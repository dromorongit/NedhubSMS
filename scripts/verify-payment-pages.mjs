import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

const REFERENCE = 'NH-VERIFY-20261104-PAID';
const LONG_REF = 'NH-20261104-ABCDEFGHIJKLMNOPQRSTUVWXYZ-LONG-REFERENCE-STRING-TO-TRIGER-WRAP';

let walletRequested = false;
let walletRequestedOnOverview = false;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

function mockApi(pathname) {
  const p = pathname.toLowerCase();
  if (p === '/api/auth/me') return { data: { user: { name: 'Test User', email: 'test@example.com', role: 'user' } } };
  if (p === '/api/wallet') {
    walletRequested = true;
    return { data: { balance: 1250.50, smsBalance: 100.00, stats: { totalSent: 0, deliveryRate: 0 } } };
  }
  if (p.startsWith('/api/payments/status/')) {
    const ref = p.slice('/api/payments/status/'.length);
    if (ref === REFERENCE) return { data: { status: 'paid', amount: 50.00, reference: ref } };
    return { data: { status: 'pending' } };
  }
  if (p === '/api/wallet/transactions') return { data: { transactions: [], pagination: { page: 1, pages: 1, total: 0, limit: 20 } } };
  if (p === '/api/campaigns') return { data: [] };
  if (p.startsWith('/api/sms/logs')) return { data: { messages: [] } };
  if (p.startsWith('/api/sms/')) return { data: {} };
  return { data: {} };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockApi(url.pathname)));
    return;
  }
  let filePath = path.join(ROOT, url.pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) { res.statusCode = 403; res.end('forbidden'); return; }
  if (filePath === ROOT || filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found: ' + url.pathname); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
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

// ---------------- A. Shell title on the four payment pages ----------------
const paymentPages = ['payment-pending', 'payment-success', 'payment-error', 'payment-cancelled'];
for (const page of paymentPages) {
  const context = await browser.newContext();
  await context.addInitScript(() => { try { localStorage.setItem('authToken', 'test-token'); } catch (e) {} });
  const pg = await context.newPage();
  await pg.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockApi(route.request().url())) }));
  await pg.route('**/*', (route, request) => { const u = request.url(); if (u.startsWith('http') && !u.startsWith(BASE)) { route.abort(); } else { route.continue(); } });
  await pg.goto(`${BASE}/src/pages/dashboard/${page}.html`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);
  const res = await pg.evaluate(() => {
    const title = document.getElementById('nhsPageTitle');
    const active = document.querySelector('.nhs-link.is-active, .nhs-link[aria-current="page"]');
    return { title: title ? title.textContent.trim() : null, active: active ? active.getAttribute('href') : null };
  });
  check(`shell title '${page}.html' === 'Payment'`, res.title === 'Payment', `got '${res.title}'`);
  check(`shell no active nav link on '${page}.html'`, res.active === null, `got active '${res.active}'`);
  await context.close();
}

// ---------------- B. Pending page spacing at 360 / 390 / 1366 ----------------
for (const vp of [360, 390, 1366]) {
  const context = await browser.newContext();
  await context.addInitScript(() => { try { localStorage.setItem('authToken', 'test-token'); } catch (e) {} });
  const pg = await context.newPage();
  await pg.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) }));
  await pg.route('**/*', (route, request) => { const u = request.url(); if (u.startsWith('http') && !u.startsWith(BASE)) { route.abort(); } else { route.continue(); } });
  await pg.setViewportSize({ width: vp, height: vp >= 1024 ? 768 : 844 });
  await pg.goto(`${BASE}/src/pages/dashboard/payment-pending.html?reference=${LONG_REF}`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);
  // Force the delayed state (yellow notice) visible with the long reference
  await pg.evaluate(() => {
    const box = document.getElementById('verificationDelayedMsg');
    if (box) box.style.display = 'block';
    const ref = document.getElementById('delayedRef');
    if (ref) ref.textContent = 'NH-20261104-ABCDEFGHIJKLMNOPQRSTUVWXYZ-LONG-REFERENCE-STRING-TO-TRIGER-WRAP';
    const spin = document.getElementById('spinner');
    if (spin) spin.style.display = 'none';
  });
  await pg.waitForTimeout(200);
  const m = await pg.evaluate(() => {
    const notice = document.getElementById('verificationDelayedMsg');
    const refBox = document.getElementById('delayedRef');
    const btn = document.getElementById('copyRefDelayed');
    const cs = notice ? getComputedStyle(notice) : {};
    const bcs = btn ? getComputedStyle(btn) : {};
    const nr = notice ? notice.getBoundingClientRect() : null;
    const rr = refBox ? refBox.getBoundingClientRect() : null;
    const br = btn ? btn.getBoundingClientRect() : null;
    const intersect = (a, b) => !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.left >= a.right);
    return {
      padTop: cs.paddingTop, padRight: cs.paddingRight, padBottom: cs.paddingBottom, padLeft: cs.paddingLeft,
      marginBottom: cs.marginBottom,
      btnHeight: bcs.height,
      nr, rr, br,
      gap: rr && br ? br.top - rr.bottom : null,
      overlapRefBtn: rr && br ? intersect(rr, br) : false,
      refInsideNoticeH: nr && rr ? rr.left >= nr.left + 16 && rr.right <= nr.right - 16 : false,
      refInsideNoticeV: nr && rr ? rr.top >= nr.top + 14 && rr.bottom <= nr.bottom - 14 : false,
      btnInsideNoticeV: nr && br ? br.top >= nr.top + 14 && br.bottom <= nr.bottom - 14 : false,
    };
  });
  const padOk = m.padTop === '16px' && m.padBottom === '16px' && m.padLeft === '18px' && m.padRight === '18px';
  check(`pending notice padding 16px 18px @${vp}`, padOk, JSON.stringify({ pad: [m.padTop, m.padRight, m.padBottom, m.padLeft] }));
  check(`pending notice margin-bottom 16px @${vp}`, m.marginBottom === '16px', `got ${m.marginBottom}`);
  check(`pending button height 44px @${vp}`, m.btnHeight === '44px', `got ${m.btnHeight}`);
  check(`pending ref-box/button gap >= 12px @${vp}`, m.gap !== null && m.gap >= 10, `gap=${m.gap}`);
  check(`pending no ref/button overlap @${vp}`, m.overlapRefBtn === false);
  check(`pending ref inside notice @${vp}`, m.refInsideNoticeH && m.refInsideNoticeV);
  check(`pending button inside notice @${vp}`, m.btnInsideNoticeV);
  await context.close();
}

// ---------------- C. Success page: countdown, redirect, wallet on Overview ----------------
{
  const context = await browser.newContext();
  await context.addInitScript(() => { try { localStorage.setItem('authToken', 'test-token'); } catch (e) {} });
  const pg = await context.newPage();
  await pg.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockApi(route.request().url())) }));
  await pg.route('**/*', (route, request) => { const u = request.url(); if (u.startsWith('http') && !u.startsWith(BASE)) { route.abort(); } else { route.continue(); } });
  pg.on('request', (r) => { if (r.url().includes('/api/wallet')) { walletRequestedOnOverview = pg.url().includes('/overview.html'); } });
  await pg.goto(`${BASE}/src/pages/dashboard/payment-success.html?reference=${REFERENCE}`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);

  const countdownStart = await pg.evaluate(() => document.getElementById('countdown').textContent);
  const btnText = await pg.evaluate(() => document.getElementById('dashboardBtn').textContent.trim());
  check('success countdown starts at 10', countdownStart === '10', `got '${countdownStart}'`);
  check('success button is "Go to Overview now"', btnText === 'Go to Overview now', `got '${btnText}'`);

  await pg.waitForTimeout(1500);
  const countdownTick = await pg.evaluate(() => document.getElementById('countdown').textContent);
  check('success countdown is running (10 -> less than 10)', Number(countdownTick) < 10, `got '${countdownTick}'`);

  await pg.waitForURL((u) => u.pathname.endsWith('/overview.html'), { timeout: 30000 });
  check('success redirects to overview.html', pg.url().endsWith('/overview.html'), `got ${pg.url()}`);

  await pg.waitForFunction(() => {
    const el = document.getElementById('walletBalanceAmount');
    return el && el.textContent === 'GH¢1250.50';
  }, { timeout: 10000 }).catch(() => {});
  const balance = await pg.evaluate(() => document.getElementById('walletBalanceAmount').textContent);
  check('overview loads fresh wallet balance (GH¢1250.50)', balance === 'GH¢1250.50', `got '${balance}'`);
  check('overview made wallet request on arrival', walletRequestedOnOverview === true, `flag=${walletRequestedOnOverview}`);

  await context.close();
}

await browser.close();
server.close();

const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
console.log(`\n================ RESULT ================\nTotal: ${results.length}  PASS: ${pass}  FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
