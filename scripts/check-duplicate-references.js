const path = require('path');
const mongoose = require('mongoose');

const Transaction = require(path.join(__dirname, '..', 'backend', 'models', 'Transaction'));
const Payment = require(path.join(__dirname, '..', 'backend', 'models', 'Payment'));

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
 * Read-only audit: prints ONLY the count of duplicate and null references per
 * collection. Never prints user data, documents, or references themselves.
 *
 * Collections checked:
 *   - Transaction.reference
 *   - Payment.clientReference
 *
 * Usage (run on production BEFORE deploying the sparse unique index):
 *   node scripts/check-duplicate-references.js
 *
 * Exit code 0 always (read-only). Non-zero only on connection/read failure.
 */
async function checkCollection(model, collectionName, field) {
  const duplicateCount = await model.aggregate([
    { $match: { [field]: { $ne: null, $exists: true } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'duplicateGroups' }
  ]);
  const duplicates = duplicateCount.length > 0 ? duplicateCount[0].duplicateGroups : 0;

  const nullCount = await model.countDocuments({
    $or: [{ [field]: null }, { [field]: { $exists: false } }]
  });

  console.log(`${collectionName}: duplicateReferenceGroups=${duplicates} nullOrMissingReferences=${nullCount}`);
  return { collection: collectionName, field, duplicateGroups: duplicates, nullOrMissingReferences: nullCount };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  console.log(`DB host: ${dbHost(uri)}`);
  if (uri) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  }

  const results = [];
  results.push(await checkCollection(Transaction, 'Transaction', 'reference'));
  results.push(await checkCollection(Payment, 'Payment', 'clientReference'));

  if (mongoose.connection.readyState) {
    await mongoose.disconnect();
  }

  const totalDuplicates = results.reduce((s, r) => s + r.duplicateGroups, 0);
  const totalNulls = results.reduce((s, r) => s + r.nullOrMissingReferences, 0);
  console.log(`TOTAL: duplicateReferenceGroups=${totalDuplicates} nullOrMissingReferences=${totalNulls}`);

  if (totalDuplicates > 0) {
    console.log('ACTION REQUIRED: resolve duplicate references before deploying the sparse unique index.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('check-duplicate-references failed: ' + err.message);
  process.exit(1);
});

module.exports = { checkCollection, main, dbHost };
