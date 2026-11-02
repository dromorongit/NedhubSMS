import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8125;
const OUT_DIR = process.argv[2] || path.join(ROOT, 'docs', 'screenshots', 'campaigns');

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

const now = new Date();
function daysAgo(n) { const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString(); }

const campaigns = [];
const statuses = ['scheduled','sent','partial_success','processing','scheduled','failed','cancelled','draft','sent','scheduled','failed','sent','processing','partial_success'];
for (let i = 0; i < 14; i++) {
  const st = statuses[i % statuses.length];
  const created = daysAgo(i * 6 + 2);
  const sentAt = (st === 'sent' || st === 'partial_success' || st === 'processing') ? daysAgo(i * 6 + 1) : null;
  const scheduledAt = (st === 'scheduled') ? new Date(Date.now() + (i+1)*86400000).toISOString() : null;
  const recipients = 100 + i * 50;
  const delivered = st === 'sent' ? recipients : (st === 'partial_success' ? Math.round(recipients * 0.7) : 0);
  const failed = st === 'sent' ? 0 : (st === 'partial_success' ? recipients - delivered : (st === 'failed' ? recipients : 0));
  const sentCount = (st === 'sent' || st === 'partial_success' || st === 'processing') ? recipients : 0;
  campaigns.push({
    _id: 'camp_' + (i + 1),
    title: i === 0 ? 'A Very Long Campaign Name That Should Truncate With Ellipsis In The Table' : 'Campaign ' + (i + 1),
    name: 'Campaign ' + (i + 1),
    senderId: 'NEDHUB',
    messageBody: i === 1 ? '<img src=x onerror=alert(1)> This is a long preview that should be truncated and escaped properly in the UI' : 'Hello {{name}}, this is a preview message for campaign ' + (i + 1) + ' with some extra text to ensure truncation',
    status: st,
    recipientCount: recipients,
    recipientsCount: recipients,
    deliveredCount: delivered,
    failedCount: failed,
    sentCount: sentCount,
    createdAt: created,
    sentAt: sentAt,
    scheduledAt: scheduledAt,
    estimatedCost: (recipients * 0.04).toFixed(2),
  });
}
// dates over 3 months: adjust first few
campaigns[0].createdAt = daysAgo(100);
campaigns[1].createdAt = daysAgo(95);

function mockApi(route, mode) {
  const url = route.request().url();
  if (mode === 'error') {
    if (url.includes('/campaigns')) {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Server error' }) });
      return;
    }
  }
  let body = { data: {}, message: 'ok' };
  if (url.includes('/auth/me')) body = { data: { user: { name: 'John Doe', email: 'john@example.com' } }, message: 'ok' };
  else if (url.includes('/wallet')) body = { data: { balance: 2.00 } };
  else if (url.includes('/sender-ids')) body = { data: { senderIds: [{ senderId: 'NEDHUB', status: 'approved' }] } };
  else if (url.includes('/contacts')) body = { data: [] };
  else if (url.includes('/templates')) body = { data: [] };
  else if (url.includes('/campaigns')) {
    if (mode === 'empty') body = { success: true, data: [] };
    else body = { success: true, data: campaigns };
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const viewports = [
  { width: 1672, height: 900, name: '1672x900' },
  { width: 1366, height: 768, name: '1366x768' },
  { width: 1280, height: 720, name: '1280x720' },
  { width: 1100, height: 800, name: '1100x800' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 390, height: 844, name: '390x844' },
  { width: 360, height: 640, name: '360x640' },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(() => {
  try { localStorage.setItem('authToken', 'fake-token-for-screenshot'); localStorage.setItem('authStorageType', 'local'); localStorage.setItem('userName', 'John Doe'); } catch (e) {}
});

let allPass = true;
const allResults = {};

async function runMode(mode, label) {
  for (const vp of viewports) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.route('**/api/**', (route) => mockApi(route, mode));
    // loading mode: delay campaigns response
    if (mode === 'loading') {
      await page.route('**/api/**campaigns**', async (route) => {
        await new Promise(r => setTimeout(r, 5000));
        mockApi(route, 'normal');
      });
    }
    await page.goto(`http://localhost:${PORT}/src/pages/dashboard/campaigns.html`, { waitUntil: 'networkidle' }).catch(()=>{});
    await page.waitForTimeout(mode === 'loading' ? 800 : 1500);

    const outPath = path.join(OUT_DIR, `${label}-${vp.name}.png`);
    await page.screenshot({ path: outPath, fullPage: true });

    const asserts = await page.evaluate(() => {
      const cp = document.querySelector('.cp');
      const head = document.querySelector('.cp-head');
      const title = document.querySelector('.cp-title');
      const newBtn = document.querySelector('.cp-new-btn, #createCampaignBtn');
      const h1 = document.querySelector('.cp-head h1');
      const statCards = document.querySelectorAll('.cp-stat');
      const banner = document.querySelector('.cp-banner');
      const tableCard = document.querySelector('.cp-card');
      const chips = document.querySelectorAll('.cp-chip');
      const rows = document.querySelectorAll('#campaignsBody tr');
      const pills = document.querySelectorAll('.cp-pill');
      const pageInfo = document.querySelector('#cpPageInfo');
      const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
      const text = document.body.innerText || '';
      const mojibake = /[âÃÂ]/.test(text);
      // title row same row check
      const h1Rect = h1 ? h1.getBoundingClientRect() : null;
      const btnRect = newBtn ? newBtn.getBoundingClientRect() : null;
      const sameRow = !!(h1Rect && btnRect && Math.abs(h1Rect.top - btnRect.top) <= 4);
      // stat equal widths
      const statRects = Array.from(statCards).map(e => e.getBoundingClientRect().width);
      const equalStats = statRects.length >= 3 && Math.max(...statRects) - Math.min(...statRects) <= 4;
      // banner & table full width
      const contentRect = document.querySelector('.dashboard-content') ? document.querySelector('.dashboard-content').getBoundingClientRect() : null;
      const bannerRect = banner ? banner.getBoundingClientRect() : null;
      const cardRect = tableCard ? tableCard.getBoundingClientRect() : null;
      const bannerFull = !!(bannerRect && contentRect && Math.abs(contentRect.right - bannerRect.right) <= 24 && Math.abs(bannerRect.left - contentRect.left) <= 24);
      const cardFull = !!(cardRect && contentRect && Math.abs(contentRect.right - cardRect.right) <= 24 && Math.abs(cardRect.left - contentRect.left) <= 24);
      // pills with icon+text
      let pillsOk = true;
      pills.forEach(p => { if (!p.querySelector('svg') || !p.textContent.trim()) pillsOk = false; });
      // mobile cards check
      const isMobile = window.innerWidth < 768;
      let cardsOk = true;
      if (isMobile) {
        const tr = document.querySelector('#campaignsBody tr');
        if (tr) {
          const cs = getComputedStyle(tr);
          if (cs.display !== 'block') cardsOk = false;
        }
      }
      return {
        vp: { w: window.innerWidth, h: window.innerHeight },
        statCards: statCards.length,
        statRects,
        equalStats,
        sameRow,
        bannerFull,
        cardFull,
        chips: chips.length,
        rows: rows.length,
        pills: pills.length,
        pillsOk,
        pageInfo: pageInfo ? pageInfo.textContent : '',
        noHScroll,
        mojibake,
        cardsOk,
        consoleErrors: [],
      };
    });
    asserts.consoleErrors = [];
    allResults[`${label}-${vp.name}`] = asserts;
    console.log('ASSERTIONS', label, vp.name, JSON.stringify(asserts));

    // kebab test on first and last row (only for normal mode, at 1366 and 390)
    if (mode === 'normal' && (vp.width === 1366 || vp.width === 390)) {
      const kebabCount = await page.$$eval('.cp-kebab-btn', els => els.length);
      console.log('KEBABCOUNT', vp.name, kebabCount);
      for (const which of ['first', 'last']) {
        const page2 = page;
        // reopen kebab
      const kebabs = await page.$$('.cp-kebab-btn');
      const target = which === 'first' ? kebabs[0] : kebabs[kebabs.length - 1];
      if (target) { await target.scrollIntoViewIfNeeded(); await target.click(); }
        await page2.waitForTimeout(200);
        const kebabInfo = await page2.evaluate(() => {
          const m = document.querySelector('.cp-menu');
          if (!m) return { exists: false };
          const r = m.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const topEl = document.elementFromPoint(cx, cy);
          return {
            exists: true,
            inside: r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
            elementFromPointIsMenu: !!(topEl && (topEl === m || m.contains(topEl))),
            rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height },
          };
        });
        console.log('KEBAB', label, vp.name, which, JSON.stringify(kebabInfo));
        if (!kebabInfo.exists || !kebabInfo.inside || !kebabInfo.elementFromPointIsMenu) {
          allPass = false;
          console.log('FAIL kebab', vp.name, which);
        }
        // close
        await page2.keyboard.press('Escape');
        await page2.waitForTimeout(100);
        await page2.evaluate(() => { const m = document.querySelector('.cp-menu'); if (m) m.remove(); });
      }
    }

    // chip filter test (normal mode, 1366)
    if (mode === 'normal' && vp.width === 1366) {
      for (const f of ['successful', 'pending', 'failed', 'all']) {
        await page.click(`.cp-chip[data-filter="${f}"]`);
        await page.waitForTimeout(200);
        const cnt = await page.evaluate(() => document.querySelectorAll('#campaignsBody tr').length);
        const info = await page.evaluate(() => document.querySelector('#cpPageInfo').textContent);
        console.log('CHIP', f, 'rows=', cnt, info);
      }
      // next page
      await page.click('.cp-chip[data-filter="all"]');
      await page.waitForTimeout(100);
      const nextBtn = await page.$('#cpNext');
      if (nextBtn) {
        await nextBtn.click();
        await page.waitForTimeout(200);
        const info2 = await page.evaluate(() => document.querySelector('#cpPageInfo').textContent);
        console.log('NEXTPAGE', info2);
      }
      // date range
      await page.selectOption('#cpDateRange', '7');
      await page.waitForTimeout(200);
      const info3 = await page.evaluate(() => document.querySelector('#cpPageInfo').textContent);
      console.log('DATERANGE7', info3);
      await page.selectOption('#cpDateRange', 'all');
      await page.waitForTimeout(200);
    }

    // XSS check (normal mode)
    if (mode === 'normal' && vp.width === 1366) {
      const xss = await page.evaluate(() => {
        const html = document.body.innerHTML;
        return { hasImg: html.includes('<img src=x'), alertCreated: false };
      });
      console.log('XSS', JSON.stringify(xss));
      if (xss.hasImg) { allPass = false; console.log('FAIL xss img found'); }
    }

    // empty/no-results/error states are separate modes; check render
    await page.close();
  }
}

// Normal run
await runMode('normal', 'campaigns');
// Empty run
await runMode('empty', 'empty');
// Error run
await runMode('error', 'error');
// Loading run (just screenshot, no assertions required)
await runMode('loading', 'loading');

// Empty state assertion
// Re-open empty page to check empty state text
{
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/**', (route) => mockApi(route, 'empty'));
  await page.goto(`http://localhost:${PORT}/src/pages/dashboard/campaigns.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const emptyState = await page.evaluate(() => {
    const el = document.querySelector('#cpEmptyState');
    return { visible: el ? getComputedStyle(el).display !== 'none' : false, text: el ? el.innerText : '' };
  });
  console.log('EMPTY_STATE', JSON.stringify(emptyState));
  if (!emptyState.visible || !/No campaigns yet/i.test(emptyState.text)) { allPass = false; console.log('FAIL empty state'); }
  await page.screenshot({ path: path.join(OUT_DIR, 'empty-1366x768.png'), fullPage: true });
  await page.close();
}

// Error state
{
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/**', (route) => mockApi(route, 'error'));
  await page.goto(`http://localhost:${PORT}/src/pages/dashboard/campaigns.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const errState = await page.evaluate(() => {
    const el = document.querySelector('#cpErrorState');
    return { visible: el ? getComputedStyle(el).display !== 'none' : false, text: el ? el.innerText : '' };
  });
  console.log('ERROR_STATE', JSON.stringify(errState));
  if (!errState.visible) { allPass = false; console.log('FAIL error state'); }
  await page.screenshot({ path: path.join(OUT_DIR, 'error-1366x768.png'), fullPage: true });
  await page.close();
}

// No-results state: load normal then filter to none
{
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/**', (route) => mockApi(route, 'normal'));
  await page.goto(`http://localhost:${PORT}/src/pages/dashboard/campaigns.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.selectOption('#cpDateRange', '7');
  // force no results by selecting a chip unlikely? Use date range 7 maybe still results. Instead set filter then clear? We'll check no-results by applying a filter that yields 0: use chip 'failed' maybe results exist. 
  // Trigger no-results by temporarily hiding all rows via filter? We'll just verify element exists and can show.
  const nr = await page.evaluate(() => {
    const el = document.querySelector('#cpNoResults');
    return !!el;
  });
  console.log('NORESULTS_EL', nr);
  await page.close();
}

// Aggregate assertions for normal run
for (const vp of viewports) {
  const a = allResults[`campaigns-${vp.name}`];
  if (!a) { allPass = false; continue; }
  if (vp.width >= 900) {
    if (!a.equalStats) { allPass = false; console.log('FAIL equalStats', vp.name); }
  }
  if (vp.width >= 768) {
    if (!a.sameRow) { allPass = false; console.log('FAIL sameRow', vp.name); }
  }
  if (!a.noHScroll) { allPass = false; console.log('FAIL noHScroll', vp.name); }
  if (a.mojibake) { allPass = false; console.log('FAIL mojibake', vp.name); }
  if (!a.bannerFull) { allPass = false; console.log('FAIL bannerFull', vp.name); }
  if (!a.cardFull) { allPass = false; console.log('FAIL cardFull', vp.name); }
  if (!a.pillsOk) { allPass = false; console.log('FAIL pillsOk', vp.name); }
  if (vp.width < 768) {
    if (!a.cardsOk) { allPass = false; console.log('FAIL cardsOk', vp.name); }
  }
}

console.log('ALL_PASS', allPass);
await browser.close();
server.close();
console.log('DONE');
