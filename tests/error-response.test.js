const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

// Force production behaviour before the server module loads its middleware
// (CORS allow-list, error detail gating, etc.).
process.env.NODE_ENV = 'production';
process.env.PORT = '49998';

const app = require('../server/index.js');

// Insert a route that throws synchronously ahead of the error-handling
// middleware so the real production error handler processes it.
const throwRouter = express.Router();
throwRouter.post('/', () => {
  throw new Error('kilo test boom');
});
app.use('/__kilo_throw', throwRouter);
const stack = app._router.stack;
const throwLayer = stack.pop();
const errorLayerIndex = stack.findIndex((layer) => layer.handle && layer.handle.length === 4);
stack.splice(errorLayerIndex, 0, throwLayer);

const baseUrl = 'http://127.0.0.1:49998';

function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body === undefined || body === null ? null : JSON.stringify(body);
    const headers = { accept: 'application/json', ...extraHeaders };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = data && data.trim() ? JSON.parse(data) : {}; } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, text: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function assertNoLeaks(body, label) {
  const text = JSON.stringify(body);
  assert.ok(!/stack/i.test(text), `${label}: body must not contain a stack trace`);
  assert.ok(!/\bat\b/i.test(text), `${label}: body must not contain file-path stack frames`);
  assert.ok(!/mongoose/i.test(text), `${label}: body must not contain MongoDB driver text`);
  assert.ok(!/CastError|ObjectId|collection|document/i.test(text), `${label}: body must not contain database error text`);
  assert.ok(!/backend[\\\/]routes/i.test(text), `${label}: body must not contain server file paths`);
}

test('error responses: production 413 payload-too-large returns a clear message', async () => {
  const padding = 'x'.repeat(200 * 1024);
  const res = await request('POST', '/api/auth/login', {
    email: 'a@b.com',
    password: 'password',
    padding
  });
  assert.equal(res.status, 413, `expected 413, got ${res.status} ${res.text}`);
  assert.equal(res.body.success, false);
  assert.ok(/request body too large/i.test(res.body.message), '413 message must be clear: ' + res.body.message);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.ok(typeof res.body.error.requestId === 'string' && res.body.error.requestId.length > 0);
  assert.equal(res.headers['x-request-id'], res.body.error.requestId, 'X-Request-Id header must match body request id');
  assertNoLeaks(res.body, 'production 413');
});

test('error responses: production 500 returns generic message + request id, no internals', async () => {
  const res = await request('POST', '/__kilo_throw');
  assert.equal(res.status, 500, `expected 500, got ${res.status} ${res.text}`);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Something went wrong!');
  assert.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.ok(typeof res.body.error.requestId === 'string' && res.body.error.requestId.length > 0);
  assert.equal(res.headers['x-request-id'], res.body.error.requestId, 'X-Request-Id header must match body request id');
  assert.equal(res.body.error.details, undefined, 'details must be undefined in production');
  assertNoLeaks(res.body, 'production 500');
});
