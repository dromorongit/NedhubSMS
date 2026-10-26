const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);

const CallbackVerificationService = require('../backend/services/callbackVerificationService');
const { hubtelCallbackSecret, naloWebhookSecret, secretMatches } = require('../backend/utils/callbackAuth');

function makeStore() {
  const payments = [];
  const transactions = [];
  const wallets = [];

  function match(obj, filter) {
    if (!filter) return true;
    return Object.keys(filter).every((k) => {
      const v = filter[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.$in) return v.$in.includes(obj[k]);
        if (v.$nin) return !v.$nin.includes(obj[k]);
        if (v.$gte != null) return obj[k] >= v.$gte;
        if (v.$lt != null) return obj[k] < v.$lt;
      }
      return obj[k] === v || String(obj[k]) === String(v);
    });
  }

  const Payment = function (data) {
    const inst = { ...data, _id: data._id || `p${payments.length + 1}`, status: data.status || 'pending' };
    inst.save = async function () { return this; };
    payments.push(inst);
    return inst;
  };
  Payment._store = payments;
  Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
  Payment.findOneAndUpdate = async (filter, update, opts) => {
    const idx = payments.findIndex((p) => match(p, filter));
    if (idx < 0) return null;
    const p = payments[idx];
    if (update.$set) Object.assign(p, update.$set);
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { p[k] = (p[k] || 0) + update.$inc[k]; });
    return p;
  };
  Payment.updateOne = async (filter, update) => {
    const idx = payments.findIndex((p) => match(p, filter));
    if (idx >= 0 && update.$set) Object.assign(payments[idx], update.$set);
    return { modifiedCount: idx >= 0 ? 1 : 0 };
  };

  const Transaction = function (data) {
    const inst = { ...data, _id: data._id || `t${transactions.length + 1}`, save: async function () { transactions.push(this); return this; } };
    // save pushes only if not already in store
    const origSave = inst.save;
    inst.save = async function () { if (!transactions.includes(this)) transactions.push(this); return this; };
    transactions.push(inst);
    return inst;
  };
  // Remove the auto-push above to avoid duplicates: recreate cleaner
  const Transaction2 = function (data) {
    const inst = { ...data, _id: data._id || `t${transactions.length + 1}` };
    inst.save = async function () { if (!transactions.includes(this)) transactions.push(this); return this; };
    return inst;
  };
  Transaction2._store = transactions;
  Transaction2.findOne = async (filter) => transactions.find((t) => match(t, filter)) || null;
  Transaction2.findOneAndUpdate = async (filter, update, opts) => {
    const t = transactions.find((x) => match(x, filter));
    if (!t) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(t.status)) return null;
    if (filter.status && filter.status.$nin && filter.status.$nin.includes(t.status)) return null;
    if (update.$set) Object.assign(t, update.$set);
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { t[k] = (t[k] || 0) + update.$inc[k]; });
    return t;
  };
  Transaction2.find = async (filter) => transactions.filter((t) => match(t, filter));

  const Wallet = function (data) { return { ...data, save: async function () { return this; } }; };
  Wallet._store = wallets;
  Wallet.findOne = async (filter) => wallets.find((w) => match(w, filter)) || null;
  Wallet.findOneAndUpdate = async (filter, update, opts) => {
    let w = wallets.find((x) => match(x, filter));
    if (!w) {
      // upsert-like for credit tests
      if (opts && opts.upsert) {
        w = { userId: filter.userId, balance: 0, smsBalance: 0 };
        wallets.push(w);
      } else {
        // allow create if not found and filter has userId
        if (filter.userId != null) {
          w = { userId: filter.userId, balance: 0, smsBalance: 0 };
          wallets.push(w);
        } else {
          return null;
        }
      }
    }
    // check $gte condition
    if (filter.balance && filter.balance.$gte != null) {
      if ((w.balance || 0) < filter.balance.$gte) return null;
    }
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
    if (update.$set) Object.assign(w, update.$set);
    return w;
  };

  return { payments, transactions, wallets, Payment: Payment, Transaction: Transaction2, Wallet };
}

function makeService(overrides = {}) {
  const store = makeStore();
  const paymentService = overrides.paymentService || {
    checkTransactionStatus: async (ref) => ({ status: 'paid', amount: 10, transactionId: 'HTX', paymentMethod: 'momo' })
  };
  const svc = new CallbackVerificationService({
    Payment: store.Payment,
    Transaction: store.Transaction,
    Wallet: store.Wallet,
    paymentService,
    transferService: overrides.transferService || { checkTransactionStatus: async (ref) => ({ success: true, status: 'success' }) },
    commissionService: overrides.commissionService || { checkTransactionStatus: async (ref) => ({ success: true, status: 'success' }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  return { store, svc, paymentService };
}

test('forged payment callback says success while Hubtel unpaid: stays pending', async () => {
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'pending', amount: 10 }) }
  });
  const p = new store.Payment({ clientReference: 'REF1', userId: 'u1', amount: 10, status: 'pending' });
  // ensure find returns it
  const res = await svc.processPaymentCallback('REF1');
  assert.notEqual(res.action, 'credit');
  const payment = await store.Payment.findOne({ clientReference: 'REF1' });
  assert.equal(payment.status, 'pending');
  assert.equal(store.transactions.length, 0);
});

test('payment callback lower paid amount: no credit', async () => {
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 5 }) }
  });
  new store.Payment({ clientReference: 'REF2', userId: 'u1', amount: 10, status: 'pending' });
  const res = await svc.processPaymentCallback('REF2');
  assert.notEqual(res.action, 'credit');
  const payment = await store.Payment.findOne({ clientReference: 'REF2' });
  assert.notEqual(payment.status, 'paid');
  assert.equal(store.transactions.length, 0);
});

test('payment callback made-up reference: no change', async () => {
  const { store, svc } = makeService();
  const res = await svc.processPaymentCallback('NOPE');
  assert.equal(res.action, 'not_found');
  assert.equal(store.transactions.length, 0);
});

test('same valid payment callback five times: exactly one credit', async () => {
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 10, transactionId: 'HTX', paymentMethod: 'momo' }) }
  });
  new store.Payment({ clientReference: 'REF3', userId: 'u1', amount: 10, status: 'pending' });

  // Make findOneAndUpdate conditional: only first succeeds
  const orig = store.Payment.findOneAndUpdate.bind(store.Payment);
  let done = false;
  store.Payment.findOneAndUpdate = async (filter, update, opts) => {
    const p = await store.Payment.findOne(filter);
    if (!p) return null;
    if (p.status !== 'pending' && p.status !== 'processing') return null;
    if (done) return null;
    done = true;
    p.status = 'paid';
    if (update.$set) Object.assign(p, update.$set);
    return p;
  };

  const calls = Array.from({ length: 5 }, () => svc.processPaymentCallback('REF3'));
  await Promise.all(calls);
  assert.equal(store.transactions.length, 1);
});

test('forged airtime failure while provider success: no refund', async () => {
  const { store, svc } = makeService({
    transferService: { checkTransactionStatus: async () => ({ success: true, status: 'success' }) }
  });
  new store.Transaction({ reference: 'AIR1', userId: 'u1', amount: 5, status: 'pending_confirmation', metadata: { transactionType: 'AIRTIME_PURCHASE' } });
  const res = await svc.processAirtimeCallback('AIR1');
  assert.notEqual(res.action, 'refund');
});

test('forged airtime failure while provider unknown: no refund', async () => {
  const { store, svc } = makeService({
    transferService: { checkTransactionStatus: async () => ({ success: true, status: 'pending' }) }
  });
  new store.Transaction({ reference: 'AIR2', userId: 'u1', amount: 5, status: 'pending_confirmation', metadata: { transactionType: 'AIRTIME_PURCHASE' } });
  const res = await svc.processAirtimeCallback('AIR2');
  assert.notEqual(res.action, 'refund');
});

test('genuine airtime failure confirmed: exactly one refund, twice', async () => {
  const { store, svc } = makeService({
    transferService: { checkTransactionStatus: async () => ({ success: true, status: 'failed' }) }
  });
  const t3 = new store.Transaction({ reference: 'AIR3', userId: 'u1', amount: 5, status: 'pending_confirmation', metadata: { transactionType: 'AIRTIME_PURCHASE' } }); await t3.save();

  const r1 = await svc.processAirtimeCallback('AIR3');
  assert.equal(r1.action, 'refund');
  const r2 = await svc.processAirtimeCallback('AIR3');
  assert.notEqual(r2.action, 'refund');
  // one refund transaction
  const refunds = store.transactions.filter((t) => String(t.reference).startsWith('REFUND-'));
  assert.equal(refunds.length, 1);
});

test('status API timeout: stays waiting and provider_unavailable', async () => {
  const { store, svc } = makeService({
    transferService: { checkTransactionStatus: async () => { throw new Error('timeout'); } }
  });
  const t4 = new store.Transaction({ reference: 'AIR4', userId: 'u1', amount: 5, status: 'pending_confirmation', metadata: { transactionType: 'AIRTIME_PURCHASE' } }); await t4.save();
  const res = await svc.processAirtimeCallback('AIR4');
  assert.equal(res.action, 'provider_unavailable');
});

test('callback for endpoint with no status API: stays waiting', async () => {
  const { store, svc } = makeService({
    transferService: { checkTransactionStatus: undefined }
  });
  // override to method missing
  svc.transferService = {};
  const t5 = new store.Transaction({ reference: 'AIR5', userId: 'u1', amount: 5, status: 'pending_confirmation', metadata: { transactionType: 'AIRTIME_PURCHASE' } }); await t5.save();
  const res = await svc.processAirtimeCallback('AIR5');
  assert.equal(res.action, 'provider_unavailable');
});

test('user cannot refresh another users pending payment', async () => {
  const { store, svc } = makeService();
  new store.Payment({ clientReference: 'REF4', userId: 'owner', amount: 10, status: 'pending' });
  const res = await svc.refreshUserPayment('other', 'REF4');
  assert.equal(res.action, 'forbidden');
});

test('hubtel secret: unset processed, set right processed, set wrong rejected', async () => {
  const makeRes = () => { const r = { statusCode: 200, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

  // unset
  delete process.env.HUBTEL_CALLBACK_SECRET;
  let nextCalled = false;
  const req1 = { header: () => null, query: {}, originalUrl: '/x' };
  const res1 = makeRes();
  hubtelCallbackSecret(req1, res1, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  // set right
  process.env.HUBTEL_CALLBACK_SECRET = 's3cret';
  nextCalled = false;
  const req2 = { header: (n) => (n === 'x-callback-secret' ? 's3cret' : null), query: {}, originalUrl: '/x' };
  const res2 = makeRes();
  hubtelCallbackSecret(req2, res2, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  // set wrong
  nextCalled = false;
  const req3 = { header: () => 'wrong', query: {}, originalUrl: '/x' };
  const res3 = makeRes();
  hubtelCallbackSecret(req3, res3, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res3.statusCode, 200);

  delete process.env.HUBTEL_CALLBACK_SECRET;
});

test('nalo secret: three cases for naloWebhookSecret', async () => {
  const makeRes = () => { const r = { statusCode: 200, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

  delete process.env.NALO_WEBHOOK_SECRET;
  let nextCalled = false;
  const req1 = { header: () => null, query: {}, originalUrl: '/x' };
  naloWebhookSecret(req1, makeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  process.env.NALO_WEBHOOK_SECRET = 'nsec';
  nextCalled = false;
  const req2 = { header: (n) => (n === 'x-webhook-secret' ? 'nsec' : null), query: {} };
  naloWebhookSecret(req2, makeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  nextCalled = false;
  const req3 = { header: () => 'wrong', query: {} };
  const res3 = makeRes();
  naloWebhookSecret(req3, res3, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res3.statusCode, 200);

  delete process.env.NALO_WEBHOOK_SECRET;
});
const { reconcilePending } = require('../scripts/reconcile-pending');
const { auditWalletCredits } = require('../scripts/audit-wallet-credits');

