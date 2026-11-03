import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.HUBTEL_CLIENT_ID = 'test-client';
process.env.HUBTEL_CLIENT_SECRET = 'test-secret';
process.env.APP_BASE_URL = 'https://app.nedhubgh.com/';

const CB = require(path.join(ROOT, 'backend', 'services', 'callbackVerificationService.js'));
const appBaseUrlModule = require(path.join(ROOT, 'backend', 'utils', 'appBaseUrl.js'));
const getAppBaseUrl = typeof appBaseUrlModule === 'function' ? appBaseUrlModule : appBaseUrlModule.getAppBaseUrl;
const isAllowedOrigin = appBaseUrlModule.isAllowedOrigin;

// ---------- in-memory fakes ----------
function makeStore() {
  const payments = [];
  const creditTransactions = [];
  const wallets = [{ userId: 'owner-user', balance: 10000, smsBalance: 0 }];
  const walletCreditCalls = [];

  function match(obj, filter) {
    if (!filter) return true;
    return Object.keys(filter).every((k) => {
      const v = filter[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.$in) return v.$in.includes(obj[k]);
        if (v.$nin) return !v.$nin.includes(obj[k]);
        if (v.$ne != null) return obj[k] !== v.$ne;
        if (v.$gte != null) return obj[k] >= v.$gte;
      }
      return obj[k] === v || String(obj[k]) === String(v);
    });
  }

  const Payment = function (data) { Object.assign(this, data); };
  Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
  Payment.findOneAndUpdate = async (filter, update) => {
    const p = payments.find((x) => match(x, filter));
    if (!p) return null;
    // atomic-ish: re-check filter conditions
    if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
    if (filter.status && filter.status.$ne != null && p.status === filter.status.$ne) return null;
    if (update.$set) Object.assign(p, update.$set);
    return p;
  };

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
    if (update.$inc) walletCreditCalls.push({ inc: { ...update.$inc } });
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
    if (update.$set) Object.assign(w, update.$set);
    return w;
  };

  const ResilientHttpClient = require(path.join(ROOT, 'backend', 'utils', 'ResilientHttpClient.js'));
  let providerGet = async () => ({ data: { status: 'Unpaid', amount: 10, currency: 'GHS' } });
  ResilientHttpClient.prototype.get = async function () { return providerGet(); };

  // Wire models into CallbackVerificationService via opts
  const svcFactory = (providerImpl) => {
    providerGet = providerImpl;
    const verificationService = new CB({
      Payment,
      Transaction,
      Wallet,
      paymentService: {
        checkTransactionStatus: async (ref) => {
          const r = await (async () => providerGet())();
          const body = r.data || r;
          return {
            status: body.status,
            rawStatus: body.status,
            amount: body.amount,
            currency: body.currency || 'GHS',
            transactionId: body.transactionId,
            paymentMethod: body.paymentMethod || 'mobile_money',
            message: body.message || 'ok'
          };
        }
      }
    });
    return { verificationService, payments, creditTransactions, wallets, walletCreditCalls, setProvider: (fn) => { providerGet = fn; } };
  };

  return { svcFactory, payments, creditTransactions, wallets, walletCreditCalls };
}

test('getAppBaseUrl never returns a Railway domain and handles a trailing slash', () => {
  const prevUrl = process.env.APP_BASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.APP_BASE_URL = 'https://app.nedhubgh.com/';
  assert.equal(getAppBaseUrl(), 'https://app.nedhubgh.com');
  // unset in production falls back to the app domain (never Railway, never request host)
  delete process.env.APP_BASE_URL;
  process.env.NODE_ENV = 'production';
  assert.equal(getAppBaseUrl(), 'https://app.nedhubgh.com');
  process.env.NODE_ENV = prevNodeEnv;
  // unset outside production returns the primary origin (consistent fallback)
  delete process.env.APP_BASE_URL;
  process.env.NODE_ENV = 'test';
  assert.equal(getAppBaseUrl(), 'https://app.nedhubgh.com');
  process.env.APP_BASE_URL = prevUrl;
  process.env.NODE_ENV = prevNodeEnv;
});

test('APP_BASE_URL is honored only when allowlisted (www never used unless allowlisted)', () => {
  const prevUrl = process.env.APP_BASE_URL;
  const prevAllow = process.env.ALLOWED_APP_ORIGINS;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  // www host not in the default allowlist -> falls back to the primary origin
  process.env.APP_BASE_URL = 'https://www.nedhubgh.com';
  delete process.env.ALLOWED_APP_ORIGINS;
  assert.equal(getAppBaseUrl(), 'https://app.nedhubgh.com');

  // www host allowlisted -> honored
  process.env.ALLOWED_APP_ORIGINS = 'https://app.nedhubgh.com,https://www.nedhubgh.com';
  assert.equal(getAppBaseUrl(), 'https://www.nedhubgh.com');

  process.env.APP_BASE_URL = prevUrl;
  process.env.ALLOWED_APP_ORIGINS = prevAllow;
  process.env.NODE_ENV = prevNodeEnv;
});

test('spoofed Origin is ignored and missing Origin falls back to primary', () => {
  const prevAllow = process.env.ALLOWED_APP_ORIGINS;
  delete process.env.ALLOWED_APP_ORIGINS;
  assert.equal(isAllowedOrigin('https://evil.example.com'), false);
  assert.equal(isAllowedOrigin(undefined), false);
  assert.equal(isAllowedOrigin(''), false);

  process.env.ALLOWED_APP_ORIGINS = 'https://app.nedhubgh.com,https://evil.example.com';
  assert.equal(isAllowedOrigin('https://evil.example.com'), true);
  assert.equal(isAllowedOrigin('https://app.nedhubgh.com'), true);

  process.env.ALLOWED_APP_ORIGINS = prevAllow;
});

test('trailing slash is handled on APP_BASE_URL and ALLOWED_APP_ORIGINS entries', () => {
  const prevUrl = process.env.APP_BASE_URL;
  const prevAllow = process.env.ALLOWED_APP_ORIGINS;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  process.env.APP_BASE_URL = 'https://app.nedhubgh.com/';
  delete process.env.ALLOWED_APP_ORIGINS;
  assert.equal(getAppBaseUrl(), 'https://app.nedhubgh.com');

  process.env.APP_BASE_URL = 'https://app.nedhubgh.com/';
  process.env.ALLOWED_APP_ORIGINS = 'https://app.nedhubgh.com/, https://app.nedhubgh.com';
  assert.equal(getAppBaseUrl(), 'https://app.nedhubgh.com');

  process.env.APP_BASE_URL = prevUrl;
  process.env.ALLOWED_APP_ORIGINS = prevAllow;
  process.env.NODE_ENV = prevNodeEnv;
});

test('same reference credited twice or concurrently results in ONE wallet increment', async () => {
  const { svcFactory } = makeStore();
  const ctx = svcFactory(async () => ({ data: { status: 'Paid', amount: 10, currency: 'GHS' } }));
  ctx.payments.push({ _id: 'p1', clientReference: 'REF1', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });

  await Promise.all([
    ctx.verificationService.processPaymentCallback('REF1'),
    ctx.verificationService.processPaymentCallback('REF1')
  ]);

  assert.equal(ctx.walletCreditCalls.length, 1, 'exactly one wallet increment');
});

test('amount mismatch is not credited', async () => {
  const { svcFactory } = makeStore();
  const ctx = svcFactory(async () => ({ data: { status: 'Paid', amount: 5, currency: 'GHS' } }));
  ctx.payments.push({ _id: 'p2', clientReference: 'REF2', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });

  const result = await ctx.verificationService.processPaymentCallback('REF2');
  assert.notEqual(result.action, 'credit');
  assert.equal(ctx.walletCreditCalls.length, 0);
  const p = ctx.payments.find((x) => x.clientReference === 'REF2');
  assert.notEqual(p.status, 'paid');
});

test('reference belonging to another user is rejected', async () => {
  const { svcFactory } = makeStore();
  const ctx = svcFactory(async () => ({ data: { status: 'Paid', amount: 10, currency: 'GHS' } }));
  ctx.payments.push({ _id: 'p3', clientReference: 'REF3', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });

  const result = await ctx.verificationService.refreshUserPayment('other-user', 'REF3');
  assert.equal(result.action, 'forbidden');
  assert.equal(ctx.walletCreditCalls.length, 0);
});

test('pending stays pending and later becomes success', async () => {
  const { svcFactory, setProvider } = makeStore();
  const ctx = svcFactory(async () => ({ data: { status: 'Unpaid', amount: 10, currency: 'GHS' } }));
  ctx.payments.push({ _id: 'p4', clientReference: 'REF4', userId: 'owner-user', amount: 10, currency: 'GHS', status: 'pending' });

  let result = await ctx.verificationService.processPaymentCallback('REF4');
  assert.equal(result.action, 'leave_pending');
  let p = ctx.payments.find((x) => x.clientReference === 'REF4');
  assert.equal(p.status, 'pending');

  // later becomes paid
  ctx.setProvider(async () => ({ data: { status: 'Paid', amount: 10, currency: 'GHS' } }));
  result = await ctx.verificationService.processPaymentCallback('REF4');
  assert.equal(result.action, 'credit');
  assert.equal(result.applied, true);
  p = ctx.payments.find((x) => x.clientReference === 'REF4');
  assert.equal(p.status, 'paid');
  assert.equal(ctx.walletCreditCalls.length, 1);
});

test('every redirect target in backend exists as a file', () => {
  const file = path.join(ROOT, 'backend', 'controllers', 'paymentController.js');
  const src = fs.readFileSync(file, 'utf8');
  const matches = [...src.matchAll(/\/(?:src\/)?pages\/dashboard\/[A-Za-z0-9_.-]+\.html/g)];
  const targets = [...new Set(matches.map((m) => m[0]))];
  assert.ok(targets.length > 0, 'expected redirect targets');
  for (const t of targets) {
    let filePath;
    if (t.startsWith('/src/')) filePath = path.join(ROOT, t.replace(/^\//, ''));
    else filePath = path.join(ROOT, 'src', t.replace(/^\//, ''));
    assert.ok(fs.existsSync(filePath), `missing redirect target file: ${t} -> ${filePath}`);
  }
});
