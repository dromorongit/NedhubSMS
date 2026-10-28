const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

process.env.JWT_SECRET = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Route-level HTTP test for GET /api/payments/status/:clientReference.
// No real provider, no database: the authenticate middleware, the Mongoose
// models and ResilientHttpClient are stubbed via require order before the
// real payments router is required.
// ---------------------------------------------------------------------------

// 1. Stub authenticate BEFORE routes/payments captures it (destructured at
//    require time from the mutated exports object).
const authModule = require('../backend/middleware/auth');
let fakeUserId = 'owner-user';
authModule.authenticate = async (req, res, next) => {
  const token = req.header('Authorization') || req.header('X-API-Key');
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided, authorization denied' });
  }
  req.user = { userId: fakeUserId, role: 'client' };
  next();
};

// 2. Stub the models before the controller requires them.
const Payment = require('../backend/models/Payment');
const Transaction = require('../backend/models/Transaction');
const Wallet = require('../backend/models/Wallet');

const payments = [];
const creditTransactions = [];
const walletCreditCalls = []; // { inc: {...} } for each wallet credit write
function match(obj, filter) {
  if (!filter) return true;
  return Object.keys(filter).every((k) => {
    const v = filter[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (v.$in) return v.$in.includes(obj[k]);
      if (v.$nin) return !v.$nin.includes(obj[k]);
      if (v.$gte != null) return obj[k] >= v.$gte;
    }
    return obj[k] === v || String(obj[k]) === String(v);
  });
}
Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
Payment.findOneAndUpdate = async (filter, update) => {
  const p = payments.find((x) => match(x, filter));
  if (!p) return null;
  if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
  if (update.$set) Object.assign(p, update.$set);
  return p;
};
Transaction.findOne = async (filter) => creditTransactions.find((t) => match(t, filter)) || null;
Transaction.prototype.save = async function () {
  if (!creditTransactions.includes(this)) creditTransactions.push(this);
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
const wallets = [{ userId: 'owner-user', balance: 10000, smsBalance: 0 }];

// 3. Stub the HTTP client used by the Hubtel services before they are
//    constructed (routes/payments -> paymentController -> services at load).
const ResilientHttpClient = require('../backend/utils/ResilientHttpClient');
let providerGet = async () => { throw new Error('provider outage'); };
ResilientHttpClient.prototype.get = async function () { return providerGet(); };

// Hubtel credentials must be configured for the status check to proceed.
process.env.HUBTEL_CLIENT_ID = 'route-test-client';
process.env.HUBTEL_CLIENT_SECRET = 'route-test-secret';

// 4. Require the real router last so every stub above is captured.
const paymentsRouter = require('../backend/routes/payments');

const app = express();
app.use(express.json());
app.use('/api/payments', paymentsRouter);

let port;
function request(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { resolve({ statusCode: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on('error', reject);
    req.end();
  });
}

const REF = 'NH-ROUTE-TEST-REF';

function resetStore() {
  payments.length = 0;
  creditTransactions.length = 0;
  walletCreditCalls.length = 0;
  wallets[0].balance = 10000;
  wallets[0].smsBalance = 0;
}
function seedPayment(ownerId, status) {
  payments.push({ _id: 'p1', clientReference: REF, userId: ownerId, amount: 10, currency: 'GHS', status, description: 'top-up' });
}

test('GET /api/payments/status/:clientReference - route-level', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  try {
    // ---- no token -> 401 ----
    resetStore(); seedPayment('owner-user', 'pending');
    const noToken = await request(`/api/payments/status/${REF}`, {});
    assert.equal(noToken.statusCode, 401, 'no token: 401');
    assert.ok(JSON.parse(noToken.body).success === false, 'no token: failure body');

    // ---- another user -> 403 ----
    fakeUserId = 'other-user';
    resetStore(); seedPayment('owner-user', 'pending');
    const otherUser = await request(`/api/payments/status/${REF}`, { Authorization: 'Bearer token-other' });
    assert.equal(otherUser.statusCode, 403, 'another user: 403');

    // ---- owner, provider outage -> 200, payment left pending, clear message ----
    fakeUserId = 'owner-user';
    resetStore(); seedPayment('owner-user', 'pending');
    providerGet = async () => { throw new Error('connect ECONNREFUSED'); };
    const outage = await request(`/api/payments/status/${REF}`, { Authorization: 'Bearer token-owner' });
    assert.equal(outage.statusCode, 200, 'outage: 200');
    const outageBody = JSON.parse(outage.body);
    assert.equal(outageBody.status, 'pending', 'outage: payment left pending');
    assert.ok(/provider unavailable|unavailable/i.test(outageBody.message), 'outage: clear message to client');

    // ---- (e) refresh sequence: Unpaid -> Paid -> Paid, credited exactly once ----
    fakeUserId = 'owner-user';
    providerGet = async () => ({ data: { status: 'Unpaid', amount: 10 } }); // maps to pending
    resetStore(); seedPayment('owner-user', 'pending');
    const r1 = await request(`/api/payments/status/${REF}`, { Authorization: 'Bearer token-owner' });
    assert.equal(r1.statusCode, 200);
    assert.equal(JSON.parse(r1.body).status, 'pending', '(e) first refresh: pending');
    assert.equal(walletCreditCalls.length, 0, '(e) no credit after Unpaid refresh');

    providerGet = async () => ({ data: { status: 'Paid', amount: 10 } }); // maps to paid
    const r2 = await request(`/api/payments/status/${REF}`, { Authorization: 'Bearer token-owner' });
    assert.equal(r2.statusCode, 200);
    const r2Body = JSON.parse(r2.body);
    assert.equal(r2Body.status, 'paid', '(e) second refresh: paid');
    assert.ok(/credited|confirmed/i.test(r2Body.message), '(e) credit message');
    assert.equal(walletCreditCalls.length, 1, '(e) exactly one wallet credit write');

    providerGet = async () => ({ data: { status: 'Paid', amount: 10 } });
    const r3 = await request(`/api/payments/status/${REF}`, { Authorization: 'Bearer token-owner' });
    assert.equal(r3.statusCode, 200);
    assert.equal(JSON.parse(r3.body).status, 'paid', '(e) third refresh: still paid');
    assert.equal(walletCreditCalls.length, 1, '(e) still exactly one credit after repeat refresh (idempotent)');

    // ---- owner, paid already: successful result ----
    resetStore(); seedPayment('owner-user', 'paid');
    providerGet = async () => ({ data: { status: 'Paid', amount: 10 } });
    const ownerPaid = await request(`/api/payments/status/${REF}`, { Authorization: 'Bearer token-owner' });
    assert.equal(ownerPaid.statusCode, 200, 'owner paid: 200');
    assert.equal(JSON.parse(ownerPaid.body).status, 'paid', 'owner paid: paid status');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.HUBTEL_CLIENT_ID;
    delete process.env.HUBTEL_CLIENT_SECRET;
    fakeUserId = 'owner-user';
  }
});
