const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const http = require('http');

function request(baseUrl, method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: 'application/json' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    const req = http.request(url, { method, headers }, (res) => { let d=''; res.on('data', c => d+=c); res.on('end', () => resolve({status: res.statusCode, body: d})); });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, () => req.destroy(new Error('tmo')));
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  const uri = mongod.getUri();
  const port = 49994;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), JWT_SECRET: 'a'.repeat(64), MONGODB_URI: uri, REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => process.stdout.write('[srv] ' + d));
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { await request('http://127.0.0.1:' + port, 'GET', '/healthz'); ready = true; } catch (e) {}
  }
  console.log('healthz ready:', ready);
  await new Promise(r => setTimeout(r, 15000));
  console.log('--- GET /api/auth/login ---');
  try { console.log(await request('http://127.0.0.1:' + port, 'GET', '/api/auth/login', null, 8000)); }
  catch (e) { console.log('GET login failed:', e.message); }
  console.log('--- POST /api/auth/login {} ---');
  try { console.log(await request('http://127.0.0.1:' + port, 'POST', '/api/auth/login', {}, 8000)); }
  catch (e) { console.log('POST login failed:', e.message); }
  child.kill();
  await mongod.stop().catch(() => {});
  process.exit(0);
})();
