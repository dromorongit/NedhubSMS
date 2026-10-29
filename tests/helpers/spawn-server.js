const { spawn } = require('child_process');
const http = require('http');

/**
 * Spins up the real server (server/index.js) against an unreachable MongoDB
 * URI. Mongoose connection attempts fail fast and are retried in the
 * background without blocking the event loop, so auth rate limiting and
 * lockout fall back to their in-memory stores deterministically. The routes
 * exercised by these tests never touch the User model, so the absence of a
 * database does not affect them. No live database is used in tests.
 */
async function spawnServer(extraEnv = {}, opts = {}) {
  const port = opts.port || 40000 + Math.floor(Math.random() * 9000);
  const env = {
    ...process.env,
    NODE_ENV: extraEnv.NODE_ENV || 'test',
    PORT: String(port),
    JWT_SECRET: extraEnv.JWT_SECRET || 'a'.repeat(64),
    MONGODB_URI: extraEnv.MONGODB_URI || 'mongodb://localhost:1/test',
    AUTH_RATE_LIMIT_MAX: extraEnv.AUTH_RATE_LIMIT_MAX === undefined ? '5' : String(extraEnv.AUTH_RATE_LIMIT_MAX),
    AUTH_RATE_LIMIT_WINDOW_MS: '900000',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379'
  };

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let buf = '';
  child.stdout.on('data', (d) => { buf += d.toString(); });
  child.stderr.on('data', (d) => { buf += d.toString(); });

  const baseUrl = `http://localhost:${port}`;

  const deadline = Date.now() + (opts.timeoutMs || 120000);
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error('Server process exited early: ' + (child.exitCode ?? 'unknown') + '\n' + buf);
    }
    try {
      await request(baseUrl, 'GET', '/healthz', null, 2000);
      ready = true;
      break;
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  if (!ready) {
    child.kill();
    throw new Error('Server did not become ready on port ' + port + '\n' + buf);
  }

  async function stop() {
    try { child.kill(); } catch (_) {}
  }

  return { baseUrl, port, stop, get logs() { return buf; } };
}

function request(baseUrl, method, path, body, extraHeaders = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body === undefined || body === null ? null : JSON.stringify(body);
    const headers = { accept: 'application/json', ...extraHeaders };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = data && data.trim() ? JSON.parse(data) : {}; } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, text: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { spawnServer, request };
