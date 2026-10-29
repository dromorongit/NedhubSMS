// scripts/check-xss.js
//
// XSS regression test for the NedhubSMS frontend.
// Serves src/ statically, intercepts every /api/** and external request,
// answers with mock data in which EVERY string field holds an XSS payload,
// loads every page, and asserts that no payload executes (window.__xss stays
// undefined and no payload-created img/svg elements appear in the DOM).
//
// Usage: node scripts/check-xss.js
//
// Requires Playwright + Chromium (usable from the temporary folder, e.g.
// the sibling Nedhub/node_modules/playwright or via the PLAYWRIGHT_PATH env
// var). Nothing is installed inside the repo.

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(process.env.SRC_DIR || path.join(REPO_ROOT, 'src'));
const PORT = parseInt(process.env.PORT || '31337', 10);
const BASE = `http://localhost:${PORT}`;
const XSS_FILTER = process.env.XSS_FILTER ? process.env.XSS_FILTER.split(',').map(s => s.trim()).filter(Boolean) : null;

// XSS payloads injected into EVERY string field of the mock API data.
const PAYLOADS = [
  '<img src=x onerror=window.__xss=1>',
  '<script>window.__xss=1</script>',
  "' onmouseover='window.__xss=1",
  '\"><svg onload=window.__xss=1>'
];
const MAIN_PAYLOAD = PAYLOADS[0];

// ---------------------------------------------------------------------------
// Playwright resolver (nothing is installed inside the repo).
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
    try {
      return require(c);
    } catch (e) {
      // try next
    }
  }
  try {
    return require('playwright');
  } catch (e) {
    throw new Error('Playwright not found. Set PLAYWRIGHT_PATH or install playwright.');
  }
}
const { chromium } = resolvePlaywright();

// ---------------------------------------------------------------------------
// Mock API data: every string field is an XSS payload.
// ---------------------------------------------------------------------------
function payload() {
  if (process.env.XSS_PAYLOAD_MODE === 'deterministic') return PAYLOADS[0];
  return PAYLOADS[Math.floor(Math.random() * PAYLOADS.length)];
}

function mockPagination() {
  return { page: 1, pages: 1, total: 2, limit: 20 };
}

function mockUser() {
  return {
    _id: payload(),
    name: payload(),
    email: payload(),
    phone: payload(),
    role: 'admin',
    status: 'active',
    createdAt: payload()
  };
}

function mockTransaction() {
  return {
    _id: payload(),
    type: payload(),
    status: payload(),
    description: payload(),
    reference: payload(),
    amount: 123.45,
    createdAt: payload()
  };
}

function mockContact() {
  return {
    _id: payload(),
    recipientName: payload(),
    phoneNumber: payload(),
    groupName: payload(),
    createdAt: payload()
  };
}

function mockSenderId() {
  return {
    _id: payload(),
    senderId: payload(),
    status: payload(),
    remarks: payload(),
    documentName: payload(),
    createdAt: payload(),
    userId: { _id: payload(), name: payload(), email: payload() }
  };
}

function mockCampaign() {
  return {
    _id: payload(),
    name: payload(),
    title: payload(),
    senderId: payload(),
    status: payload(),
    messageBody: payload(),
    recipientsCount: 50,
    cost: 25.0,
    deliveredCount: 40,
    failedCount: 5,
    queuedCount: 5,
    estimatedCost: 25.0,
    actualCost: 25.0,
    createdAt: payload(),
    scheduledAt: payload(),
    sentAt: payload(),
    failedCount: 0
  };
}

function mockMessage() {
  return {
    _id: payload(),
    message: payload(),
    senderId: payload(),
    recipient: payload(),
    status: payload(),
    source: 'new',
    createdAt: payload()
  };
}

function mockApiKey() {
  return {
    keyId: payload(),
    name: payload(),
    prefix: payload(),
    createdAt: payload(),
    lastUsedAt: payload(),
    revoked: false
  };
}

function mockBlacklist() {
  return {
    _id: payload(),
    phoneNumber: payload(),
    reason: payload(),
    source: payload(),
    createdAt: payload()
  };
}

function mockResponse(extra) {
  const data = {
    pagination: mockPagination(),
    user: mockUser(),
    transactions: [mockTransaction(), mockTransaction()],
    contacts: [mockContact(), mockContact()],
    senderIds: [mockSenderId()],
    campaigns: [mockCampaign(), mockCampaign()],
    messages: [mockMessage(), mockMessage()],
    messageHistory: [mockMessage()],
    apiKeys: [mockApiKey()],
    blacklist: [mockBlacklist()],
    wallets: [{ userId: mockUser(), balance: 100, frozen: false, updatedAt: payload(), _id: payload() }],
    total: 2,
    totalVolume: 100,
    totalCost: 50.0,
    token: payload(),
    newPassword: payload()
  };
  if (extra) Object.assign(data, extra);
  return { data, error: null };
}

// Some endpoints expect `result.data` to be an array, others an object.
// Route the mock by path so each page receives a shape it can render without
// throwing (which would otherwise hide a real XSS).
function mockForPath(pathname) {
  const p = pathname.toLowerCase();
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
  return mockResponse();
}

// ---------------------------------------------------------------------------
// Static file server for src/
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
  let filePath = path.join(SRC_DIR, url.pathname);
  if (filePath === SRC_DIR || filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Static server on ${BASE}`);
});

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
const results = [];

function injectGuard(page) {
  return page.addInitScript(() => {
    window.__xss = undefined;
  });
}

async function checkPage(context, label, pageUrl, opts = {}) {
  const page = await context.newPage();
  const errors = [];
  let xssExecuted = false;
  let payloadElements = 0;
  let consoleErrs = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrs.push(msg.text());
  });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); });

  // Mock every /api/** request and abort other external (non-same-origin)
  // requests so no live API/provider calls are made.
  await page.route('**/api/**', async (route) => {
    try {
      let url = '';
      const req = typeof route.request === 'function' ? route.request() : route.request;
      if (req && typeof req.url === 'function') url = req.url();
      else if (req && req.url) url = String(req.url);
      let pathname = '';
      try { pathname = new URL(url).pathname; } catch (e) { pathname = url; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockForPath(pathname))
      });
    } catch (e) {
      await route.abort();
    }
  });
  await page.route((r) => {
    let u = '';
    if (typeof r.url === 'function') u = r.url();
    else if (r.url) u = String(r.url);
    else if (typeof r.request === 'function' && r.request() && typeof r.request().url === 'function') u = r.request().url();
    else u = String(r);
    return u.startsWith('http') && !u.startsWith(BASE) && !u.startsWith('http://localhost:31337');
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

  // Wait for the page to settle (api mocks resolve and onerror/onload fire).
  await page.waitForTimeout(2500);

  // Open modals / click tabs / pagination the mock enables.
  if (opts.interact) {
    try { await opts.interact(page); } catch (e) { errors.push(`interaction: ${e.message}`); }
    await page.waitForTimeout(1200);
  }

  // Evaluate in page context.
  const evalRes = await page.evaluate(() => {
    const xss = window.__xss;
    const imgs = document.querySelectorAll("img[src='x'], img[src=\"x\"]").length;
    const svgs = document.querySelectorAll('svg[onload]').length;
    const text = document.body ? document.body.textContent || '' : '';
    return { xss, imgs, svgs, text };
  });
  console.log('DEBUG-EVAL', label, 'xss=', evalRes.xss, 'imgs=', evalRes.imgs, 'svgs=', evalRes.svgs, 'url=', pageUrl);

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

  // Payload text should be visible as plain (escaped) text, not executed.
  const payloadVisible = evalRes.text.includes('window.__xss=1') || evalRes.text.includes('<img') || evalRes.text.includes('<svg');
  const normalOk = evalRes.text.includes('O\'Brien') || evalRes.text.includes('AT&T') || evalRes.text.includes('&quot;');

  await page.close();

  const status = errors.length === 0 ? 'PASS' : 'FAIL';
  results.push({ label, status, errors, xssExecuted, payloadElements, payloadVisible, normalOk });
  console.log(`[${status}] ${label}` + (errors.length ? '\n      ' + errors.join('\n      ') : ''));
}

async function interactSendSms(page) {
  // open sender id modal / contacts picker if present
  const btn = await page.$('#createSenderIdBtn');
  if (btn) await btn.click();
  await page.waitForTimeout(400);
}

async function interactAdmin(page) {
  // click through admin tabs
  for (const pageName of ['users', 'wallets', 'sender-ids', 'campaigns', 'system']) {
    const item = await page.$(`[data-page="${pageName}"]`);
    if (item) { await item.click(); await page.waitForTimeout(400); }
  }
}

async function interactReports(page) {
  // pagination next if present
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

  // Admin page needs an admin token and /auth/verify mock returning admin role.
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

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
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
