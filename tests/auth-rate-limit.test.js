const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnServer, request } = require('./helpers/spawn-server');
const {
  increment,
  getCount,
  clearKey,
  normalizeEmail,
  WINDOW_MS,
  MAX_ATTEMPTS,
  memoryStore
} = require('../backend/utils/authRateLimiter');

test('authRateLimiter unit: IP and email buckets are independent (in-memory store)', async () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmail(''), '');

  const ipKey = 'ip:10.0.0.1';
  const emailKey = 'email:user@example.com';
  await clearKey(ipKey);
  await clearKey(emailKey);

  // Five attempts are allowed for the IP...
  for (let i = 1; i <= 5; i++) {
    const r = await increment(ipKey);
    assert.equal(r.count, i);
  }
  // ...the sixth exceeds the limit.
  const over = await increment(ipKey);
  assert.equal(over.count, 6);
  assert.ok(over.count > MAX_ATTEMPTS);

  // ...while a different IP and the email bucket are untouched.
  assert.equal(await getCount('ip:10.0.0.2'), 0);
  assert.equal(await getCount(emailKey), 0);

  const emailR = await increment(emailKey);
  assert.equal(emailR.count, 1);
  assert.equal(await getCount(ipKey), 6); // IP bucket unaffected by email bucket

  await clearKey(ipKey);
  await clearKey(emailKey);
  assert.equal(await getCount(ipKey), 0);
  assert.equal(await getCount(emailKey), 0);
});

test('authRateLimiter unit: Mongo-backed increment path (mongoose connected)', async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongoose = require('mongoose');
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(mongod.getUri());

  const key = 'email:mongo-unit@example.com';
  await clearKey(key);
  try {
    const r1 = await increment(key);
    assert.equal(r1.count, 1);
    const r2 = await increment(key);
    assert.equal(r2.count, 2);
    assert.equal(await getCount(key), 2);
    assert.ok(r2.resetTime > Date.now());
  } finally {
    await clearKey(key);
    await mongoose.disconnect();
    await mongod.stop();
  }
});

test('auth rate limit: login IP bucket (5 per 15 min) yields HTTP 429 with Retry-After', async () => {
  const { baseUrl, stop } = await spawnServer({});
  try {
    // Omitting the email fails validation (400) before any user lookup, so
    // these requests only exercise the rate-limit counter.
    for (let i = 0; i < 5; i++) {
      const r = await request(baseUrl, 'POST', '/api/auth/login', { password: 'wrong-password' });
      assert.equal(r.status, 400, `attempt ${i + 1}: expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
    }

    const r = await request(baseUrl, 'POST', '/api/auth/login', { password: 'wrong-password' });
    assert.equal(r.status, 429, 'expected 429 after 5 attempts, got ' + r.status + ' ' + JSON.stringify(r.body));
    assert.ok(r.headers['retry-after'], 'missing Retry-After header');
    const retryAfter = Number(r.headers['retry-after']);
    assert.ok(retryAfter >= 1 && retryAfter <= 900, 'unexpected Retry-After: ' + retryAfter);
    assert.equal(r.body.success, false);
    assert.equal(r.body.error.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(/too many requests/i.test(r.body.message));
    assert.ok(!/user|account|email|password/i.test(r.body.message), 'message must stay generic: ' + r.body.message);
  } finally {
    await stop();
  }
});

test('auth rate limit: forgot-password IP bucket yields HTTP 429', async () => {
  const { baseUrl, stop } = await spawnServer({});
  try {
    for (let i = 0; i < 5; i++) {
      const r = await request(baseUrl, 'POST', '/api/auth/request-password-reset', {
        email: 'not-an-email'
      });
      assert.equal(r.status, 400, `attempt ${i + 1}: expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
    }

    const r = await request(baseUrl, 'POST', '/api/auth/request-password-reset', {
      email: 'not-an-email'
    });
    assert.equal(r.status, 429, 'expected 429 after 5 forgot-password attempts, got ' + r.status);
    assert.ok(r.headers['retry-after']);
    assert.equal(r.body.error.code, 'RATE_LIMIT_EXCEEDED');
  } finally {
    await stop();
  }
});

test('WINDOW_MS and MAX_ATTEMPTS defaults', () => {
  assert.equal(WINDOW_MS, 15 * 60 * 1000);
  assert.equal(MAX_ATTEMPTS, 5);
});
