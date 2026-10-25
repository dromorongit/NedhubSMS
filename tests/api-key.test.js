const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);
const User = require('../backend/models/User');
const { authenticate } = require('../backend/middleware/auth');

function makeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

const crypto = require('crypto');
function key() { return 'ndh_live_' + crypto.randomBytes(24).toString('hex'); }

test('revoked API key rejected', async () => {
  const k = key();
  const hash = crypto.createHash('sha256').update(k).digest('hex');
  User.findOne = async () => ({ _id: 'u1', role: 'user', status: 'active', apiKeys: [{ keyHash: hash, revoked: true, keyId: 'k1' }] });
  const req = { headers: { 'x-api-key': k }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('expired API key rejected', async () => {
  const k = key();
  const hash = crypto.createHash('sha256').update(k).digest('hex');
  User.findOne = async () => ({ _id: 'u1', role: 'user', status: 'active', apiKeys: [{ keyHash: hash, revoked: false, keyId: 'k1', expiresAt: new Date(Date.now() - 1000) }] });
  const req = { headers: { 'x-api-key': k }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('owner account suspended API key rejected', async () => {
  const k = key();
  const hash = crypto.createHash('sha256').update(k).digest('hex');
  User.findOne = async () => ({ _id: 'u1', role: 'user', status: 'suspended', apiKeys: [{ keyHash: hash, revoked: false, keyId: 'k1' }] });
  const req = { headers: { 'x-api-key': k }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});



