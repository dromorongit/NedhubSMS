const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const Payment = require(path.join(__dirname, '..', 'models', 'Payment'));
const Transaction = require(path.join(__dirname, '..', 'models', 'Transaction'));
const Wallet = require(path.join(__dirname, '..', 'models', 'Wallet'));
const CallbackVerificationService = require(path.join(__dirname, '..', 'services', 'callbackVerificationService'));
const logger = require(path.join(__dirname, '..', 'utils', 'logger'));

function parseArgs(argv) {
  const args = {
    apply: false,
    confirm: false,
    minutes: 10,
    importCsv: null,
    positional: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--confirm') args.confirm = true;
    else if (a === '--minutes' || a === '--older-than') { args.minutes = Number(argv[++i]); }
    else if (a === '--import-csv') { args.importCsv = argv[++i]; }
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

/**
 * Parse a CSV export from the Hubtel dashboard.
 * Expected columns: clientReference, amount, status (and any others are ignored).
 * Returns array of { clientReference, amount, status }.
 */
function parseHubtelCsv(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const refIdx = header.indexOf('clientreference');
  const amountIdx = header.indexOf('amount');
  const statusIdx = header.indexOf('status');

  if (refIdx < 0 || amountIdx < 0 || statusIdx < 0) {
    throw new Error('CSV must have columns: clientReference, amount, status');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    if (cols.length <= Math.max(refIdx, amountIdx, statusIdx)) continue;
    rows.push({
      clientReference: cols[refIdx],
      amount: parseFloat(cols[amountIdx]),
      status: cols[statusIdx]
    });
  }
  return rows;
}

async function recoverPendingTopups(options = {}) {
  const {
    apply = false,
    olderThanMinutes = 10,
    importCsv = null,
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
  const results = { payments: [], credited: 0, skipped: 0, errors: [] };

  // Load Hubtel CSV import if provided
  let hubtelPaidMap = null;
  if (importCsv) {
    hubtelPaidMap = new Map();
    const rows = parseHubtelCsv(importCsv);
    for (const row of rows) {
      if (row.status && /paid|success|completed/i.test(row.status)) {
        hubtelPaidMap.set(row.clientReference, row);
      }
    }
    console.log(`Loaded ${hubtelPaidMap.size} paid references from Hubtel CSV import`);
  }

  // Pending payments
  const pendingPayments = await PaymentModel.find({
    status: { $in: ['pending', 'processing'] },
    createdAt: { $lt: cutoff }
  });

  console.log(`Found ${pendingPayments.length} pending payment(s) older than ${olderThanMinutes} minutes`);

  for (const payment of pendingPayments) {
    let providerStatus = 'unknown';
    let providerAmount = null;
    let providerReachable = false;
    let action = 'no change';
    let wouldCredit = false;

    if (hubtelPaidMap) {
      // CSV import mode: match by clientReference and amount
      const hubtelRow = hubtelPaidMap.get(payment.clientReference);
      if (hubtelRow) {
        providerStatus = hubtelRow.status;
        providerAmount = hubtelRow.amount;
        providerReachable = true;
        wouldCredit = Number(hubtelRow.amount || 0) >= payment.amount;
        action = wouldCredit ? (apply ? 'CREDIT' : 'would credit') : 'would not credit (amount mismatch or not paid)';
      } else {
        action = 'not in Hubtel paid list - skipping';
        results.skipped++;
        results.payments.push({ reference: payment.clientReference, ourAmount: payment.amount, providerStatus: 'not_in_csv', providerAmount: null, action });
        continue;
      }
    } else {
      // Hubtel API mode: query the status check API
      try {
        const provider = await service.checkProviderStatus('payment', payment.clientReference);
        providerReachable = provider.ok;
        providerStatus = provider.ok ? provider.status : 'unavailable';
        providerAmount = provider.ok ? provider.amount : null;
        wouldCredit = provider.ok && provider.status === 'paid' && Number(providerAmount || 0) >= payment.amount;
        action = wouldCredit ? (apply ? 'CREDIT' : 'would credit')
          : provider.ok ? 'would not credit (provider not paid)'
          : 'provider unavailable - skipping';
      } catch (err) {
        providerReachable = false;
        providerStatus = 'error';
        action = `provider error: ${err.message} - skipping`;
        results.errors.push({ reference: payment.clientReference, error: err.message });
        results.payments.push({ reference: payment.clientReference, ourAmount: payment.amount, providerStatus: 'error', providerAmount: null, action });
        continue;
      }
    }

    const line = `PAYMENT reference=${payment.clientReference} userId=${payment.userId} ourAmount=${payment.amount} providerStatus=${providerStatus} providerAmount=${providerAmount} -> ${action}`;
    console.log(line);
    results.payments.push({ reference: payment.clientReference, userId: payment.userId, ourAmount: payment.amount, providerStatus, providerAmount, action, providerReachable });

    if (apply && wouldCredit && providerReachable) {
      try {
        const result = await service.processPaymentCallback(payment.clientReference);
        if (result.action === 'credit' && result.applied) {
          results.credited++;
          console.log(`  -> CREDITED wallet for ${payment.clientReference} (${payment.amount} GHS)`);
        } else if (result.action === 'credit' && !result.applied) {
          console.log(`  -> already credited (idempotent skip)`);
        } else {
          console.log(`  -> action=${result.action}, no credit applied`);
        }
      } catch (err) {
        console.error(`  -> CREDIT FAILED for ${payment.clientReference}: ${err.message}`);
        results.errors.push({ reference: payment.clientReference, error: err.message, phase: 'credit' });
      }
    } else if (apply && !wouldCredit) {
      results.skipped++;
    }
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply && !args.confirm) {
    console.error('ERROR: --apply requires --confirm to prevent accidental production runs.');
    console.error('Usage: node backend/scripts/recover-pending-topups.js --apply --confirm [--minutes N] [--import-csv path]');
    console.error('Run the dry run first (no --apply), review the output, then re-run with --apply --confirm.');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  console.log(`DB host: ${dbHost(uri)}`);

  if (uri) {
    await mongoose.connect(uri);
  }

  try {
    const results = await recoverPendingTopups({
      apply: args.apply,
      olderThanMinutes: args.minutes,
      importCsv: args.importCsv
    });

    if (args.apply) {
      console.log('\n=== APPLY SUMMARY ===');
    } else {
      console.log('\n=== DRY RUN SUMMARY ===');
    }
    console.log(`Pending payments found: ${results.payments.length}`);
    console.log(`${args.apply ? 'Credited' : 'Would credit'}: ${results.credited}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Errors: ${results.errors.length}`);
    if (results.errors.length > 0) {
      console.log('Errors:');
      results.errors.forEach(e => console.log(`  ${e.reference}: ${e.error}`));
    }
  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Recover failed:', err.message);
    process.exit(1);
  });
}

module.exports = { recoverPendingTopups, parseArgs, parseHubtelCsv, dbHost, main };
