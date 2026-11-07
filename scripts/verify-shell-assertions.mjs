import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 3002;
const BASE = `http://localhost:${PORT}`;

const REQUIRED_ORDER = ['Overview','Send SMS','Campaigns','Contacts','Message History','Blacklist','Transactions','Buy Airtime','Buy Data','Utility Payments','Reports','Templates','Analytics','Settings','Logout'];
const PAYMENT_PAGES = ['payment-pending','payment-success','payment-error','payment-cancelled'];
const ALL_PAGES = ['analytics','blacklist','buy-airtime','buy-data','campaigns','contacts','history','overview','payment-cancelled','payment-error','payment-pending','payment-success','reports','send-sms','settings','templates','transactions','utility-payments'].map(p=>p+'.html');

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
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

for (const pageName of ALL_PAGES) {
  const context = await browser.newContext();
  await context.addInitScript(() => { try { localStorage.setItem('authToken', 'test-token'); localStorage.setItem('userName', 'Test User'); } catch (e) {} });
  const pg = await context.newPage();
  await pg.route('**/*', (route, request) => {
    const u = request.url();
    if (u.startsWith('http') && !u.startsWith(BASE)) route.abort();
    else route.continue();
  });
  await pg.goto(`${BASE}/src/pages/dashboard/${pageName}`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(600);

  const isPayment = PAYMENT_PAGES.some(p => pageName.toLowerCase() === p + '.html');
  const res = await pg.evaluate(() => {
    const title = document.getElementById('nhsPageTitle');
    const sidebar = document.querySelector('.nhs-sidebar');
    const nav = sidebar ? sidebar.querySelector('.nhs-nav') : null;
    const links = nav ? Array.from(nav.querySelectorAll('.nhs-link')) : [];
    const order = links.map(a => (a.querySelector('span') ? a.querySelector('span').textContent.trim() : a.textContent.trim()));
    const active = sidebar ? sidebar.querySelector('.nhs-link.is-active, .nhs-link[aria-current="page"]') : null;
    return { title: title ? title.textContent.trim() : null, order: order, active: active ? active.getAttribute('href') : null };
  });

  // expected title: match the rendered nav link whose href ends with this page
  let expectedTitle = 'Overview';
  if (isPayment) { expectedTitle = 'Payment'; }
  else {
    const navHrefs = ['overview.html','send-sms.html','campaigns.html','contacts.html','history.html','blacklist.html','transactions.html','buy-airtime.html','buy-data.html','utility-payments.html','reports.html','templates.html','analytics.html','settings.html'];
    const pageInNav = navHrefs.includes(pageName.toLowerCase());
    if (pageInNav) {
      const matched = res.order.find(function (lbl) { return lbl.toLowerCase() === pageName.replace('.html','').replace(/-/g,' '); });
      if (matched) expectedTitle = matched;
    }
  }
  check(`shell title '${pageName}'`, res.title === expectedTitle, `expected '${expectedTitle}' got '${res.title}'`);

  // active link
  if (isPayment) {
    check(`shell no active nav link '${pageName}'`, res.active === null, `got '${res.active}'`);
  } else {
    const navHrefs = ['overview.html','send-sms.html','campaigns.html','contacts.html','history.html','blacklist.html','transactions.html','buy-airtime.html','buy-data.html','utility-payments.html','reports.html','templates.html','analytics.html','settings.html'];
    const pageInNav = navHrefs.includes(pageName.toLowerCase());
    if (pageInNav) {
      check(`shell active link '${pageName}'`, res.active && res.active.toLowerCase().endsWith(pageName.toLowerCase()), `got '${res.active}'`);
    } else {
      check(`shell no active nav link '${pageName}'`, res.active === null, `got '${res.active}'`);
    }
  }

  // nav order: 15 items (14 nav + Logout), no Payment link rendered
  check(`shell nav order '${pageName}' === REQUIRED_ORDER`, JSON.stringify(res.order) === JSON.stringify(REQUIRED_ORDER), `got ${JSON.stringify(res.order)}`);
  check(`shell no Payment link rendered '${pageName}'`, !res.order.includes('Payment'), `got ${JSON.stringify(res.order)}`);

  await context.close();
}

await browser.close();
server.close();

const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
console.log(`\n================ RESULT ================\nTotal: ${results.length}  PASS: ${pass}  FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
