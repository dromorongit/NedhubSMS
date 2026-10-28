const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);

const {
  hubtelCallbackSecret,
  naloWebhookSecret,
  secretMatches,
  isCallbackRoute,
  callbackPath,
  CALLBACK_ROUTES
} = require('../backend/utils/callbackAuth');
const logger = require('../backend/utils/logger');

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function captureWarn() {
  const calls = [];
  const orig = logger.warn;
  logger.warn = (...args) => calls.push(args);
  return { calls, restore: () => { logger.warn = orig; } };
}

// ---------------------------------------------------------------------------
// 1. Route identity: every callback/webhook path is registered and recognized
// ---------------------------------------------------------------------------
test('CALLBACK_ROUTES contains every callback/webhook path', () => {
  assert.ok(CALLBACK_ROUTES.includes('/api/payments/hubtel/callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/hubtel/momo-callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/hubtel/bank-callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/hubtel/airtime-callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/hubtel/data-callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/hubtel/tv-callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/hubtel/utility-callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/sms/callback'));
  assert.ok(CALLBACK_ROUTES.includes('/api/sms/callback/nalo'));
  assert.ok(CALLBACK_ROUTES.includes('/api/sms/webhooks/delivery-status'));
});

test('isCallbackRoute recognizes callback paths and rejects others', () => {
  const fake = (path) => ({ baseUrl: '', path });
  assert.equal(isCallbackRoute(fake('/api/payments/hubtel/callback')), true);
  assert.equal(isCallbackRoute(fake('/api/hubtel/momo-callback')), true);
  assert.equal(isCallbackRoute(fake('/api/sms/callback/nalo')), true);
  assert.equal(isCallbackRoute(fake('/api/sms/webhooks/delivery-status')), true);
  assert.equal(isCallbackRoute(fake('/api/payments/initiate')), false);
  assert.equal(isCallbackRoute(fake('/api/sms/send')), false);
  assert.equal(isCallbackRoute(fake('/healthz')), false);
});

test('callbackPath strips the query string so secret never appears', () => {
  const req = { baseUrl: '', path: '/api/payments/hubtel/callback', query: { secret: 'LEAKVALUE', foo: 'bar' } };
  assert.equal(callbackPath(req), '/api/payments/hubtel/callback');
  assert.notEqual(callbackPath(req), req.originalUrl);
});

// ---------------------------------------------------------------------------
// 2. Three secret cases (unset / right / wrong) for EACH route
// ---------------------------------------------------------------------------
const HUBTEL_SECRET = 'hubtel-test-secret';
const NALO_SECRET = 'nalo-test-secret';

const hubtelRoutes = [
  { path: '/api/payments/hubtel/callback', label: 'Hubtel payment callback' },
  { path: '/api/hubtel/momo-callback', label: 'Hubtel transfer callback (momo)' },
  { path: '/api/hubtel/bank-callback', label: 'Hubtel transfer callback (bank)' },
  { path: '/api/hubtel/airtime-callback', label: 'Hubtel commission callback (airtime)' },
  { path: '/api/hubtel/data-callback', label: 'Hubtel commission callback (data)' },
  { path: '/api/hubtel/tv-callback', label: 'Hubtel commission callback (TV)' },
  { path: '/api/hubtel/utility-callback', label: 'Hubtel commission callback (utility)' }
];

const naloRoutes = [
  { path: '/api/sms/callback', label: 'Nalo callback' },
  { path: '/api/sms/callback/nalo', label: 'Nalo callback (nalo)' },
  { path: '/api/sms/webhooks/delivery-status', label: 'Nalo webhook (delivery-status)' }
];

function reqFor(path, secretValue) {
  return {
    baseUrl: '',
    path,
    originalUrl: path + (secretValue ? `?secret=${secretValue}` : ''),
    query: secretValue ? { secret: secretValue } : {},
    header: (name) => {
      if (name === 'x-callback-secret') return secretValue;
      if (name === 'x-webhook-secret') return secretValue;
      return undefined;
    }
  };
}

function routeSecretTests(route, middleware, envVar, secretValue) {
  const { path, label } = route;

  test(`${label}: unset secret -> request proceeds`, () => {
    const saved = process.env[envVar];
    delete process.env[envVar];
    try {
      let nextCalled = false;
      const req = reqFor(path);
      const res = makeRes();
      const cap = captureWarn();
      middleware(req, res, () => { nextCalled = true; });
      cap.restore();
      assert.equal(nextCalled, true);
      assert.equal(res.statusCode, 200);
    } finally {
      if (saved === undefined) delete process.env[envVar];
      else process.env[envVar] = saved;
    }
  });

  test(`${label}: right secret -> request proceeds`, () => {
    const saved = process.env[envVar];
    process.env[envVar] = secretValue;
    try {
      let nextCalled = false;
      const req = reqFor(path, secretValue);
      const res = makeRes();
      middleware(req, res, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
      assert.equal(res.statusCode, 200);
    } finally {
      if (saved === undefined) delete process.env[envVar];
      else process.env[envVar] = saved;
    }
  });

  test(`${label}: wrong secret -> HTTP 200, not processed, secret not logged`, () => {
    const saved = process.env[envVar];
    process.env[envVar] = secretValue;
    try {
      let nextCalled = false;
      const req = reqFor(path, 'wrong-secret');
      const res = makeRes();
      const cap = captureWarn();
      middleware(req, res, () => { nextCalled = true; });
      cap.restore();
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 200);
      const logged = cap.calls.map((a) => JSON.stringify(a)).join(' ');
      assert.ok(!logged.includes('wrong-secret'), 'candidate secret must not be logged');
      assert.ok(!logged.includes('secret='), 'query string must not be logged');
      assert.ok(!logged.includes(secretValue), 'configured secret must not be logged');
    } finally {
      if (saved === undefined) delete process.env[envVar];
      else process.env[envVar] = saved;
    }
  });
}

for (const route of hubtelRoutes) {
  routeSecretTests(route, hubtelCallbackSecret, 'HUBTEL_CALLBACK_SECRET', HUBTEL_SECRET);
}
for (const route of naloRoutes) {
  routeSecretTests(route, naloWebhookSecret, 'NALO_WEBHOOK_SECRET', NALO_SECRET);
}

// Cleanup env so other suites are unaffected
delete process.env.HUBTEL_CALLBACK_SECRET;
delete process.env.NALO_WEBHOOK_SECRET;
