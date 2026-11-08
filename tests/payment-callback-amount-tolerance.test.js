const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'a'.repeat(64);

// Minimal in-memory mocks
function match(obj, filter) {
  if (!filter) return true;
  return Object.keys(filter).every((k) => {
    const v = filter[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (v.$in) return v.$in.includes(obj[k]);
      if (v.$nin) return !v.$nin.includes(obj[k]);
    }
    return obj[k] === v || String(obj[k]) === String(v);
  });
}

function makeStore() {
  const payments = [];
  const Payment = {
    findOne: async (filter) => payments.find((p) => match(p, filter)) || null,
    findOneAndUpdate: async (filter, update) => {
      const p = payments.find((x) => match(x, filter));
      if (!p) return null;
      if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
      if (update.$set) Object.assign(p, update.$set);
      if (update.$inc) Object.keys(update.$inc).forEach((k) => { p[k] = (p[k] || 0) + update.$inc[k]; });
      return p;
    },
    _store: payments,
  };
  return { payments, Payment };
}

function makeReq(body) {
  return { body, path: '/api/payments/hubtel/callback', method: 'POST', ip: '127.0.0.1' };
}

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// Test the amount tolerance logic directly (same logic as in paymentController)
function amountWithinTolerance(callbackAmount, orderAmount) {
  if (callbackAmount == null) return true;
  const callbackPesewas = Math.round(callbackAmount * 100);
  const orderPesewas = Math.round(orderAmount * 100);
  const toleranceGhs = Math.min(orderAmount * 0.05, 0.50);
  const tolerancePesewas = Math.round(toleranceGhs * 100);
  return callbackPesewas >= orderPesewas && callbackPesewas <= orderPesewas + tolerancePesewas;
}

test('amount tolerance: callback 1.01 for order 1.00 is within tolerance (GHS 0.01 fee)', () => {
  assert.strictEqual(amountWithinTolerance(1.01, 1.00), true);
});

test('amount tolerance: callback 1.00 for order 1.00 is exact match', () => {
  assert.strictEqual(amountWithinTolerance(1.00, 1.00), true);
});

test('amount tolerance: callback 1.05 for order 1.00 is within 5% tolerance (0.05)', () => {
  assert.strictEqual(amountWithinTolerance(1.05, 1.00), true);
});

test('amount tolerance: callback 1.06 for order 1.00 exceeds tolerance (0.05)', () => {
  assert.strictEqual(amountWithinTolerance(1.06, 1.00), false);
});

test('amount tolerance: callback 0.99 for order 1.00 is underpayment (rejected)', () => {
  assert.strictEqual(amountWithinTolerance(0.99, 1.00), false);
});

test('amount tolerance: callback 100.50 for order 100.00 is within 0.50 GHS cap', () => {
  assert.strictEqual(amountWithinTolerance(100.50, 100.00), true);
});

test('amount tolerance: callback 100.51 for order 100.00 exceeds 0.50 GHS cap', () => {
  assert.strictEqual(amountWithinTolerance(100.51, 100.00), false);
});

test('amount tolerance: callback 10.05 for order 10.00 is within 5% (0.50)', () => {
  assert.strictEqual(amountWithinTolerance(10.05, 10.00), true);
});

test('amount tolerance: null callback amount is accepted (no check)', () => {
  assert.strictEqual(amountWithinTolerance(null, 1.00), true);
});

// Test HubtelPaymentService status mapping
const HubtelPaymentService = require('../backend/services/HubtelPaymentService');

test('payment status mapping: success words map to paid (case-insensitive)', () => {
  const svc = new HubtelPaymentService();
  const paidWords = ['paid', 'Paid', 'PAID', ' PAID ', 'success', 'SUCCESS', 'Successful', 'SUCCESSFUL', 'completed', 'COMPLETED', 'Completed', ' completed '];
  for (const word of paidWords) {
    assert.strictEqual(svc._mapHubtelStatus(word), 'paid', `'${word}' should map to paid`);
  }
});

test('payment status mapping: failed words map to failed', () => {
  const svc = new HubtelPaymentService();
  for (const word of ['failed', 'Failed', 'FAILED', ' FAILED ']) {
    assert.strictEqual(svc._mapHubtelStatus(word), 'failed', `'${word}' should map to failed`);
  }
});

test('payment status mapping: unknown words map to pending', () => {
  const svc = new HubtelPaymentService();
  for (const word of ['pending', 'Unpaid', 'Refunded', 'cancelled', 'unknown', '']) {
    assert.strictEqual(svc._mapHubtelStatus(word), 'pending', `'${word}' should map to pending`);
  }
});

// Integration-style test: verify the callback verification service accepts
// provider amounts >= order amount (the server-to-server check)
const CallbackVerificationService = require('../backend/services/callbackVerificationService');

test('callback verification: provider amount 1.01 for order 1.00 credits order amount', async () => {
  const payments = [];
  const transactions = [];
  const wallets = [];

  const Payment = function (data) {
    const inst = { ...data, _id: `p1`, status: data.status || 'pending' };
    inst.save = async function () { return this; };
    payments.push(inst);
    return inst;
  };
  Payment.findOne = async (filter) => payments.find((p) => p.clientReference === filter.clientReference) || null;
  Payment.findOneAndUpdate = async (filter, update) => {
    const p = payments.find((x) => x.clientReference === filter.clientReference);
    if (!p) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
    if (update.$set) Object.assign(p, update.$set);
    return p;
  };

  const Transaction = function (data) {
    const inst = { ...data, _id: `t1` };
    inst.save = async function () { if (!transactions.includes(this)) transactions.push(this); return this; };
    return inst;
  };
  Transaction.findOne = async (filter) => transactions.find((t) => t.reference === filter.reference) || null;
  Transaction.findOneAndUpdate = async () => null;
  Transaction.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });

  const Wallet = {
    findOne: async (filter) => wallets.find((w) => w.userId === filter.userId) || null,
    findOneAndUpdate: async (filter, update) => {
      let w = wallets.find((x) => x.userId === filter.userId);
      if (!w) { w = { userId: filter.userId, balance: 0, smsBalance: 0 }; wallets.push(w); }
      if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
      return w;
    },
  };

  const svc = new CallbackVerificationService({
    Payment,
    Transaction,
    Wallet,
    paymentService: {
      checkTransactionStatus: async () => ({ status: 'paid', amount: 1.01, transactionId: 'HTX-1.01', paymentMethod: 'momo' }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });

  new Payment({ clientReference: 'NH-FEE-TEST', userId: 'u1', amount: 1.00, status: 'pending' });
  const res = await svc.processPaymentCallback('NH-FEE-TEST');

  assert.strictEqual(res.action, 'credit');
  assert.strictEqual(res.applied, true);

  const payment = await Payment.findOne({ clientReference: 'NH-FEE-TEST' });
  assert.strictEqual(payment.status, 'paid');

  const tx = await Transaction.findOne({ reference: 'PAYMENT-NH-FEE-TEST' });
  assert.ok(tx, 'credit transaction should exist');
  assert.strictEqual(tx.amount, 1.00, 'credited amount must be the ORDER amount, not the provider amount');
});

test('callback verification: provider amount 2.00 for order 1.00 - service accepts (credits order amount); controller tolerance rejects', async () => {
  const payments = [];
  const transactions = [];
  const wallets = [];

  const Payment = function (data) {
    const inst = { ...data, _id: `p1`, status: data.status || 'pending' };
    payments.push(inst);
    return inst;
  };
  Payment.findOne = async (filter) => payments.find((p) => p.clientReference === filter.clientReference) || null;
  Payment.findOneAndUpdate = async (filter, update) => {
    const p = payments.find((x) => x.clientReference === filter.clientReference);
    if (!p) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
    if (update.$set) Object.assign(p, update.$set);
    return p;
  };

  const Transaction = function (data) {
    const inst = { ...data, _id: `t1` };
    inst.save = async function () { if (!transactions.includes(this)) transactions.push(this); return this; };
    return inst;
  };
  Transaction.findOne = async (filter) => transactions.find((t) => t.reference === filter.reference) || null;
  Transaction.findOneAndUpdate = async () => null;
  Transaction.updateOne = async (filter, update) => {
    const t = transactions.find((x) => x.reference === filter.reference || x._id === filter._id);
    if (!t) return { matchedCount: 0, modifiedCount: 0 };
    if (update.$set) Object.assign(t, update.$set);
    return { matchedCount: 1, modifiedCount: 1 };
  };

  const Wallet = {
    findOne: async (filter) => wallets.find((w) => w.userId === filter.userId) || null,
    findOneAndUpdate: async (filter, update) => {
      let w = wallets.find((x) => x.userId === filter.userId);
      if (!w) { w = { userId: filter.userId, balance: 0, smsBalance: 0 }; wallets.push(w); }
      if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
      return w;
    },
  };

  const svc = new CallbackVerificationService({
    Payment,
    Transaction,
    Wallet,
    paymentService: {
      checkTransactionStatus: async () => ({ status: 'paid', amount: 2.00, transactionId: 'HTX-2.00', paymentMethod: 'momo' }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });

  new Payment({ clientReference: 'NH-BIG-MISMATCH', userId: 'u1', amount: 1.00, status: 'pending' });
  const res = await svc.processPaymentCallback('NH-BIG-MISMATCH');

  // Service layer: accepts providerAmount >= payment.amount (server-to-server verified).
  // It credits the ORDER amount (1.00), never more.
  assert.strictEqual(res.action, 'credit');
  assert.strictEqual(res.applied, true);
  const tx = transactions[0];
  assert.strictEqual(tx.amount, 1.00, 'credited the ORDER amount, never more');

  // Controller pre-check (tolerance logic tested above) rejects callback amount 2.00
  // for order 1.00 (tolerance 0.05). So the controller would hold it for review
  // before reaching the service. This test documents the service's safe behavior.
});
