const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

process.env.JWT_SECRET = 'a'.repeat(64);

const callbackAuth = require('../backend/utils/callbackAuth');
const logger = require('../backend/utils/logger');

// Require controllers first so we can replace their handlers with spies BEFORE
// the routers capture references to them (routers capture at require time).
const paymentController = require('../backend/controllers/paymentController');
const hubtelCallbackController = require('../backend/controllers/hubtelCallbackController');
const naloCallbackController = require('../backend/controllers/naloCallbackController');
const webhookController = require('../backend/controllers/webhookController');

// ---------------------------------------------------------------------------
// Mount the REAL routers and real hubtel callback routes on a test express app.
// No production-server listener is started and no database is connected.
// Controller handlers are replaced with spies so only the secret middleware
// behaviour is exercised (no provider calls, no database writes).
// ---------------------------------------------------------------------------
const calls = [];
function spy(name) {
  return async (...args) => {
    const res = args[1];
    calls.push({ spy: name });
    if (res && typeof res.json === 'function') {
      res.status(200).json({ status: 'ok', spy: name });
    }
  };
}

const paymentSpy = spy('paymentController.handleHubtelCallback');
paymentController.handleHubtelCallback = paymentSpy;

const momoSpy = spy('handleMomoCallback');
const bankSpy = spy('handleBankCallback');
const airtimeSpy = spy('handleAirtimeCallback');
const dataSpy = spy('handleDataCallback');
const tvSpy = spy('handleTvCallback');
const utilitySpy = spy('handleUtilityCallback');
// hubtelCallbackController exposes prototype methods; reassigning creates an
// own property that inline call-time lookups resolve to.
hubtelCallbackController.handleMomoCallback = momoSpy;
hubtelCallbackController.handleBankCallback = bankSpy;
hubtelCallbackController.handleAirtimeCallback = airtimeSpy;
hubtelCallbackController.handleDataCallback = dataSpy;
hubtelCallbackController.handleTvCallback = tvSpy;
hubtelCallbackController.handleUtilityCallback = utilitySpy;

const naloCallbackSpy = spy('naloCallbackController.handleDeliveryReport');
const naloWebhookSpy = spy('webhookController.handleDeliveryStatusWebhook');
naloCallbackController.handleDeliveryReport = naloCallbackSpy;
webhookController.handleDeliveryStatusWebhook = naloWebhookSpy;

// Mock nalo downstream models (only the sms.js inline /callback handler still
// calls these directly; all other nalo handlers are replaced by spies above).
const Message = require('../backend/models/Message');
const SmsMessage = require('../backend/models/SmsMessage');
const origMessageUpdateStatus = Message.updateStatus;
const origSmsMessageFindOneAndUpdate = SmsMessage.findOneAndUpdate;
Message.updateStatus = async () => { calls.push({ spy: 'Message.updateStatus' }); };
SmsMessage.findOneAndUpdate = async () => { calls.push({ spy: 'SmsMessage.findOneAndUpdate' }); return null; };

const paymentsRouter = require('../backend/routes/payments');
const smsRouter = require('../backend/routes/sms');
const naloSmsRouter = require('../backend/routes/naloSms');

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use('/api/payments', paymentsRouter);

app.post('/api/hubtel/momo-callback', express.json(), callbackAuth.hubtelCallbackSecret, async (req, res) => {
  await hubtelCallbackController.handleMomoCallback(req, res);
});
app.post('/api/hubtel/bank-callback', express.json(), callbackAuth.hubtelCallbackSecret, async (req, res) => {
  await hubtelCallbackController.handleBankCallback(req, res);
});
app.post('/api/hubtel/airtime-callback', express.json(), callbackAuth.hubtelCallbackSecret, async (req, res) => {
  await hubtelCallbackController.handleAirtimeCallback(req, res);
});
app.post('/api/hubtel/data-callback', express.json(), callbackAuth.hubtelCallbackSecret, async (req, res) => {
  await hubtelCallbackController.handleDataCallback(req, res);
});
app.post('/api/hubtel/tv-callback', express.json(), callbackAuth.hubtelCallbackSecret, async (req, res) => {
  await hubtelCallbackController.handleTvCallback(req, res);
});
app.post('/api/hubtel/utility-callback', express.json(), callbackAuth.hubtelCallbackSecret, async (req, res) => {
  await hubtelCallbackController.handleUtilityCallback(req, res);
});

app.use('/api/sms', smsRouter);
app.use('/api/sms', naloSmsRouter);

const HUBTEL_SECRET = 'ht-route-test-secret';
const NALO_SECRET = 'nal-route-test-secret';

const ROUTES = [
  { path: '/api/payments/hubtel/callback', label: 'payment', env: 'HUBTEL_CALLBACK_SECRET', secret: HUBTEL_SECRET, header: 'x-callback-secret', body: { clientReference: 'REF' }, spyName: 'paymentController.handleHubtelCallback' },
  { path: '/api/hubtel/momo-callback', label: 'momo', env: 'HUBTEL_CALLBACK_SECRET', secret: HUBTEL_SECRET, header: 'x-callback-secret', body: { clientReference: 'REF' }, spyName: 'handleMomoCallback' },
  { path: '/api/hubtel/bank-callback', label: 'bank', env: 'HUBTEL_CALLBACK_SECRET', secret: HUBTEL_SECRET, header: 'x-callback-secret', body: { clientReference: 'REF' }, spyName: 'handleBankCallback' },
  { path: '/api/hubtel/airtime-callback', label: 'airtime', env: 'HUBTEL_CALLBACK_SECRET', secret: HUBTEL_SECRET, header: 'x-callback-secret', body: { clientReference: 'REF' }, spyName: 'handleAirtimeCallback' },
  { path: '/api/hubtel/data-callback', label: 'data', env: 'HUBTEL_CALLBACK_SECRET', secret: HUBTEL_SECRET, header: 'x-callback-secret', body: { clientReference: 'REF' }, spyName: 'handleDataCallback' },
  { path: '/api/hubtel/tv-callback', label: 'tv', env: 'HUBTEL_CALLBACK_SECRET', secret: HUBTEL_SECRET, header: 'x-callback-secret', body: { clientReference: 'REF' }, spyName: 'handleTvCallback' },
  { path: '/api/hubtel/utility-callback', label: 'utility', env: 'HUBTEL_CALLBACK_SECRET', secret: HUBTEL_SECRET, header: 'x-callback-secret', body: { clientReference: 'REF' }, spyName: 'handleUtilityCallback' },
  { path: '/api/sms/callback', label: 'sms-callback', env: 'NALO_WEBHOOK_SECRET', secret: NALO_SECRET, header: 'x-webhook-secret', body: { messageId: 'M1', status: 'delivered', recipient: 'R1' }, spyName: 'Message.updateStatus' },
  { path: '/api/sms/callback/nalo', label: 'sms-callback-nalo', env: 'NALO_WEBHOOK_SECRET', secret: NALO_SECRET, header: 'x-webhook-secret', body: { job_id: 'J1', status: 'delivered', recipient: 'R1' }, spyName: 'naloCallbackController.handleDeliveryReport' },
  { path: '/api/sms/webhooks/delivery-status', label: 'sms-delivery-status', env: 'NALO_WEBHOOK_SECRET', secret: NALO_SECRET, header: 'x-webhook-secret', body: { message_id: 'M1', status: 'delivered', recipient: 'R1' }, spyName: 'webhookController.handleDeliveryStatusWebhook' }
];

function httpRequest(port, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { resolve({ statusCode: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('callback route-level secret checks on all 10 routes (mounted real routers, no listener/DB)', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const failures = [];

  try {
    for (const route of ROUTES) {
      const savedEnv = process.env[route.env];

      // ---- wrong secret: HTTP 200, processing NOT called ----
      {
        process.env[route.env] = route.secret;
        calls.length = 0;
        const cap = { calls: [] };
        const origWarn = logger.warn;
        logger.warn = (...a) => { cap.calls.push(a); };
        try {
          const res = await httpRequest(port, route.path, { [route.header]: 'wrong-secret', 'content-type': 'application/json' }, route.body);
          if (res.statusCode !== 200) failures.push(`${route.label} wrong-secret: expected 200 got ${res.statusCode}`);
          const processed = calls.some((c) => c.spy === route.spyName);
          if (processed) failures.push(`${route.label} wrong-secret: processing was called`);
          try {
            const parsed = JSON.parse(res.body);
            if (parsed.received !== true) failures.push(`${route.label} wrong-secret: middleware did not short-circuit (body=${res.body})`);
          } catch (e) { failures.push(`${route.label} wrong-secret: non-JSON response ${res.body}`); }
          const rejectedWarn = cap.calls.some((a) => JSON.stringify(a).includes('rejected by secret check'));
          if (!rejectedWarn) failures.push(`${route.label} wrong-secret: no 'rejected by secret check' warning logged`);
        } finally {
          logger.warn = origWarn;
          if (savedEnv === undefined) delete process.env[route.env];
          else process.env[route.env] = savedEnv;
        }
      }

      // ---- right secret: processing called ----
      {
        process.env[route.env] = route.secret;
        calls.length = 0;
        try {
          const res = await httpRequest(port, route.path, { [route.header]: route.secret, 'content-type': 'application/json' }, route.body);
          const processed = calls.some((c) => c.spy === route.spyName);
          if (!processed) failures.push(`${route.label} right-secret: processing was NOT called`);
          if (res.statusCode !== 200) failures.push(`${route.label} right-secret: expected 200 got ${res.statusCode}`);
        } finally {
          if (savedEnv === undefined) delete process.env[route.env];
          else process.env[route.env] = savedEnv;
        }
      }

      // ---- unset secret: processing called, warning logged ----
      {
        delete process.env[route.env];
        calls.length = 0;
        const cap = { calls: [] };
        const origWarn = logger.warn;
        logger.warn = (...a) => { cap.calls.push(a); };
        try {
          const res = await httpRequest(port, route.path, { 'content-type': 'application/json' }, route.body);
          const processed = calls.some((c) => c.spy === route.spyName);
          if (!processed) failures.push(`${route.label} unset-secret: processing was NOT called`);
          if (res.statusCode !== 200) failures.push(`${route.label} unset-secret: expected 200 got ${res.statusCode}`);
          // 'secret not configured' warning is rate-limited once/hour per env var
          // across all routes sharing that secret; assert processing was called instead.
        } finally {
          logger.warn = origWarn;
          delete process.env[route.env];
        }
      }
    }
  } finally {
    Message.updateStatus = origMessageUpdateStatus;
    SmsMessage.findOneAndUpdate = origSmsMessageFindOneAndUpdate;
    paymentController.handleHubtelCallback = undefined;
    hubtelCallbackController.handleMomoCallback = undefined;
    hubtelCallbackController.handleBankCallback = undefined;
    hubtelCallbackController.handleAirtimeCallback = undefined;
    hubtelCallbackController.handleDataCallback = undefined;
    hubtelCallbackController.handleTvCallback = undefined;
    hubtelCallbackController.handleUtilityCallback = undefined;
    naloCallbackController.handleDeliveryReport = undefined;
    webhookController.handleDeliveryStatusWebhook = undefined;
    await new Promise((resolve) => server.close(resolve));
    delete process.env.HUBTEL_CALLBACK_SECRET;
    delete process.env.NALO_WEBHOOK_SECRET;
  }

  if (failures.length > 0) {
    assert.fail('Route-level secret check failures:\n' + failures.join('\n'));
  }
});
