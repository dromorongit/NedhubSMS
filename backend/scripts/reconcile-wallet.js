// READ-ONLY wallet reconciliation helper.
//
// This script performs NO writes, no updates, and no saves to MongoDB.
// It only reads Wallet and Transaction documents to compare the stored
// wallet balance against a transaction-derived reconciled balance.
//
// Usage: node backend/scripts/reconcile-wallet.js <userId>
//        node backend/scripts/reconcile-wallet.js --all-users
// Environment: MONGODB_URI must point to the target (test) database.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// Models at module scope so reconcileUser and any helper can use them.
// (Previously they were declared inside main(), causing ReferenceError at module scope.)
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

const allUsers = process.argv.includes('--all-users');

function maskUserId(userId) {
  const s = String(userId);
  return s.length <= 4 ? s : '*'.repeat(s.length - 4) + s.slice(-4);
}

function sumAmount(transactions, type, status) {
  return transactions
    .filter((t) => t.type === type && t.status === status)
    .reduce((total, t) => total + Number(t.amount || 0), 0);
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
    Transaction.find(query).lean(),
  ]);

  const completedCredits = sumAmount(transactions, 'credit', 'completed');
  const completedDebits = sumAmount(transactions, 'debit', 'completed');
  const pendingDebits = sumAmount(transactions, 'debit', 'pending');
  const pendingConfirmationDebits = sumAmount(transactions, 'debit', 'pending_confirmation');

  // Reconciled balance from completed money movements only; pending debits
  // reduce it because the funds are already reserved. Pending confirmation
  // debits are reported separately and not subtracted.
  const reconciled = completedCredits - completedDebits - pendingDebits;
  const storedBalance = wallet ? Number(wallet.balance || 0) : 0;
  const drift = storedBalance - reconciled;

  return {
    userId,
    mask: maskUserId(userId),
    storedBalance,
    completedCredits,
    completedDebits,
    pendingDebits,
    pendingConfirmationDebits,
    reconciled,
    drift,
    txCount: transactions.length,
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  if (allUsers) {
    const txUserIds = await Transaction.distinct('userId');
    const walletUserIds = await Wallet.distinct('userId');
    const all = new Set(
      [...txUserIds, ...walletUserIds].filter((uid) => uid != null).map(String)
    );
    const results = [];
    for (const uid of all) {
      results.push(await reconcileUser(uid));
    }
    results.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

    console.log('ALL-USERS DRIFT REPORT (stored balance - reconciled, sorted by |drift| desc):');
    results.forEach((r) => {
      console.log(
        `${r.mask} stored=${r.storedBalance.toFixed(2)} ` +
        `completedCredits=${r.completedCredits.toFixed(2)} ` +
        `completedDebits=${r.completedDebits.toFixed(2)} ` +
        `pendingDebits=${r.pendingDebits.toFixed(2)} ` +
        `pendingConfirmationDebits=${r.pendingConfirmationDebits.toFixed(2)} ` +
        `reconciled=${r.reconciled.toFixed(2)} drift=${r.drift.toFixed(2)} tx=${r.txCount}`
      );
    });

    const usersWithDrift = results.filter((r) => r.drift !== 0);
    const totalAbsDrift = results.reduce((sum, r) => sum + Math.abs(r.drift), 0);
    console.log('');
    console.log('TOTALS');
    console.log(`users checked: ${results.length}`);
    console.log(`users with drift: ${usersWithDrift.length}`);
    console.log(`total absolute drift: ${totalAbsDrift.toFixed(2)}`);
  } else {
    const userId = process.argv[2];
    if (!userId || userId === '--all-users') {
      console.error('Usage: node backend/scripts/reconcile-wallet.js <userId> OR --all-users');
      process.exit(1);
    }
    const r = await reconcileUser(userId);
    console.log('USER:', r.mask);
    console.log('STORED WALLET BALANCE:', r.storedBalance.toFixed(2));
    console.log('COMPLETED CREDITS:', r.completedCredits.toFixed(2));
    console.log('COMPLETED DEBITS:', r.completedDebits.toFixed(2));
    console.log('PENDING DEBITS:', r.pendingDebits.toFixed(2));
    console.log('PENDING CONFIRMATION DEBITS:', r.pendingConfirmationDebits.toFixed(2));
    console.log('RECONCILED BALANCE:', r.reconciled.toFixed(2));
    console.log('DRIFT (stored - reconciled):', r.drift.toFixed(2));
    console.log('TRANSACTIONS:', r.txCount);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
