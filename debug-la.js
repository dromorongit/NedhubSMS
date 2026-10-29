const mongoose = require('mongoose');
(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(mongod.getUri());
  const schema = new mongoose.Schema({
    email: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now, expires: 1800 }
  }, { collection: 'loginAttempts' });
  schema.index({ email: 1, createdAt: -1 });
  const M = mongoose.model('LoginAttemptProbe', schema);
  const t0 = Date.now();
  try {
    await Promise.race([M.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG init')), 20000))]);
    console.log('LoginAttemptProbe.init OK in', Date.now() - t0, 'ms');
  } catch (e) { console.log('LoginAttemptProbe.init FAILED:', e.message, 'after', Date.now() - t0, 'ms'); }
  await mongoose.disconnect();
  await mongod.stop();
  console.log('DONE');
})().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
