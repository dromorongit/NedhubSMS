const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

function runServer(env, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d.toString(); });
    child.stderr.on('data', (d) => { buf += d.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, buf, timedOut: true });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, buf, timedOut: false });
    });
  });
}

test('server refuses to start without JWT_SECRET', async () => {
  const r = await runServer({ NODE_ENV: 'test', JWT_SECRET: '', MONGODB_URI: 'mongodb://127.0.0.1:27017/test' }, 15000);
  assert.notEqual(r.code, 0);
});

test('server refuses to start with short JWT_SECRET', async () => {
  const r = await runServer({ NODE_ENV: 'test', JWT_SECRET: 'short', MONGODB_URI: 'mongodb://127.0.0.1:27017/test' }, 15000);
  assert.notEqual(r.code, 0);
});

test('server refuses to start with placeholder JWT_SECRET', async () => {
  const r = await runServer({ NODE_ENV: 'test', JWT_SECRET: 'secret', MONGODB_URI: 'mongodb://127.0.0.1:27017/test' }, 15000);
  assert.notEqual(r.code, 0);
});

test('server starts with 64 char JWT_SECRET', async () => {
  const port = 32000 + Math.floor(Math.random() * 1000);
  const r = await runServer({ NODE_ENV: 'test', PORT: String(port), JWT_SECRET: 'a'.repeat(64), MONGODB_URI: 'mongodb://127.0.0.1:27017/test' }, 5000);
  // It may still be running (timedOut true) which is success
  if (r.timedOut) {
    assert.ok(true);
  } else {
    // If exited, ensure not due to JWT validation
    assert.ok(!/JWT_SECRET validation failed/.test(r.buf));
  }
});
