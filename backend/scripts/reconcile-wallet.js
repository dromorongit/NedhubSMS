// READ-ONLY wallet reconciliation helper.
//
// This script performs NO writes, no updates, and no saves to MongoDB.
// It only reads Wallet and Transaction documents.
//
// Usage:
//   node backend/scripts/reconcile-wallet.js <userId>
//   node backend/scripts/reconcile-wallet.js --all-users
//   node backend/scripts/reconcile-wallet.js --user-details <userId>
// Environment: MONGODB_URI must point to the target (test) database.
//   WALLET_FIX_DATE overrides the debit-at-creation fix cutoff
//   (default: 2026-11-08T20:28:27Z, commit 26cea98).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

// Cutoff: before this, pending SMS-debits and pending top-up credits moved the
// wallet but were never marked completed (legacy). At/after this, pending and
// pending_confirmation debits move the wallet via debit-at-creation.
const FIX_DATE = new Date(process.env.WALLET_FIX_DATE || '2026-11-08T20:28:27Z');

const allUsers = process.argv.includes('--all-users');
const udIdx = process.argv.indexOf('--user-details');
const userDetailsId = udIdx !== -1 ? process.argv[udIdx + 1] : null;

function maskUserId(userId) {
  const s = String(userId);
  return s.length <= 4 ? s : '*'.repeat(s.length - 4) + s.slice(-4);
}

function sumAmount(transactions, predicate) {
  return transactions
    .filter(predicate)
    .reduce((total, t) => total + Number(t.amount || 0), 0);
}

function isAfterFix(tx) {
  return new Date(tx.createdAt) >= FIX_DATE;
}

// A transaction "moved the wallet" if money actually changed hands:
// - completed credits/debits always
// - pending / pending_confirmation debits (reserve/move money immediately)
// - pending credits created before FIX_DATE (legacy top-up that moved wallet)
function isWalletMoving(tx) {
  const amount = Number(tx.amount || 0);
  if (amount <= 0) return false;
  if (tx.status === 'completed') return true;
  if (tx.status === 'pending' || tx.status === 'pending_confirmation') {
    if (tx.type === 'debit') return true;
    if (tx.type === 'credit' && !isAfterFix(tx)) return true;
  }
  return false;
}

function userQuery(userId) {
  return mongoose.Types.ObjectId.isValid(userId)
    ? { userId: new mongoose.Types.ObjectId(userId) }
    : { userId };
}

async function reconcileUser(userId) {
  const query = userQuery(userId);
  const [wallet, transactions] = await Promise.all([
    Wallet.findOne(query).lean(),
    Transaction.find(query).lean().sort({ createdAt: 1 }),
  ]);

  const completed = transactions.filter((t) => t.status === 'completed');
  const pending = transactions.filter((t) => t.status === 'pending');
  const pendingConfirmation = transactions.filter((t) => t.status === 'pending_confirmation');
  const failed = transactions.filter((t) => t.status === 'failed');

  const failedWithRefund = failed.filter((fDebit) =>
    transactions.some(
      (t) =>
        t.status === 'completed' &&
        t.type === 'credit' &&
        (t.reference === fDebit.reference ||
          t.reference === fDebit._id.toString() ||
          (t.description && t.description.includes(fDebit.reference || '')))
    )
  );

  const completedCredits = sumAmount(completed, (t) => t.type === 'credit');
  const completedDebits = sumAmount(completed, (t) => t.type === 'debit');
  const pendingDebits = sumAmount(pending, (t) => t.type === 'debit');
  const pendingCredits = sumAmount(pending, (t) => t.type === 'credit');
  const pendingConfirmationDebits = sumAmount(pendingConfirmation, (t) => t.type === 'debit');
  const pendingConfirmationCredits = sumAmount(pendingConfirmation, (t) => t.type === 'credit');
  const failedDebits = sumAmount(failed, (t) => t.type === 'debit');
  const failedCredits = sumAmount(failed, (t) => t.type === 'credit');

  let walletMovingCredits = 0;
  let walletMovingDebits = 0;
  for (const tx of transactions) {
    if (!isWalletMoving(tx)) continue;
    const amount = Number(tx.amount || 0);
    if (tx.type === 'credit') walletMovingCredits += amount;
    else walletMovingDebits += amount;
  }

  let balanceMismatches = 0;
  let missingBalanceFields = 0;
  for (const tx of transactions) {
    if (tx.balanceBefore == null || tx.balanceAfter == null) {
      missingBalanceFields += 1;
      continue;
    }
    const bb = Number(tx.balanceBefore);
    const ba = Number(tx.balanceAfter);
    const amount = Number(tx.amount || 0);
    const expectedDelta = tx.type === 'credit' ? amount : -amount;
    if (ba - bb !== expectedDelta) balanceMismatches += 1;
  }

  const storedBalance = wallet ? Number(wallet.balance || 0) : 0;

  const reconciledAll = walletMovingCredits - walletMovingDebits;
  const driftAll = storedBalance - reconciledAll;
  const reconciledCompleted = completedCredits - completedDebits;
  const driftCompleted = storedBalance - reconciledCompleted;

  return {
    userId,
    mask: maskUserId(userId),
    storedBalance,
    completedCredits,
    completedDebits,
    pendingDebits,
    pendingCredits,
    pendingConfirmationDebits,
    pendingConfirmationCredits,
    failedDebits,
    failedCredits,
    failedWithRefundCount: failedWithRefund.length,
    walletMovingCredits,
    walletMovingDebits,
    reconciledAll,
    driftAll,
    reconciledCompleted,
    driftCompleted,
    balanceMismatches,
    missingBalanceFields,
    txCount: transactions.length,
    transactions,
    buckets: {
      completed: { count: completed.length, credits: completedCredits, debits: completedDebits },
      pendingLegacy: {
        count: pending.length,
        credits: pendingCredits,
        debits: pendingDebits,
      },
      pendingConfirmation: {
        count: pendingConfirmation.length,
        credits: pendingConfirmationCredits,
        debits: pendingConfirmationDebits,
      },
      failed: { count: failed.length, credits: failedCredits, debits: failedDebits },
      failedWithRefund: { count: failedWithRefund.length },
    },
  };
}

function printUserSummary(r) {
  const statusNoise = r.driftAll - r.driftCompleted;
  console.log('USER:', r.mask);
  console.log('STORED WALLET BALANCE:', r.storedBalance.toFixed(2));
  console.log('');
  console.log('WALLET-MOVING (all statuses that moved the wallet):');
  console.log(`  credits: ${r.walletMovingCredits.toFixed(2)}  debits: ${r.walletMovingDebits.toFixed(2)}  reconciled: ${r.reconciledAll.toFixed(2)}`);
  console.log('');
  console.log('COMPLETED ONLY (stricter):');
  console.log(`  credits: ${r.completedCredits.toFixed(2)}  debits: ${r.completedDebits.toFixed(2)}  reconciled: ${r.reconciledCompleted.toFixed(2)}`);
  console.log('');
  console.log('DRIFT (all wallet-moving):', r.driftAll.toFixed(2));
  console.log('DRIFT (completed only):', r.driftCompleted.toFixed(2));
  console.log('STATUS NOISE (driftAll - driftCompleted):', statusNoise.toFixed(2));
  console.log('');
  console.log('BUCKETS (count / credits / debits):');
  console.log(`  completed:               ${r.buckets.completed.count.toString().padStart(3)} / ${r.buckets.completed.credits.toFixed(2).padStart(10)} / ${r.buckets.completed.debits.toFixed(2).padStart(10)}`);
  console.log(`  pending (legacy):        ${r.buckets.pendingLegacy.count.toString().padStart(3)} / ${r.buckets.pendingLegacy.credits.toFixed(2).padStart(10)} / ${r.buckets.pendingLegacy.debits.toFixed(2).padStart(10)}`);
  console.log(`  pending_confirmation:    ${r.buckets.pendingConfirmation.count.toString().padStart(3)} / ${r.buckets.pendingConfirmation.credits.toFixed(2).padStart(10)} / ${r.buckets.pendingConfirmation.debits.toFixed(2).padStart(10)}`);
  console.log(`  failed:                  ${r.buckets.failed.count.toString().padStart(3)} / ${r.buckets.failed.credits.toFixed(2).padStart(10)} / ${r.buckets.failed.debits.toFixed(2).padStart(10)}`);
  console.log(`  failed with matching refund: ${r.buckets.failedWithRefund.count}`);
  console.log('');
  console.log('BALANCE VALIDATION:');
  console.log(`  balanceBefore/After mismatches: ${r.balanceMismatches}`);
  console.log(`  transactions missing balanceBefore/After: ${r.missingBalanceFields}`);
  console.log('');
  console.log('TRANSACTIONS:', r.txCount);
}

function printUserDetails(r) {
  const txs = r.transactions;
  if (txs.length === 0) {
    console.log('USER DETAILS:', r.mask);
    console.log('No transactions found.');
    return;
  }

  let runningBalance = txs[0].balanceBefore != null ? Number(txs[0].balanceBefore) : 0;
  let firstDivergence = -1;
  const rows = [];

  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const amount = Number(tx.amount || 0);
    const delta = isWalletMoving(tx) ? (tx.type === 'credit' ? amount : -amount) : 0;
    const computedAfter = runningBalance + delta;
    let divergence = false;
    if (tx.balanceAfter != null && computedAfter !== tx.balanceAfter) {
      divergence = true;
      if (firstDivergence === -1) firstDivergence = i;
    }
    runningBalance = tx.balanceAfter != null ? tx.balanceAfter : computedAfter;
    rows.push({ i, tx, computedAfter, divergence, delta });
  }

  console.log('USER DETAILS:', r.mask);
  console.log('(running balance computed from wallet-moving transactions; stored balanceAfter shown for comparison)');
  console.log('');
  console.log(
    '#'.padStart(3) +
    ' Date'.padEnd(24) +
    ' Type'.padEnd(9) +
    ' Status'.padEnd(19) +
    ' Amount'.padEnd(10) +
    ' BalanceBefore'.padEnd(16) +
    ' BalanceAfter'.padEnd(15) +
    ' Computed'.padEnd(12) +
    ' Flag'
  );
  console.log('-'.repeat(115));
  for (const row of rows) {
    const t = row.tx;
    const date = new Date(t.createdAt).toISOString().replace('T', ' ').substring(0, 16);
    const flag = row.divergence ? (row.i === firstDivergence ? 'FIRST-DIVERGENCE' : 'DIVERGENCE') : '';
    console.log(
      String(row.i + 1).padStart(3) +
      ' ' + date.padEnd(23) +
      String(t.type || '').padEnd(9) +
      String(t.status || '').padEnd(19) +
      Number(t.amount || 0).toFixed(2).padStart(10).padEnd(10) +
      (t.balanceBefore != null ? Number(t.balanceBefore).toFixed(2) : '-').padStart(15).padEnd(16) +
      (t.balanceAfter != null ? Number(t.balanceAfter).toFixed(2) : '-').padStart(14).padEnd(15) +
      row.computedAfter.toFixed(2).padStart(11).padEnd(12) +
      flag
    );
  }
  console.log('');
  console.log('First divergence at row', firstDivergence === -1 ? 'none' : firstDivergence + 1);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  if (userDetailsId) {
    const r = await reconcileUser(userDetailsId);
    printUserDetails(r);
  } else if (allUsers) {
    const txUserIds = await Transaction.distinct('userId');
    const walletUserIds = await Wallet.distinct('userId');
    const all = new Set([...txUserIds, ...walletUserIds].filter((uid) => uid != null).map(String));
    const results = [];
    for (const uid of all) {
      results.push(await reconcileUser(uid));
    }
    results.sort((a, b) => Math.abs(b.driftAll) - Math.abs(a.driftAll));

    console.log(
      'ALL-USERS DRIFT REPORT (sorted by |driftAll| desc; FIX_DATE =',
      FIX_DATE.toISOString(),
      ')'
    );
    console.log(
      'mask'.padEnd(10) +
      ' stored'.padEnd(12) +
      ' reconciledAll'.padEnd(17) +
      ' driftAll'.padEnd(12) +
      ' reconciledCompleted'.padEnd(21) +
      ' driftCompleted'.padEnd(16) +
      ' statusNoise'.padEnd(14) +
      'tx'
    );
    results.forEach((r) => {
      const statusNoise = r.driftAll - r.driftCompleted;
      console.log(
        r.mask.padEnd(10) +
        r.storedBalance.toFixed(2).padStart(11).padEnd(12) +
        r.reconciledAll.toFixed(2).padStart(16).padEnd(17) +
        r.driftAll.toFixed(2).padStart(11).padEnd(12) +
        r.reconciledCompleted.toFixed(2).padStart(20).padEnd(21) +
        r.driftCompleted.toFixed(2).padStart(15).padEnd(16) +
        statusNoise.toFixed(2).padStart(13).padEnd(14) +
        r.txCount
      );
    });

    const usersWithDrift = results.filter((r) => r.driftAll !== 0);
    const totalAbsDriftAll = results.reduce((sum, r) => sum + Math.abs(r.driftAll), 0);
    const totalAbsDriftCompleted = results.reduce((sum, r) => sum + Math.abs(r.driftCompleted), 0);
    console.log('');
    console.log('TOTALS');
    console.log('users checked:', results.length);
    console.log('users with drift (all wallet-moving):', usersWithDrift.length);
    console.log('total absolute drift (all wallet-moving):', totalAbsDriftAll.toFixed(2));
    console.log('total absolute drift (completed only):', totalAbsDriftCompleted.toFixed(2));
  } else {
    const userId = process.argv[2];
    if (!userId || userId === '--all-users' || userId === '--user-details') {
      console.error('Usage: node backend/scripts/reconcile-wallet.js <userId> OR --all-users OR --user-details <userId>');
      process.exit(1);
    }
    const r = await reconcileUser(userId);
    printUserSummary(r);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
