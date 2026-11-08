const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('os').tmpdir();

process.env.JWT_SECRET = 'a'.repeat(64);

const CallbackVerificationService = require('../backend/services/callbackVerificationService');

// ============================================================================
// In-memory mock stores (same pattern as callback-verification.test.js)
// ============================================================================

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

function makeStore() {
  const payments = [];
  const transactions = [];
  const wallets = [];
  const auditLines = [];

  const Payment = function (data) {
    const inst = { ...data, _id: data._id || `p${payments.length + 1}`, status: data.status || 'pending' };
    inst.save = async function () { return this; };
    payments.push(inst);
    return inst;
  };
  Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
  Payment.findOneAndUpdate = async (filter, update, opts) => {
    const idx = payments.findIndex((p) => match(p, filter));
    if (idx < 0) return null;
    const p = payments[idx];
    if (update.$set) Object.assign(p, update.$set);
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { p[k] = (p[k] || 0) + update.$inc[k]; });
    if (opts && opts.new) return p;
    return p;
  };
  Payment.updateOne = async (filter, update) => {
    const idx = payments.findIndex((p) => match(p, filter));
    if (idx >= 0 && update.$set) Object.assign(payments[idx], update.$set);
    return { modifiedCount: idx >= 0 ? 1 : 0 };
  };
  Payment.find = async (filter) => payments.filter((p) => match(p, filter));

  const Transaction = function (data) {
    const inst = { ...data, _id: data._id || `t${transactions.length + 1}` };
    inst.save = async function () { if (!transactions.includes(this)) transactions.push(this); return this; };
    return inst;
  };
  Transaction.findOne = async (filter) => transactions.find((t) => match(t, filter)) || null;
  Transaction.findOneAndUpdate = async (filter, update, opts) => {
    const t = transactions.find((x) => match(x, filter));
    if (!t) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(t.status)) return null;
    if (filter.status && filter.status.$nin && filter.status.$nin.includes(t.status)) return null;
    if (update.$set) Object.assign(t, update.$set);
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { t[k] = (t[k] || 0) + update.$inc[k]; });
    return t;
  };
  Transaction.updateOne = async (filter, update) => {
    const t = transactions.find((x) => match(x, filter));
    if (!t) return { matchedCount: 0, modifiedCount: 0 };
    if (update.$set) Object.assign(t, update.$set);
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { t[k] = (t[k] || 0) + update.$inc[k]; });
    return { matchedCount: 1, modifiedCount: 1 };
  };

  const Wallet = function (data) { return { ...data, save: async function () { return this; } }; };
  Wallet.findOne = async (filter) => wallets.find((w) => match(w, filter)) || null;
  Wallet.findOneAndUpdate = async (filter, update, opts) => {
    let w = wallets.find((x) => match(x, filter));
    if (!w) {
      w = { userId: filter.userId, balance: 0, smsBalance: 0 };
      wallets.push(w);
    }
    if (filter.balance && filter.balance.$gte != null) {
      if ((w.balance || 0) < filter.balance.$gte) return null;
    }
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
    if (update.$set) Object.assign(w, update.$set);
    return w;
  };

  return { payments, transactions, wallets, auditLines, Payment, Transaction, Wallet };
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

// ============================================================================
// Test 1: success callback credits once and sets completed
// ============================================================================

test('success callback credits wallet once and sets payment completed', async () => {
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 10, transactionId: 'HTX-1', paymentMethod: 'momo' }) }
  });
  new store.Payment({ clientReference: 'REF-SUCCESS-1', userId: 'u1', amount: 10, status: 'pending' });

  const res = await svc.processPaymentCallback('REF-SUCCESS-1');

  assert.strictEqual(res.action, 'credit');
  assert.strictEqual(res.applied, true);

  const payment = await store.Payment.findOne({ clientReference: 'REF-SUCCESS-1' });
  assert.strictEqual(payment.status, 'paid');

  const tx = await store.Transaction.findOne({ reference: 'PAYMENT-REF-SUCCESS-1' });
  assert.ok(tx, 'credit transaction should exist');
  assert.strictEqual(tx.status, 'completed');

  const wallet = await store.Wallet.findOne({ userId: 'u1' });
  assert.strictEqual(wallet.balance, 10);
  assert.strictEqual(wallet.smsBalance, 10);
});

// ============================================================================
// Test 2: replayed callback does nothing (idempotent)
// ============================================================================

test('replayed success callback does nothing (already terminal)', async () => {
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 10, transactionId: 'HTX-2', paymentMethod: 'momo' }) }
  });
  new store.Payment({ clientReference: 'REF-REPLAY', userId: 'u1', amount: 10, status: 'pending' });

  const r1 = await svc.processPaymentCallback('REF-REPLAY');
  assert.strictEqual(r1.action, 'credit');
  assert.strictEqual(r1.applied, true);

  const r2 = await svc.processPaymentCallback('REF-REPLAY');
  assert.strictEqual(r2.action, 'already_terminal');
  assert.strictEqual(r2.applied, false);

  const txs = store.transactions.filter((t) => String(t.reference).startsWith('PAYMENT-'));
  assert.strictEqual(txs.length, 1, 'only one credit transaction');
});

// ============================================================================
// Test 3: callback with mismatched amount does not credit
// ============================================================================

test('callback with provider amount less than stored amount does not credit', async () => {
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 5, transactionId: 'HTX-3', paymentMethod: 'momo' }) }
  });
  new store.Payment({ clientReference: 'REF-MISMATCH', userId: 'u1', amount: 10, status: 'pending' });

  const res = await svc.processPaymentCallback('REF-MISMATCH');

  assert.notStrictEqual(res.action, 'credit');
  const payment = await store.Payment.findOne({ clientReference: 'REF-MISMATCH' });
  assert.notStrictEqual(payment.status, 'paid');
  assert.strictEqual(store.transactions.length, 0);
});

// ============================================================================
// Test 4: failed callback marks failed
// ============================================================================

test('failed callback marks payment failed and does not credit', async () => {
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'failed', amount: 10, transactionId: 'HTX-4', paymentMethod: 'momo' }) }
  });
  new store.Payment({ clientReference: 'REF-FAILED', userId: 'u1', amount: 10, status: 'pending' });

  const res = await svc.processPaymentCallback('REF-FAILED');

  assert.strictEqual(res.action, 'mark_failed');
  const payment = await store.Payment.findOne({ clientReference: 'REF-FAILED' });
  assert.strictEqual(payment.status, 'failed');
  assert.strictEqual(store.transactions.length, 0);
});

// ============================================================================
// Test 5: pending page polling flow resolves to success
// (simulated: status endpoint returns paid -> redirect to success)
// ============================================================================

test('pending page polling: backend status returns paid -> success redirect', async () => {
  // Simulate the backend status endpoint behavior: pending -> provider confirms paid -> status paid
  const { store, svc } = makeService({
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 25, transactionId: 'HTX-5', paymentMethod: 'card' }) }
  });
  new store.Payment({ clientReference: 'REF-POLL', userId: 'u1', amount: 25, status: 'pending' });

  // First poll: still pending (callback hasn't arrived yet, but status endpoint calls Hubtel)
  const result = await svc.refreshUserPayment('u1', 'REF-POLL');
  assert.strictEqual(result.action, 'credit');
  assert.strictEqual(result.applied, true);

  const payment = await store.Payment.findOne({ clientReference: 'REF-POLL' });
  assert.strictEqual(payment.status, 'paid');
});

// ============================================================================
// Test 6: recovery dry run changes nothing
// ============================================================================

test('recovery dry run changes nothing (no writes to DB)', async () => {
  const { recoverPendingTopups } = require('../backend/scripts/recover-pending-topups');

  const store = makeStore();
  const svc = new CallbackVerificationService({
    Payment: store.Payment,
    Transaction: store.Transaction,
    Wallet: store.Wallet,
    paymentService: {
      checkTransactionStatus: async () => ({ status: 'paid', amount: 10, transactionId: 'HTX-DRY', paymentMethod: 'momo' })
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  // Create a pending payment older than 10 minutes
  const oldPayment = new store.Payment({
    clientReference: 'REF-DRY-1',
    userId: 'u1',
    amount: 10,
    status: 'pending',
    createdAt: new Date(Date.now() - 15 * 60 * 1000) // 15 minutes ago
  });

  const oldTxCount = store.transactions.length;
  const oldPaymentCount = store.payments.length;

  const results = await recoverPendingTopups({
    apply: false,
    olderThanMinutes: 10,
    PaymentModel: store.Payment,
    TransactionModel: store.Transaction,
    WalletModel: store.Wallet,
    verificationService: svc
  });

  // Dry run should not have credited anything
  assert.strictEqual(results.credited, 0);
  assert.strictEqual(store.transactions.length, oldTxCount, 'no new transactions in dry run');
  assert.strictEqual(store.payments.length, oldPaymentCount, 'no new payments in dry run');

  // Payment should still be pending
  const payment = await store.Payment.findOne({ clientReference: 'REF-DRY-1' });
  assert.strictEqual(payment.status, 'pending');
});

// ============================================================================
// Test 7: --apply credits only confirmed-paid references once
// ============================================================================

test('--apply credits only confirmed-paid references once (idempotent)', async () => {
  const { recoverPendingTopups } = require('../backend/scripts/recover-pending-topups');

  const store = makeStore();
  const svc = new CallbackVerificationService({
    Payment: store.Payment,
    Transaction: store.Transaction,
    Wallet: store.Wallet,
    paymentService: {
      checkTransactionStatus: async (ref) => {
        // Only REF-APPLY-1 is paid; REF-APPLY-2 is still pending
        if (ref === 'REF-APPLY-1') return { status: 'paid', amount: 10, transactionId: 'HTX-APPLY-1', paymentMethod: 'momo' };
        return { status: 'pending', amount: 0 };
      }
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  // Two pending payments older than 10 minutes
  new store.Payment({ clientReference: 'REF-APPLY-1', userId: 'u1', amount: 10, status: 'pending', createdAt: new Date(Date.now() - 15 * 60 * 1000) });
  new store.Payment({ clientReference: 'REF-APPLY-2', userId: 'u2', amount: 20, status: 'pending', createdAt: new Date(Date.now() - 15 * 60 * 1000) });

  const results = await recoverPendingTopups({
    apply: true,
    olderThanMinutes: 10,
    PaymentModel: store.Payment,
    TransactionModel: store.Transaction,
    WalletModel: store.Wallet,
    verificationService: svc
  });

  // Only REF-APPLY-1 should be credited (Hubtel confirmed paid)
  assert.strictEqual(results.credited, 1);

  const p1 = await store.Payment.findOne({ clientReference: 'REF-APPLY-1' });
  assert.strictEqual(p1.status, 'paid');
  const tx1 = await store.Transaction.findOne({ reference: 'PAYMENT-REF-APPLY-1' });
  assert.ok(tx1, 'credit tx for REF-APPLY-1');

  const p2 = await store.Payment.findOne({ clientReference: 'REF-APPLY-2' });
  assert.strictEqual(p2.status, 'pending', 'REF-APPLY-2 stays pending (Hubtel not paid)');

  // Idempotency: run again, no duplicate credit
  const results2 = await recoverPendingTopups({
    apply: true,
    olderThanMinutes: 10,
    PaymentModel: store.Payment,
    TransactionModel: store.Transaction,
    WalletModel: store.Wallet,
    verificationService: svc
  });
  assert.strictEqual(results2.credited, 0, 'second apply credits nothing (already terminal)');
});
