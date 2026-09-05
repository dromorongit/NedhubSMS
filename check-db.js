require('dotenv').config({ path: 'backend/.env' });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const User = require('./backend/models/User');
  const SmsMessage = require('./backend/models/SmsMessage');

  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ role: 'user', status: 'active' });
  const allSms = await SmsMessage.countDocuments();

  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const thisMonthSms = await SmsMessage.countDocuments({ createdAt: { $gte: start } });
  const successfulSms = await SmsMessage.countDocuments({
    status: { $in: ['sent', 'delivered'] },
    createdAt: { $gte: start }
  });

  console.log('Total users:', totalUsers);
  console.log('Active users (role=user, status=active):', activeUsers);
  console.log('Total SMS messages:', allSms);
  console.log('SMS messages this month:', thisMonthSms);
  console.log('Successful SMS this month:', successfulSms);

  if (activeUsers > 0) {
    const users = await User.find({ role: 'user', status: 'active' }).select('_id name email role status').lean();
    console.log('\nActive users detail:');
    for (const u of users) {
      console.log(JSON.stringify({ _id: u._id, name: u.name, email: u.email, role: u.role, status: u.status }));
    }
  } else {
    const anyUsers = await User.find({}).select('_id name email role status').limit(10).lean();
    console.log('\nAny users in DB (up to 10):');
    for (const u of anyUsers) {
      console.log(JSON.stringify({ _id: u._id, name: u.name, email: u.email, role: u.role, status: u.status }));
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
