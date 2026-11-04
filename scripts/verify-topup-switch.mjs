import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  let filePath = path.join(ROOT, url.pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) { res.statusCode = 403; res.end('forbidden'); return; }
  if (filePath === ROOT || filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(PORT, resolve));

const results = [];
function check(label, ok, extra = '') {
  results.push({ label, ok, extra });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}` + (ok || !extra ? '' : '\n      ' + extra));
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function checkDisabledState(viewport, topupStatusBody) {
  const context = await browser.newContext();
  await context.addInitScript(() => { try { localStorage.setItem('authToken', 'test-token'); } catch (e) {} });
  const pg = await context.newPage();

  // Mock every /api/** call so the page never depends on a real backend.
  await pg.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/wallet/topup-status')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(topupStatusBody) });
    }
    if (url.endsWith('/api/wallet/transactions')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { transactions: [], pagination: { page: 1, pages: 1, total: 0, limit: 20 } } }) });
    }
    if (url.endsWith('/api/wallet')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { balance: 250, availableBalance: 250, smsBalance: 250, reservedAmount: 0, currency: 'GHS', stats: { totalSent: 0, totalDelivered: 0, totalFailed: 0, deliveryRate: 0 } } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await pg.setViewportSize(viewport);
  await pg.goto(`${BASE}/src/pages/dashboard/overview.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);

  const btn = '#topupButton';
  const notice = '#topupsPausedNotice';

  const disabled = await pg.evaluate((s) => {
    const b = document.querySelector(s);
    return b ? b.disabled : null;
  }, btn);
  const text = await pg.evaluate((s) => {
    const b = document.querySelector(s);
    return b ? b.textContent.trim() : null;
  }, btn);
  const noticeVisible = await pg.evaluate((s) => {
    const n = document.querySelector(s);
    return n ? !n.classList.contains('ov-topups-paused-banner--hidden') : null;
  }, notice);

  const expectedDisabled = topupStatusBody.enabled === false;
  const label = `${viewport.width}x${viewport.height} topups-enabled=${topupStatusBody.enabled}`;
  check(`${label} Top Up button disabled=${expectedDisabled}`, disabled === expectedDisabled, `got disabled=${disabled}`);
  check(`${label} button labelled 'Top-ups paused' when paused`, expectedDisabled ? text === 'Top-ups paused' : text !== 'Top-ups paused', `got '${text}'`);
  check(`${label} pause banner visible=${expectedDisabled}`, noticeVisible === expectedDisabled, `got visible=${noticeVisible}`);

  await context.close();
}

// Disabled state at 390 and 1366 (required by the task).
await checkDisabledState({ width: 390, height: 844 }, { enabled: false });
await checkDisabledState({ width: 1366, height: 768 }, { enabled: false });

// Enabled state sanity check at 1366 (button enabled, banner hidden).
await checkDisabledState({ width: 1366, height: 768 }, { enabled: true });

await browser.close();
server.close();

const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
console.log(`\n================ RESULT ================\nTotal: ${results.length}  PASS: ${pass}  FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
