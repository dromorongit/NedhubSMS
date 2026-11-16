const path = require('path');
const mongoose = require('mongoose');

const Payment = require(path.join(__dirname, '..', 'models', 'Payment'));
const Transaction = require(path.join(__dirname, '..', 'models', 'Transaction'));
const Wallet = require(path.join(__dirname, '..', 'models', 'Wallet'));
const AuditLog = require(path.join(__dirname, '..', 'models', 'AuditLog'));
const logger = require(path.join(__dirname, '..', 'utils', 'logger'));

const PAYMENT_PENDING_STATUSES = ['pending', 'processing'];
const CREDIT_REFERENCE_PREFIX = 'PAYMENT-';

function parseArgs(argv) {
  const args = {
    reference: null,
    amount: null,
    confirm: false,
    adminId: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reference') { args.reference = argv[++i]; }
    else if (a === '--amount') { args.amount = parseFloat(argv[++i]); }
    else if (a === '--confirm') { args.confirm = true; }
    else if (a === '--admin-id') { args.adminId = argv[++i]; }
  }
  return args;
}

function dbHost(uri) {
  try {
    const u = new URL(uri);
    return u.hostname || '(unknown host)';
  } catch (e) {
    const m = String(uri || '').match(/@([^/:]+)/);
    return m ? m[1] : '(unknown host)';
  }
}

function formatMoney(n) {
  return Number(n || 0).toFixed(2);
}

/**
 * Credit a wallet exactly once for a reference (same idempotent pattern as
 * creditWalletOnce in callbackVerificationService). Never calls Hubtel.
 */
async function creditWalletOnce(TransactionModel, WalletModel, userId, amount, description, reference) {
  const existing = await TransactionModel.findOne({ reference });
  if (existing) {
    return { alreadyCredited: true };
  }

  const wallet = await WalletModel.findOne({ userId });
  const balanceBefore = wallet ? Number(wallet.balance) : 0;

  const transaction = new TransactionModel({
    userId,
    type: 'credit',
    amount,
    description,
    reference,
    balanceBefore,
    balanceAfter: balanceBefore + amount,
    status: 'pending'
  });
  try {
    await transaction.save();
  } catch (err) {
    if (err && (err.code === 11000 || /duplicate key/i.test(err.message || ''))) {
      return { alreadyCredited: true };
    }
    throw err;
  }

  await WalletModel.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount, smsBalance: amount }, $set: { updatedAt: new Date() } }
  );

  await TransactionModel.updateOne(
    { _id: transaction._id },
    { $set: { status: 'completed' } }
  );

  logger.info('[CreditSingle] Wallet credited', { reference, amount, outcome: 'credited' });
  return { credited: true, balanceBefore, balanceAfter: balanceBefore + amount };
}

async function creditSinglePayment(options = {}) {
  const {
    reference,
    amount,
    confirm = false,
    adminId = null,
    PaymentModel = Payment,
    TransactionModel = Transaction,
    WalletModel = Wallet,
    AuditLogModel = AuditLog
  } = options;

  if (!reference) {
    throw new Error('--reference <clientReference> is required');
  }
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('--amount <GHS amount> is required and must be positive');
  }

  const uri = process.env.MONGODB_URI;
  console.log(`DB host: ${dbHost(uri)}`);
  console.log(`Mode: ${confirm ? 'APPLY (will write to database)' : 'DRY RUN (no changes will be made)'}`);
  console.log(`Reference: ${reference}`);
  console.log(`Amount: GHS ${formatMoney(amount)}`);

  if (uri) {
    await mongoose.connect(uri);
  }

  try {
    // Find the payment by clientReference
    const payment = await PaymentModel.findOne({ clientReference: reference });
    if (!payment) {
      console.log(`No payment found with reference ${reference}. Nothing to do.`);
      return { action: 'not_found', reference };
    }

    console.log(`Payment found: status=${payment.status} storedAmount=GHS ${formatMoney(payment.amount)} userId=${payment.userId}`);

    // Only credit pending or processing payments
    if (!PAYMENT_PENDING_STATUSES.includes(payment.status)) {
      console.log(`Payment status is '${payment.status}' (not pending/processing). Refusing to credit.`);
      return { action: 'not_pending', reference, status: payment.status };
    }

    // Stored amount must match --amount exactly
    if (Math.round(payment.amount * 100) !== Math.round(amount * 100)) {
      console.log(`Amount mismatch: stored=GHS ${formatMoney(payment.amount)} requested=GHS ${formatMoney(amount)}. Refusing to credit.`);
      return { action: 'amount_mismatch', reference, storedAmount: payment.amount, requestedAmount: amount };
    }

    // Already paid? (defensive - status check above should catch this)
    if (payment.status === 'paid') {
      console.log(`Payment is already paid. Nothing to do.`);
      return { action: 'already_terminal', reference, status: payment.status };
    }

    if (!confirm) {
      console.log(`DRY RUN: Would credit wallet for user ${payment.userId} with GHS ${formatMoney(amount)} (reference ${reference}). Re-run with --confirm to apply.`);
      return { action: 'would_credit', reference, amount, userId: payment.userId };
    }

    // ---- APPLY PATH ----

    // Atomic pending-to-paid conditional update (same as applyPaymentAssessment).
    // Only one request can win this transition, so it can never double-credit.
    const filter = {
      clientReference: reference,
      status: { $in: PAYMENT_PENDING_STATUSES }
    };
    const update = {
      $set: {
        status: 'paid',
        callbackVerified: true,
        verifiedBy: 'manual_admin',
        paidAt: new Date(),
        manualReason: `Manual credit via credit-single-payment.js (GHS ${formatMoney(amount)})`,
        manualAt: new Date()
      }
    };

    const updated = await PaymentModel.findOneAndUpdate(filter, { $set: update.$set }, { new: true });
    if (!updated) {
      console.log(`Conditional update lost: payment ${reference} was already transitioned by another request. No credit applied.`);
      return { action: 'lost_conditional_update', reference };
    }

    // Credit the wallet exactly once (idempotent via Transaction reference).
    const creditRef = `${CREDIT_REFERENCE_PREFIX}${reference}`;
    const creditResult = await creditWalletOnce(
      TransactionModel,
      WalletModel,
      payment.userId,
      payment.amount,
      `Wallet top-up via Hubtel (${payment.amount} GHS) - Manual admin credit`,
      creditRef
    );

    // Write AuditLog entry (who, when, reference, amount, reason).
    const auditAdminId = adminId || new mongoose.Types.ObjectId();
    await AuditLogModel.log({
      adminId: auditAdminId,
      action: 'manual_wallet_credit',
      targetType: 'payment',
      targetId: payment._id,
      details: {
        reference,
        amount: payment.amount,
        reason: 'manual_admin',
        verifiedBy: 'manual_admin',
        credited: creditResult.credited || creditResult.alreadyCredited,
        balanceBefore: creditResult.balanceBefore,
        balanceAfter: creditResult.balanceAfter
      }
    });

    // Print wallet balance before and after.
    const walletAfter = await WalletModel.findOne({ userId: payment.userId });
    const balanceAfter = walletAfter ? Number(walletAfter.balance) : 0;

    console.log(`CREDITED wallet for user ${payment.userId}: GHS ${formatMoney(payment.amount)}`);
    console.log(`  Reference: ${reference}`);
    console.log(`  Wallet balance after: GHS ${formatMoney(balanceAfter)}`);
    console.log(`  AuditLog entry written (action=manual_wallet_credit, targetType=payment)`);

    return {
      action: 'credited',
      reference,
      amount: payment.amount,
      userId: payment.userId,
      walletBalanceBefore: creditResult.balanceBefore,
      walletBalanceAfter: balanceAfter,
      applied: true
    };
  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.reference) {
    console.error('ERROR: --reference <clientReference> is required.');
    console.error('Usage: node backend/scripts/credit-single-payment.js --reference NH-... --amount 50.00 [--confirm] [--admin-id <adminUserId>]');
    console.error('Default is dry run. Add --confirm to apply the credit to the production database.');
    process.exit(1);
  }

  if (args.amount == null || !Number.isFinite(args.amount) || args.amount <= 0) {
    console.error('ERROR: --amount <GHS amount> is required and must be a positive number.');
    console.error('Usage: node backend/scripts/credit-single-payment.js --reference NH-... --amount 50.00 [--confirm] [--admin-id <adminUserId>]');
    process.exit(1);
  }

  const result = await creditSinglePayment({
    reference: args.reference,
    amount: args.amount,
    confirm: args.confirm,
    adminId: args.adminId
  });

  if (result.action === 'credited' || result.action === 'would_credit') {
    process.exit(0);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Credit single payment failed:', err.message);
    process.exit(1);
  });
}

module.exports = { creditSinglePayment, parseArgs, creditWalletOnce, dbHost };
