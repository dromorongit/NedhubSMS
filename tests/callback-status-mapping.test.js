const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);

const CallbackVerificationService = require('../backend/services/callbackVerificationService');

// ---------------------------------------------------------------------------
// Minimal in-memory store mirroring the real models just enough for the assess
// functions. No database, no provider calls - the provider result is injected.
// ---------------------------------------------------------------------------
function makeStore() {
  const payments = [];
  const transactions = [];
  const wallets = [{ userId: 'u1', balance: 10000, smsBalance: 0 }];
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
    const inst = { ...data, _id: `p${payments.length + 1}`, status: data.status || 'pending' };
    inst.save = async function () { return this; };
    payments.push(inst);
    return inst;
  };
  Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
  Payment.findOneAndUpdate = async (filter, update) => {
    const p = payments.find((x) => match(x, filter));
    if (!p) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
    if (update.$set) Object.assign(p, update.$set);
    return p;
  };
  const Transaction = function (data) {
    const inst = { ...data, _id: `t${transactions.length + 1}` };
    inst.save = async function () { if (!transactions.includes(inst)) transactions.push(inst); return inst; };
    transactions.push(inst);
    return inst;
  };
  Transaction.findOne = async (filter) => transactions.find((t) => match(t, filter)) || null;
  Transaction.findOneAndUpdate = async (filter, update) => {
    const t = transactions.find((x) => match(x, filter));
    if (!t) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(t.status)) return null;
    if (update.$set) Object.assign(t, update.$set);
    return t;
  };
  const Wallet = {
    findOne: async (filter) => wallets.find((w) => match(w, filter)) || null,
    findOneAndUpdate: async (filter, update) => {
      let w = wallets.find((x) => match(x, filter));
      if (!w) return null;
      if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
      if (update.$set) Object.assign(w, update.$set);
      return w;
    }
  };
  return { payments, transactions, wallets, Payment, Transaction, Wallet };
}

function makeSvc(store) {
  const svc = new CallbackVerificationService({
    Payment: store.Payment,
    Transaction: store.Transaction,
    Wallet: store.Wallet,
    paymentService: { checkTransactionStatus: async () => ({ ok: false, error: 'stubbed' }) },
    transferService: { checkTransactionStatus: async () => ({ ok: false, error: 'stubbed' }) },
    commissionService: { checkTransactionStatus: async () => ({ ok: false, error: 'stubbed' }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  svc.checkProviderStatus = async () => ({ ok: false, error: 'stubbed' });
  return svc;
}

const STORED_AMOUNT = 10;

function setupPayment(store) {
  new store.Payment({ clientReference: 'REF', userId: 'u1', amount: STORED_AMOUNT, status: 'pending' });
}
function setupPurchase(store) {
  new store.Transaction({ reference: 'REF', userId: 'u1', amount: 5, status: 'pending_confirmation', metadata: { transactionType: 'AIRTIME_PURCHASE' } }).save();
}

// ---------------------------------------------------------------------------
// (a) Payment: provider says Unpaid -> payment still pending, no credit.
//     Same payment, then provider says Paid with matching amount -> credited
//     exactly once. Repeat Paid callback -> still exactly one credit.
// ---------------------------------------------------------------------------
test('payment: Unpaid leaves pending, then Paid matching amount credits exactly once', async () => {
  const store = makeStore();
  const svc = makeSvc(store);
  setupPayment(store);
  const credits = [];
  svc.creditWalletOnce = async (...args) => { credits.push(args); return { credited: true }; };

  let providerResult = { ok: true, status: 'pending', amount: STORED_AMOUNT, transactionId: 'HTX-1', paymentMethod: 'momo', message: 'Unpaid' };
  svc.checkProviderStatus = async () => providerResult;

  const first = await svc.processPaymentCallback('REF');
  assert.equal(first.action, 'leave_pending', 'Unpaid must leave the payment pending');
  assert.equal(store.payments[0].status, 'pending', 'payment status must still be pending after Unpaid check');
  assert.equal(credits.length, 0, 'no credit after Unpaid');

  providerResult = { ok: true, status: 'paid', amount: STORED_AMOUNT, transactionId: 'HTX-2', paymentMethod: 'momo', message: 'Paid' };
  const second = await svc.processPaymentCallback('REF');
  assert.equal(second.action, 'credit', 'matching Paid must credit');
  assert.equal(store.payments[0].status, 'paid', 'payment must be marked paid');
  assert.equal(credits.length, 1, 'exactly one credit on Paid callback');
  assert.equal(credits[0][1], STORED_AMOUNT, 'credit amount is the stored amount');

  // Idempotent repeat of the Paid callback
  const third = await svc.processPaymentCallback('REF');
  assert.equal(third.action, 'already_terminal', 'repeat Paid callback is already terminal');
  assert.equal(credits.length, 1, 'still exactly one credit after repeat callback');
});

// ---------------------------------------------------------------------------
// (d) Payment: provider says Refunded -> no credit, stays pending.
// ---------------------------------------------------------------------------
test('payment: Refunded leaves pending with no credit', async () => {
  const store = makeStore();
  const svc = makeSvc(store);
  setupPayment(store);
  const credits = [];
  svc.creditWalletOnce = async (...args) => { credits.push(args); return { credited: true }; };

  // Refunded maps to pending under the conservative mapping
  const providerResult = { ok: true, status: 'pending', amount: STORED_AMOUNT, transactionId: 'HTX-3', paymentMethod: 'momo', message: 'Refunded' };
  svc.checkProviderStatus = async () => providerResult;

  const res = await svc.processPaymentCallback('REF');
  assert.equal(res.action, 'leave_pending', 'Refunded must leave the payment pending');
  assert.equal(store.payments[0].status, 'pending', 'payment status must stay pending');
  assert.equal(credits.length, 0, 'Refunded must never credit');
});

// ---------------------------------------------------------------------------
// (b) Airtime / data purchase: provider says Unpaid, pending or an unknown
//     word -> no refund, stays waiting.
// ---------------------------------------------------------------------------
test('airtime purchase: Unpaid / pending / unknown provider status stays waiting, no refund', async () => {
  for (const raw of ['Unpaid', 'pending', 'UnknownWord']) {
    const store = makeStore();
    const svc = makeSvc(store);
    setupPurchase(store);
    const refunds = [];
    svc.refundWalletOnce = async (...args) => { refunds.push(args); return { refunded: true }; };

    // Under the conservative mapping Unpaid/pending/unknown all map to pending
    const providerResult = { ok: true, status: 'pending', amount: 0, transactionId: 'HTX-4', paymentMethod: 'momo', message: raw };
    svc.checkProviderStatus = async () => providerResult;

    const res = await svc.processAirtimeCallback('REF');
    assert.equal(res.action, 'leave_pending', `${raw}: purchase must stay waiting`);
    assert.equal(store.transactions[0].status, 'pending_confirmation', `${raw}: transaction status unchanged`);
    assert.equal(refunds.length, 0, `${raw}: no refund`);
  }
});

test('data purchase: Unpaid / pending / unknown provider status stays waiting, no refund', async () => {
  for (const raw of ['Unpaid', 'pending', 'UnknownWord']) {
    const store = makeStore();
    const svc = makeSvc(store);
    setupPurchase(store);
    const refunds = [];
    svc.refundWalletOnce = async (...args) => { refunds.push(args); return { refunded: true }; };

    const providerResult = { ok: true, status: 'pending', amount: 0, transactionId: 'HTX-5', paymentMethod: 'momo', message: raw };
    svc.checkProviderStatus = async () => providerResult;

    const res = await svc.processDataCallback('REF');
    assert.equal(res.action, 'leave_pending', `${raw}: data purchase must stay waiting`);
    assert.equal(store.transactions[0].status, 'pending_confirmation', `${raw}: transaction status unchanged`);
    assert.equal(refunds.length, 0, `${raw}: no refund`);
  }
});

// ---------------------------------------------------------------------------
// (c) Purchase: explicit Failed -> exactly one refund, idempotent.
// ---------------------------------------------------------------------------
test('purchase: explicit Failed refunds exactly once and is idempotent', async () => {
  const store = makeStore();
  const svc = makeSvc(store);
  setupPurchase(store);
  const refunds = [];
  svc.refundWalletOnce = async (...args) => { refunds.push(args); return { refunded: true }; };

  const providerResult = { ok: true, status: 'failed', amount: 0, transactionId: 'HTX-6', paymentMethod: 'momo', message: 'FAILED' };
  svc.checkProviderStatus = async () => providerResult;

  const first = await svc.processAirtimeCallback('REF');
  assert.equal(first.action, 'refund', 'explicit Failed triggers a refund');
  assert.equal(store.transactions[0].status, 'failed', 'transaction marked failed');
  assert.equal(refunds.length, 1, 'exactly one refund');

  // Idempotent repeat: transaction is now terminal
  const second = await svc.processAirtimeCallback('REF');
  assert.equal(second.action, 'already_terminal', 'repeat callback is already terminal');
  assert.equal(refunds.length, 1, 'still exactly one refund after repeat callback');
});
