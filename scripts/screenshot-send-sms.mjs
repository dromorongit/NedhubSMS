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
  else if (url.includes('/wallet')) body = { data: { balance: 2.00 } };
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
  { width: 1366, height: 768, name: '1366x768' },
  { width: 1280, height: 720, name: '1280x720' },
  { width: 1440, height: 900, name: '1440x900' },
  { width: 1100, height: 800, name: '1100x800' },
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
  try { await page.click('.messaging-mode-tabs .tab-btn[data-mode="personalized"]'); await page.waitForTimeout(500); } catch (e) {}
  try { await page.fill('#messageBody', 'Dear {{name}}, '); await page.waitForTimeout(300); } catch (e) {}

  const outPath = path.join(OUT_DIR, `send-sms-${vp.name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('saved', outPath);

  const asserts = await page.evaluate(() => {
    const grid = document.querySelector('.ss2-grid');
    const composeCard = document.querySelector('.sms-form-card');
    const phone = document.querySelector('.ss2-phone');
    const summary = document.querySelector('.ss2-summary');
    const networks = document.querySelector('.ss2-networks');
    const contentArea = document.querySelector('.dashboard-content') || document.querySelector('.main-content') || document.querySelector('.ss2');
    const gcs = grid ? getComputedStyle(grid) : null;
    const colStr = gcs ? gcs.gridTemplateColumns : '';
    const matches = colStr.match(/minmax\([^)]*\)|\d+px|\d+fr/g) || [];
    const nCols = matches.length;

    const composeRect = composeCard ? composeCard.getBoundingClientRect() : null;
    const phoneRect = phone ? phone.getBoundingClientRect() : null;
    const summaryRect = summary ? summary.getBoundingClientRect() : null;
    const networksRect = networks ? networks.getBoundingClientRect() : null;
    const gridRect = grid ? grid.getBoundingClientRect() : null;
    const contentRect = contentArea ? contentArea.getBoundingClientRect() : null;

    const msgContent = document.querySelector('.message-composer-section');
    const schedule = document.querySelector('.schedule-section');
    let scheduleAfterMessageDom = false;
    if (msgContent && schedule) {
      scheduleAfterMessageDom = !!(msgContent.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    const scheduleAfterMessageScreen = !!(msgContent && schedule && schedule.getBoundingClientRect().top >= msgContent.getBoundingClientRect().bottom - 5);

    const senderSelect = document.querySelector('#senderId');
    const createBtn = document.querySelector('#createSenderIdBtn');
    const sr = senderSelect ? senderSelect.getBoundingClientRect() : null;
    const cr = createBtn ? createBtn.getBoundingClientRect() : null;
    const createNewSameRow = !!(sr && cr && Math.abs(sr.top - cr.top) <= 6);
    const senderDebug = { sr: sr?{top:Math.round(sr.top),left:Math.round(sr.left),right:Math.round(sr.right),height:Math.round(sr.height)}:null, cr: cr?{top:Math.round(cr.top),left:Math.round(cr.left),right:Math.round(cr.right),height:Math.round(cr.height)}:null, flexDir: senderSelect && senderSelect.parentElement ? getComputedStyle(senderSelect.parentElement).flexDirection : null, btnWidth: cr?Math.round(cr.width):null };

    const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
    const text = document.body.innerText || '';
    const mojibake = /[Ã¢ÃƒÃ‚]/.test(text);

    const assertions = {
      phoneLeftGEComposeRight: !!(phoneRect && composeRect && phoneRect.left >= composeRect.right - 1),
      summaryLeftGEPhoneRight: !!(summaryRect && phoneRect && summaryRect.left >= phoneRect.right - 1),
      networksLeftEqSummaryLeft: !!(networksRect && summaryRect && Math.abs(networksRect.left - summaryRect.left) <= 2),
      networksTopGESummaryBottom: !!(networksRect && summaryRect && networksRect.top >= summaryRect.bottom - 1),
      gridRightWithin24OfContent: !!(gridRect && contentRect && Math.abs(contentRect.right - gridRect.right) <= 24),
      phoneTopWithin40OfComposeTop: !!(phoneRect && composeRect && Math.abs(phoneRect.top - composeRect.top) <= 40),
      scheduleAfterMessageDom,
      scheduleAfterMessageScreen,
      createNewSameRow,
      noHScroll,
      noMojibake: !mojibake,
    };

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      gridCols: nCols,
      gridColStr: colStr,
      composeWidth: composeRect ? Math.round(composeRect.width) : 0,
      noHScroll,
      mojibake,
      assertions,
      senderDebug,
      measure: {
        compose: composeRect ? { left: Math.round(composeRect.left), top: Math.round(composeRect.top), right: Math.round(composeRect.right), bottom: Math.round(composeRect.bottom), width: Math.round(composeRect.width) } : null,
        phone: phoneRect ? { left: Math.round(phoneRect.left), top: Math.round(phoneRect.top), right: Math.round(phoneRect.right), bottom: Math.round(phoneRect.bottom), width: Math.round(phoneRect.width) } : null,
        summary: summaryRect ? { left: Math.round(summaryRect.left), top: Math.round(summaryRect.top), right: Math.round(summaryRect.right), bottom: Math.round(summaryRect.bottom), width: Math.round(summaryRect.width) } : null,
        networks: networksRect ? { left: Math.round(networksRect.left), top: Math.round(networksRect.top), right: Math.round(networksRect.right), bottom: Math.round(networksRect.bottom), width: Math.round(networksRect.width) } : null,
        grid: gridRect ? { left: Math.round(gridRect.left), top: Math.round(gridRect.top), right: Math.round(gridRect.right), bottom: Math.round(gridRect.bottom), width: Math.round(gridRect.width) } : null,
        content: contentRect ? { left: Math.round(contentRect.left), top: Math.round(contentRect.top), right: Math.round(contentRect.right), bottom: Math.round(contentRect.bottom), width: Math.round(contentRect.width) } : null,
      },
    };
  });

  allResults[vp.name] = asserts;
  console.log('ASSERTIONS', vp.name, JSON.stringify(asserts));
  await page.close();
}

await browser.close();
server.close();

let allPass = true;
for (const vp of viewports) {
  const a = allResults[vp.name];
  const expCols = vp.width >= 1200 ? 3 : (vp.width >= 768 ? 2 : 1);
  const colOk = a.gridCols === expCols;
  const A = a.assertions;
  let requiredOk = true;
  // universal
  if (!A.networksTopGESummaryBottom) requiredOk = false;
  if (!A.gridRightWithin24OfContent) requiredOk = false;
  if (!A.scheduleAfterMessageDom || !A.scheduleAfterMessageScreen) requiredOk = false;
  if (!A.noHScroll) requiredOk = false;
  if (!A.noMojibake) requiredOk = false;
  // >=1280: createNew same row
  if (vp.width >= 1280 && !A.createNewSameRow) requiredOk = false;
  // >=1200 (3 cols): phone/summary/networks placement
  if (vp.width >= 1200) {
    if (!A.phoneLeftGEComposeRight) requiredOk = false;
    if (!A.summaryLeftGEPhoneRight) requiredOk = false;
    if (!A.networksLeftEqSummaryLeft) requiredOk = false;
  }
  // >=768 (2+ cols): phone top aligned
  if (vp.width >= 768) {
    if (!A.phoneTopWithin40OfComposeTop) requiredOk = false;
    if (vp.width < 1200) {
      // 2-col: phone is right of compose
      if (!A.phoneLeftGEComposeRight) requiredOk = false;
    }
  }
  if (!colOk || !requiredOk) {
    allPass = false;
    console.log('FAIL', vp.name, { colOk, expCols, gotCols: a.gridCols, requiredOk });
  }
}
console.log('ALL_PASS', allPass);
console.log('RESULTS_JSON', JSON.stringify(allResults, null, 2));




