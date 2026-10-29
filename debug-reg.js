const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const http = require('http');

function req(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://127.0.0.1:' + PORT);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: 'application/json' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    const rq = http.request(url, { method, headers }, (res) => { let d=''; res.on('data', c => d+=c); res.on('end', () => resolve({status: res.statusCode, body: d})); });
    rq.on('error', reject);
    rq.setTimeout(timeoutMs || 8000, () => rq.destroy(new Error('tmo')));
    if (payload) rq.write(payload);
    rq.end();
  });
}

let PORT;
(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  PORT = 49987;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), JWT_SECRET: 'a'.repeat(64), MONGODB_URI: mongod.getUri(), REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => process.stdout.write('[srv] ' + d));
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { await req('GET', '/healthz'); ready = true; } catch (e) {}
  }
  console.log('healthz ready:', ready);
  await new Promise(r => setTimeout(r, 8000));
  console.log('--- register attempt 1 ---');
  try { console.log(await req('POST', '/api/auth/register', { name: 'X', email: 'dbready@example.com', phone: '0240000000', password: 'Str0ng!Passw0rd' }, 8000)); }
  catch (e) { console.log('register 1 failed:', e.message); }
  console.log('--- register attempt 2 ---');
  try { console.log(await req('POST', '/api/auth/register', { name: 'X', email: 'dbready@example.com', phone: '0240000000', password: 'Str0ng!Passw0rd' }, 8000)); }
  catch (e) { console.log('register 2 failed:', e.message); }
  child.kill();
  await mongod.stop().catch(() => {});
  process.exit(0);
})();
