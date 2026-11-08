// READ-ONLY wallet reconciliation helper.
// Usage: node backend/scripts/reconcile-wallet.js <userId>
// Environment: MONGODB_URI must point to the target database.
// This script performs NO writes.
const mongoose = require('mongoose');

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: node backend/scripts/reconcile-wallet.js <userId>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const Transaction = mongoose.model('Transaction', new mongoose.Schema({}, { strict: false }));
  const Wallet = mongoose.model('Wallet', new mongoose.Schema({}, { strict: false }));

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

  console.log('USER:', userId);
  console.log('STORED WALLET BALANCE:', storedBalance);
  console.log('TRANSACTION GROUPS (type:status):');
  Object.keys(groups).sort().forEach((key) => {
    console.log(`  ${key}: count=${groups[key].count} amount=${groups[key].amount.toFixed(2)}`);
  });
  console.log('COMPLETED CREDITS:', completedCredits.toFixed(2));
  console.log('COMPLETED DEBITS:', completedDebits.toFixed(2));
  console.log('PENDING DEBITS:', pendingDebits.toFixed(2));
  console.log('RECONCILED (completed credits - completed debits - pending debits):', reconciled.toFixed(2));
  console.log('DIFFERENCE (reconciled - stored):', (reconciled - storedBalance).toFixed(2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});