const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('../backend/node_modules/mongoose');
const express = require('express');
const http = require('http');

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

let MongoMemoryServer;
try { MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer; } catch (e) { MongoMemoryServer = null; }

if (!MongoMemoryServer) {
  test.skip('wallet data bundle accounting: SKIPPED - mongodb-memory-server missing', () => {});
  return;
}

const { generateToken } = require('../backend/utils/auth');
const HubtelTransferService = require('../backend/services/HubtelTransferService');

async function startDb(t) {
  if (process.env.TEST_MONGODB_URI) {
    try {
      await mongoose.connect(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
      await mongoose.connection.asPromise();
      await mongoose.connection.db.admin().ping();
      return { mongod: null, uri: process.env.TEST_MONGODB_URI };
    } catch (err) {
      t.skip(`SKIPPED - test DB unavailable (${err.message})`);
      return null;
    }
  }
  if (!MongoMemoryServer) {
    t.skip('SKIPPED - mongodb-memory-server missing and TEST_MONGODB_URI not set');
    return null;
  }
  let mongod;
  try {
    mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
    const uri = mongod.getUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 60000 });
    await mongoose.connection.asPromise();
    await mongoose.connection.db.admin().ping();
    return { mongod, uri };
  } catch (err) {
    if (mongod) try { if (mongod) await mongod.stop(); } catch (_) {}
    try { await mongoose.disconnect(); } catch (_) {}
    t.skip(`SKIPPED - mongod unavailable (${err.message})`);
    return null;
  }
}

function makeApp() {
  const app = express();
  app.use(express.json());
  const transferRoutes = require('../backend/routes/transfers');
  app.use('/api/transfer', transferRoutes);
  return app;
}

function request(server, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('wallet data bundle accounting: insufficient balance rejected with no debit', async (t) => {
  const env = await startDb(t);
  if (!env) return;
  const { mongod } = env;
  try {
    const User = require('../backend/models/User');
    const Wallet = require('../backend/models/Wallet');
    const Transaction = require('../backend/models/Transaction');
    await User.deleteMany({}); await Wallet.deleteMany({}); await Transaction.deleteMany({});
    const user = await new User({ name: 'U', email: 'u@test.com', phone: '0240000000', password: 'password123', status: 'active' }).save();
    await new Wallet({ userId: user._id, balance: 1, smsBalance: 0 }).save();
    const token = generateToken(user._id.toString(), 'user');

    HubtelTransferService.buyAirtime = async () => ({ success: true, status: 'success' });
    const app = makeApp();
    const server = app.listen(0);
    await new Promise((r) => server.on('listening', r));
    const res = await request(server, 'POST', '/api/transfer/airtime', token, { phoneNumber: '0241234567', network: 'MTN', amount: 5 });
    await new Promise((r) => server.close(r));
    assert.equal(res.status, 400);
    const wallet = await Wallet.findOne({ userId: user._id });
    assert.equal(wallet.balance, 1);
    const txns = await Transaction.find({ userId: user._id });
    assert.equal(txns.length, 0);
  } finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});

test('wallet data bundle accounting: successful airtime debits once and stays pending_confirmation', async (t) => {
  const env = await startDb(t);
  if (!env) return;
  const { mongod } = env;
  try {
    const User = require('../backend/models/User');
    const Wallet = require('../backend/models/Wallet');
    const Transaction = require('../backend/models/Transaction');
    await User.deleteMany({}); await Wallet.deleteMany({}); await Transaction.deleteMany({});
    const user = await new User({ name: 'U', email: 'u2@test.com', phone: '0240000000', password: 'password123', status: 'active' }).save();
    await new Wallet({ userId: user._id, balance: 10, smsBalance: 0 }).save();
    const token = generateToken(user._id.toString(), 'user');

    HubtelTransferService.buyAirtime = async () => ({ success: true, status: 'success' });
    const app = makeApp();
    const server = app.listen(0);
    await new Promise((r) => server.on('listening', r));
    const res = await request(server, 'POST', '/api/transfer/airtime', token, { phoneNumber: '0241234567', network: 'MTN', amount: 5 });
    await new Promise((r) => server.close(r));
    assert.equal(res.status, 200);
    const wallet = await Wallet.findOne({ userId: user._id });
    assert.equal(wallet.balance, 5);
    const tx = await Transaction.findOne({ userId: user._id });
    assert.equal(tx.status, 'pending_confirmation');
    assert.equal(tx.balanceBefore, 10);
    assert.equal(tx.balanceAfter, 5);
  } finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});

test('wallet data bundle accounting: provider failure refunds once and marks failed', async (t) => {
  const env = await startDb(t);
  if (!env) return;
  const { mongod } = env;
  try {
    const User = require('../backend/models/User');
    const Wallet = require('../backend/models/Wallet');
    const Transaction = require('../backend/models/Transaction');
    await User.deleteMany({}); await Wallet.deleteMany({}); await Transaction.deleteMany({});
    const user = await new User({ name: 'U', email: 'u3@test.com', phone: '0240000000', password: 'password123', status: 'active' }).save();
    await new Wallet({ userId: user._id, balance: 10, smsBalance: 0 }).save();
    const token = generateToken(user._id.toString(), 'user');

    HubtelTransferService.buyAirtime = async () => { throw new Error('provider failed'); };
    const app = makeApp();
    const server = app.listen(0);
    await new Promise((r) => server.on('listening', r));
    const res = await request(server, 'POST', '/api/transfer/airtime', token, { phoneNumber: '0241234567', network: 'MTN', amount: 5 });
    await new Promise((r) => server.close(r));
    assert.equal(res.status, 400);
    const wallet = await Wallet.findOne({ userId: user._id });
    assert.equal(wallet.balance, 10);
    const debitTx = await Transaction.findOne({ userId: user._id, type: 'debit' });
    assert.equal(debitTx.status, 'failed');
    const refundTx = await Transaction.findOne({ userId: user._id, type: 'credit' });
    assert.ok(refundTx);
    assert.equal(refundTx.status, 'completed');
  } finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});

test('wallet data bundle accounting: two simultaneous purchases only one succeeds', async (t) => {
  const env = await startDb(t);
  if (!env) return;
  const { mongod } = env;
  try {
    const User = require('../backend/models/User');
    const Wallet = require('../backend/models/Wallet');
    const Transaction = require('../backend/models/Transaction');
    await User.deleteMany({}); await Wallet.deleteMany({}); await Transaction.deleteMany({});
    const user = await new User({ name: 'U', email: 'u4@test.com', phone: '0240000000', password: 'password123', status: 'active' }).save();
    await new Wallet({ userId: user._id, balance: 5, smsBalance: 0 }).save();
    const token = generateToken(user._id.toString(), 'user');

    HubtelTransferService.buyAirtime = async () => ({ success: true, status: 'success' });
    const app = makeApp();
    const server = app.listen(0);
    await new Promise((r) => server.on('listening', r));
    const [r1, r2] = await Promise.all([
      request(server, 'POST', '/api/transfer/airtime', token, { phoneNumber: '0241234567', network: 'MTN', amount: 5 }),
      request(server, 'POST', '/api/transfer/airtime', token, { phoneNumber: '0241234567', network: 'MTN', amount: 5 })
    ]);
    await new Promise((r) => server.close(r));
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 400]);
    const wallet = await Wallet.findOne({ userId: user._id });
    assert.equal(wallet.balance, 0);
    const txns = await Transaction.find({ userId: user._id, type: 'debit' });
    assert.equal(txns.length, 1);
  } finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});

test('wallet data bundle accounting: data bundle success debits once', async (t) => {
  const env = await startDb(t);
  if (!env) return;
  const { mongod } = env;
  try {
    const User = require('../backend/models/User');
    const Wallet = require('../backend/models/Wallet');
    const Transaction = require('../backend/models/Transaction');
    await User.deleteMany({}); await Wallet.deleteMany({}); await Transaction.deleteMany({});
    const user = await new User({ name: 'U', email: 'u5@test.com', phone: '0240000000', password: 'password123', status: 'active' }).save();
    await new Wallet({ userId: user._id, balance: 10, smsBalance: 0 }).save();
    const token = generateToken(user._id.toString(), 'user');

    HubtelTransferService.buyData = async () => ({ success: true, status: 'success' });
    const app = makeApp();
    const server = app.listen(0);
    await new Promise((r) => server.on('listening', r));
    const res = await request(server, 'POST', '/api/transfer/data', token, { phoneNumber: '0241234567', network: 'MTN', bundleCode: 'MTN-10MB', price: 1.5 });
    await new Promise((r) => server.close(r));
    assert.equal(res.status, 200);
    const wallet = await Wallet.findOne({ userId: user._id });
    assert.equal(wallet.balance, 8.5);
    const tx = await Transaction.findOne({ userId: user._id, type: 'debit' });
    assert.equal(tx.status, 'pending_confirmation');
  } finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});

test('wallet data bundle accounting: top-up credits once and ends completed', async (t) => {
  const env = await startDb(t);
  if (!env) return;
  const { mongod } = env;
  try {
    const CallbackVerificationService = require('../backend/services/callbackVerificationService');
    const Payment = require('../backend/models/Payment');
    const Transaction = require('../backend/models/Transaction');
    const Wallet = require('../backend/models/Wallet');
    await Payment.deleteMany({}); await Transaction.deleteMany({}); await Wallet.deleteMany({});
    const userId = new mongoose.Types.ObjectId();
    await new Wallet({ userId, balance: 1000, smsBalance: 0 }).save();
    await new Payment({ clientReference: 'TOPUP-1', userId, amount: 10, status: 'pending', description: 'top-up' }).save();

    const svc = new CallbackVerificationService({ Payment, Transaction, Wallet });
    svc.paymentService = { checkTransactionStatus: async () => ({ status: 'paid', amount: 10, transactionId: 'HTX', paymentMethod: 'momo', message: 'ok' }) };
    // callbackVerificationService uses this.checkProviderStatus; set it
    svc.checkProviderStatus = async () => ({ ok: true, status: 'paid', amount: 10, transactionId: 'HTX', paymentMethod: 'momo', message: 'ok' });

    const r = await svc.processPaymentCallback('TOPUP-1');
    assert.equal(r.action, 'credit');
    const wallet = await Wallet.findOne({ userId });
    assert.equal(wallet.balance, 1010);
    const tx = await Transaction.findOne({ reference: 'PAYMENT-TOPUP-1' });
    assert.equal(tx.status, 'completed');
  } finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});
