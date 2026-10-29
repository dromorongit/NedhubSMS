(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '49990';
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.MONGODB_URI = 'mongodb://localhost:1/test';
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = '6379';

  const child = require('child_process').spawn(process.execPath, ['server/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });
  child.stdout.on('data', d => { if (/Server started/.test(d.toString())) console.log('[child] SERVER STARTED LOG'); });
  child.stderr.on('data', d => {});

  const http = require('http');
  let ready = false;
  const t0 = Date.now();
  for (let i = 0; i < 120 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await new Promise((res, rej) => {
        const req = http.get('http://127.0.0.1:49990/healthz', (response) => { response.resume(); response.on('end', () => res(response.statusCode === 200)); });
        req.on('error', rej);
        req.setTimeout(1500, () => req.destroy(new Error('tmo')));
      });
      ready = true;
    } catch (e) { /* keep polling */ }
  }
  console.log('healthz ready:', ready, 'in', Date.now() - t0, 'ms');
  child.kill();
  process.exit(0);
})();
