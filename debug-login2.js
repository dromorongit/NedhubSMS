(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '49989';
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.MONGODB_URI = 'mongodb://localhost:1/test';
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = '6379';

  const { spawn } = require('child_process');
  const http = require('http');
  const child = spawn(process.execPath, ['server/index.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let buf = '';
  child.stdout.on('data', d => buf += d.toString());
  child.stderr.on('data', d => buf += d.toString());

  const baseUrl = 'http://127.0.0.1:49989';
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      await new Promise((res, rej) => {
        const req = http.get(baseUrl + '/healthz', (response) => { response.resume(); response.on('end', () => res(response.statusCode === 200)); });
        req.on('error', rej);
        req.setTimeout(2000, () => req.destroy(new Error('tmo')));
      });
      ready = true;
    } catch (e) {}
  }
  console.log('ready:', ready, 'at', Date.now());

  function req(method, path, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const payload = body ? JSON.stringify(body) : null;
      const headers = { accept: 'application/json' };
      if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
      const rq = http.request(url, { method, headers }, (response) => { let d = ''; response.on('data', c => d += c); response.on('end', () => resolve({ status: response.statusCode, body: d })); });
      rq.on('error', reject);
      rq.setTimeout(timeoutMs || 8000, () => rq.destroy(new Error('tmo')));
      if (payload) rq.write(payload);
      rq.end();
    });
  }

  console.log('--- GET /healthz ---');
  console.log(await req('GET', '/healthz', null, 5000));
  console.log('--- POST /api/auth/login {password} ---');
  try { console.log(await req('POST', '/api/auth/login', { password: 'x' }, 8000)); }
  catch (e) { console.log('login tmo/err:', e.message); }
  console.log('--- POST /api/auth/login again ---');
  try { console.log(await req('POST', '/api/auth/login', { password: 'x' }, 8000)); }
  catch (e) { console.log('login2 tmo/err:', e.message); }

  child.kill();
  console.log('SERVER LOG:\n' + buf);
  process.exit(0);
})();
