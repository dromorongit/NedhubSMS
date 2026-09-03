require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const SmsMessage = mongoose.model('SmsMessage', new mongoose.Schema({}, { strict: false }));
  const messages = await SmsMessage.find({ userId: new mongoose.Types.ObjectId('6a9918f6b38235b899051483') })
    .sort({ createdAt: -1 })
    .limit(10);
  
  console.log('Recent SmsMessages for test user:', messages.length);
  messages.forEach(m => {
    console.log(JSON.stringify({
      id: m._id,
      phoneNumber: m.phoneNumber,
      status: m.status,
      errorCode: m.errorCode,
      errorMessage: m.errorMessage,
      totalChargedToUser: m.totalChargedToUser,
      totalCostToProvider: m.totalCostToProvider,
      profitAmount: m.profitAmount,
      createdAt: m.createdAt
    }));
  });
  
  await mongoose.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
