const { spawn } = require('child_process');
const http = require('http');

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', PORT: '49992', JWT_SECRET: 'a'.repeat(64), MONGODB_URI: 'mongodb://localhost:1/test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let buf = '';
child.stdout.on('data', d => buf += d.toString());
child.stderr.on('data', d => buf += d.toString());

function get(path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:49992' + path, (res) => { let d=''; res.on('data', c => d += c); res.on('end', () => resolve({status: res.statusCode, body: d})); });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 5000, () => req.destroy(new Error('tmo')));
  });
}

(async () => {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { await get('/healthz', 2000); ready = true; } catch (e) {}
  }
  console.log('healthz ready:', ready);
  if (ready) {
    try { console.log('login:', JSON.stringify(await get('/api/auth/login', 2000))); } catch (e) { console.log('login error:', e.message); }
  }
  child.kill();
  console.log('LOGTAIL:\n' + buf.slice(-2000));
})();
