import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SELF = fileURLToPath(import.meta.url);

// Load existing server config (.env) without printing any values.
try { require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') }); } catch (e) {}

const { connectDB, disconnectDB } = require(path.join(ROOT, 'backend', 'utils', 'database.js'));
const Payment = require(path.join(ROOT, 'backend', 'models', 'Payment.js'));
const Wallet = require(path.join(ROOT, 'backend', 'models', 'Wallet.js'));
const Transaction = require(path.join(ROOT, 'backend', 'models', 'Transaction.js'));
const HubtelPaymentService = require(path.join(ROOT, 'backend', 'services', 'HubtelPaymentService.js'));
const CallbackVerificationService = require(path.join(ROOT, 'backend', 'services', 'callbackVerificationService.js'));
const logger = require(path.join(ROOT, 'backend', 'utils', 'logger.js'));
const mongoose = require('mongoose');

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

/**
 * Core credit logic. Operates on injected models (real or fakes) and never
 * connects to the database itself, so it can be tested in isolation.
 * Prints before/after snapshots; prints no secrets.
 *
 * Supported options:
 *   reference   - clientReference or hubtelCheckoutId (provider path)
 *   apply       - when true, writes the credit; default dry run
 *   manual      - administrative manual-credit path (skips the provider call)
 *   amount      - required with --manual; must equal the recorded amount exactly
 *   hubtelId    - required with --manual; looks the payment up by hubtelTransactionId
 *   reason      - required with --manual; stored as manualReason
 *   db          - required with --manual; must match connectedDbName
 *   connectedDbName - database name the script is connected to (injected for tests)
 */
async function processReference({
  reference, apply, manual, amount, hubtelId, reason, db, connectedDbName,
  Payment, Wallet, Transaction, log = console.log
}) {
  // ---------- Manual credit path: no provider call ----------
  if (manual) {
    if (!apply) {
      throw new Error('Manual credit requires --apply. Default is a dry run (no changes).');
    }
    if (!db) {
      throw new Error('Manual credit requires --db <name>.');
    }
    if (connectedDbName != null && String(db) !== String(connectedDbName)) {
      throw new Error(`Refusing manual credit: --db '${db}' does not match connected database '${connectedDbName}'.`);
    }
    if (!hubtelId) {
      throw new Error('Manual credit requires --hubtel-id <Hubtel transaction id>.');
    }
    if (!reason) {
      throw new Error('Manual credit requires --reason <text>.');
    }

    const payment = await Payment.findOne({ hubtelTransactionId: hubtelId })
      || (reference ? await Payment.findOne({ clientReference: reference }) : null);
    if (!payment) {
      throw new Error(`No payment found for Hubtel transaction id ${hubtelId}.`);
    }

    const userId = payment.userId;
    const wallet = await Wallet.findOne({ userId });
    const balanceBefore = wallet ? wallet.balance : null;

    log('=== BEFORE SNAPSHOT ===');
    log(JSON.stringify({
      reference: payment.clientReference,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      hubtelCheckoutId: payment.hubtelCheckoutId || null,
      hubtelTransactionId: payment.hubtelTransactionId || null,
      callbackVerified: payment.callbackVerified || false,
      verifiedBy: payment.verifiedBy || null,
      paidAt: payment.paidAt || null,
      userId,
      walletBalance: balanceBefore,
      walletSmsBalance: wallet ? wallet.smsBalance : null
    }, null, 2));

    if (payment.status !== 'pending') {
      throw new Error(`Refusing to credit: payment ${payment.clientReference} is '${payment.status}', not pending.`);
    }

    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount)) {
      throw new Error(`Invalid --amount '${amount}'.`);
    }
    if (requestedAmount !== payment.amount) {
      throw new Error(`Refusing to credit: --amount ${requestedAmount} does not equal recorded payment amount ${payment.amount}.`);
    }

    log('=== MANUAL CREDIT (provider check skipped) ===');
    log(JSON.stringify({
      reference: payment.clientReference,
      hubtelId,
      amount: payment.amount,
      reason
    }, null, 2));

    const svc = new CallbackVerificationService({ Payment, Transaction, Wallet });
    const creditResult = await svc.creditWalletOnce(
      userId,
      payment.amount,
      reason,
      `PAYMENT-${payment.clientReference}`
    );

    const updated = await Payment.findOneAndUpdate(
      { clientReference: payment.clientReference, status: 'pending' },
      {
        $set: {
          status: 'paid',
          callbackVerified: true,
          verifiedBy: 'manual',
          manualReason: reason,
          manualHubtelId: hubtelId,
          manualAt: new Date(),
          hubtelTransactionId: hubtelId,
          paymentMethod: payment.paymentMethod || 'unknown',
          paidAt: new Date()
        }
      },
      { new: true }
    );

    const updatedPayment = await Payment.findOne({ clientReference: payment.clientReference });
    const updatedWallet = await Wallet.findOne({ userId });
    const result = {
      reference: payment.clientReference,
      amount: payment.amount,
      userId,
      applied: creditResult.credited === true,
      alreadyCredited: creditResult.alreadyCredited === true,
      manual: true
    };

    log('=== AFTER SNAPSHOT ===');
    log(JSON.stringify({
      reference: updatedPayment ? updatedPayment.clientReference : payment.clientReference,
      status: updatedPayment ? updatedPayment.status : payment.status,
      amount: updatedPayment ? updatedPayment.amount : payment.amount,
      walletBalance: updatedWallet ? updatedWallet.balance : balanceBefore,
      walletSmsBalance: updatedWallet ? updatedWallet.smsBalance : null,
      creditAlreadyRecorded: result.alreadyCredited,
      creditApplied: result.applied
    }, null, 2));

    logger.info('[credit-reference] Manual credit applied', { reference: payment.clientReference, amount: payment.amount, userId, result: creditResult });
    return result;
  }

  // ---------- Provider verification path (default) ----------
  const payment = await Payment.findOne({ clientReference: reference }) || await Payment.findOne({ hubtelCheckoutId: reference });
  if (!payment) {
    throw new Error(`No payment transaction found for reference ${reference}`);
  }

  const userId = payment.userId;
  const wallet = await Wallet.findOne({ userId });
  const balanceBefore = wallet ? wallet.balance : null;

  log('=== BEFORE SNAPSHOT ===');
  log(JSON.stringify({
    reference: payment.clientReference,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    hubtelCheckoutId: payment.hubtelCheckoutId || null,
    callbackVerified: payment.callbackVerified || false,
    paidAt: payment.paidAt || null,
    userId,
    walletBalance: balanceBefore,
    walletSmsBalance: wallet ? wallet.smsBalance : null
  }, null, 2));

  // Verify the payment with the provider (GET only).
  const provider = new HubtelPaymentService();
  let providerStatus;
  try {
    providerStatus = await provider.checkTransactionStatus(reference);
  } catch (err) {
    throw new Error(`Provider verification failed for ${reference}: ${err.message}`);
  }

  const providerAmount = Number(providerStatus.amount) || 0;
  const status = normalizeStatus(providerStatus.status);
  const isSuccess = status === 'paid' || status === 'success';
  const amountOk = providerAmount != null && Math.round(providerAmount * 100) >= Math.round(payment.amount * 100);
  const alreadyPaid = payment.status === 'paid';

  log('=== PROVIDER VERIFY (GET) ===');
  log(JSON.stringify({
    reference,
    providerStatus: providerStatus.status,
    providerAmount,
    currency: providerStatus.currency,
    transactionId: providerStatus.transactionId || null,
    amountOk,
    isSuccess
  }, null, 2));

  if (!isSuccess) {
    throw new Error(`Refusing to credit: provider status for ${reference} is '${providerStatus.status}', not success.`);
  }
  if (!amountOk) {
    throw new Error(`Refusing to credit: provider amount ${providerAmount} is less than transaction amount ${payment.amount}.`);
  }
  if (alreadyPaid) {
    throw new Error(`Refusing to credit: transaction ${reference} is already paid.`);
  }

  const result = { reference, amount: payment.amount, userId, applied: false, alreadyCredited: false };

  if (!apply) {
    log('=== DRY RUN (no changes made) ===');
    log(`Would credit wallet for user ${userId} with ${payment.amount} ${payment.currency} via reference PAYMENT-${payment.clientReference}`);
    log('Re-run with --apply to apply the credit.');
    return result;
  }

  const svc = new CallbackVerificationService({ Payment, Transaction, Wallet });
  const creditResult = await svc.creditWalletOnce(
    userId,
    payment.amount,
    `Wallet top-up via Hubtel (${payment.amount} GHS)`,
    `PAYMENT-${payment.clientReference}`
  );

  const updatedPayment = await Payment.findOne({ clientReference: reference });
  const updatedWallet = await Wallet.findOne({ userId });
  result.applied = creditResult.credited === true;
  result.alreadyCredited = creditResult.alreadyCredited === true;

  log('=== AFTER SNAPSHOT ===');
  log(JSON.stringify({
    reference: updatedPayment ? updatedPayment.clientReference : reference,
    status: updatedPayment ? updatedPayment.status : payment.status,
    amount: updatedPayment ? updatedPayment.amount : payment.amount,
    walletBalance: updatedWallet ? updatedWallet.balance : balanceBefore,
    walletSmsBalance: updatedWallet ? updatedWallet.smsBalance : null,
    creditAlreadyRecorded: result.alreadyCredited,
    creditApplied: result.applied
  }, null, 2));

  logger.info('[credit-reference] Credit applied', { reference, amount: payment.amount, userId, result: creditResult });
  return result;
}

/** Parse command line flags. */
function parseArgs(argv) {
  const args = { _: [], manual: false, apply: false, amount: null, hubtelId: null, reason: null, db: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manual') {
      args.manual = true;
    } else if (a === '--apply') {
      args.apply = true;
    } else if (a === '--db') {
      args.db = argv[++i];
    } else if (a === '--amount') {
      args.amount = argv[++i];
    } else if (a === '--hubtel-id') {
      args.hubtelId = argv[++i];
    } else if (a === '--reason') {
      args.reason = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

/** Mask the database host in the connection URI; never print credentials. */
function maskDatabaseHost(uri) {
  try {
    const u = new URL(uri);
    const host = u.hostname;
    const parts = host.split('.');
    if (parts.length <= 2) return '*'.repeat(host.length);
    return parts.slice(0, -2).map(() => '**').join('.') + '.' + parts.slice(-2).join('.');
  } catch {
    return '<unparseable>';
  }
}

/** Human-safe database description: masked host + database name, no credentials. */
function databaseDescription() {
  const uri = process.env.MONGODB_URI || '';
  const name = mongoose.connection.name || '<unknown>';
  return `${maskDatabaseHost(uri)}/${name}`;
}

/** CLI entry point. Only runs when this file is invoked directly. */
async function main() {
  const args = parseArgs(process.argv);

  if (process.env.RAILWAY || process.env.RAILWAY_ENVIRONMENT) {
    console.warn('WARNING: running under `railway run` — the Hubtel status check originates from this machine\'s IP rather than the server\'s IP. Provider IP allowlists may not match.');
  }

  const ref = args._[0];
  if (!ref && !args.manual) {
    console.error('Usage: node scripts/credit-reference.mjs <reference> [--apply]');
    console.error('       Default is a dry run. Use --apply to credit the wallet.');
    process.exit(1);
  }
  if (args.manual && (!args.apply || !args.db)) {
    console.error('Usage: node scripts/credit-reference.mjs --manual --apply --db <name> --amount <GHS> --hubtel-id <Hubtel transaction id> --reason <text>');
    console.error('       --manual requires --apply and --db. Default is a dry run (no changes).');
    process.exit(1);
  }

  await connectDB();
  const connectedDbName = mongoose.connection.name;
  try {
    console.log(`Database: ${databaseDescription()}`);
    await processReference({
      reference: ref, apply: args.apply, manual: args.manual, amount: args.amount,
      hubtelId: args.hubtelId, reason: args.reason, db: args.db, connectedDbName,
      Payment, Wallet, Transaction, log: console.log
    });
  } finally {
    await disconnectDB();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (isMain) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

export { processReference, normalizeStatus };
