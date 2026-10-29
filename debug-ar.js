const mongoose = require('mongoose');
(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(mongod.getUri());
  console.log('connected');
  const schema = new mongoose.Schema({ key: String, count: Number, windowStart: Date, expiresAt: Date }, { collection: 'authRateLimits' });
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  let M;
  try { M = mongoose.model('AuthRateLimit'); } catch { M = mongoose.model('AuthRateLimit', schema); }
  const t0 = Date.now();
  try {
    const r = await Promise.race([M.findOneAndUpdate(
      { key: 'ip:test', windowStart: { $gte: Date.now() - 900000 } },
      { $inc: { count: 1 }, $set: { expiresAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG')), 8000))]);
    console.log('findOneAndUpdate OK in', Date.now() - t0, 'ms ->', r ? r.count : null);
  } catch (e) { console.log('findOneAndUpdate FAILED:', e.message, 'after', Date.now() - t0, 'ms'); }
  await mongoose.disconnect();
  await mongod.stop();
  console.log('DONE');
})().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
