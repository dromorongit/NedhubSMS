// Route-level smoke tests for the payment top-up flow.
// Runs the REAL routers (payments, wallet, admin) with require-cache stubs for
// models (Payment, Wallet, Transaction, User), the auth middleware, and
// HubtelPaymentService (fake initiate + fake status check). No new dependencies.
// node:test + node:http only. Run with: node --test tests/payment-routes-smoke.test.js

const path = require('path');
const http = require('node:http');
const express = require('express');
const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const BACKEND = path.resolve('backend');

function stub(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { exports, filename: resolved, loaded: true };
}

// ============================================================================
// Require-cache stubs (must be populated BEFORE the real routers are required)
// ============================================================================

// No-op logger so handlers never touch the filesystem/winston transports.
stub(path.join(BACKEND, 'utils/logger.js'), {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, log: () => {},
  tags: {}, api: {}, ratelimit: {}, responseParser: {}, smsSend: {}, backendError: {},
  auth: {}, campaign: {}, wallet: {}, schedule: {}, retry: {}, webhook: {}, bullmq: {},
  validation: {}, messageStatus: {}, deliveryWebhook: {}, messageHistory: {},
  statusMapping: {}, resendLogic: {}, statusRepair: {}, polling: {},
  hubtelRequest: {}, hubtelResponse: {}, hubtelTimeout: {}, hubtelCallback: {},
  transactionLifecycle: {}, providerPromise: {}, providerCatch: {},
  hubtelAuth: {}, hubtel403: {}, hubtelValidation: {}, providerFailure: {},
  senderIdCreation: {}, senderIdApproval: {}, senderIdNotification: {},
  senderIdEmail: {}, senderIdError: {}
});

// Fake in-memory models.
const payments = [];
const transactions = [];
const wallets = new Map();

function matchFilter(item, filter) {
  for (const [key, value] of Object.entries(filter || {})) {
    const itemValue = item[key];
    if (key === '$or') {
      if (!Array.isArray(value) || !value.some(sub => matchFilter(item, sub))) return false;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.$in !== undefined && !value.$in.includes(itemValue)) return false;
      if (value.$nin !== undefined && value.$nin.includes(itemValue)) return false;
      if (value.$lt !== undefined && !(itemValue < value.$lt)) return false;
      if (value.$lte !== undefined && !(itemValue <= value.$lte)) return false;
      if (value.$gt !== undefined && !(itemValue > value.$gt)) return false;
      if (value.$gte !== undefined && !(itemValue >= value.$gte)) return false;
      if (value.$ne !== undefined && itemValue === value.$ne) return false;
      continue;
    }
    if (itemValue !== value) return false;
  }
  return true;
}

function applyUpdate(target, update) {
  for (const [key, value] of Object.entries(update || {})) {
    if (key === '$set' && value && typeof value === 'object') Object.assign(target, value);
    else if (key === '$inc' && value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) target[k] = (Number(target[k]) || 0) + v;
    } else {
      target[key] = value;
    }
  }
}

class FakeQuery {
  constructor(items) { this.items = items; }
  populate() { return this; }
  sort() { return this; }
  skip() { return this; }
  limit() { return this; }
  then(resolve) { resolve(this.items); }
}

class FakePayment {
  constructor(data) {
    Object.assign(this, data);
    if (!this._id) this._id = 'pay_' + Math.random().toString(36).slice(2, 10);
    if (!this.createdAt) this.createdAt = new Date();
  }
  async save() {
    const idx = payments.findIndex(p => p.clientReference === this.clientReference);
    if (idx >= 0) payments[idx] = this; else payments.push(this);
    return this;
  }
  static findOne(filter) {
    const p = payments.find(x => matchFilter(x, filter));
    return p || null;
  }
  static find(filter) {
    const items = payments.filter(x => matchFilter(x, filter));
    return new FakeQuery(items);
  }
  static findOneAndUpdate(filter, update, opts) {
    const p = payments.find(x => matchFilter(x, filter));
    if (!p) return null;
    applyUpdate(p, update);
    return opts && opts.new ? p : p;
  }
  static updateOne(filter, update) {
    const p = payments.find(x => matchFilter(x, filter));
    if (!p) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(p, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  static countDocuments(filter) {
    return payments.filter(x => matchFilter(x, filter)).length;
  }
}
FakePayment.__store = payments;

class FakeWallet {
  constructor(data) { Object.assign(this, data); }
  async save() { return this; }
  static findOne(filter) {
    for (const [, w] of wallets) if (matchFilter(w, filter)) return w;
    return null;
  }
  static findOneAndUpdate(filter, update) {
    let w;
    for (const [, candidate] of wallets) {
      if (matchFilter(candidate, filter)) { w = candidate; break; }
    }
    if (!w) {
      w = { ...filter };
      wallets.set(w.userId, w);
    }
    applyUpdate(w, update);
    return w;
  }
}
class FakeTransaction {
  constructor(data) {
    Object.assign(this, data);
    if (!this._id) this._id = 'txn_' + Math.random().toString(36).slice(2, 10);
    if (!this.createdAt) this.createdAt = new Date();
  }
  async save() { transactions.push(this); return this; }
  static findOne(filter) {
    const t = transactions.find(x => matchFilter(x, filter));
    return t || null;
  }
  static findByIdAndUpdate() { return null; }
  static find() { return new FakeQuery(transactions); }
  static countDocuments(filter) {
    return transactions.filter(x => matchFilter(x, filter)).length;
  }
}
class FakeUser {
  static findById(id) {
    return { _id: id, email: 'user@example.com', phone: '0500000000', role: 'user' };
  }
  static findOne() { return null; }
}

stub(path.join(BACKEND, 'models/Payment.js'), FakePayment);
stub(path.join(BACKEND, 'models/Wallet.js'), FakeWallet);
stub(path.join(BACKEND, 'models/Transaction.js'), FakeTransaction);
stub(path.join(BACKEND, 'models/User.js'), FakeUser);

// Auth middleware stub: injects a fake user; role is mutable per request.
let currentRole = 'admin';
const fakeAuthenticate = (req, res, next) => {
  req.user = { userId: 'smoke_user_1', role: currentRole };
  next();
};
const fakeAuthorize = (roles = []) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied', error: { code: 'FORBIDDEN' } });
  }
  next();
};
stub(path.join(BACKEND, 'middleware/auth.js'), { authenticate: fakeAuthenticate, authorize: fakeAuthorize });

// HubtelPaymentService stub: controllable provider behavior, read at call time.
const providerBehavior = { status: 'paid', amount: '10', currency: 'GHS', transactionId: 'TXN_1', paymentMethod: 'mobile_money', rawStatus: 'SUCCESS', throw: null };
class FakeHubtelPaymentService {
  generateClientReference() { return 'NH-SMOKE-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }
  async initiatePayment() {
    return { checkoutId: 'CHK_SMOKE_1', checkoutUrl: 'https://checkout.hubtel.example/pay/CHK_SMOKE_1' };
  }
  async checkTransactionStatus() {
    if (providerBehavior.throw) {
      const err = new Error(providerBehavior.throw.message || 'provider down');
      err.httpStatus = providerBehavior.throw.status || 502;
      err.code = providerBehavior.throw.code || 'PROVIDER_DOWN';
      err.isNetwork = !!providerBehavior.throw.isNetwork;
      throw err;
    }
    return {
      status: providerBehavior.status, rawStatus: providerBehavior.rawStatus,
      amount: providerBehavior.amount, currency: providerBehavior.currency,
      transactionId: providerBehavior.transactionId, paymentMethod: providerBehavior.paymentMethod, message: 'ok'
    };
  }
  async checkStatusRaw() {
    if (providerBehavior.throw) {
      const err = new Error(providerBehavior.throw.message || 'provider down');
      err.httpStatus = providerBehavior.throw.status || 502;
      err.code = providerBehavior.throw.code || 'PROVIDER_DOWN';
      err.isNetwork = !!providerBehavior.throw.isNetwork;
      throw err;
    }
    return {
      httpStatus: 200, rawStatus: providerBehavior.rawStatus, status: providerBehavior.status,
      amount: providerBehavior.amount, currency: providerBehavior.currency,
      transactionId: providerBehavior.transactionId, paymentMethod: providerBehavior.paymentMethod,
      hasStatus: true, hasAmount: true
    };
  }
  sanitizeShortMessage(m) { return String(m || ''); }
}
stub(path.join(BACKEND, 'services/HubtelPaymentService.js'), FakeHubtelPaymentService);

stub(path.join(BACKEND, 'services/HubtelAuthAuditService.js'), {
  runAuthAudit: async () => ({ overallStatus: 'success', checks: {}, failures: [], warnings: [] }),
  logAuditReport: () => {}
});
stub(path.join(BACKEND, 'utils/audit.js'), { logAction: async () => {} });
stub(path.join(BACKEND, 'utils/nalo.js'), { checkBalance: async () => ({ ok: true, balance: 5000 }) });

// ============================================================================
// Real routers, mounted exactly as in server/index.js
// ============================================================================

const paymentsRouter = require(path.join(BACKEND, 'routes/payments.js'));
const walletRouter = require(path.join(BACKEND, 'routes/wallet.js'));
const adminRouter = require(path.join(BACKEND, 'routes/admin.js'));

const app = express();
app.use(express.json());
app.use('/api/payments', paymentsRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/admin', adminRouter);

let PORT;
const server = app.listen(0, '127.0.0.1');

before(async () => {
  await new Promise((res) => server.once('listening', res));
  PORT = server.address().port;
});
after(() => server.close());

function request(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, method, path: url,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setRole(role) { currentRole = role; }
function provider(statusOrThrow, override = {}) {
  Object.assign(providerBehavior, { status: 'paid', amount: '10', currency: 'GHS', transactionId: 'TXN_1', paymentMethod: 'mobile_money', rawStatus: 'SUCCESS', throw: null });
  if (typeof statusOrThrow === 'object') Object.assign(providerBehavior, statusOrThrow);
  else providerBehavior.status = statusOrThrow || 'paid';
  Object.assign(providerBehavior, override);
}
function plantPayment(data) {
  const p = new FakePayment(data);
  payments.push(p);
  return p;
}
function lastLocation(res) { return res.headers && res.headers.location; }
function hostOf(location) { return location ? new URL(location).host : null; }

describe('payment routes smoke tests (real handlers, stubbed models/auth/provider)', () => {
  it('(a) POST initiate payment - allowed Origin returns 200 with checkout URL and returnOrigin = allowed origin', async () => {
    setRole('user');
    provider('paid');
    const res = await request('POST', '/api/payments/initiate', { origin: 'https://app.nedhubgh.com' }, { amount: 10, description: 'Wallet top-up' });
    console.log('(a) allowed Origin: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.checkoutUrl, 'checkoutUrl present');
    const saved = payments.find(p => p.clientReference === body.clientReference);
    assert.ok(saved, 'payment record saved');
    assert.strictEqual(saved.returnOrigin, 'https://app.nedhubgh.com');
    assert.strictEqual(saved.status, 'processing');
  });

  it('(a) POST initiate payment - spoofed Origin returns 200 and returnOrigin falls back to primary origin', async () => {
    setRole('user');
    provider('paid');
    const res = await request('POST', '/api/payments/initiate', { origin: 'https://evil.example.com' }, { amount: 10 });
    console.log('(a) spoofed Origin: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.checkoutUrl);
    const saved = payments.find(p => p.clientReference === body.clientReference);
    assert.ok(saved);
    assert.strictEqual(saved.returnOrigin, 'https://app.nedhubgh.com'); // primary origin, NOT the spoofed origin
  });

  it('(a) POST initiate payment - no Origin returns 200 and returnOrigin falls back to primary origin', async () => {
    setRole('user');
    provider('paid');
    const res = await request('POST', '/api/payments/initiate', {}, { amount: 5 });
    console.log('(a) no Origin: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.checkoutUrl);
    const saved = payments.find(p => p.clientReference === body.clientReference);
    assert.ok(saved);
    assert.strictEqual(saved.returnOrigin, 'https://app.nedhubgh.com');
  });

  it('(b) GET payment return - paid -> payment-success.html, host app.nedhubgh.com', async () => {
    setRole('user');
    plantPayment({ clientReference: 'NH-PAID', status: 'paid', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    const res = await request('GET', '/api/payments/return?clientReference=NH-PAID');
    console.log('(b) paid return: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(hostOf(res.headers.location), 'app.nedhubgh.com');
    assert.ok(res.headers.location.includes('/src/pages/dashboard/payment-success.html'), 'success page');
  });

  it('(b) GET payment return - failed -> payment-error.html, host app.nedhubgh.com', async () => {
    setRole('user');
    plantPayment({ clientReference: 'NH-FAILED', status: 'failed', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    const res = await request('GET', '/api/payments/return?clientReference=NH-FAILED');
    console.log('(b) failed return: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(hostOf(res.headers.location), 'app.nedhubgh.com');
    assert.ok(res.headers.location.includes('/src/pages/dashboard/payment-error.html'), 'error page');
  });

  it('(b) GET payment return - pending + provider confirms paid -> payment-success.html, host app.nedhubgh.com', async () => {
    setRole('user');
    provider('paid');
    plantPayment({ clientReference: 'NH-PENDING', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    const res = await request('GET', '/api/payments/return?clientReference=NH-PENDING');
    console.log('(b) pending return (provider=paid): status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(hostOf(res.headers.location), 'app.nedhubgh.com');
    assert.ok(res.headers.location.includes('/src/pages/dashboard/payment-success.html'), 'success page');
  });

  it('(b) GET payment return - unknown reference -> payment-error.html, host app.nedhubgh.com', async () => {
    setRole('user');
    provider('paid');
    const res = await request('GET', '/api/payments/return?clientReference=NH-DOESNOTEXIST');
    console.log('(b) unknown reference return: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(hostOf(res.headers.location), 'app.nedhubgh.com');
    assert.ok(res.headers.location.includes('/src/pages/dashboard/payment-error.html'), 'error page');
  });

  it('(b) GET payment return - provider unavailable -> payment-pending.html, host app.nedhubgh.com', async () => {
    setRole('user');
    provider({ throw: { status: 502, code: 'PROVIDER_DOWN', isNetwork: true } });
    plantPayment({ clientReference: 'NH-PROVIDER-DOWN', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    const res = await request('GET', '/api/payments/return?clientReference=NH-PROVIDER-DOWN');
    console.log('(b) provider-unavailable return: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(hostOf(res.headers.location), 'app.nedhubgh.com');
    assert.ok(res.headers.location.includes('/src/pages/dashboard/payment-pending.html'), 'pending page');
  });

  it('(c) GET payment cancelled -> payment-cancelled.html, host app.nedhubgh.com', async () => {
    setRole('user');
    plantPayment({ clientReference: 'NH-CANCEL', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    const res = await request('GET', '/api/payments/cancelled?clientReference=NH-CANCEL');
    console.log('(c) cancelled return: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(hostOf(res.headers.location), 'app.nedhubgh.com');
    assert.ok(res.headers.location.includes('/src/pages/dashboard/payment-cancelled.html'), 'cancelled page');
    const updated = FakePayment.__store.find(p => p.clientReference === 'NH-CANCEL');
    assert.strictEqual(updated.status, 'cancelled');
  });

  it('(d) GET payment status - paid returns 200', async () => {
    setRole('user');
    plantPayment({ clientReference: 'NH-STATUS-PAID', status: 'paid', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com' });
    const res = await request('GET', '/api/payments/status/NH-STATUS-PAID');
    console.log('(d) status paid: status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'paid');
  });

  it('(d) GET payment status - pending + provider confirms -> 200 paid', async () => {
    setRole('user');
    provider('paid');
    plantPayment({ clientReference: 'NH-STATUS-PENDING', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com' });
    const res = await request('GET', '/api/payments/status/NH-STATUS-PENDING');
    console.log('(d) status pending (provider=paid): status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'paid');
  });

  it('(d) GET payment status - unknown reference -> 404', async () => {
    setRole('user');
    provider('paid');
    const res = await request('GET', '/api/payments/status/NH-NOPE');
    console.log('(d) status unknown: status', res.statusCode);
    assert.strictEqual(res.statusCode, 404);
  });

  it('(e) POST /api/wallet/reconcile -> 200 with checked/credited', async () => {
    setRole('user');
    provider('paid');
    payments.length = 0;
    transactions.length = 0;
    wallets.clear();
    plantPayment({ clientReference: 'NH-REC', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', createdAt: new Date() });
    const res = await request('POST', '/api/wallet/reconcile', {}, {});
    console.log('(e) wallet reconcile: status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.checked, 1);
    assert.strictEqual(body.data.credited, 1);
  });

  it('(f) admin GET pending list -> 200 for admin, 403 for non-admin', async () => {
    provider('paid');
    setRole('admin');
    let res = await request('GET', '/api/admin/payments/pending');
    console.log('(f) admin pending list (admin): status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    setRole('user');
    res = await request('GET', '/api/admin/payments/pending');
    console.log('(f) admin pending list (non-admin): status', res.statusCode);
    assert.strictEqual(res.statusCode, 403);
  });

  it('(f) admin POST reverify -> 200 for admin, 403 for non-admin', async () => {
    setRole('admin');
    provider('paid');
    plantPayment({ clientReference: 'NH-REVERIFY-1', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    let res = await request('POST', '/api/admin/payments/NH-REVERIFY-1/reverify');
    console.log('(f) admin reverify (admin): status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(['paid', 'verification_unavailable', 'provider_unavailable', 'leave_pending', 'not_found'].includes(body.outcome));
    setRole('user');
    res = await request('POST', '/api/admin/payments/NH-REVERIFY-1/reverify');
    console.log('(f) admin reverify (non-admin): status', res.statusCode);
    assert.strictEqual(res.statusCode, 403);
  });

  it('(f) admin GET hubtel-status-access -> 200 for admin, 403 for non-admin', async () => {
    provider('paid');
    setRole('admin');
    let res = await request('GET', '/api/admin/diagnostics/hubtel-status-access');
    console.log('(f) admin hubtel-status-access (admin): status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    setRole('user');
    res = await request('GET', '/api/admin/diagnostics/hubtel-status-access');
    console.log('(f) admin hubtel-status-access (non-admin): status', res.statusCode);
    assert.strictEqual(res.statusCode, 403);
  });
});

describe('top-up kill switch (TOPUP_ENABLED)', () => {
  afterEach(() => {
    // Reset env so subsequent suites see the default (enabled).
    delete process.env.TOPUP_ENABLED;
    payments.length = 0;
    transactions.length = 0;
    wallets.clear();
    provider('paid');
  });

  it('(g) POST initiate returns 503 TOPUPS_PAUSED and creates NO Payment when disabled', async () => {
    process.env.TOPUP_ENABLED = 'false';
    setRole('user');
    provider('paid');
    payments.length = 0;
    const res = await request('POST', '/api/payments/initiate', { origin: 'https://app.nedhubgh.com' }, { amount: 10, description: 'Wallet top-up' });
    console.log('(g) initiate disabled: status', res.statusCode, 'body:', res.body);
    assert.strictEqual(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'TOPUPS_PAUSED');
    assert.strictEqual(body.message, 'Top-ups are temporarily unavailable while we upgrade our payment system. Your wallet and messages are not affected.');
    assert.strictEqual(payments.length, 0, 'no Payment record created when paused');
  });

  it('(g) POST initiate works when enabled', async () => {
    delete process.env.TOPUP_ENABLED;
    setRole('user');
    provider('paid');
    payments.length = 0;
    const res = await request('POST', '/api/payments/initiate', { origin: 'https://app.nedhubgh.com' }, { amount: 10, description: 'Wallet top-up' });
    console.log('(g) initiate enabled: status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.checkoutUrl, 'checkoutUrl present');
    assert.strictEqual(payments.length, 1, 'Payment record created when enabled');
  });

  it('(g) GET /api/wallet/topup-status returns enabled boolean', async () => {
    setRole('user');
    let res = await request('GET', '/api/wallet/topup-status');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).enabled, true);

    process.env.TOPUP_ENABLED = 'off';
    res = await request('GET', '/api/wallet/topup-status');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).enabled, false);
  });

  it('(h) payment status still returns 200 when disabled', async () => {
    process.env.TOPUP_ENABLED = '0';
    setRole('user');
    provider('paid');
    plantPayment({ clientReference: 'NH-KS-STATUS', status: 'paid', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com' });
    const res = await request('GET', '/api/payments/status/NH-KS-STATUS');
    console.log('(h) status disabled: status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).status, 'paid');
  });

  it('(h) wallet reconcile still returns 200 when disabled', async () => {
    process.env.TOPUP_ENABLED = 'false';
    setRole('user');
    provider('paid');
    payments.length = 0; transactions.length = 0; wallets.clear();
    plantPayment({ clientReference: 'NH-KS-REC', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', createdAt: new Date() });
    const res = await request('POST', '/api/wallet/reconcile', {}, {});
    console.log('(h) reconcile disabled: status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).success, true);
  });

  it('(h) admin re-verify still returns 200 when disabled', async () => {
    process.env.TOPUP_ENABLED = 'false';
    setRole('admin');
    provider('paid');
    plantPayment({ clientReference: 'NH-KS-REVERIFY', status: 'pending', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    const res = await request('POST', '/api/admin/payments/NH-KS-REVERIFY/reverify');
    console.log('(h) reverify disabled: status', res.statusCode);
    assert.strictEqual(res.statusCode, 200);
  });

  it('(h) payment return still works when disabled', async () => {
    process.env.TOPUP_ENABLED = 'false';
    setRole('user');
    plantPayment({ clientReference: 'NH-KS-RETURN', status: 'paid', userId: 'smoke_user_1', amount: 10, currency: 'GHS', description: 'x', customerEmail: 'a@b.com', returnOrigin: 'https://app.nedhubgh.com' });
    const res = await request('GET', '/api/payments/return?clientReference=NH-KS-RETURN');
    console.log('(h) return disabled: status', res.statusCode, 'Location:', res.headers.location || '-');
    assert.strictEqual(res.statusCode, 302);
    assert.ok(res.headers.location.includes('/src/pages/dashboard/payment-success.html'), 'still redirects to success page');
  });
});
