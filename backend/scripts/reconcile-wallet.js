// READ-ONLY wallet reconciliation helper.
// Usage: node backend/scripts/reconcile-wallet.js <userId>
// Environment: MONGODB_URI must point to the target database.
// This script performs NO writes.
const mongoose = require('mongoose');

const allUsers = process.argv.includes('--all-users');

async function reconcileUser(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const wallet = await Wallet.findOne({ userId: userObjectId }).lean();
  const transactions = await Transaction.find({ userId: userObjectId }).lean();

  const groups = {};
  for (const tx of transactions) {
    const key = `${tx.type || 'unknown'}:${tx.status || 'missing'}`;
    if (!groups[key]) groups[key] = { count: 0, amount: 0 };
    groups[key].count += 1;
    groups[key].amount += Number(tx.amount || 0);
  }

  const completedCredits = transactions
    .filter((t) => t.type === 'credit' && t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const completedDebits = transactions
    .filter((t) => t.type === 'debit' && t.status === 'completed')
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const pendingDebits = transactions
    .filter((t) => t.type === 'debit' && t.status === 'pending')
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const reconciled = completedCredits - completedDebits - pendingDebits;
  const storedBalance = wallet ? Number(wallet.balance || 0) : 0;
  return { userId, storedBalance, reconciled, drift: storedBalance - reconciled, groups, txCount: transactions.length };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const Transaction = mongoose.model('Transaction', new mongoose.Schema({}, { strict: false }));
  const Wallet = mongoose.model('Wallet', new mongoose.Schema({}, { strict: false }));

  if (allUsers) {
    const userIds = await Transaction.distinct('userId');
    const walletUsers = await Wallet.distinct('userId');
    const all = new Set([...userIds.map(String), ...walletUsers.map(String)]);
    const results = [];
    for (const uid of all) {
      results.push(await reconcileUser(uid));
    }
    results.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
    console.log('ALL-USERS DRIFT REPORT (stored balance - reconciled):');
    results.forEach((r) => {
      console.log(`${r.userId}: drift=${r.drift.toFixed(2)} stored=${r.storedBalance.toFixed(2)} reconciled=${r.reconciled.toFixed(2)} tx=${r.txCount}`);
    });
  } else {
    const userId = process.argv[2];
    if (!userId || userId === '--all-users') {
      console.error('Usage: node backend/scripts/reconcile-wallet.js <userId> OR --all-users');
      process.exit(1);
    }
    const r = await reconcileUser(userId);
    console.log('USER:', r.userId);
    console.log('STORED WALLET BALANCE:', r.storedBalance);
    console.log('TRANSACTION GROUPS (type:status):');
    Object.keys(r.groups).sort().forEach((key) => {
      console.log(`  ${key}: count=${r.groups[key].count} amount=${r.groups[key].amount.toFixed(2)}`);
    });
    console.log('RECONCILED (completed credits - completed debits - pending debits):', r.reconciled.toFixed(2));
    console.log('DIFFERENCE (stored - reconciled):', r.drift.toFixed(2));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});