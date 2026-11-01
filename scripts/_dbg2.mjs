import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8125;
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots', 'shell');

const REQUIRED_ORDER = ['Overview','Send SMS','Campaigns','Contacts','Message History','Blacklist','Transactions','Buy Airtime','Buy Data','Utility Payments','Reports','Templates','Analytics','Settings','Logout'];

const PAGES = ['analytics.html','buy-airtime.html','buy-data.html'];

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png' };

function serve(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer(serve);
await new Promise((resolve) => server.listen(PORT, resolve));

const RICH = { user: { name: "John Doe", email: "john@example.com", role: "user" }, balance: 2.00, senderIds: [{ senderId: "NEDHUB", status: "approved" }], contacts: [], blacklistedNumbers: [], blacklisted: [], pagination: { totalPages: 1, page: 1, total: 0, limit: 50 }, transactions: [], campaigns: [], reports: [], messages: [], history: [], recipients: [], total: 0, valid: 0, invalid: 0, duplicates: 0, cost: 0.04, segments: 1, encoding: "gsm7", recipientCount: 0, success: true, messageId: "msg_1" };
function mockApi(route) {
  const url = route.request().url();
  const body = { data: { ...RICH }, message: "ok" };
  if (url.includes("/auth/me")) body.data = { user: RICH.user };
  else if (url.includes("/wallet")) body.data = { balance: RICH.balance };
  else if (url.includes("/sender-ids")) body.data = { senderIds: RICH.senderIds };
  else if (url.includes("/contacts")) body.data = [];
  else if (url.includes("/calculate-cost")) body.data = { cost: RICH.cost, segments: RICH.segments, encoding: RICH.encoding, recipientCount: RICH.recipientCount };
  else if (url.includes("/sms/upload-temp") || url.includes("/sms-uploads")) body.data = { recipients: [{ name: "John", phone: "0241234567" }], total: 1, valid: 1, invalid: 0, duplicates: 0 };
  else if (url.includes("/blacklist")) body.data = { blacklistedNumbers: [], pagination: RICH.pagination };
  else if (url.includes("/sms/send") || url.includes("/sms/schedule")) body.data = { success: true, messageId: "msg_1" };
  else if (url.includes("/sms-campaigns")) body.data = { success: true };
  else if (url.includes("/transactions")) body.data = { transactions: [], pagination: RICH.pagination };
  else if (url.includes("/reports")) body.data = { reports: [] };
  else if (url.includes("/templates")) body.data = [];
  else if (url.includes("/history") || url.includes("/sms/history")) body.data = { messages: [], pagination: RICH.pagination };
  else if (url.includes("/campaigns")) body.data = { campaigns: [], pagination: RICH.pagination };
  else if (url.includes("/analytics/sms-summary")) body.data = { totalCampaigns: 0, totalRecipients: 0, deliveryRate: 0, totalActualCost: 0 };
  else if (url.includes("/analytics/charts")) body.data = { sendsOverTime: [], deliverySuccessRate: [], costTrends: [], networkDistribution: [], statusDistribution: [] };
  else if (url.includes("/analytics/campaigns")) body.data = { campaigns: [] };
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

const viewports = [ { width: 390, height: 844, name: '390x844' } ];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const allResults = [];

for (const pageName of PAGES) {
  for (const vp of viewports) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try { localStorage.setItem('authToken', 'fake-token-for-screenshot'); localStorage.setItem('authStorageType', 'local'); localStorage.setItem('userName', 'John Doe'); } catch (e) {}
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(err.message));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.route('**/api/**', mockApi);
    await page.goto(`http://localhost:${PORT}/src/pages/dashboard/${pageName}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    await page.click('.nhs-burger', { force: true });
    await page.waitForTimeout(320);
    const openedDetail = await page.evaluate(() => {
      const sb = document.querySelector('.nhs-sidebar');
      const ov = document.querySelector('.nhs-overlay');
      const r = sb.getBoundingClientRect();
      const overlayVisible = ov && (getComputedStyle(ov).opacity === '1' || ov.classList.contains('is-visible'));
      return { left: r.left, overlayVisible, ovCls: ov.className, ovOp: getComputedStyle(ov).opacity };
    });
    console.log('OPENED', pageName, JSON.stringify(openedDetail));
    await page.waitForTimeout(200);
    await context.close();
  }
}
await browser.close();
server.close();
