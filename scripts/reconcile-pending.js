const path = require('path');
const mongoose = require('mongoose');

const Payment = require(path.join(__dirname, '..', 'backend', 'models', 'Payment'));
const Transaction = require(path.join(__dirname, '..', 'backend', 'models', 'Transaction'));
const Wallet = require(path.join(__dirname, '..', 'backend', 'models', 'Wallet'));
const CallbackVerificationService = require(path.join(__dirname, '..', 'backend', 'services', 'callbackVerificationService'));
const logger = require(path.join(__dirname, '..', 'backend', 'utils', 'logger'));

function parseArgs(argv) {
  const args = { apply: false, envCheck: false, minutes: 10, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--env-check') args.envCheck = true;
    else if (a === '--minutes' || a === '--older-than') { args.minutes = Number(argv[++i]); }
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

async function reconcilePending(options = {}) {
  const {
    apply = false,
    env = process.env,
    olderThanMinutes = 10,
    PaymentModel = Payment,
    TransactionModel = Transaction,
    WalletModel = Wallet,
    verificationService: injectedService
  } = options;

  const service = injectedService || new CallbackVerificationService({
    Payment: PaymentModel,
    Transaction: TransactionModel,
    Wallet: WalletModel
  });

  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const results = { payments: [], transactions: [] };

  // Pending payments
  const pendingPayments = await PaymentModel.find({
    status: { $in: ['pending', 'processing'] },
    createdAt: { $lt: cutoff }
  });

  for (const payment of pendingPayments) {
    const provider = await service.checkProviderStatus('payment', payment.clientReference);
    const providerStatus = provider.ok ? provider.status : 'unavailable';
    const providerAmount = provider.ok ? provider.amount : null;
    const wouldCredit = provider.ok && provider.status === 'paid' && Number(providerAmount || 0) >= payment.amount;

    const line = `PAYMENT reference=${payment.clientReference} ourAmount=${payment.amount} providerStatus=${providerStatus} providerAmount=${providerAmount} -> ${wouldCredit ? (apply ? 'CREDIT' : 'would credit') : (apply ? 'no change' : 'would not credit')}`;
    console.log(line);
    results.payments.push({ reference: payment.clientReference, ourAmount: payment.amount, providerStatus, providerAmount, wouldCredit });

    if (apply) {
      await service.processPaymentCallback(payment.clientReference);
    }
  }

  // Waiting airtime/data/tv/utility transactions
  const waitingTxns = await TransactionModel.find({
    status: { $in: ['pending_confirmation', 'pending'] },
    createdAt: { $lt: cutoff }
  });

  for (const tx of waitingTxns) {
    const ttype = tx.metadata && tx.metadata.transactionType;
    if (!['AIRTIME_PURCHASE', 'DATA_PURCHASE', 'TV_PAYMENT', 'UTILITY_PAYMENT'].includes(ttype)) {
      continue;
    }
    const kind = (ttype === 'AIRTIME_PURCHASE' || ttype === 'DATA_PURCHASE') ? 'transfer' : 'commission';

    const provider = await service.checkProviderStatus(kind, tx.reference);
    const providerStatus = provider.ok ? provider.status : 'unavailable';

    let action;
    if (!provider.ok) action = 'leave waiting (provider unavailable)';
    else if (provider.status === 'success' || provider.status === 'paid') action = apply ? 'COMPLETE' : 'would complete';
    else if (provider.status === 'failed' || provider.status === 'cancelled') action = apply ? 'REFUND' : 'would refund';
    else action = 'leave waiting';

    const line = `TRANSACTION reference=${tx.reference} type=${ttype} ourAmount=${tx.amount} providerStatus=${providerStatus} -> ${action}`;
    console.log(line);
    results.transactions.push({ reference: tx.reference, type: ttype, ourAmount: tx.amount, providerStatus, action });

    if (apply) {
      if (ttype === 'AIRTIME_PURCHASE') await service.processAirtimeCallback(tx.reference);
      else if (ttype === 'DATA_PURCHASE') await service.processDataCallback(tx.reference);
      else if (ttype === 'TV_PAYMENT') await service.processTvCallback(tx.reference);
      else if (ttype === 'UTILITY_PAYMENT') await service.processUtilityCallback(tx.reference);
    }
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.envCheck) {
    console.error('Refusing to run without --env-check. Re-run with --env-check to print the database host.');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  console.log(`DB host: ${dbHost(uri)}`);

  if (uri) {
    await mongoose.connect(uri);
  }

  try {
    await reconcilePending({ apply: args.apply, olderThanMinutes: args.minutes });
  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Reconcile failed:', err.message);
    process.exit(1);
  });
}

module.exports = { reconcilePending, parseArgs, dbHost, main };
module.exports.reconcile = reconcilePending;
module.exports.run = reconcilePending;
module.exports.runReconcile = reconcilePending;
module.exports.default = reconcilePending;
