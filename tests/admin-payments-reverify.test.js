const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

process.env.JWT_SECRET = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Route-level HTTP tests for the admin payment pending list and re-verify
// endpoints. No real provider, no database: authenticate, the Mongoose models
// and ResilientHttpClient are stubbed before the real admin router is loaded.
// ---------------------------------------------------------------------------

// 1. Stub authenticate BEFORE routes/admin captures it (destructured at require
//    time from the mutated exports object).
const authModule = require('../backend/middleware/auth');
let fakeUserId = 'admin-user';
let fakeRole = 'admin';
authModule.authenticate = async (req, res, next) => {
  const token = req.header('Authorization') || req.header('X-API-Key');
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided, authorization denied' });
  }
  req.user = { userId: fakeUserId, id: fakeUserId, role: fakeRole };
  next();
};

// Stub logAction so the audit trail can be asserted without a real database.
const auditModule = require('../backend/utils/audit');
auditModule.logAction = async (adminId, action, targetType, targetId, details = {}) => {
  capturedLogActions.push({ adminId, action, targetType, targetId, details });
};

// 2. Stub the models before the router requires them.
const Payment = require('../backend/models/Payment');
const Transaction = require('../backend/models/Transaction');
const Wallet = require('../backend/models/Wallet');

const payments = [];
const creditTransactions = [];
const capturedLogActions = [];
const walletCreditCalls = [];
const wallets = [{ userId: 'owner-user', balance: 10000, smsBalance: 0 }];

function match(obj, filter) {
  if (!filter) return true;
  return Object.keys(filter).every((k) => {
    const v = filter[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (v.$in) return v.$in.includes(obj[k]);
      if (v.$nin) return !v.$nin.includes(obj[k]);
      if (v.$ne != null) return obj[k] !== v.$ne;
      if (v.$gte != null) return obj[k] >= v.$gte;
      if (v.$lte != null) return obj[k] <= v.$lte;
      if (v.$lt != null) return obj[k] < v.$lt;
    }
    return obj[k] === v || String(obj[k]) === String(v);
  });
}

Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
Payment.find = (filter) => {
  const items = payments
    .filter((p) => match(p, filter))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const chain = {
    populate: () => chain,
    sort: () => chain,
    limit: (n) => Promise.resolve(items.slice(0, n))
  };
  return chain;
};
Payment.findOneAndUpdate = async (filter, update) => {
  const p = payments.find((x) => match(x, filter));
  if (!p) return null;
  if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
  if (update.$set) Object.assign(p, update.$set);
  if (update.$inc) {
    Object.keys(update.$inc).forEach((k) => { p[k] = (p[k] || 0) + update.$inc[k]; });
  }
  return p;
};
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
Wallet.findOne = async (filter) => wallets.find((w) => match(w, filter)) || null;
Wallet.findOneAndUpdate = async (filter, update) => {
  let w = wallets.find((x) => match(x, filter));
  if (!w) return null;
  if (update.$inc) walletCreditCalls.push({ inc: { ...update.$inc } });
  if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
  if (update.$set) Object.assign(w, update.$set);
  return w;
};

// 3. Stub the HTTP client used by the Hubtel services before they are
//    constructed (routes/admin -> services at load).
const ResilientHttpClient = require('../backend/utils/ResilientHttpClient');
let providerGet = async () => { throw new Error('provider outage'); };
ResilientHttpClient.prototype.get = async function () { return providerGet(); };

process.env.HUBTEL_CLIENT_ID = 'admin-test-client';
process.env.HUBTEL_CLIENT_SECRET = 'admin-test-secret';

// 4. Require the real router last so every stub above is captured.
const adminRouter = require('../backend/routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

let port;
function request(path, headers, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { resolve({ statusCode: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const ADMIN_TOKEN = 'Bearer admin-token-123';
const headers = { Authorization: ADMIN_TOKEN };

function resetStore() {
  payments.length = 0;
  creditTransactions.length = 0;
  capturedLogActions.length = 0;
  walletCreditCalls.length = 0;
  wallets[0].balance = 10000;
  wallets[0].smsBalance = 0;
}

function seedPayment(overrides = {}) {
  const p = {
    _id: 'p-admin-1',
    clientReference: 'NH-ADMIN-REF-1',
    userId: 'owner-user',
    amount: 10,
    currency: 'GHS',
    status: 'pending',
    description: 'top-up',
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    customerEmail: 'john@example.com',
    verificationFailures: 0,
    ...overrides
  };
  payments.push(p);
  return p;
}

test('GET /api/admin/payments/pending lists stuck payments oldest-first, masked email', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  try {
    resetStore();
    // older than 5 minutes, pending -> included
    seedPayment({ clientReference: 'NH-LIST-OLD-1', status: 'pending', createdAt: new Date(Date.now() - 10 * 60 * 1000), customerEmail: 'john@example.com' });
    // older than 5 minutes, processing -> included
    seedPayment({ clientReference: 'NH-LIST-OLD-2', status: 'processing', createdAt: new Date(Date.now() - 20 * 60 * 1000), customerEmail: 'alice@example.com' });
    // newer than 5 minutes -> excluded
    seedPayment({ clientReference: 'NH-LIST-NEW', status: 'pending', createdAt: new Date(Date.now() - 1 * 60 * 1000), customerEmail: 'bob@example.com' });
    // paid -> excluded
    seedPayment({ clientReference: 'NH-LIST-PAID', status: 'paid', createdAt: new Date(Date.now() - 10 * 60 * 1000), customerEmail: 'carol@example.com' });

    const res = await request('/api/admin/payments/pending?olderThanMinutes=5', headers);
    assert.equal(res.statusCode, 200, 'pending list: 200');
    const body = JSON.parse(res.body);
    assert.equal(body.success, true, 'pending list: success');
    assert.equal(body.count, 2, 'pending list: exactly 2 stuck payments');
    assert.equal(body.payments.length, 2, 'pending list: 2 items');
    // newest first
    assert.equal(body.payments[0].reference, 'NH-LIST-OLD-1', 'pending list: newest first');
    assert.equal(body.payments[1].reference, 'NH-LIST-OLD-2', 'pending list: second newest');
    for (const p of body.payments) {
      assert.ok(p.reference);
      assert.ok(typeof p.amount === 'number');
      assert.ok(p.createdAt);
      assert.ok(/^(pending|processing)$/.test(p.status));
      assert.ok(typeof p.verificationFailures === 'number');
      assert.ok(p.lastVerificationError === null || p.lastVerificationError.at);
    }
    // masked email: first 2 chars plus domain
    const john = body.payments.find((p) => p.reference === 'NH-LIST-OLD-1');
    assert.equal(john.userEmail, 'jo**@example.com', 'pending list: masked email');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/admin/payments/:reference/reverify credits once on repeat calls', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  try {
    resetStore();
    seedPayment({ clientReference: 'NH-REVERIFY-1', status: 'pending', amount: 10 });
    providerGet = async () => ({ data: { status: 'Paid', amount: 10, currency: 'GHS' } });

    const r1 = await request('/api/admin/payments/NH-REVERIFY-1/reverify', headers, 'POST');
    assert.equal(r1.statusCode, 200, 'reverify first call: 200');
    const b1 = JSON.parse(r1.body);
    assert.equal(b1.outcome, 'paid', 'reverify first call: paid');
    assert.equal(b1.credited, true, 'reverify first call: credited');
    assert.equal(b1.httpStatus, null, 'reverify first call: no provider error status');
    assert.equal(b1.code, null, 'reverify first call: no provider error code');

    const p1 = payments.find((x) => x.clientReference === 'NH-REVERIFY-1');
    assert.equal(p1.status, 'paid', 'reverify first call: payment marked paid');
    assert.equal(walletCreditCalls.length, 1, 'reverify first call: exactly one wallet credit write');

    // repeat call: payment already terminal -> idempotent, no second credit
    const r2 = await request('/api/admin/payments/NH-REVERIFY-1/reverify', headers, 'POST');
    assert.equal(r2.statusCode, 200, 'reverify repeat call: 200');
    const b2 = JSON.parse(r2.body);
    assert.equal(b2.outcome, 'paid', 'reverify repeat call: paid');
    assert.equal(b2.credited, false, 'reverify repeat call: not credited again');
    assert.equal(walletCreditCalls.length, 1, 'reverify repeat call: still exactly one wallet credit write');

    const audit = capturedLogActions.find((e) => e.action === 'reverify_payment' && e.targetId === 'NH-REVERIFY-1');
    assert.ok(audit, 'reverify: audit log written');
    assert.equal(audit.adminId, fakeUserId, 'reverify: audit records admin id');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/admin/payments/:reference/reverify refuses when provider unavailable', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  try {
    resetStore();
    seedPayment({ clientReference: 'NH-REVERIFY-2', status: 'pending', amount: 10, verificationFailures: 0 });
    const timeoutErr = new Error('gateway timeout');
    timeoutErr.httpStatus = 504;
    timeoutErr.response = { status: 504, data: {} };
    timeoutErr.isTimeout = true;
    providerGet = async () => { throw timeoutErr; };

    const res = await request('/api/admin/payments/NH-REVERIFY-2/reverify', headers, 'POST');
    assert.equal(res.statusCode, 200, 'unavailable: 200');
    const body = JSON.parse(res.body);
    assert.equal(body.outcome, 'verification_unavailable', 'unavailable: outcome');
    assert.equal(body.httpStatus, 504, 'unavailable: provider http status');
    assert.equal(body.credited, false, 'unavailable: not credited');

    const p = payments.find((x) => x.clientReference === 'NH-REVERIFY-2');
    assert.equal(p.status, 'pending', 'unavailable: payment stays pending');
    assert.equal(p.verificationFailures, 1, 'unavailable: failure recorded');
    assert.ok(p.lastVerificationError && p.lastVerificationError.at, 'unavailable: last verification error recorded');
    assert.equal(walletCreditCalls.length, 0, 'unavailable: no wallet credit');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/admin/payments/:reference/reverify refuses non-admin (403)', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  try {
    resetStore();
    seedPayment({ clientReference: 'NH-REVERIFY-3', status: 'pending', amount: 10 });
    providerGet = async () => ({ data: { status: 'Paid', amount: 10, currency: 'GHS' } });

    const prevRole = fakeRole;
    fakeRole = 'user';
    try {
      const res = await request('/api/admin/payments/NH-REVERIFY-3/reverify', headers, 'POST');
      assert.equal(res.statusCode, 403, 'non-admin: 403');
    } finally {
      fakeRole = prevRole;
    }
    assert.equal(walletCreditCalls.length, 0, 'non-admin: no wallet credit');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/admin/payments/:reference/reverify rejects bad reference format (400)', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  try {
    resetStore();
    const bad = ['BAD-REF', 'NH-short', 'nh-abcdefgh', 'NH-abcdefgh!', 'NH-'];
    for (const ref of bad) {
      const res = await request(`/api/admin/payments/${encodeURIComponent(ref)}/reverify`, headers, 'POST');
      assert.equal(res.statusCode, 400, `bad reference ${ref}: 400`);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'VALIDATION_ERROR', `bad reference ${ref}: validation error`);
    }
    assert.equal(walletCreditCalls.length, 0, 'bad reference: no wallet credit');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
