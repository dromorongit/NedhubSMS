const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHubtelStatusAccessDiagnostic } = require('../backend/routes/admin');

function fakeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (body) { res.body = body; return res; };
  return res;
}

async function runHandler({ checkTransactionStatus, getOutboundIpv4 }) {
  const handler = buildHubtelStatusAccessDiagnostic({ checkTransactionStatus, getOutboundIpv4 });
  const req = { user: { userId: 'admin-user', role: 'admin' } };
  const res = fakeRes();
  await handler(req, res);
  return res;
}

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

test('diagnostic classifies ALLOWED for a well-formed not-found response (404)', async () => {
  const err = new Error('not found');
  err.httpStatus = 404;
  err.code = '1002';
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'ALLOWED');
  assert.equal(res.body.httpStatus, 404);
  assert.equal(res.body.code, '1002');
  assert.equal(res.body.outboundIpv4, null);
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

test('diagnostic classifies BLOCKED for 403', async () => {
  const err = new Error('Forbidden');
  err.httpStatus = 403;
  err.code = '403';
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'BLOCKED');
  assert.equal(res.body.httpStatus, 403);
  assert.equal(res.body.outboundIpv4, null);
});

test('diagnostic classifies UNREACHABLE for 5xx', async () => {
  const err = new Error('Internal Server Error');
  err.httpStatus = 500;
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'UNREACHABLE');
  assert.equal(res.body.httpStatus, 500);
});

test('diagnostic classifies UNREACHABLE for network errors', async () => {
  const err = new Error('connect ECONNREFUSED api-txnstatus.hubtel.com:443');
  err.code = 'ECONNREFUSED';
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'UNREACHABLE');
  assert.equal(res.body.httpStatus, undefined);
});

test('diagnostic classifies UNREACHABLE for timeouts', async () => {
  const err = new Error('timeout of 30000ms exceeded');
  err.code = 'ECONNABORTED';
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'UNREACHABLE');
});

test('diagnostic classifies UNREACHABLE for unparseable bodies', async () => {
  const err = new Error('JSON parse error');
  const res = await runHandler({
    checkTransactionStatus: async () => { throw err; },
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'UNREACHABLE');
});

test('diagnostic returns null outboundIpv4 when ipify fails', async () => {
  const res = await runHandler({
    checkTransactionStatus: async () => ({ success: true, httpStatus: 200, rawStatus: 'Unpaid' }),
    getOutboundIpv4: async () => { throw new Error('network down'); }
  });
  assert.equal(res.body.classification, 'ALLOWED');
  assert.equal(res.body.outboundIpv4, null);
});

test('diagnostic returns null outboundIpv4 when ipify times out', async () => {
  const res = await runHandler({
    checkTransactionStatus: async () => ({ success: true, httpStatus: 200, rawStatus: 'Unpaid' }),
    getOutboundIpv4: async () => null
  });
  assert.equal(res.body.classification, 'ALLOWED');
  assert.equal(res.body.outboundIpv4, null);
});

test('no secrets are returned by the diagnostic', async () => {
  const res = await runHandler({
    checkTransactionStatus: async () => ({ success: true, httpStatus: 200, rawStatus: 'Unpaid' }),
    getOutboundIpv4: async () => '203.0.113.10'
  });
  const text = JSON.stringify(res.body);
  assert.ok(!/clientSecret|access_token|authorization|basic/i.test(text));
});
