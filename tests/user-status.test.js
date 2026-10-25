const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);
const { generateToken } = require('../backend/utils/auth');
const User = require('../backend/models/User');
const { authenticate, authorize } = require('../backend/middleware/auth');

function makeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

test('suspended user token rejected', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'suspended', passwordChangedAt: null }) });
  const token = generateToken('u1', 'user');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('deleted user rejected', async () => {
  User.findById = () => ({ select: async () => null });
  const token = generateToken('u1', 'user');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('valid user accepted and token role ignored', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', passwordChangedAt: null }) });
  const token = generateToken('u1', 'super_admin');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, 'user');
});

test('token issued before password change rejected', async () => {
  const token = generateToken('u1', 'user');
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', passwordChangedAt: new Date(Date.now() + 1000) }) });
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('demoted admin token no longer passes admin authorize', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', passwordChangedAt: null }) });
  const token = generateToken('u1', 'super_admin');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  await authenticate(req, res, () => {});
  const authz = authorize(['admin', 'super_admin']);
  const res2 = makeRes();
  let nextCalled = false;
  authz(req, res2, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res2.statusCode, 403);
});





test('user with all new fields undefined is accepted', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user' }) });
  const token = generateToken('u1', 'user');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('newly registered unverified user is accepted', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', isEmailVerified: false }) });
  const token = generateToken('u1', 'user');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('register then immediate protected call accepted', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', passwordChangedAt: null }) });
  const token = generateToken('u1', 'user');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('password reset then immediate protected call accepted', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', passwordChangedAt: new Date(Date.now() - 1000) }) });
  const token = generateToken('u1', 'user');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('token issued 5 seconds before password change rejected', async () => {
  const token = generateToken('u1', 'user');
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', passwordChangedAt: new Date(Date.now() + 5000) }) });
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('token issued after password change accepted', async () => {
  User.findById = () => ({ select: async () => ({ _id: 'u1', role: 'user', status: 'active', passwordChangedAt: new Date(Date.now() - 5000) }) });
  const token = generateToken('u1', 'user');
  const req = { headers: { authorization: `Bearer ${token}` }, header: (n) => req.headers[n.toLowerCase()] };
  const res = makeRes();
  let nextCalled = false;
  await authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
