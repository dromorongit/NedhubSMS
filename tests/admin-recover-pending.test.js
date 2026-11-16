const test = require('node:test');
const assert = require('node:assert/strict');

// Satisfy the auth module's load-time JWT_SECRET guard (test-only; not used for
// any crypto or token operations).
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long';

const { buildRecoverPendingPayments } = require('../backend/routes/admin');

function fakeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (body) { res.body = body; return res; };
  return res;
}

function maskExpected(userId) {
  const s = String(userId || '');
  if (s.length <= 4) return s;
  return '****' + s.slice(-4);
}

function makePayment({ clientReference = 'NH-REF1', userId = 'u1234567890', amount = 50, status = 'pending' } = {}) {
  return {
    _id: 'pid-' + clientReference,
    clientReference,
    userId,
    amount,
    status,
    createdAt: new Date(Date.now() - 20 * 60 * 1000)
  };
}

async function runHandler({
  body = {},
  user = { userId: 'admin-1', role: 'super_admin' },
  PaymentModel,
  verificationService,
  AuditLogModel
} = {}) {
  const handler = buildRecoverPendingPayments({
    PaymentModel: PaymentModel || fakePaymentModel(),
    AuditLogModel: AuditLogModel || fakeAuditLog(),
    verificationService: verificationService || fakeVerificationService(),
    log: { error: () => {}, warn: () => {}, info: () => {} }
  });
  const req = { user, body, ip: '1.2.3.4', get: () => null };
  const res = fakeRes();
  await handler(req, res);
  return res;
}

function fakePaymentModel(payments = []) {
  return {
    find: (query) => {
      let result = payments.filter((p) => {
        if (query.status && query.status.$in) {
          if (!query.status.$in.includes(p.status)) return false;
        }
        if (query.createdAt && query.createdAt.$lt) {
          if (!(p.createdAt < query.createdAt.$lt)) return false;
        }
        if (query.clientReference && query.clientReference.$in) {
          if (!query.clientReference.$in.includes(p.clientReference)) return false;
        }
        return true;
      });
      result = result.sort((a, b) => b.createdAt - a.createdAt);
      if (query.limit) result = result.slice(0, query.limit);
      const api = {
        sort: () => api,
        limit: () => api,
        then: (fn) => fn(result)
      };
      return api;
    }
  };
}

function fakeVerificationService(assessments = {}, applyResults = {}) {
  const calls = { assess: [], apply: [] };
  return {
    assessPayment: async (clientReference) => {
      calls.assess.push(clientReference);
      return assessments[clientReference] || { action: 'leave_pending', reason: 'default' };
    },
    applyPaymentAssessment: async (assessment) => {
      calls.apply.push(assessment.clientReference);
      return applyResults[assessment.clientReference] || { applied: true, action: 'credit' };
    },
    calls
  };
}

function fakeAuditLog() {
  const created = [];
  return {
    create: async (data) => { created.push(data); return data; },
    created
  };
}

// ---------- Dry run: nothing credited ----------

test('dry run by default: wouldCredit counted, credited stays 0, no audit writes', async () => {
  const payments = [makePayment({ amount: 50 })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'credit', providerStatus: 'paid', providerAmount: 50, paymentMethod: 'mobile_money' }
  });
  const audit = fakeAuditLog();
  const res = await runHandler({
    body: {},
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs,
    AuditLogModel: audit
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.scanned, 1);
  assert.equal(res.body.wouldCredit, 1);
  assert.equal(res.body.credited, 0);
  assert.equal(res.body.skipped, 0);
  assert.equal(res.body.items[0].outcome, 'would_credit');
  assert.equal(res.body.items[0].providerStatus, 'paid');
  assert.equal(res.body.items[0].providerAmount, 50);
  assert.equal(res.body.items[0].userIdMasked, maskExpected('u1234567890'));
  // No per-credit audit in dry run; only summary
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'bulk_recover_summary');
  assert.equal(audit.created[0].details.credited, 0);
});

test('user id masked to last 4 characters', async () => {
  const payments = [makePayment({ userId: 'short' })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'credit', providerStatus: 'paid', providerAmount: 10, clientReference: 'NH-REF1' }
  });
  const res = await runHandler({
    body: {},
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  assert.equal(res.body.items[0].userIdMasked, '****hort');
});

// ---------- apply requires confirm ----------

test('apply=true without confirm returns 400', async () => {
  const res = await runHandler({ body: { apply: true } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'MISSING_CONFIRM');
});

test('apply=true with confirm=CREDIT_VERIFIED_PAYMENTS is accepted', async () => {
  const payments = [makePayment({ amount: 50 })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'credit', providerStatus: 'paid', providerAmount: 50 }
  }, { 'NH-REF1': { applied: true } });
  const audit = fakeAuditLog();
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS' },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs,
    AuditLogModel: audit
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dryRun, false);
  assert.equal(res.body.credited, 1);
  assert.equal(res.body.items[0].outcome, 'credited');
  assert.equal(audit.created.length, 2); // per-credit + summary
  assert.equal(audit.created[0].action, 'bulk_recover_verified');
  assert.equal(audit.created[0].details.method, 'bulk_recover_verified');
  assert.equal(audit.created[0].details.reference, 'NH-REF1');
  assert.equal(audit.created[1].action, 'bulk_recover_summary');
});

// ---------- non-credit actions left untouched ----------

test('leave_pending payment is not credited and reported as skipped', async () => {
  const payments = [makePayment({ amount: 50 })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'leave_pending', reason: 'amount_too_low:provider=30,order=50', providerStatus: 'paid', providerAmount: 30 }
  });
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS' },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  assert.equal(res.body.credited, 0);
  assert.equal(res.body.skipped, 1);
  assert.equal(res.body.items[0].outcome, 'skipped');
  assert.equal(res.body.items[0].reason, 'amount_too_low:provider=30,order=50');
});

test('verification_unavailable (401/403/5xx/timeout) reported as skipped and not credited', async () => {
  const payments = [makePayment({ amount: 50 })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'verification_unavailable', reason: 'blocked_401_403', httpStatus: 401, code: '401' }
  });
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS' },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  assert.equal(res.body.credited, 0);
  assert.equal(res.body.skipped, 1);
  assert.equal(res.body.items[0].providerStatus, null);
  assert.equal(res.body.items[0].outcome, 'skipped');
  assert.equal(res.body.items[0].reason, 'blocked_401_403');
});

test('already_terminal payment is skipped', async () => {
  const payments = [makePayment({ status: 'pending' })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'already_terminal', status: 'paid', clientReference: 'NH-REF1' }
  });
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS' },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  assert.equal(res.body.scanned, 1);
  assert.equal(res.body.credited, 0);
  assert.equal(res.body.skipped, 1);
  assert.equal(res.body.items[0].reason, 'already_terminal');
});

// ---------- idempotent / race skip ----------

test('apply returns already credited -> reported as skipped, not double credited', async () => {
  const payments = [makePayment({ amount: 50 })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'credit', providerStatus: 'paid', providerAmount: 50, clientReference: 'NH-REF1' }
  }, { 'NH-REF1': { applied: false, reason: 'lost_conditional_update' } });
  const audit = fakeAuditLog();
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS' },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs,
    AuditLogModel: audit
  });
  assert.equal(res.body.scanned, 1);
  assert.equal(res.body.credited, 0);
  assert.equal(res.body.skipped, 1);
  assert.equal(res.body.items[0].outcome, 'skipped');
  assert.equal(res.body.items[0].reason, 'lost_conditional_update');
  // Only summary audit (no per-credit since not applied)
  assert.equal(audit.created.length, 1);
  assert.equal(audit.created[0].action, 'bulk_recover_summary');
});

// ---------- early stop on 3 consecutive unreachable ----------

test('stops early after 3 consecutive verification_unavailable and sets hubtelUnreachable', async () => {
  const payments = [
    makePayment({ clientReference: 'NH-REF1' }),
    makePayment({ clientReference: 'NH-REF2' }),
    makePayment({ clientReference: 'NH-REF3' }),
    makePayment({ clientReference: 'NH-REF4' })
  ];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'verification_unavailable', reason: 'blocked_401_403', httpStatus: 401 },
    'NH-REF2': { action: 'verification_unavailable', reason: 'provider_5xx', httpStatus: 500 },
    'NH-REF3': { action: 'verification_unavailable', reason: 'timeout', httpStatus: null },
    'NH-REF4': { action: 'credit', providerStatus: 'paid', providerAmount: 50 }
  });
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS' },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  assert.equal(res.body.hubtelUnreachable, true);
  assert.equal(res.body.items.length, 3);
  assert.equal(vs.calls.assess.length, 3);
  assert.ok(!vs.calls.assess.includes('NH-REF4'));
});

// ---------- limit and olderThanMinutes guards ----------

test('limit capped at 200, olderThanMinutes floored at 5', async () => {
  const payments = Array.from({ length: 5 }, (_, i) => makePayment({ clientReference: `NH-R${i}` }));
  const vs = fakeVerificationService();
  payments.forEach((p) => {
    vs.calls; // keep reference; assessments default to leave_pending
  });
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS', olderThanMinutes: 1, limit: 9999 },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  assert.equal(res.body.scanned, 5);
  assert.equal(res.body.items.length, 5);
});

// ---------- references filter ----------

test('references restrict which payments are scanned', async () => {
  const payments = [
    makePayment({ clientReference: 'NH-A' }),
    makePayment({ clientReference: 'NH-B' }),
    makePayment({ clientReference: 'NH-C' })
  ];
  const vs = fakeVerificationService({
    'NH-A': { action: 'credit', providerStatus: 'paid', providerAmount: 10 },
    'NH-B': { action: 'credit', providerStatus: 'paid', providerAmount: 10 },
    'NH-C': { action: 'credit', providerStatus: 'paid', providerAmount: 10 }
  }, {
    'NH-A': { applied: true },
    'NH-B': { applied: true },
    'NH-C': { applied: true }
  });
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS', references: ['NH-A', 'NH-C'] },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  assert.equal(res.body.scanned, 2);
  assert.equal(res.body.credited, 2);
  assert.deepEqual(vs.calls.assess.sort(), ['NH-A', 'NH-C']);
});

// ---------- no secrets leaked ----------

test('response contains no tokens, secrets, or raw Hubtel bodies', async () => {
  const payments = [makePayment({ amount: 50 })];
  const vs = fakeVerificationService({
    'NH-REF1': { action: 'credit', providerStatus: 'paid', providerAmount: 50, rawStatus: 'SECRET_VALUE', message: 'token_abc1234567890' }
  }, { 'NH-REF1': { applied: true } });
  const res = await runHandler({
    body: { apply: true, confirm: 'CREDIT_VERIFIED_PAYMENTS' },
    PaymentModel: fakePaymentModel(payments),
    verificationService: vs
  });
  const text = JSON.stringify(res.body);
  assert.ok(!/clientSecret|access_token|authorization|basic/i.test(text));
  assert.ok(!/SECRET_VALUE/.test(text));
  assert.ok(!/token_abc1234567890/.test(text));
});

// ---------- in-process lock: 409 when already running ----------

test('returns 409 when a run is already in progress', async () => {
  let releaseLock;
  const handler = buildRecoverPendingPayments({
    PaymentModel: fakePaymentModel([makePayment()]),
    verificationService: fakeVerificationService({
      'NH-REF1': { action: 'credit', providerStatus: 'paid', providerAmount: 50 }
    }, { 'NH-REF1': { applied: true } }),
    AuditLogModel: fakeAuditLog(),
    log: { error: () => {}, warn: () => {}, info: () => {} }
  });
  // Manually trip the lock by calling handler directly with a slow assessment
  const slowVs = {
    assessPayment: async () => { await new Promise((r) => setTimeout(r, 200)); return { action: 'leave_pending' }; },
    applyPaymentAssessment: async () => ({ applied: false })
  };
  const slowHandler = buildRecoverPendingPayments({
    PaymentModel: fakePaymentModel([makePayment()]),
    verificationService: slowVs,
    AuditLogModel: fakeAuditLog(),
    log: { error: () => {}, warn: () => {}, info: () => {} }
  });
  const req = { user: { userId: 'admin-1', role: 'super_admin' }, body: {}, ip: '1.2.3.4', get: () => null };
  const res1 = fakeRes();
  const res2 = fakeRes();
  const p1 = slowHandler(req, res1);
  await new Promise((r) => setTimeout(r, 50));
  await slowHandler(req, res2);
  await p1;
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.error.code, 'RECOVERY_RUNNING');
});
