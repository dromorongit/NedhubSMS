const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

let MongoMemoryServer;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
} catch (err) {
  MongoMemoryServer = null;
}

const NO_MMS = !MongoMemoryServer;

if (NO_MMS) {
  test.skip('callback concurrency real DB (payment): SKIPPED - mongodb-memory-server is not installed. Run "npm i -D mongodb-memory-server" locally to enable this test.', () => {});
  test.skip('callback concurrency real DB (airtime refund): SKIPPED - mongodb-memory-server is not installed. Run "npm i -D mongodb-memory-server" locally to enable this test.', () => {});
} else {
  test('callback concurrency real DB: five simultaneous valid payment callbacks -> exactly one wallet credit and exactly one Transaction', async () => {
    const mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    try {
      const Payment = require('../backend/models/Payment');
      const Transaction = require('../backend/models/Transaction');
      const Wallet = require('../backend/models/Wallet');
      const CallbackVerificationService = require('../backend/services/callbackVerificationService');

      await Payment.deleteMany({});
      await Transaction.deleteMany({});
      await Wallet.deleteMany({});

      const userId = new mongoose.Types.ObjectId();
      const clientReference = 'CONC-PAY-1';

      await new Wallet({ userId, balance: 1000, smsBalance: 0 }).save();
      await new Payment({ clientReference, userId, amount: 10, status: 'pending', description: 'top-up' }).save();

      const svc = new CallbackVerificationService({ Payment, Transaction, Wallet });
      svc.paymentService.checkTransactionStatus = async () => ({
        status: 'paid', amount: 10, transactionId: 'HTX', paymentMethod: 'momo', message: 'ok'
      });

      const results = await Promise.all(Array.from({ length: 5 }, () => svc.processPaymentCallback(clientReference)));

      const appliedCredits = results.filter((r) => r.action === 'credit' && r.applied === true);
      assert.equal(appliedCredits.length, 1, 'exactly one applied wallet credit');

      const txns = await Transaction.find({ reference: `PAYMENT-${clientReference}` });
      assert.equal(txns.length, 1, 'exactly one Transaction document');

      const wallet = await Wallet.findOne({ userId });
      assert.equal(wallet.balance, 1010, 'wallet credited exactly once (1000 + 10)');
    } finally {
      await mongoose.disconnect();
      await mongod.stop();
    }
  });

  test('callback concurrency real DB: duplicate airtime failure refund -> exactly one refund', async () => {
    const mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    try {
      const Transaction = require('../backend/models/Transaction');
      const Wallet = require('../backend/models/Wallet');
      const CallbackVerificationService = require('../backend/services/callbackVerificationService');

      await Transaction.deleteMany({});
      await Wallet.deleteMany({});

      const userId = new mongoose.Types.ObjectId();
      const reference = 'CONC-AIR-1';

      await new Wallet({ userId, balance: 1000, smsBalance: 0 }).save();
      // wallet debited at purchase time
      await Wallet.findOneAndUpdate({ userId }, { $inc: { balance: -5 } });
      await new Transaction({
        reference,
        userId,
        type: 'debit',
        amount: 5,
        status: 'pending_confirmation',
        balanceBefore: 1000,
        balanceAfter: 995,
        description: 'airtime purchase',
        metadata: { transactionType: 'AIRTIME_PURCHASE' }
      }).save();

      const svc = new CallbackVerificationService({ Transaction, Wallet });
      svc.transferService.checkTransactionStatus = async () => ({ success: true, status: 'failed' });

      const results = await Promise.all(Array.from({ length: 5 }, () => svc.processAirtimeCallback(reference)));

      const appliedRefunds = results.filter((r) => r.action === 'refund' && r.applied === true);
      assert.equal(appliedRefunds.length, 1, 'exactly one applied refund');

      const refundTxns = await Transaction.find({ reference: `REFUND-${reference}` });
      assert.equal(refundTxns.length, 1, 'exactly one refund Transaction document');

      const wallet = await Wallet.findOne({ userId });
      assert.equal(wallet.balance, 1000, 'wallet refunded exactly once (back to 1000)');
    } finally {
      await mongoose.disconnect();
      await mongod.stop();
    }
  });
}
