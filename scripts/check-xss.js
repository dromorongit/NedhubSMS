// scripts/check-xss.js
//
// XSS regression test for the NedhubSMS frontend.
// Serves src/ AND a mock /api/** API on port 3000 (matching API_BASE_URL).
// Every mock string field carries an XSS payload. Loads every page and
// asserts no payload executes (window.__xss stays undefined and no
// payload-created img/svg elements appear in the DOM).
//
// Usage: node scripts/check-xss.js
//   SRC_DIR   - static root (default: <repo>/src)
//   PORT      - port (default 3000)
//   XSS_FILTER - comma list of labels to run (default all)
//   XSS_PAYLOAD_MODE=deterministic - use '<img src=x onerror=...>' everywhere
//
// Nothing is installed inside the repo; Playwright runs from the temp folder.

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(process.env.SRC_DIR || path.join(REPO_ROOT, 'src'));
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE = `http://localhost:${PORT}`;
const XSS_FILTER = process.env.XSS_FILTER ? process.env.XSS_FILTER.split(',').map(s => s.trim()).filter(Boolean) : null;

// XSS payloads injected into EVERY string field of the mock API data.
const PAYLOADS = [
  '<img src=x onerror=window.__xss=1>',
  '<script>window.__xss=1</script>',
  "' onmouseover='window.__xss=1",
  '\"><svg onload=window.__xss=1>'
];
function payload() {
  if (process.env.XSS_PAYLOAD_MODE === 'deterministic') return PAYLOADS[0];
  if (process.env.XSS_PAYLOAD_MODE === 'normal') {
    const normals = ["O'Brien", 'AT&T', 'He said "hi"', "D'Angelo & Co.", "it's fine", "50% off & free"];
    return normals[Math.floor(Math.random() * normals.length)];
  }
  return PAYLOADS[Math.floor(Math.random() * PAYLOADS.length)];
}

function mockPagination() { return { page: 1, pages: 1, total: 2, limit: 20 }; }
function mockUser() {
  return { _id: payload(), name: payload(), email: payload(), phone: payload(), role: 'admin', status: 'active', createdAt: payload() };
}
function mockTransaction() {
  return { _id: payload(), type: payload(), status: payload(), description: payload(), reference: payload(), amount: 123.45, createdAt: payload() };
}
function mockContact() {
  return { _id: payload(), recipientName: payload(), phoneNumber: payload(), groupName: payload(), createdAt: payload() };
}
function mockSenderId() {
  return { _id: payload(), senderId: payload(), status: payload(), remarks: payload(), documentName: payload(), createdAt: payload(), userId: { _id: payload(), name: payload(), email: payload() } };
}
function mockCampaign() {
  return { _id: payload(), name: payload(), title: payload(), senderId: payload(), status: payload(), messageBody: payload(), recipientsCount: 50, cost: 25.0, deliveredCount: 40, failedCount: 5, queuedCount: 5, estimatedCost: 25.0, actualCost: 25.0, createdAt: payload(), scheduledAt: payload(), sentAt: payload(), failedCount: 0 };
}
function mockMessage() {
  return { _id: payload(), message: payload(), senderId: payload(), recipient: payload(), status: payload(), source: 'new', createdAt: payload() };
}
function mockApiKey() {
  return { keyId: payload(), name: payload(), prefix: payload(), createdAt: payload(), lastUsedAt: payload(), revoked: false };
}
function mockBlacklist() {
  return { _id: payload(), phoneNumber: payload(), reason: payload(), source: payload(), createdAt: payload() };
}

function mockForPath(pathname) {
  let p = pathname.toLowerCase();
  if (p.startsWith('/api/')) p = p.slice(4); // strip /api prefix added by API_BASE_URL
  if (p === '/auth/verify') {
    return { data: { user: mockUser() }, error: null };
  }
  if (p === '/wallet/transactions') {
    return { data: { transactions: [mockTransaction(), mockTransaction()], pagination: mockPagination() }, error: null };
  }
  if (p === '/contacts') {
    return { data: [mockContact(), mockContact()], error: null };
  }
  if (p.startsWith('/admin/users')) {
    return { data: { users: [mockUser(), mockUser()] }, error: null };
  }
  if (p.startsWith('/admin/wallets')) {
    return { data: { wallets: [{ userId: mockUser(), balance: 100, frozen: false, updatedAt: payload(), _id: payload() }] }, error: null };
  }
  if (p.startsWith('/admin/sender-ids') && !p.includes('/document')) {
    return { data: { senderIds: [mockSenderId()] }, error: null };
  }
  if (p.startsWith('/admin/campaigns')) {
    return { data: { campaigns: [mockCampaign(), mockCampaign()] }, error: null };
  }
  if (p === '/admin/sms-traffic') {
    return { data: { totalVolume: 100, totalCost: 50.0 }, error: null };
  }
  if (p === '/admin/nalo/balance') {
    return { data: { balance: 100, currency: 'GHS' }, error: null };
  }
  return {
    data: { pagination: mockPagination(), user: mockUser(), transactions: [mockTransaction(), mockTransaction()], contacts: [mockContact(), mockContact()], senderIds: [mockSenderId()], campaigns: [mockCampaign(), mockCampaign()], messages: [mockMessage(), mockMessage()], apiKeys: [mockApiKey()], blacklist: [mockBlacklist()], wallets: [{ userId: mockUser(), balance: 100, frozen: false, updatedAt: payload(), _id: payload() }], token: payload(), newPassword: payload() },
    error: null
  };
}

// ---------------------------------------------------------------------------
// Static file server for src/ + mock /api/**
// ---------------------------------------------------------------------------
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockForPath(url.pathname)));
    return;
  }
  let filePath = path.join(SRC_DIR, url.pathname);
  if (filePath === SRC_DIR || filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Server (static + mock API) on ${BASE} from ${SRC_DIR}`);
});

// ---------------------------------------------------------------------------
// Playwright resolver (nothing installed inside the repo).
// ---------------------------------------------------------------------------
function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    path.join(REPO_ROOT, 'node_modules', 'playwright'),
    'C:\\Users\\Dromor Narh\\Desktop\\GithubRepos\\Nedhub\\node_modules\\playwright',
    path.join(__dirname, '..', '..', 'Nedhub', 'node_modules', 'playwright')
  ];
  for (const c of candidates) {
    if (!c) continue;
    try { return require(c); } catch (e) { /* try next */ }
  }
  try { return require('playwright'); } catch (e) {
    throw new Error('Playwright not found. Set PLAYWRIGHT_PATH.');
  }
}
const { chromium } = resolvePlaywright();

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
const results = [];

async function checkPage(context, label, pageUrl, opts = {}) {
  const page = await context.newPage();
  const errors = [];
  let xssExecuted = false;
  let payloadElements = 0;
  const script404s = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      // Track script-load failures separately so we don't report a page as
      // tested when its escaping logic never ran. Ignore asset/font/API errors.
      if (t.includes('Failed to load resource') && t.endsWith('.js)')) {
        script404s.push(t);
      }
    }
  });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); });

  // Abort external (non-same-origin) requests so no live API/provider calls.
  await page.route((r) => {
    let u = '';
    if (typeof r.url === 'function') u = r.url();
    else if (typeof r.request === 'function' && r.request() && typeof r.request().url === 'function') u = r.request().url();
    else if (r.request) u = String(r.request.url || r.request);
    return u.startsWith('http') && !u.startsWith(BASE);
  }, async (route) => {
    await route.abort();
  });

  await page.addInitScript(() => {
    window.__xss = undefined;
    try { localStorage.setItem('authToken', 'test-token'); } catch (e) {}
  });

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    errors.push(`navigation failed: ${e.message}`);
  }

  await page.waitForTimeout(2500);

  if (opts.interact) {
    try { await opts.interact(page); } catch (e) { errors.push(`interaction: ${e.message}`); }
    await page.waitForTimeout(1200);
  }

  const evalRes = await page.evaluate(() => {
    const xss = window.__xss;
    const imgs = document.querySelectorAll("img[src='x'], img[src=\"x\"]").length;
    const svgs = document.querySelectorAll('svg[onload]').length;
    const text = document.body ? document.body.textContent || '' : '';
    return { xss, imgs, svgs, text };
  });

  if (evalRes.xss) {
    xssExecuted = true;
    errors.push(`window.__xss became ${evalRes.xss} (payload executed)`);
  }
  if (evalRes.imgs > 0) {
    payloadElements += evalRes.imgs;
    errors.push(`${evalRes.imgs} payload img[src='x'] element(s) in DOM`);
  }
  if (evalRes.svgs > 0) {
    payloadElements += evalRes.svgs;
    errors.push(`${evalRes.svgs} payload svg[onload] element(s) in DOM`);
  }
  if (script404s.length > 0) {
    errors.push(`script load failure(s): ${script404s.join('; ')}`);
  }

  const payloadVisible = evalRes.text.includes('window.__xss=1') || evalRes.text.includes('<img') || evalRes.text.includes('<svg');
  const normalOk = evalRes.text.includes('O\'Brien') || evalRes.text.includes('AT&T') || evalRes.text.includes('&quot;');

  await page.close();

  const status = errors.length === 0 ? 'PASS' : 'FAIL';
  results.push({ label, status, errors, xssExecuted, payloadElements, payloadVisible, normalOk });
  console.log(`[${status}] ${label}` + (errors.length ? '\n      ' + errors.join('\n      ') : ''));
}

async function interactSendSms(page) {
  const btn = await page.$('#createSenderIdBtn');
  if (btn) await btn.click();
  await page.waitForTimeout(400);
}
async function interactAdmin(page) {
  for (const pageName of ['users', 'wallets', 'sender-ids', 'campaigns', 'system']) {
    const item = await page.$(`[data-page="${pageName}"]`);
    if (item) { await item.click(); await page.waitForTimeout(400); }
  }
}
async function interactReports(page) {
  const next = await page.$('.page-btn');
  if (next) { await next.click(); await page.waitForTimeout(400); }
}

async function run() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();

  const pages = [
    { label: 'auth/login', url: `${BASE}/pages/auth/login.html` },
    { label: 'auth/register', url: `${BASE}/pages/auth/register.html` },
    { label: 'auth/forgot-password', url: `${BASE}/pages/auth/forgot-password.html` },
    { label: 'auth/reset-password', url: `${BASE}/pages/auth/reset-password.html` },
    { label: 'auth/verify-email', url: `${BASE}/pages/auth/verify-email.html` },
    { label: 'dashboard/overview', url: `${BASE}/pages/dashboard/overview.html` },
    { label: 'dashboard/send-sms', url: `${BASE}/pages/dashboard/send-sms.html`, interact: interactSendSms },
    { label: 'dashboard/contacts', url: `${BASE}/pages/dashboard/contacts.html` },
    { label: 'dashboard/campaigns', url: `${BASE}/pages/dashboard/campaigns.html` },
    { label: 'dashboard/history', url: `${BASE}/pages/dashboard/history.html` },
    { label: 'dashboard/transactions', url: `${BASE}/pages/dashboard/transactions.html` },
    { label: 'dashboard/reports', url: `${BASE}/pages/dashboard/reports.html`, interact: interactReports },
    { label: 'dashboard/blacklist', url: `${BASE}/pages/dashboard/blacklist.html` },
    { label: 'dashboard/analytics', url: `${BASE}/pages/dashboard/analytics.html` },
    { label: 'dashboard/settings', url: `${BASE}/pages/dashboard/settings.html` },
    { label: 'dashboard/buy-airtime', url: `${BASE}/pages/dashboard/buy-airtime.html` },
    { label: 'dashboard/buy-data', url: `${BASE}/pages/dashboard/buy-data.html` },
    { label: 'dashboard/utility-payments', url: `${BASE}/pages/dashboard/utility-payments.html` },
    { label: 'dashboard/payment-success', url: `${BASE}/pages/dashboard/payment-success.html?reference=<script>window.__xss=1</script>&message=<img src=x onerror=window.__xss=1>` },
    { label: 'dashboard/payment-error', url: `${BASE}/pages/dashboard/payment-error.html?reference=<script>window.__xss=1</script>&message=' onmouseover='window.__xss=1` },
    { label: 'dashboard/payment-cancelled', url: `${BASE}/pages/dashboard/payment-cancelled.html` },
  ];

  await context.addInitScript(() => {
    localStorage.setItem('authToken', 'admin-token');
  });
  pages.push({ label: 'admin/admin', url: `${BASE}/pages/admin/admin.html`, interact: interactAdmin });

  for (const p of pages) {
    if (XSS_FILTER && !XSS_FILTER.some(f => p.label.includes(f))) continue;
    await checkPage(context, p.label, p.url, p);
  }

  await browser.close();
  server.close();

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log('\n================ XSS CHECK SUMMARY ================');
  console.log(`Total: ${results.length}  PASS: ${pass}  FAIL: ${fail}`);
  for (const r of results) {
    console.log(`  [${r.status}] ${r.label}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
