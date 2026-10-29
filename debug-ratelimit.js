const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const http = require('http');

function request(baseUrl, method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: 'application/json' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    const req = http.request(url, { method, headers }, (res) => { let d=''; res.on('data', c => d+=c); res.on('end', () => resolve({status: res.statusCode, body: d, headers: res.headers})); });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 10000, () => req.destroy(new Error('tmo')));
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  const uri = mongod.getUri();
  const port = 49995;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), JWT_SECRET: 'a'.repeat(64), MONGODB_URI: uri, REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  const baseUrl = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { await request(baseUrl, 'GET', '/healthz'); ready = true; } catch (e) {}
  }
  console.log('healthz ready:', ready);
  await new Promise(r => setTimeout(r, 20000)); // warm up inits
  console.log('warmed up');
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    try {
      const r = await request(baseUrl, 'POST', '/api/auth/login', { password: 'x' }, 8000);
      console.log(`attempt ${i+1}: ${r.status} in ${Date.now()-t0}ms ${JSON.stringify(r.body).slice(0,80)}`);
    } catch (e) {
      console.log(`attempt ${i+1}: FAILED ${e.message} after ${Date.now()-t0}ms`);
    }
  }
  child.kill();
  await mongod.stop().catch(() => {});
  process.exit(0);
})();
