const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);

const HubtelPaymentService = require('../backend/services/HubtelPaymentService');
const hubtelTransferService = require('../backend/services/HubtelTransferService'); // exported instance
const hubtelCommissionService = require('../backend/services/HubtelCommissionService'); // exported instance
const CallbackVerificationService = require('../backend/services/callbackVerificationService');

// ---------------------------------------------------------------------------
// Fixtures. Each fixture is an ASSUMED Hubtel response shape. The owner must
// verify the actual status words and field names against Hubtel's documentation
// before relying on them in production.
// ---------------------------------------------------------------------------
const FIXTURES = [
  {
    name: 'top-level responseCode 0000 with inner status Unpaid is not paid',
    body: { responseCode: '0000', status: 'Unpaid', amount: 10 },
    label: 'assumed response shape, owner to verify against Hubtel\'s documentation'
  },
  {
    name: 'inner status Paid with matching amount is paid',
    body: { responseCode: '0000', status: 'Paid', amount: 10 },
    label: 'assumed response shape, owner to verify against Hubtel\'s documentation'
  },
  {
    name: 'inner status Paid with a lower amount does not credit',
    body: { responseCode: '0000', status: 'Paid', amount: 5 },
    label: 'assumed response shape, owner to verify against Hubtel\'s documentation'
  },
  {
    name: 'inner status Refunded does not credit',
    body: { responseCode: '0000', status: 'Refunded', amount: 10 },
    label: 'assumed response shape, owner to verify against Hubtel\'s documentation'
  },
  {
    name: 'missing inner data stays pending',
    body: { responseCode: '0000' },
    label: 'assumed response shape, owner to verify against Hubtel\'s documentation'
  },
  {
    name: 'unknown status string stays pending',
    body: { responseCode: '0000', status: 'UnknownStatus' },
    label: 'assumed response shape, owner to verify against Hubtel\'s documentation'
  }
];

const ERROR_CASES = [
  { name: 'HTTP 404 stays pending', error: Object.assign(new Error('Not Found'), { response: { status: 404 } }) },
  { name: 'HTTP 500 stays pending', error: Object.assign(new Error('Server Error'), { response: { status: 500 } }) },
  { name: 'network timeout stays pending', error: Object.assign(new Error('ESOCKETTIMEDOUT'), { code: 'ECONNABORTED' }) }
];

// ---------------------------------------------------------------------------
// Level A: each service's checkTransactionStatus maps the raw provider body.
// ---------------------------------------------------------------------------
const SERVICES = [
  {
    label: 'payment (HubtelPaymentService)',
    instance: new HubtelPaymentService(),
    kind: 'payment'
  },
  {
    label: 'transfer MoMo (HubtelTransferService)',
    instance: hubtelTransferService,
    kind: 'transfer'
  },
  {
    label: 'transfer bank (HubtelTransferService)',
    instance: hubtelTransferService,
    kind: 'transfer'
  },
  {
    label: 'transfer airtime (HubtelTransferService)',
    instance: hubtelTransferService,
    kind: 'transfer'
  },
  {
    label: 'transfer data (HubtelTransferService)',
    instance: hubtelTransferService,
    kind: 'transfer'
  },
  {
    label: 'commission TV (HubtelCommissionService)',
    instance: hubtelCommissionService,
    kind: 'commission'
  },
  {
    label: 'commission utility (HubtelCommissionService)',
    instance: hubtelCommissionService,
    kind: 'commission'
  }
];

function readyService(instance) {
  // checkTransactionStatus guards on configured credentials; stub them for the
  // mapping test so we exercise only the status parsing.
  instance.basicAuthHeader = 'Basic dummy';
  return instance;
}

for (const svc of SERVICES) {
  for (const fx of FIXTURES) {
    test(`${svc.label}: ${fx.name} [${fx.label}]`, async () => {
      const instance = readyService(svc.instance);
      instance.httpClient = { get: async () => ({ data: fx.body }) };
      const result = await instance.checkTransactionStatus('REF-FIXTURE');
      assert.ok(result, 'checkTransactionStatus should return a result');

      if (svc.kind === 'payment') {
        // _mapHubtelStatus -> 'paid' | 'failed' | 'pending' | 'cancelled'
        if (fx.name.startsWith('inner status Paid with matching amount')) {
          assert.equal(result.status, 'paid', 'matching Paid maps to paid');
        } else if (fx.name.startsWith('top-level responseCode 0000 with inner status Unpaid')) {
          assert.notEqual(result.status, 'paid', 'Unpaid must not map to paid');
        } else if (fx.name.startsWith('inner status Paid with a lower amount')) {
          assert.equal(result.status, 'paid', 'Paid maps to paid; amount is checked later by assess');
        } else if (fx.name.startsWith('inner status Refunded')) {
          assert.notEqual(result.status, 'paid', 'Refunded must not map to paid');
        } else if (fx.name.startsWith('missing inner data')) {
          assert.equal(result.status, 'pending', 'missing inner status stays pending');
        } else if (fx.name.startsWith('unknown status string')) {
          assert.equal(result.status, 'pending', 'unknown status stays pending');
        }
      } else {
        // _mapTransactionStatus -> 'success' | 'failed' | 'pending' | 'cancelled'
        if (fx.name.startsWith('inner status Paid with matching amount')) {
          assert.equal(result.status, 'success', 'matching Paid maps to success');
        } else if (fx.name.startsWith('top-level responseCode 0000 with inner status Unpaid')) {
          assert.notEqual(result.status, 'success', 'Unpaid must not map to success');
        } else if (fx.name.startsWith('inner status Paid with a lower amount')) {
          assert.equal(result.status, 'success', 'Paid maps to success; amount is checked later by assess');
        } else if (fx.name.startsWith('inner status Refunded')) {
          assert.notEqual(result.status, 'success', 'Refunded must not map to success');
        } else if (fx.name.startsWith('missing inner data')) {
          assert.equal(result.status, 'pending', 'missing inner status stays pending');
        } else if (fx.name.startsWith('unknown status string')) {
          assert.equal(result.status, 'pending', 'unknown status stays pending');
        }
      }
    });
  }

  for (const ec of ERROR_CASES) {
    test(`${svc.label}: ${ec.name} [assumed response shape, owner to verify against Hubtel's documentation]`, async () => {
      const instance = readyService(svc.instance);
      instance.httpClient = { get: async () => { throw ec.error; } };
      await assert.rejects(() => instance.checkTransactionStatus('REF-FIXTURE'));
    });
  }
}

// ---------------------------------------------------------------------------
// Level B: callbackVerificationService assess functions turn the provider
// result into paid/failed/pending, honouring the amount check (payment only).
// ---------------------------------------------------------------------------
function makeStore() {
  const payments = [];
  const transactions = [];
  const wallets = [{ userId: 'u1', balance: 10000, smsBalance: 0 }];
  function match(obj, filter) {
    if (!filter) return true;
    return Object.keys(filter).every((k) => {
      const v = filter[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.$in) return v.$in.includes(obj[k]);
        if (v.$nin) return !v.$nin.includes(obj[k]);
        if (v.$gte != null) return obj[k] >= v.$gte;
        if (v.$lt != null) return obj[k] < v.$lt;
      }
      return obj[k] === v || String(obj[k]) === String(v);
    });
  }
  const Payment = function (data) {
    const inst = { ...data, _id: `p${payments.length + 1}`, status: data.status || 'pending' };
    inst.save = async function () { return this; };
    payments.push(inst);
    return inst;
  };
  Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
  Payment.findOneAndUpdate = async (filter, update) => {
    const p = payments.find((x) => match(x, filter));
    if (!p) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(p.status)) return null;
    if (update.$set) Object.assign(p, update.$set);
    return p;
  };
  const Transaction = function (data) {
    const inst = { ...data, _id: `t${transactions.length + 1}` };
    inst.save = async function () { if (!transactions.includes(inst)) transactions.push(inst); return inst; };
    transactions.push(inst);
    return inst;
  };
  Transaction.findOne = async (filter) => transactions.find((t) => match(t, filter)) || null;
  Transaction.findOneAndUpdate = async (filter, update) => {
    const t = transactions.find((x) => match(x, filter));
    if (!t) return null;
    if (filter.status && filter.status.$in && !filter.status.$in.includes(t.status)) return null;
    if (update.$set) Object.assign(t, update.$set);
    return t;
  };
  const Wallet = {
    findOne: async (filter) => wallets.find((w) => match(w, filter)) || null,
    findOneAndUpdate: async (filter, update) => {
      let w = wallets.find((x) => match(x, filter));
      if (!w) return null;
      if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
      if (update.$set) Object.assign(w, update.$set);
      return w;
    }
  };
  return { payments, transactions, wallets, Payment, Transaction, Wallet };
}

function makeSvc(store, providerResult) {
  const svc = new CallbackVerificationService({
    Payment: store.Payment,
    Transaction: store.Transaction,
    Wallet: store.Wallet,
    paymentService: { checkTransactionStatus: async () => providerResult },
    transferService: { checkTransactionStatus: async () => providerResult },
    commissionService: { checkTransactionStatus: async () => providerResult },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  svc.checkProviderStatus = async () => providerResult;
  return svc;
}

function mapStatus(kind, body) {
  if (kind === 'payment') {
    if (body.status === 'Paid' || body.status === 'PAID' || body.status === 'SUCCESS' || body.status === 'SUCCESSFUL') return 'paid';
    if (body.status === 'Unpaid' || body.status === 'Refunded' || body.status === 'FAILED' || body.status === '1002') return 'failed';
    return 'pending';
  }
  if (body.status === 'Paid' || body.status === 'PAID' || body.status === 'SUCCESS' || body.status === 'SUCCESSFUL') return 'success';
  if (body.status === 'Unpaid' || body.status === 'Refunded' || body.status === 'FAILED' || body.status === '1002') return 'failed';
  return 'pending';
}

const STORED_AMOUNT = 10;

// Expected assess action per service kind for each fixture.
const ASSESS_CASES = [
  {
    fx: FIXTURES[1], // Paid matching amount
    desc: 'Paid matching amount -> credit/complete',
    payment: 'credit',
    transfer: 'complete',
    purchase: 'complete'
  },
  {
    fx: FIXTURES[2], // Paid lower amount
    desc: 'Paid lower amount -> no credit (payment amount check; transfer/purchase confirm)',
    payment: 'leave_pending',
    transfer: 'complete',
    purchase: 'complete'
  },
  {
    fx: FIXTURES[0], // Unpaid
    desc: 'Unpaid -> not paid (failed)',
    payment: 'mark_failed',
    transfer: 'mark_failed',
    purchase: 'refund'
  },
  {
    fx: FIXTURES[3], // Refunded
    desc: 'Refunded -> no credit as success',
    payment: 'mark_failed',
    transfer: 'mark_failed',
    purchase: 'refund'
  },
  {
    fx: FIXTURES[4], // missing inner data
    desc: 'missing inner data -> stays pending',
    payment: 'leave_pending',
    transfer: 'leave_pending',
    purchase: 'leave_pending'
  },
  {
    fx: FIXTURES[5], // unknown status string
    desc: 'unknown status string -> stays pending',
    payment: 'leave_pending',
    transfer: 'leave_pending',
    purchase: 'leave_pending'
  }
];

const ASSESS_SUITES = [
  { label: 'payment', kind: 'payment', run: (svc) => svc.processPaymentCallback('REF') },
  { label: 'transfer MoMo', kind: 'transfer', run: (svc) => svc.processTransferCallback('REF', 'momo') },
  { label: 'transfer bank', kind: 'transfer', run: (svc) => svc.processTransferCallback('REF', 'bank') },
  { label: 'transfer airtime', kind: 'purchase', run: (svc) => svc.processAirtimeCallback('REF') },
  { label: 'transfer data', kind: 'purchase', run: (svc) => svc.processDataCallback('REF') },
  { label: 'commission TV', kind: 'purchase', run: (svc) => svc.processTvCallback('REF') },
  { label: 'commission utility', kind: 'purchase', run: (svc) => svc.processUtilityCallback('REF') }
];

function setupTxn(store, kind) {
  if (kind === 'payment') {
    new store.Payment({ clientReference: 'REF', userId: 'u1', amount: STORED_AMOUNT, status: 'pending' });
  } else {
    new store.Transaction({ reference: 'REF', userId: 'u1', amount: 5, status: 'pending_confirmation', metadata: { transactionType: 'AIRTIME_PURCHASE' } }).save();
  }
}

for (const suite of ASSESS_SUITES) {
  for (const c of ASSESS_CASES) {
    test(`${suite.label}: ${c.desc} [assumed response shape, owner to verify against Hubtel's documentation]`, async () => {
      const store = makeStore();
      const mapped = mapStatus(suite.kind, c.fx.body);
      const providerResult = { ok: true, status: mapped, amount: c.fx.body.amount || 0, transactionId: 'HTX', paymentMethod: 'momo', message: 'ok' };
      const svc = makeSvc(store, providerResult);
      setupTxn(store, suite.kind);
      const res = await suite.run(svc);
      const expected = suite.kind === 'payment' ? c.payment : (suite.kind === 'transfer' ? c.transfer : c.purchase);
      assert.equal(res.action, expected, `${suite.label} assess action`);
    });
  }

  for (const ec of ERROR_CASES) {
    test(`${suite.label}: ${ec.name} [assumed response shape, owner to verify against Hubtel's documentation]`, async () => {
      const store = makeStore();
      const providerResult = { ok: false, error: ec.error.message };
      const svc = makeSvc(store, providerResult);
      setupTxn(store, suite.kind);
      const res = await suite.run(svc);
      assert.equal(res.action, 'provider_unavailable', `${suite.label}: HTTP error leaves pending`);
    });
  }
}

// ---------------------------------------------------------------------------
// Top-level responseCode '0000' alone (no inner status) must never by itself
// make a transaction paid or failed.
// ---------------------------------------------------------------------------
test('top-level responseCode 0000 alone (no inner status) is not paid for all services', async () => {
  const cases = [
    { label: 'payment', instance: readyService(new HubtelPaymentService()) },
    { label: 'transfer', instance: readyService(hubtelTransferService) },
    { label: 'commission', instance: readyService(hubtelCommissionService) }
  ];
  for (const c of cases) {
    c.instance.httpClient = { get: async () => ({ data: { responseCode: '0000' } }) };
    const result = await c.instance.checkTransactionStatus('REF');
    assert.notEqual(result.status, 'paid', `${c.label}: responseCode 0000 alone must not map to paid`);
    assert.notEqual(result.status, 'success', `${c.label}: responseCode 0000 alone must not map to success`);
    assert.notEqual(result.status, 'failed', `${c.label}: responseCode 0000 alone must not map to failed`);
  }
});
