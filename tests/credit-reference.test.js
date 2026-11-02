const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.HUBTEL_CLIENT_ID = 'test-client';
process.env.HUBTEL_CLIENT_SECRET = 'test-secret';

const { processReference, normalizeStatus } = require(path.join(ROOT, 'scripts', 'credit-reference.mjs'));
const HubtelPaymentService = require(path.join(ROOT, 'backend', 'services', 'HubtelPaymentService.js'));

function makeStore() {
  const payments = [];
  const creditTransactions = [];
  const walletCreditCalls = [];
  const wallets = [{ userId: 'owner-user', balance: 10000, smsBalance: 0 }];

  function match(obj, filter) {
    if (!filter) return true;
    return Object.keys(filter).every((k) => {
      const v = filter[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.$in) return v.$in.includes(obj[k]);
        if (v.$ne != null) return obj[k] !== v.$ne;
      }
      return obj[k] === v || String(obj[k]) === String(v);
    });
  }

  const Payment = function (data) { Object.assign(this, data); };
  Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
  Payment.findOneAndUpdate = async () => null;

  const Transaction = function (data) { Object.assign(this, data); };
  Transaction.findOne = async (filter) => creditTransactions.find((t) => match(t, filter)) || null;
  Transaction.prototype.save = async function () {
    if (creditTransactions.some((t) => t.reference === this.reference)) {
      const err = new Error('duplicate key');
      err.code = 11000;
      throw err;
    }
    creditTransactions.push(this);
    return this;
  };

  const Wallet = function (data) { Object.assign(this, data); };
  Wallet.findOne = async (filter) => wallets.find((w) => match(w, filter)) || null;
  Wallet.findOneAndUpdate = async (filter, update) => {
    let w = wallets.find((x) => match(x, filter));
    if (!w) return null;
    if (update.$inc) {
      walletCreditCalls.push({ inc: { ...update.$inc } });
      Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
    }
    if (update.$set) Object.assign(w, update.$set);
    return w;
  };

  return { Payment, Transaction, Wallet, payments, creditTransactions, wallets, walletCreditCalls };
}

test('normalizeStatus maps paid/success variants to lowercase', () => {
  assert.equal(normalizeStatus('Paid'), 'paid');
  assert.equal(normalizeStatus('SUCCESS'), 'success');
  assert.equal(normalizeStatus('  Paid  '), 'paid');
  assert.equal(normalizeStatus('failed'), 'failed');
});

test('dry run does not credit when provider success and amount matches', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'p1', clientReference: 'REF1', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });
  HubtelPaymentService.prototype.checkTransactionStatus = async () => ({ status: 'Paid', amount: 10, currency: 'GHS' });

  const result = await processReference({ reference: 'REF1', apply: false, ...ctx });
  assert.equal(result.applied, false);
  assert.equal(result.alreadyCredited, false);
  assert.equal(ctx.walletCreditCalls.length, 0, 'dry run must not increment wallet');
});

test('--apply credits wallet exactly once when provider success and amount matches', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'p2', clientReference: 'REF2', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });
  HubtelPaymentService.prototype.checkTransactionStatus = async () => ({ status: 'Paid', amount: 10, currency: 'GHS' });

  const result = await processReference({ reference: 'REF2', apply: true, ...ctx });
  assert.equal(result.applied, true);
  assert.equal(ctx.walletCreditCalls.length, 1, 'exactly one wallet increment');
  assert.equal(ctx.wallets[0].balance, 10010);
  const tx = ctx.creditTransactions.find((t) => t.reference === 'PAYMENT-REF2');
  assert.ok(tx, 'credit transaction recorded');
});

test('--apply is idempotent: second apply does not credit again', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'p3', clientReference: 'REF3', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });
  HubtelPaymentService.prototype.checkTransactionStatus = async () => ({ status: 'Paid', amount: 10, currency: 'GHS' });

  await processReference({ reference: 'REF3', apply: true, ...ctx });
  await processReference({ reference: 'REF3', apply: true, ...ctx });
  assert.equal(ctx.walletCreditCalls.length, 1, 'only one credit across two applies');
  assert.equal(ctx.wallets[0].balance, 10010);
});

test('refuses when provider status is not success', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'p4', clientReference: 'REF4', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });
  HubtelPaymentService.prototype.checkTransactionStatus = async () => ({ status: 'Unpaid', amount: 10, currency: 'GHS' });

  await assert.rejects(() => processReference({ reference: 'REF4', apply: true, ...ctx }), /not success/);
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('refuses when provider amount is less than transaction amount', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'p5', clientReference: 'REF5', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });
  HubtelPaymentService.prototype.checkTransactionStatus = async () => ({ status: 'Paid', amount: 5, currency: 'GHS' });

  await assert.rejects(() => processReference({ reference: 'REF5', apply: true, ...ctx }), /less than/);
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('refuses when transaction is already paid', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'p6', clientReference: 'REF6', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'paid' });
  HubtelPaymentService.prototype.checkTransactionStatus = async () => ({ status: 'Paid', amount: 10, currency: 'GHS' });

  await assert.rejects(() => processReference({ reference: 'REF6', apply: true, ...ctx }), /already paid/);
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('unmatched reference throws', async () => {
  const ctx = makeStore();
  HubtelPaymentService.prototype.checkTransactionStatus = async () => ({ status: 'Paid', amount: 10, currency: 'GHS' });
  await assert.rejects(() => processReference({ reference: 'NOPE', apply: true, ...ctx }), /No payment transaction/);
});

test('credit-reference.mjs file exists and exports processReference', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'credit-reference.mjs')));
  assert.equal(typeof processReference, 'function');
  assert.equal(typeof normalizeStatus, 'function');
});

// ---------- Manual credit path ----------

test('manual mode requires --amount', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm1', clientReference: 'MREF1', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending', hubtelTransactionId: 'HT-1' });
  await assert.rejects(
    () => processReference({ reference: 'MREF1', manual: true, apply: true, db: 'ndb', connectedDbName: 'ndb', hubtelId: 'HT-1', reason: 'top-up', ...ctx }),
    /Invalid --amount/
  );
  assert.equal(ctx.walletCreditCalls.length, 0, 'no credit when amount missing');
});

test('manual mode refuses amount below recorded amount', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm2', clientReference: 'MREF2', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending', hubtelTransactionId: 'HT-2' });
  await assert.rejects(
    () => processReference({ reference: 'MREF2', manual: true, apply: true, db: 'ndb', connectedDbName: 'ndb', amount: '5', hubtelId: 'HT-2', reason: 'top-up', ...ctx }),
    /does not equal recorded payment amount 10/
  );
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('manual mode refuses amount above recorded amount (exact equality required)', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm3', clientReference: 'MREF3', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending', hubtelTransactionId: 'HT-3' });
  await assert.rejects(
    () => processReference({ reference: 'MREF3', manual: true, apply: true, db: 'ndb', connectedDbName: 'ndb', amount: '15', hubtelId: 'HT-3', reason: 'top-up', ...ctx }),
    /does not equal recorded payment amount 10/
  );
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('manual mode accepts amount equal to recorded amount and credits once', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm4', clientReference: 'MREF4', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending', hubtelTransactionId: 'HT-4' });
  const result = await processReference({ reference: 'MREF4', manual: true, apply: true, db: 'ndb', connectedDbName: 'ndb', amount: '10', hubtelId: 'HT-4', reason: 'Manual top-up', ...ctx });
  assert.equal(result.applied, true);
  assert.equal(result.manual, true);
  assert.equal(ctx.walletCreditCalls.length, 1, 'exactly one wallet increment');
  assert.equal(ctx.wallets[0].balance, 10010);
  const tx = ctx.creditTransactions.find((t) => t.reference === 'PAYMENT-MREF4');
  assert.ok(tx, 'credit transaction recorded');
});

test('manual mode refuses non-pending payment', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm5', clientReference: 'MREF5', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'paid', hubtelTransactionId: 'HT-5' });
  await assert.rejects(
    () => processReference({ reference: 'MREF5', manual: true, apply: true, db: 'ndb', connectedDbName: 'ndb', amount: '10', hubtelId: 'HT-5', reason: 'top-up', ...ctx }),
    /not pending/
  );
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('manual mode is idempotent on rerun: second run never credits twice', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm6', clientReference: 'MREF6', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending', hubtelTransactionId: 'HT-6' });
  const first = await processReference({ reference: 'MREF6', manual: true, apply: true, db: 'ndb', connectedDbName: 'ndb', amount: '10', hubtelId: 'HT-6', reason: 'top-up', ...ctx });
  assert.equal(first.applied, true);
  const second = await processReference({ reference: 'MREF6', manual: true, apply: true, db: 'ndb', connectedDbName: 'ndb', amount: '10', hubtelId: 'HT-6', reason: 'top-up', ...ctx });
  assert.equal(second.applied, false, 'second run does not apply');
  assert.equal(second.alreadyCredited, true, 'second run records already credited');
  assert.equal(ctx.walletCreditCalls.length, 1, 'only one credit across two runs');
  assert.equal(ctx.wallets[0].balance, 10010);
});

test('manual mode refuses when --db does not match connected database', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm7', clientReference: 'MREF7', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending', hubtelTransactionId: 'HT-7' });
  await assert.rejects(
    () => processReference({ reference: 'MREF7', manual: true, apply: true, db: 'other-db', connectedDbName: 'ndb', amount: '10', hubtelId: 'HT-7', reason: 'top-up', ...ctx }),
    /does not match connected database/
  );
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('manual mode refuses without --db', async () => {
  const ctx = makeStore();
  ctx.payments.push({ _id: 'pm8', clientReference: 'MREF8', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending', hubtelTransactionId: 'HT-8' });
  await assert.rejects(
    () => processReference({ reference: 'MREF8', manual: true, apply: true, connectedDbName: 'ndb', amount: '10', hubtelId: 'HT-8', reason: 'top-up', ...ctx }),
    /requires --db/
  );
  assert.equal(ctx.walletCreditCalls.length, 0);
});
