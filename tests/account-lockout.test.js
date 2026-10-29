const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnServer, request } = require('./helpers/spawn-server');
const { isAccountLocked, recordFailedAttempt, resetAttempts, FAILURE_THRESHOLD } = require('../backend/utils/accountLockout');

const EMAIL = 'lockout@example.com';
const PASSWORD = 'Str0ng!Passw0rd';

async function registerUser(baseUrl) {
  const r = await request(baseUrl, 'POST', '/api/auth/register', {
    name: 'Lockout User',
    email: EMAIL,
    phone: '0240000000',
    password: PASSWORD
  });
  assert.ok(r.status === 201 || r.status === 400, 'register unexpected: ' + r.status + ' ' + JSON.stringify(r.body));
}

async function failedLogin(baseUrl, email = EMAIL) {
  return request(baseUrl, 'POST', '/api/auth/login', { email, password: 'wrong-password' });
}

test('account lockout: 10 failed logins lock the account; responses stay generic', async () => {
  const { baseUrl, stop } = await spawnServer({ AUTH_RATE_LIMIT_MAX: 1000 });
  try {
    await registerUser(baseUrl);

    const responses = [];
    for (let i = 0; i < 11; i++) {
      const r = await failedLogin(baseUrl);
      responses.push(r);
      assert.equal(r.status, 401, `attempt ${i + 1} unexpected status ${r.status}`);
      assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
      // Generic message: must never reveal lockout or account existence.
      assert.equal(r.body.message, 'Invalid credentials');
      assert.ok(!/lock/i.test(r.body.message), 'message must not reveal lockout: ' + r.body.message);
    }

    // The 10th and 11th attempts find the account locked; responses identical
    // to every other failed login (no enumeration of lockout state).
    for (const i of [9, 10]) {
      assert.equal(responses[i].status, 401);
      assert.equal(responses[i].body.message, 'Invalid credentials');
    }

    // Even the correct password is rejected while the account is locked.
    const correct = await request(baseUrl, 'POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
    assert.equal(correct.status, 401);
    assert.equal(correct.body.message, 'Invalid credentials');

    // A different account is not affected by this account's lockout.
    const other = await request(baseUrl, 'POST', '/api/auth/register', {
      name: 'Other User',
      email: 'lockout-other@example.com',
      phone: '0240000001',
      password: PASSWORD
    });
    assert.ok(other.status === 201 || other.status === 400, 'other register: ' + other.status);
    const otherFailed = await failedLogin(baseUrl, 'lockout-other@example.com');
    assert.equal(otherFailed.status, 401);
  } finally {
    await stop();
  }
});

test('account lockout: failures against an unknown account are not recorded (no enumeration)', async () => {
  const { baseUrl, stop } = await spawnServer({ AUTH_RATE_LIMIT_MAX: 1000 });
  try {
    const unknown = 'does-not-exist@example.com';
    const responses = [];
    for (let i = 0; i < 11; i++) {
      const r = await failedLogin(baseUrl, unknown);
      responses.push(r);
      assert.equal(r.status, 401);
      assert.equal(r.body.message, 'Invalid credentials');
    }
    // All responses identical: nothing reveals whether the account exists.
    const first = responses[0].body;
    for (const r of responses) {
      assert.deepEqual(r.body, first);
    }

    // A real account registered afterward is not pre-locked by attacks on its
    // email while it did not exist.
    await registerUser(baseUrl);
    const fresh = await request(baseUrl, 'POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
    assert.equal(fresh.status, 200, 'fresh account should log in: ' + JSON.stringify(fresh.body));
    assert.equal(fresh.body.success, true);
  } finally {
    await stop();
  }
});

test('accountLockout unit: threshold and reset (in-memory store)', async () => {
  assert.equal(FAILURE_THRESHOLD, 10);

  const email = 'unit@example.com';

  // First 9 failures: not locked.
  for (let i = 0; i < 9; i++) {
    await recordFailedAttempt(email);
  }
  let state = await isAccountLocked(email);
  assert.equal(state.locked, false);
  assert.equal(state.attempts, 9);

  // 10th failure: locked.
  await recordFailedAttempt(email);
  state = await isAccountLocked(email);
  assert.equal(state.locked, true);
  assert.equal(state.attempts, 10);
  assert.ok(state.resetTime > Date.now());

  // Window not expired yet: still locked.
  state = await isAccountLocked(email);
  assert.equal(state.locked, true);

  // Successful login clears failures.
  await resetAttempts(email);
  state = await isAccountLocked(email);
  assert.equal(state.locked, false);
  assert.equal(state.attempts, 0);
  assert.equal(state.resetTime, null);
});

test('accountLockout defaults', () => {
  assert.equal(FAILURE_THRESHOLD, 10);
});
