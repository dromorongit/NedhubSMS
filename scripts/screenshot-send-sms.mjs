import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8123;
const OUT_DIR = process.argv[2] || path.join(ROOT, 'docs', 'screenshots', 'send-sms', 'after');

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

function mockApi(route) {
  const url = route.request().url();
  let body = { data: {} };
  if (url.includes('/auth/me')) body = { data: { user: { name: 'John Doe', email: 'john@example.com' } }, message: 'ok' };
  else if (url.includes('/wallet')) body = { data: { balance: 100.00 } };
  else if (url.includes('/sender-ids')) body = { data: { senderIds: [{ senderId: 'NEDHUB', status: 'approved' }, { senderId: 'NEDHUB2', status: 'pending' }] } };
  else if (url.includes('/contacts')) body = { data: { contacts: [] } };
  else if (url.includes('/calculate-cost')) body = { data: { cost: 0.04, segments: 1, encoding: 'gsm7', recipientCount: 0 } };
  else if (url.includes('/sms/upload-temp') || url.includes('/sms-uploads')) body = { data: { recipients: [{ name: 'John', phone: '0241234567' }], total: 1, valid: 1, invalid: 0, duplicates: 0 } };
  else if (url.includes('/blacklist')) body = { data: { blacklisted: [] } };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(() => {
  try { localStorage.setItem('authToken', 'fake-token-for-screenshot'); localStorage.setItem('authStorageType', 'local'); localStorage.setItem('userName', 'John Doe'); } catch (e) {}
});

const viewports = [
  { width: 1672, height: 900, name: '1672x900' },
  { width: 1366, height: 650, name: '1366x650' },
  { width: 1100, height: 800, name: '1100x800' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 390, height: 844, name: '390x844' },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const allResults = {};

for (const vp of viewports) {
  const page = await context.newPage();
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.route('**/api/**', mockApi);
  await page.goto(`http://localhost:${PORT}/src/pages/dashboard/send-sms.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const outPath = path.join(OUT_DIR, `send-sms-${vp.name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('saved', outPath);

  const asserts = await page.evaluate(() => {
    const grid = document.querySelector('.ss2-grid');
    const composeCard = document.querySelector('.ss2-compose .sms-form-card') || document.querySelector('.sms-form-card');
    const gridRect = grid ? grid.getBoundingClientRect() : null;
    const composeRect = composeCard ? composeCard.getBoundingClientRect() : null;
    // 3 columns check: computed grid-template-columns count
    const gcs = grid ? getComputedStyle(grid) : null;
    const cols = gcs ? gcs.gridTemplateColumns.split(/\s+(?![^()]*\))/).filter(Boolean).length : 0;
    // actually split by spaces not inside minmax; minmax(0, 1fr) has space inside. Count minmax occurrences + px
    const colStr = gcs ? gcs.gridTemplateColumns : '';
    const colCount = (colStr.match(/minmax|px|fr/g) || []).length; // rough
    // better: count top-level columns by counting 'minmax' and standalone lengths
    const matches = colStr.match(/minmax\([^)]*\)|\d+px|\d+fr/g) || [];
    const nCols = matches.length;

    // compose sections width >= 90% of card inner width
    let sectionsOk = true;
    let minSectionRatio = 1;
    if (composeCard) {
      const cardRect = composeCard.getBoundingClientRect();
      const cs = getComputedStyle(composeCard);
      const innerWidth = cardRect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const sections = composeCard.querySelectorAll('section, .form-group, .form-row, .message-composer-section, .schedule-section, .char-counter-wrapper, .send-now-action, .duplicate-handling-section, .personalization-section');
      // fallback: direct children divs
      const targets = sections.length ? sections : composeCard.children;
      targets.forEach((s) => {
        const r = s.getBoundingClientRect();
        if (r.width > 0) {
          const ratio = r.width / innerWidth;
          if (ratio < minSectionRatio) minSectionRatio = ratio;
          if (ratio < 0.9) sectionsOk = false;
        }
      });
    }

    // no horizontal scroll
    const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth;

    // no sticky/fixed in page content (excluding modals? check all non-sidebar/top-nav)
    const badPos = [];
    document.querySelectorAll('body.page-send-sms *').forEach((el) => {
      if (el.closest('.sidebar, .top-nav, .modal, .sidebar-overlay')) return;
      if (el.classList && (el.classList.contains('modal') || el.classList.contains('sidebar-overlay'))) return;
      const pos = getComputedStyle(el).position;
      if (pos === 'sticky' || pos === 'fixed') badPos.push({ tag: el.tagName, cls: el.className, pos });
    });

    // mojibake in text
    const text = document.body.innerText || '';
    const mojibake = /[âÃÂ]/.test(text);

    // compose width
    const composeWidth = composeRect ? composeRect.width : 0;

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      gridCols: nCols,
      gridColStr: colStr,
      composeWidth,
      sectionsOk,
      minSectionRatio,
      noHScroll,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      badPosCount: badPos.length,
      badPosSample: badPos.slice(0, 5),
      mojibake,
    };
  });

  allResults[vp.name] = asserts;
  console.log('ASSERTS', vp.name, JSON.stringify(asserts));
  await page.close();
}

await browser.close();
server.close();

// Overall pass/fail
let allPass = true;
for (const vp of viewports) {
  const a = allResults[vp.name];
  const threeCols = (vp.width >= 1200) ? (a.gridCols === 3) : true;
  const composeOk = (vp.width === 1366) ? (a.composeWidth >= 480) : true;
  if (!threeCols || !composeOk || !a.sectionsOk || !a.noHScroll || a.badPosCount > 0 || a.mojibake) {
    allPass = false;
    console.log('FAIL', vp.name, { threeCols, composeOk, sectionsOk: a.sectionsOk, noHScroll: a.noHScroll, badPos: a.badPosCount, mojibake: a.mojibake });
  }
}
console.log('ALL_PASS', allPass);
console.log('RESULTS_JSON', JSON.stringify(allResults, null, 2));
