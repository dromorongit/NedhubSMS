const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(64);

const { reconcilePending } = require('../scripts/reconcile-pending');
const { auditWalletCredits } = require('../scripts/audit-wallet-credits');
const CallbackVerificationService = require('../backend/services/callbackVerificationService');

function makeStore() {
  const payments = [];
  const transactions = [];
  const wallets = [];
  function match(obj, filter) {
    if (!filter) return true;
    return Object.keys(filter).every((k) => {
      const v = filter[k];
      if (v instanceof RegExp) return v.test(obj[k]);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.$regex) { const re = v.$regex instanceof RegExp ? v.$regex : new RegExp(v.$regex); return re.test(obj[k]); }
        if (v.$in) return v.$in.includes(obj[k]);
        if (v.$nin) return !v.$nin.includes(obj[k]);
        if (v.$gte != null) return obj[k] >= v.$gte;
        if (v.$lt != null) return obj[k] < v.$lt;
      }
      return obj[k] === v || String(obj[k]) === String(v);
    });
  }
  const Payment = function (data) {
    const inst = { ...data, _id: data._id || `p${payments.length + 1}`, status: data.status || 'pending' };
    inst.save = async function () { return this; };
    payments.push(inst);
    return inst;
  };
  Payment._store = payments;
  Payment.findOne = async (filter) => payments.find((p) => match(p, filter)) || null;
  Payment.find = async (filter) => payments.filter((p) => match(p, filter || {}));
  Payment.findOneAndUpdate = async (filter, update, opts) => {
    const p = payments.find((x) => match(x, filter));
    if (!p) return null;
    if (p.status !== 'pending' && p.status !== 'processing') return null;
    if (update.$set) Object.assign(p, update.$set);
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { p[k] = (p[k] || 0) + update.$inc[k]; });
    return p;
  };
  const Transaction = function (data) {
    const inst = { ...data, _id: data._id || `t${transactions.length + 1}` };
    inst.save = async function () { if (!transactions.includes(this)) transactions.push(this); return this; };
    return inst;
  };
  Transaction._store = transactions;
  Transaction.findOne = async (filter) => transactions.find((t) => match(t, filter)) || null;
  Transaction.find = (filter) => {
    const arr = transactions.filter((t) => match(t, filter || {}));
    arr.sort = () => arr;
    return arr;
  };
  const Wallet = function (data) { return { ...data, save: async function () { return this; } }; };
  Wallet._store = wallets;
  Wallet.findOne = async (filter) => wallets.find((w) => match(w, filter)) || null;
  Wallet.findOneAndUpdate = async (filter, update, opts) => {
    let w = wallets.find((x) => match(x, filter));
    if (!w) { w = { userId: filter.userId, balance: 0, smsBalance: 0 }; wallets.push(w); }
    if (filter.balance && filter.balance.$gte != null) { if ((w.balance || 0) < filter.balance.$gte) return null; }
    if (update.$inc) Object.keys(update.$inc).forEach((k) => { w[k] = (w[k] || 0) + update.$inc[k]; });
    if (update.$set) Object.assign(w, update.$set);
    return w;
  };
  return { payments, transactions, wallets, Payment, Transaction, Wallet };
}

test('reconcile dry run prints and changes nothing', async () => {
  const store = makeStore();
  const svc = new CallbackVerificationService({
    Payment: store.Payment, Transaction: store.Transaction, Wallet: store.Wallet,
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 10 }) },
    transferService: { checkTransactionStatus: async () => ({ success: true, status: 'success' }) },
    commissionService: { checkTransactionStatus: async () => ({ success: true, status: 'success' }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  new store.Payment({ clientReference: 'P1', userId: 'u1', amount: 10, status: 'pending', createdAt: new Date(Date.now() - 60 * 60 * 1000) });

  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  await reconcilePending({ apply: false, olderThanMinutes: 10, PaymentModel: store.Payment, TransactionModel: store.Transaction, WalletModel: store.Wallet, verificationService: svc });
  console.log = orig;

  assert.ok(logs.some((l) => l.includes('P1')));
  const payment = await store.Payment.findOne({ clientReference: 'P1' });
  assert.equal(payment.status, 'pending');
});

test('reconcile apply matches callback behaviour', async () => {
  const store = makeStore();
  const svc = new CallbackVerificationService({
    Payment: store.Payment, Transaction: store.Transaction, Wallet: store.Wallet,
    paymentService: { checkTransactionStatus: async () => ({ status: 'paid', amount: 10, transactionId: 'HTX', paymentMethod: 'momo' }) },
    transferService: { checkTransactionStatus: async () => ({ success: true, status: 'success' }) },
    commissionService: { checkTransactionStatus: async () => ({ success: true, status: 'success' }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  new store.Payment({ clientReference: 'P2', userId: 'u1', amount: 10, status: 'pending', createdAt: new Date(Date.now() - 60 * 60 * 1000) });

  let done = false;
  store.Payment.findOneAndUpdate = async (filter, update, opts) => {
    const p = store.payments.find((x) => x.clientReference === filter.clientReference);
    if (!p || (p.status !== 'pending' && p.status !== 'processing')) return null;
    if (done) return null;
    done = true;
    p.status = 'paid';
    if (update.$set) Object.assign(p, update.$set);
    return p;
  };

  const orig = console.log;
  console.log = () => {};
  await reconcilePending({ apply: true, olderThanMinutes: 10, PaymentModel: store.Payment, TransactionModel: store.Transaction, WalletModel: store.Wallet, verificationService: svc });
  console.log = orig;

  const payment = await store.Payment.findOne({ clientReference: 'P2' });
  assert.equal(payment.status, 'paid');
});

test('audit flags credit whose provider status is unpaid', async () => {
  const store = makeStore();
  const svc = new CallbackVerificationService({
    Payment: store.Payment, Transaction: store.Transaction, Wallet: store.Wallet,
    paymentService: { checkTransactionStatus: async () => ({ status: 'pending', amount: 10 }) },
    transferService: { checkTransactionStatus: async () => ({ success: true, status: 'success' }) },
    commissionService: { checkTransactionStatus: async () => ({ success: true, status: 'success' }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const tx = new store.Transaction({ reference: 'PAYMENT-P3', userId: 'u1', amount: 10, type: 'credit', createdAt: new Date() });
  await tx.save();

  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  await auditWalletCredits({ checkHubtel: true, days: 90, TransactionModel: store.Transaction, verificationService: svc, paymentService: svc.paymentService });
  console.log = orig;

  assert.ok(logs.some((l) => l.includes('FLAG') && l.includes('P3')));
});
