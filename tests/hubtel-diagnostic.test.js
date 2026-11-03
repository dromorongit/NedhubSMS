const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHubtelStatusAccessDiagnostic, computeVerdict } = require('../backend/routes/admin');
const HubtelPaymentService = require('../backend/services/HubtelPaymentService');

function fakeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (body) { res.body = body; return res; };
  return res;
}

async function runHandler({ checkTransactionStatus, checkStatusRaw, getOutboundIpv4 }) {
  const handler = buildHubtelStatusAccessDiagnostic({ checkTransactionStatus, checkStatusRaw, getOutboundIpv4 });
  const req = { user: { userId: 'admin-user', role: 'admin' }, query: {} };
  const res = fakeRes();
  await handler(req, res);
  return res;
}

async function runHandlerWithRef({ reference, checkStatusRaw, getOutboundIpv4, env }) {
  const origEnv = process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;
  if (env !== undefined) {
    if (env === null) delete process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;
    else process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER = env;
  }
  try {
    const handler = buildHubtelStatusAccessDiagnostic({ checkStatusRaw, getOutboundIpv4 });
    const req = { user: { userId: 'admin-user', role: 'admin' }, query: { reference } };
    const res = fakeRes();
    await handler(req, res);
    return res;
  } finally {
    if (origEnv === undefined) delete process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;
    else process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER = origEnv;
  }
}

// ---------- Existing no-reference tests (updated with checkStatusRaw passthrough) ----------

test('diagnostic classifies ALLOWED when provider returns a well-formed response', async () => {
  const res = await runHandler({
    checkTransactionStatus: async () => ({ success: true, httpStatus: 200, rawStatus: 'Unpaid' }),
    getOutboundIpv4: async () => '203.0.113.10'
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.classification, 'ALLOWED');
  assert.equal(res.body.httpStatus, 200);
  assert.equal(res.body.code, 'Unpaid');
  assert.equal(res.body.outboundIpv4, '203.0.113.10');
  assert.ok(res.body.checkedAt);
});

test('diagnostic classifies BLOCKED for 401', async () => {
  const err = new Error('Unauthorized');
  err.httpStatus = 401;
  err.code = '401';
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => '203.0.113.10'
  });
  assert.equal(res.body.classification, 'BLOCKED');
  assert.equal(res.body.httpStatus, 401);
});

test('diagnostic classifies UNREACHABLE for network errors', async () => {
  const err = new Error('connect ECONNREFUSED api-txnstatus.hubtel.com:443');
  err.code = 'ECONNREFUSED';
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'UNREACHABLE');
});

test('no reference labels result weak and never returns CONFIRMED', async () => {
  const res = await runHandler({
    checkTransactionStatus: async () => ({ success: true, httpStatus: 200, rawStatus: 'Paid', hasStatus: true, hasAmount: true }),
    getOutboundIpv4: async () => '203.0.113.10'
  });
  assert.equal(res.body.weak, 'cannot prove the URL form is right');
  assert.notEqual(res.body.verdict, 'CONFIRMED_A');
  assert.notEqual(res.body.verdict, 'CONFIRMED_B');
  assert.equal(res.body.formA, undefined);
  assert.equal(res.body.formB, undefined);
});

test('no secrets are returned by the diagnostic', async () => {
  const res = await runHandler({
    checkTransactionStatus: async () => ({ success: true, httpStatus: 200, rawStatus: 'Unpaid' }),
    getOutboundIpv4: async () => '203.0.113.10'
  });
  const text = JSON.stringify(res.body);
  assert.ok(!/clientSecret|access_token|authorization|basic/i.test(text));
});

// ---------- Reference validation ----------

test('reference validation rejects invalid references with 400', async () => {
  for (const bad of ['', 'nh-abc12345', 'NH-short', 'NH-lowercase12345', 'NH-A B C', 'NH-@#$%', 'NH-A'.repeat(70), 'OTHER-REF123456']) {
    const res = await runHandlerWithRef({ reference: bad, checkStatusRaw: async () => ({}) });
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(bad)}`);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('reference validation accepts valid references', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => ({ httpStatus: 200, code: '0000', message: 'ok', hasStatus: true, hasAmount: true }),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference, 'NH-ABC12345');
});

// ---------- Per-form results and verdicts ----------

function okForm() {
  return { httpStatus: 200, code: '0000', message: 'Status retrieved', hasStatus: true, hasAmount: true };
}

test('reference CONFIRMED_A when form A returns 2xx with status+amount', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => okForm(),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'CONFIRMED_A');
  assert.equal(res.body.formA.urlForm, 'client_ref_in_path');
  assert.equal(res.body.formA.httpStatus, 200);
  assert.equal(res.body.formA.code, '0000');
  assert.equal(res.body.formA.hasStatus, true);
  assert.equal(res.body.formA.hasAmount, true);
  assert.equal(res.body.formB, null);
});

test('reference CONFIRMED_B when form B returns 2xx with status+amount (merchant configured)', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async (ref, form) => {
      if (form === 'merchant_in_path_with_query') return okForm();
      return { httpStatus: 500, code: '500', message: 'server error', hasStatus: false, hasAmount: false };
    },
    getOutboundIpv4: async () => null,
    env: 'MERCH-123'
  });
  assert.equal(res.body.verdict, 'CONFIRMED_B');
  assert.equal(res.body.formB.urlForm, 'merchant_in_path_with_query');
  assert.equal(res.body.formB.httpStatus, 200);
});

test('reference BLOCKED when 401', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => { const e = new Error('Unauthorized'); e.httpStatus = 401; e.code = '401'; throw e; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'BLOCKED');
});

test('reference BLOCKED when 403', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => { const e = new Error('Forbidden'); e.httpStatus = 403; e.code = '403'; throw e; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'BLOCKED');
});

test('reference BLOCKED when response code 4101', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => ({ httpStatus: 200, code: '4101', message: 'invalid', hasStatus: false, hasAmount: false }),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'BLOCKED');
});

test('reference BLOCKED when response code 4103', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => ({ httpStatus: 200, code: '4103', message: 'invalid', hasStatus: false, hasAmount: false }),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'BLOCKED');
});

test('reference NOT_FOUND when 404', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => ({ httpStatus: 404, code: '1002', message: 'not found', hasStatus: false, hasAmount: false }),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'NOT_FOUND');
});

test('reference UNREACHABLE when 5xx', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => ({ httpStatus: 500, code: '500', message: 'server error', hasStatus: false, hasAmount: false }),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'UNREACHABLE');
});

test('reference UNREACHABLE when network error', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; e.isNetwork = true; throw e; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'UNREACHABLE');
});

test('reference UNREACHABLE when HTML body (unparseable)', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => { const e = new Error('Unexpected token < in JSON'); e.isUnparseable = true; throw e; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'UNREACHABLE');
});

test('reference UNKNOWN when no form confirms', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => ({ httpStatus: 200, code: '0000', message: 'ok', hasStatus: false, hasAmount: false }),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.verdict, 'UNKNOWN');
});

// ---------- No secrets in response ----------

test('reference response contains no secrets', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => okForm(),
    getOutboundIpv4: async () => null
  });
  const text = JSON.stringify(res.body);
  assert.ok(!/clientSecret|access_token|authorization|basic/i.test(text));
  // message sanitized and short
  assert.ok(res.body.formA.message.length <= 160);
});

// ---------- Nothing written to database (handler never touches models) ----------

test('reference diagnostic does not require DB models', async () => {
  const res = await runHandlerWithRef({
    reference: 'NH-ABC12345',
    checkStatusRaw: async () => okForm(),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

// ---------- computeVerdict unit tests ----------

test('computeVerdict: both confirm => CONFIRMED_A', () => {
  assert.equal(computeVerdict(okForm(), okForm()), 'CONFIRMED_A');
});

test('computeVerdict: only form B confirms => CONFIRMED_B', () => {
  const a = { httpStatus: 500, code: '500', message: 'x', hasStatus: false, hasAmount: false };
  assert.equal(computeVerdict(a, okForm()), 'CONFIRMED_B');
});

test('computeVerdict: BLOCKED priority over CONFIRMED', () => {
  const blocked = { httpStatus: 401, code: '401', message: 'x', hasStatus: false, hasAmount: false };
  assert.equal(computeVerdict(blocked, okForm()), 'BLOCKED');
});

// ---------- URL form flag switching ----------

test('HubtelPaymentService._buildStatusUrl default is form A', () => {
  const svc = new HubtelPaymentService();
  svc.statusUrlForm = 'client_ref_in_path';
  const url = svc._buildStatusUrl('NH-TEST1234');
  assert.equal(url, 'https://api-txnstatus.hubtel.com/transactions/NH-TEST1234/status');
});

test('HubtelPaymentService._buildStatusUrl form B uses merchant in path', () => {
  const svc = new HubtelPaymentService();
  svc.statusUrlForm = 'merchant_in_path_with_query';
  svc.merchantAccountNumber = 'MERCH-123';
  const url = svc._buildStatusUrl('NH-TEST1234');
  assert.equal(url, 'https://api-txnstatus.hubtel.com/transactions/MERCH-123/status?clientReference=NH-TEST1234');
});

test('HubtelPaymentService._buildStatusUrl form B falls back to form A when no merchant configured', () => {
  const svc = new HubtelPaymentService();
  svc.statusUrlForm = 'merchant_in_path_with_query';
  svc.merchantAccountNumber = '';
  const url = svc._buildStatusUrl('NH-TEST1234');
  assert.equal(url, 'https://api-txnstatus.hubtel.com/transactions/NH-TEST1234/status');
});

test('HubtelPaymentService.sanitizeShortMessage truncates and redacts tokens', () => {
  const long = 'Error: fake_token_12345678901234567890 very long message here ' + 'x'.repeat(200);
  const out = HubtelPaymentService.sanitizeShortMessage(long);
  assert.ok(out.length <= 160);
  assert.ok(!/fake_token_12345678901234567890/.test(out));
  assert.ok(/<redacted>/.test(out) || out.includes('…'));
});
