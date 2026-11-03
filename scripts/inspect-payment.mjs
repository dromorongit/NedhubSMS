import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load existing server config (.env) without printing values.
try { require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') }); } catch (e) {}

const { connectDB, disconnectDB } = require(path.join(ROOT, 'backend', 'utils', 'database.js'));
const Payment = require(path.join(ROOT, 'backend', 'models', 'Payment.js'));
const Wallet = require(path.join(ROOT, 'backend', 'models', 'Wallet.js'));
const HubtelPaymentService = require(path.join(ROOT, 'backend', 'services', 'HubtelPaymentService.js'));

const ref = process.argv[2];
if (!ref) {
  console.error('Usage: node scripts/inspect-payment.mjs <reference>');
  process.exit(1);
}

function safeDoc(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : { ...doc };
  // Avoid printing any nested secrets; only known fields remain.
  return o;
}

async function main() {
  await connectDB();
  try {
    const payment = await Payment.findOne({ clientReference: ref }) || await Payment.findOne({ hubtelCheckoutId: ref });
    console.log('=== TRANSACTION DOCUMENT ===');
    console.log(JSON.stringify(safeDoc(payment), null, 2));

    if (payment && payment.userId) {
      const wallet = await Wallet.findOne({ userId: payment.userId });
      console.log('=== WALLET BALANCE ===');
      console.log(JSON.stringify({ userId: payment.userId, balance: wallet ? wallet.balance : null, smsBalance: wallet ? wallet.smsBalance : null }, null, 2));
    }

    console.log('=== PROVIDER VERIFY (GET) ===');
    const svc = new HubtelPaymentService();
    try {
      const result = await svc.checkTransactionStatus(ref);
      console.log(JSON.stringify({
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        transactionId: result.transactionId,
        paid_at: result.paidAt || null,
        message: result.message
      }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    }
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
