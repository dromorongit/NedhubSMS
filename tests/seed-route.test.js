const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

test('no /api/seed route returns 404 for any method', async () => {
  const port = 31000 + Math.floor(Math.random() * 1000);
  const secret = 'a'.repeat(64);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), JWT_SECRET: secret, NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve, reject) => {
    let buf = '';
    let timer;
    const onData = (d) => {
      buf += d.toString();
      if (buf.includes('Server listening')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    timer = setTimeout(() => reject(new Error('server did not start: ' + buf)), 30000);
    child.on('exit', (code) => {
      if (!buf.includes('Server listening')) {
        clearTimeout(timer);
        reject(new Error('exited ' + code + ' ' + buf));
      }
    });
  });

  try {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`http://127.0.0.1:${port}/api/seed/admin`, { method });
      assert.equal(res.status, 404, method);
    }
  } finally {
    child.kill();
  }
});
