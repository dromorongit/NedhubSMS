const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);
const { generateToken, verifyToken, validateJwtSecret } = require('../backend/utils/auth');

test('JWT validateJwtSecret rejects missing', () => {
  assert.throws(() => validateJwtSecret(''), /required/i);
});

test('JWT validateJwtSecret rejects short', () => {
  assert.throws(() => validateJwtSecret('short'), /32/);
});

test('JWT validateJwtSecret rejects placeholder', () => {
  assert.throws(() => validateJwtSecret('secret'));
});

test('JWT validateJwtSecret accepts 64 char', () => {
  assert.doesNotThrow(() => validateJwtSecret('a'.repeat(64)));
});

test('JWT token signed with different secret is rejected', () => {
  const t = require('jsonwebtoken').sign({ userId: '1', role: 'admin' }, 'b'.repeat(64), { algorithm: 'HS256', expiresIn: '1h' });
  assert.equal(verifyToken(t), null);
});

test('JWT unsigned token (alg none) is rejected', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: '1', role: 'admin', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  const t = header + '.' + payload + '.';
  assert.equal(verifyToken(t), null);
});

test('JWT roundtrip valid', () => {
  const t = generateToken('user1', 'admin');
  const d = verifyToken(t);
  assert.equal(d.userId, 'user1');
  assert.equal(d.role, 'admin');
});

