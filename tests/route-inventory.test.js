const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const { spawnServer, request } = require('./helpers/spawn-server');

// Routes that are intentionally reachable without authentication.
const PUBLIC_ALLOW_LIST = new Set([
  'POST /api/auth/login',
  'POST /api/auth/register',
  'POST /api/auth/verify-email',
  'POST /api/auth/request-password-reset',
  'POST /api/auth/reset-password',
  'POST /api/auth/resend-otp',
  'GET /api/health',
  'POST /api/hubtel/momo-callback',
  'POST /api/hubtel/bank-callback',
  'POST /api/hubtel/airtime-callback',
  'POST /api/hubtel/data-callback',
  'POST /api/hubtel/tv-callback',
  'POST /api/hubtel/utility-callback'
]);

// This codebase has no public CV or careers routes; the allow-list entry for
// them is therefore empty (documented in the hardening report).
const PUBLIC_CV_CAREERS_ROUTES = [];

function mountPrefix(source) {
  // layer.regexp.source for app.use('/api/auth', router) is:
  // ^/api/auth(?:\/(.+))?
  const m = source.match(/^\^([^?]+)/);
  return m ? m[1] : '';
}

function collectRoutes(layer, prefix, out) {
  if (layer.route) {
    const path = (prefix + layer.route.path).replace(/\/+$/, '') || '/';
    const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
    out.push({ path, methods, layer });
  } else if (layer.handle && Array.isArray(layer.handle.stack)) {
    const mount = mountPrefix(layer.handle.regexp.source || '');
    for (const sub of layer.handle.stack) {
      collectRoutes(sub, prefix + mount, out);
    }
  }
}

function registeredRoutes() {
  const app = express();

  // Replicate every mount from server/index.js so the inventory reflects what
  // the real server registers (without starting it).
  app.use('/api/auth', require('../backend/routes/auth'));
  app.use('/api/contacts', require('../backend/routes/contacts'));
  app.use('/api/sms', require('../backend/routes/sms'));
  app.use('/api/sms', require('../backend/routes/naloSms'));
  app.use('/api/sms', require('../backend/routes/sms-uploads'));
  app.use('/api/sms-campaigns', require('../backend/routes/sms-campaigns'));
  app.use('/api/analytics', require('../backend/routes/analytics'));
  app.use('/api/reports', require('../backend/routes/reports'));
  app.use('/api/wallet', require('../backend/routes/wallet'));
  app.use('/api/transfer', require('../backend/routes/transfer'));
  app.use('/api/utility', require('../backend/routes/utility'));
  app.use('/api/sender-ids', require('../backend/routes/senderIds'));
  app.use('/api/templates', require('../backend/routes/templates'));
  app.use('/api/campaigns', require('../backend/routes/campaigns'));
  app.use('/api/admin', require('../backend/routes/admin'));
  app.use('/api/settings/api-keys', require('../backend/routes/apiKeys'));
  app.use('/api/payments', require('../backend/routes/payments'));
  app.use('/api/blacklist', require('../backend/routes/blacklist'));
  app.use('/api', require('../backend/routes/health'));
  app.use('/api', require('../backend/routes/metrics'));

  app.post('/api/hubtel/momo-callback', () => {});
  app.post('/api/hubtel/bank-callback', () => {});
  app.post('/api/hubtel/airtime-callback', () => {});
  app.post('/api/hubtel/data-callback', () => {});
  app.post('/api/hubtel/tv-callback', () => {});
  app.post('/api/hubtel/utility-callback', () => {});

  app.get('/healthz', () => {});
  app.get('/auth/login', () => {});
  app.get('/auth/login.html', () => {});
  app.get('/auth/register', () => {});
  app.get('/auth/register.html', () => {});
  app.get('/auth/forgot-password', () => {});
  app.get('/auth/forgot-password.html', () => {});
  app.get('/auth/verify-email', () => {});
  app.get('/auth/verify-email.html', () => {});
  app.get('/auth/reset-password', () => {});
  app.get('/auth/reset-password.html', () => {});
  app.get('/overview.html', () => {});
  app.get('/campaigns.html', () => {});
  app.get('/contacts.html', () => {});
  app.get('/history.html', () => {});
  app.get('/analytics.html', () => {});
  app.get('/reports.html', () => {});
  app.get('/send-sms.html', () => {});
  app.get('/settings.html', () => {});
  app.get('/templates.html', () => {});
  app.get('/buy-airtime.html', () => {});
  app.get('/buy-data.html', () => {});
  app.get('/utility-payments.html', () => {});
  app.get('/transactions.html', () => {});
  app.get('/blacklist.html', () => {});
  app.get('/admin/admin.html', () => {});
  app.get('/admin/admin.js', () => {});
  app.get('/payment/success', () => {});
  app.get('/payment/cancelled', () => {});
  app.get('/payment/error', () => {});
  app.get('/payment/return', () => {});

  const out = [];
  for (const layer of app._router.stack) {
    collectRoutes(layer, '', out);
  }
  return out;
}

test('route inventory: every route is listed; non-allow-list /api routes require authentication', async (t) => {
  const routes = registeredRoutes();
  assert.ok(routes.length > 0, 'expected at least one registered route');

  const apiRoutes = routes.filter((r) => r.path.startsWith('/api'));
  const adminRoutes = apiRoutes.filter((r) =>
    r.path.startsWith('/api/admin') || r.path.startsWith('/api/settings/api-keys')
  );

  console.log('\n=== REGISTERED API ROUTES ===');
  for (const r of apiRoutes) {
    console.log(`${r.methods.join(', ').padEnd(12)} ${r.path}`);
  }
  console.log('=== ADMIN-ONLY ROUTES ===');
  for (const r of adminRoutes) {
    console.log(`${r.methods.join(', ').padEnd(12)} ${r.path}`);
  }
  console.log('=== PUBLIC ALLOW-LIST ===');
  for (const p of [...PUBLIC_ALLOW_LIST, ...PUBLIC_CV_CAREERS_ROUTES]) {
    console.log(p);
  }

  const { baseUrl, stop } = await spawnServer({});
  try {
    for (const r of apiRoutes) {
      for (const method of r.methods) {
        const key = `${method} ${r.path}`;
        const res = await request(baseUrl, method, r.path, undefined);

        if (PUBLIC_ALLOW_LIST.has(key)) {
          // Public by design: anything except session-auth rejection is fine
          // (hubtel callbacks return 200, auth endpoints return 200/400/429).
          assert.notEqual(res.status, 401, `${key} is public but returned 401`);
          continue;
        }

        // Every other API route must reject unauthenticated calls with 401.
        assert.equal(
          res.status,
          401,
          `${key} is reachable without authentication (got ${res.status}); it must be protected`
        );
      }
    }
  } finally {
    await stop();
  }
});
