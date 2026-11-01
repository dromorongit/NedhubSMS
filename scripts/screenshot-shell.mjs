import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8124;
const OUT_DIR = process.argv[2] || path.join(ROOT, 'docs', 'screenshots', 'shell');

const REQUIRED_ORDER = ['Overview','Send SMS','Campaigns','Contacts','Message History','Blacklist','Transactions','Buy Airtime','Buy Data','Utility Payments','Reports','Templates','Analytics','Settings','Logout'];

const PAGES = process.argv[3] ? [process.argv[3]] : [
  'analytics','blacklist','buy-airtime','buy-data','campaigns','contacts','history','overview','payment-cancelled','payment-error','payment-success','reports','send-sms','settings','templates','transactions','utility-payments'
].map(p=>p+'.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

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

const viewports = [
  { width: 1366, height: 768, name: '1366x768' },
  { width: 1280, height: 720, name: '1280x720' },
  { width: 390, height: 844, name: '390x844' },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const allResults = [];
const topbarSnapshots = []; // {page, vp, html, height}

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

    // desktop assertion helpers
    const asserts = await page.evaluate(async ({REQUIRED_ORDER, vp, pageName}) => {
      const sidebar = document.querySelector('.nhs-sidebar');
      const nav = sidebar ? sidebar.querySelector('.nhs-nav') : null;
      const links = nav ? Array.from(nav.querySelectorAll('.nhs-link')) : [];
      const order = links.map(a => (a.querySelector('span') ? a.querySelector('span').textContent.trim() : a.textContent.trim()));
      const orderOk = JSON.stringify(order) === JSON.stringify(REQUIRED_ORDER);

      const active = sidebar ? sidebar.querySelector('.nhs-link[aria-current="page"], .nhs-link.is-active') : null;
      const activeHref = active ? (active.getAttribute('href') || '') : '';
      const inNav = REQUIRED_ORDER.map(x=>x.toLowerCase().replace(/ /g,'-')).length>=0; const navHrefs = ['overview.html','send-sms.html','campaigns.html','contacts.html','history.html','blacklist.html','transactions.html','buy-airtime.html','buy-data.html','utility-payments.html','reports.html','templates.html','analytics.html','settings.html']; const pageInNav = navHrefs.includes(pageName.toLowerCase()); const activeOk = pageInNav ? activeHref.toLowerCase().endsWith(pageName.toLowerCase()) : (active === null);

      const main = document.querySelector('.main-content');
      const sRect = sidebar ? sidebar.getBoundingClientRect() : null;
      const mRect = main ? main.getBoundingClientRect() : null;
      let desktopOk = true;
      if (vp.width >= 1024) {
        desktopOk = !!sRect && sRect.left <= 1 && Math.abs(sRect.width - 260) <= 1 && !!mRect && mRect.left >= 260 - 1;
      }

      // pinned cards
      const help = sidebar ? sidebar.querySelector('.nhs-help') : null;
      const userCard = sidebar ? sidebar.querySelector('.nhs-user') : null;
      const helpRectBefore = help ? help.getBoundingClientRect() : null;
      const userRectBefore = userCard ? userCard.getBoundingClientRect() : null;
      if (nav) nav.scrollTop = nav.scrollHeight;
      await new Promise(r=>setTimeout(r,100));
      const helpRectAfter = help ? help.getBoundingClientRect() : null;
      const userRectAfter = userCard ? userCard.getBoundingClientRect() : null;
      const cardsNotMoved = !!helpRectBefore && !!userRectBefore && !!helpRectAfter && !!userRectAfter &&
        Math.abs(helpRectBefore.top - helpRectAfter.top) <= 1 &&
        Math.abs(helpRectBefore.left - helpRectAfter.left) <= 1 &&
        Math.abs(userRectBefore.top - userRectAfter.top) <= 1 &&
        Math.abs(userRectBefore.left - userRectAfter.left) <= 1;
      const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
      const cardsInsideViewport = !!helpRectAfter && !!userRectAfter &&
        helpRectAfter.top >= 0 && helpRectAfter.bottom <= window.innerHeight + 1 &&
        userRectAfter.top >= 0 && userRectAfter.bottom <= window.innerHeight + 1;
      const cardsAtBottom = !!sidebarRect && !!userRectAfter && (sidebarRect.bottom - userRectAfter.bottom) <= 24 && (sidebarRect.bottom - userRectAfter.bottom) >= 0;
      const pinnedOk = cardsNotMoved && cardsInsideViewport && cardsAtBottom;

      // logout inside nav and last item
      const logoutLink = sidebar ? sidebar.querySelector('.nhs-link--logout') : null;
      const logoutInNav = !!logoutLink && !!nav && nav.contains(logoutLink);
      const allLinks = links.concat(logoutLink ? [logoutLink] : []);
      const lastIsLogout = allLinks.length > 0 && allLinks[allLinks.length-1] === logoutLink;
      const logoutOk = logoutInNav && lastIsLogout;

      const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
      const text = (document.body && document.body.innerText) ? document.body.innerText : '';
      const mojibake = /[���]/.test(text);

      const topbar = document.querySelector('.nhs-topbar');
      const topbarHeight = topbar ? topbar.getBoundingClientRect().height : 0;
      const topbarHtml = topbar ? topbar.outerHTML : '';

      return {
        order, orderOk, activeHref, activeOk, desktopOk,
        cardsNotMoved, cardsInsideViewport, cardsAtBottom, pinnedOk,
        logoutInNav, lastIsLogout, logoutOk,
        noHScroll, mojibake, topbarHeight, topbarHtml,
        consoleErrors: []
      };
    }, { REQUIRED_ORDER, vp, pageName });

    // capture console errors from closure var
    asserts.consoleErrors = consoleErrors.slice();

    // mobile drawer test at 390
    let mobileOk = true;
    if (vp.width === 390) {
      const drawerClosedBefore = await page.evaluate(() => {
        const sb = document.querySelector('.nhs-sidebar');
        const r = sb.getBoundingClientRect();
        return r.right <= 0 || r.left >= window.innerWidth; // off-screen
      });
      // click hamburger
      await page.click('.nhs-burger', { force: true });
      await page.waitForTimeout(400);
      const openedDetail = await page.evaluate(() => {
        const sb = document.querySelector('.nhs-sidebar');
        const ov = document.querySelector('.nhs-overlay');
        const r = sb.getBoundingClientRect();
        const overlayVisible = ov && (getComputedStyle(ov).opacity === '1' || ov.classList.contains('is-visible'));
        return { left: r.left, overlayVisible: overlayVisible, op: getComputedStyle(ov).opacity, cls: ov.className };
      });
      const opened = openedDetail.left >= 0 && openedDetail.left < 390 && openedDetail.overlayVisible;
      // click overlay
      await page.click('.nhs-overlay', { force: true, position: { x: vp.width - 10, y: 100 } });
      await page.waitForTimeout(400);
      const closedAfterOverlay = await page.evaluate(() => {
        const sb = document.querySelector('.nhs-sidebar');
        const r = sb.getBoundingClientRect();
        return r.right <= 0 || r.left >= window.innerWidth;
      });
      // click nav link closes
      await page.click('.nhs-burger', { force: true });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const n=document.querySelector('.nhs-nav'); if(n) n.scrollTop=0; document.querySelectorAll('.nhs-nav .nhs-link').forEach(a => a.addEventListener('click', e => e.preventDefault(), { once: true, capture: true })); });
      await page.click('.nhs-nav .nhs-link', { force: true });
      await page.waitForTimeout(400);
      const closedAfterLink = await page.evaluate(() => {
        const sb = document.querySelector('.nhs-sidebar');
        const r = sb.getBoundingClientRect();
        return r.right <= 0 || r.left >= window.innerWidth;
      });
      console.log('MOBILEDEBUG', pageName, drawerClosedBefore, opened, closedAfterOverlay, closedAfterLink); mobileOk = drawerClosedBefore && opened && closedAfterOverlay && closedAfterLink;
    }

    const jOk = asserts.consoleErrors.length === 0;
    const iOk = !asserts.mojibake;
    const hOk = asserts.noHScroll;
    const fOk = (vp.width !== 390) || mobileOk;
    const cOk = asserts.desktopOk;
    const eOk = asserts.logoutOk;
    const dOk = asserts.pinnedOk;
    const bOk = asserts.activeOk;
    const aOk = asserts.orderOk;

    const pageResult = {
      page: pageName, vp: vp.name,
      a: aOk, b: bOk, c: cOk, d: dOk, e: eOk, f: fOk, g: null, h: hOk, i: iOk, j: jOk,
      mobileOk, consoleErrors: asserts.consoleErrors,
      topbarHeight: asserts.topbarHeight,
      topbarHtml: asserts.topbarHtml,
      order: asserts.order
    };
    allResults.push(pageResult);

    // normalize topbar html for (g): replace title text and user name
    const normalized = asserts.topbarHtml
      .replace(/<h1 class="nhs-page-title"[^>]*>.*?<\/h1>/, '<h1 class="nhs-page-title" id="nhsPageTitle">TITLE</h1>')
      .replace(/<span class="nhs-topbar-name"[^>]*>.*?<\/span>/, '<span class="nhs-topbar-name" id="userName">NAME</span>');
    topbarSnapshots.push({ page: pageName, vp: vp.name, html: normalized, height: asserts.topbarHeight });

    const outPath = path.join(OUT_DIR, `${pageName.replace('.html','')}-${vp.name}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    await context.close();
  }
}

// Evaluate (g): identical outerHTML (apart from title and user name) and same height on every page
const byVp = {};
for (const s of topbarSnapshots) {
  if (!byVp[s.vp]) byVp[s.vp] = [];
  byVp[s.vp].push(s);
}
for (const r of allResults) {
  const peers = topbarSnapshots.filter(s => s.vp === r.vp);
  const first = peers[0];
  const cur = peers.find(s => s.page === r.page.replace('.html','') + '.html' || s.page === r.page);
  // find matching
  const match = topbarSnapshots.find(s => s.page === r.page && s.vp === r.vp);
  const sameHtml = peers.every(s => s.html === first.html);
  const sameHeight = peers.every(s => Math.abs(s.height - first.height) <= 1);
  r.g = sameHtml && sameHeight;
}

// Print order for first result
if (allResults.length) {
  console.log('Sample nav order:', JSON.stringify(allResults[0].order));
}

// Summary table
console.log('\n=== ASSERTION SUMMARY ===');
const header = 'page'.padEnd(22) + 'vp'.padEnd(12) + 'a b c d e f g h i j';
console.log(header);
for (const r of allResults) {
  const flags = [r.a,r.b,r.c,r.d,r.e,r.f,r.g,r.h,r.i,r.j].map(x=>x?'P':'F').join(' ');
  console.log(r.page.padEnd(22) + r.vp.padEnd(12) + flags + (r.consoleErrors.length? '  ERR:'+r.consoleErrors.join('; '):''));
}

const fails = allResults.filter(r => [r.a,r.b,r.c,r.d,r.e,r.f,r.g,r.h,r.i,r.j].some(x=>!x));
console.log('\nTotal runs:', allResults.length, 'Failures:', fails.length);
if (fails.length) {
  console.log('Failed runs:', fails.map(f=>f.page+'@'+f.vp).join(', '));
}

await browser.close();
server.close();
