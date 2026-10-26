const path = require('path');
const mongoose = require('mongoose');

const Transaction = require(path.join(__dirname, '..', 'backend', 'models', 'Transaction'));
const CallbackVerificationService = require(path.join(__dirname, '..', 'backend', 'services', 'callbackVerificationService'));

function parseArgs(argv) {
  const args = { checkHubtel: false, envCheck: false, days: 90, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check-hubtel') args.checkHubtel = true;
    else if (a === '--env-check') args.envCheck = true;
    else if (a === '--days') { args.days = Number(argv[++i]); }
    else args.positional.push(a);
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

async function auditWalletCredits(options = {}) {
  const {
    checkHubtel = false,
    days = 90,
    env = process.env,
    TransactionModel = Transaction,
    paymentService = null
  } = options;

  const service = options.verificationService || new CallbackVerificationService({
    Transaction: TransactionModel,
    Payment: options.PaymentModel,
    Wallet: options.WalletModel
  });

  const ps = paymentService || service.paymentService;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const credits = await TransactionModel.find({
    type: 'credit',
    reference: { $regex: /^PAYMENT-/ },
    createdAt: { $gte: cutoff }
  }).sort({ createdAt: -1 });

  const results = { credits: [], refunds: [], flags: [] };

  for (const tx of credits) {
    const clientReference = String(tx.reference).replace(/^PAYMENT-/, '');
    const line = `CREDIT reference=${tx.reference} amount=${tx.amount} timestamp=${tx.createdAt.toISOString()} userId=${tx.userId}`;
    console.log(line);
    results.credits.push({ reference: tx.reference, amount: tx.amount, timestamp: tx.createdAt, userId: tx.userId });

    if (checkHubtel) {
      try {
        const provider = await ps.checkTransactionStatus(clientReference);
        const status = provider && provider.status;
        const amount = provider && (provider.amount || provider.totalAmount);
        if (!(status === 'paid') || (amount != null && Number(amount) < tx.amount)) {
          const flag = `FLAG credit reference=${tx.reference} reason=provider_not_paid_or_lower_amount providerStatus=${status} providerAmount=${amount} ourAmount=${tx.amount}`;
          console.log(flag);
          results.flags.push({ reference: tx.reference, reason: 'provider_not_paid_or_lower_amount', providerStatus: status, providerAmount: amount, ourAmount: tx.amount });
        }
      } catch (err) {
        const flag = `FLAG credit reference=${tx.reference} reason=provider_check_failed error=${err.message}`;
        console.log(flag);
        results.flags.push({ reference: tx.reference, reason: 'provider_check_failed', error: err.message });
      }
    }
  }

  // Refunds
  const refunds = await TransactionModel.find({
    type: 'credit',
    reference: { $regex: /^REFUND-/ },
    createdAt: { $gte: cutoff }
  }).sort({ createdAt: -1 });

  for (const tx of refunds) {
    const origRef = String(tx.reference).replace(/^REFUND-/, '');
    console.log(`REFUND reference=${tx.reference} amount=${tx.amount} timestamp=${tx.createdAt.toISOString()} userId=${tx.userId} originalReference=${origRef}`);

    // Find original transaction
    const original = await TransactionModel.findOne({ reference: origRef });

    // Determine provider status for original if possible
    let providerStatus = null;
    if (checkHubtel) {
      // Decide kind: try transfer/commission based on original metadata
      const ttype = original && original.metadata && original.metadata.transactionType;
      const kind = (ttype === 'AIRTIME_PURCHASE' || ttype === 'DATA_PURCHASE') ? 'transfer' : 'commission';
      const svc = (kind === 'transfer') ? service.transferService : service.commissionService;
      try {
        const provider = await svc.checkTransactionStatus(origRef);
        providerStatus = provider && provider.status;
      } catch (err) {
        providerStatus = 'error';
      }
      if (!(providerStatus === 'failed' || providerStatus === 'cancelled')) {
        const flag = `FLAG refund reference=${tx.reference} reason=no_failed_provider_status providerStatus=${providerStatus} originalReference=${origRef}`;
        console.log(flag);
        results.flags.push({ reference: tx.reference, reason: 'no_failed_provider_status', providerStatus, originalReference: origRef });
      }
    } else {
      // Without hubtel check, flag refunds whose original transaction is not failed
      if (!original || original.status !== 'failed') {
        const flag = `FLAG refund reference=${tx.reference} reason=no_failed_original_transaction originalStatus=${original ? original.status : 'missing'}`;
        console.log(flag);
        results.flags.push({ reference: tx.reference, reason: 'no_failed_original_transaction', originalStatus: original ? original.status : 'missing' });
      }
    }

    results.refunds.push({ reference: tx.reference, amount: tx.amount, timestamp: tx.createdAt, userId: tx.userId, originalReference: origRef, providerStatus });
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.envCheck) {
    console.log(`DB host: ${dbHost(process.env.MONGODB_URI)}`);
  }

  const uri = process.env.MONGODB_URI;
  if (uri) {
    await mongoose.connect(uri);
  }

  try {
    await auditWalletCredits({ checkHubtel: args.checkHubtel, days: args.days, env: process.env });
  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Audit failed:', err.message);
    process.exit(1);
  });
}

module.exports = { auditWalletCredits, parseArgs, dbHost, main };
module.exports.audit = auditWalletCredits;
module.exports.run = auditWalletCredits;
module.exports.runAudit = auditWalletCredits;
module.exports.default = auditWalletCredits;
