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

const capturedRequests = [];

function mockApi(route) {
  const url = route.request().url();
  const postData = route.request().postData();
  capturedRequests.push({ url, method: route.request().method(), body: postData || '' });
  let body = { data: {} };
  if (url.includes('/auth/me')) body = { data: { user: { name: 'John Doe', email: 'john@example.com' } }, message: 'ok' };
  else if (url.includes('/wallet')) body = { data: { balance: 2.00 } };
  else if (url.includes('/sender-ids')) body = { data: { senderIds: [{ senderId: 'NEDHUB', status: 'approved' }, { senderId: 'NEDHUB2', status: 'pending' }] } };
  else if (url.includes('/contacts')) body = { data: { contacts: [] } };
  else if (url.includes('/calculate-cost')) body = { data: { cost: 0.04, segments: 1, encoding: 'gsm7', recipientCount: 0 } };
  else if (url.includes('/sms/upload-temp') || url.includes('/sms-uploads')) body = { data: { recipients: [{ name: 'John', phone: '0241234567' }], total: 1, valid: 1, invalid: 0, duplicates: 0 } };
  else if (url.includes('/blacklist')) body = { data: { blacklisted: [] } };
  else if (url.includes('/sms/send') || url.includes('/sms/schedule')) body = { data: { success: true, messageId: 'msg_1' }, message: 'ok' };
  else if (url.includes('/sms-campaigns')) body = { data: { success: true }, message: 'ok' };
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
    const composeCard = document.querySelector('.ss2-compose');
    const phone = document.querySelector('.ss2-phone');
    const summary = document.querySelector('.ss2-summary');
    const networks = document.querySelector('.ss2-networks');
    const schedule = document.querySelector('.schedule-section');
    const contentArea = document.querySelector('.dashboard-content') || document.querySelector('.main-content') || document.querySelector('.ss2');
    const gcs = grid ? getComputedStyle(grid) : null;
    const colStr = gcs ? gcs.gridTemplateColumns : '';
    const matches = colStr.match(/minmax\([^)]*\)|\d+px|\d+fr/g) || [];
    const nCols = matches.length;

    const composeRect = composeCard ? composeCard.getBoundingClientRect() : null;
    const phoneRect = phone ? phone.getBoundingClientRect() : null;
    const summaryRect = summary ? summary.getBoundingClientRect() : null;
    const networksRect = networks ? networks.getBoundingClientRect() : null;
    const scheduleRect = schedule ? schedule.getBoundingClientRect() : null;
    const gridRect = grid ? grid.getBoundingClientRect() : null;
    const contentRect = contentArea ? contentArea.getBoundingClientRect() : null;

    const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
    const text = document.body.innerText || '';
    const mojibake = /[âÃÂ]/.test(text);

    const assertions = {
      phoneLeftGEComposeRight: !!(phoneRect && composeRect && phoneRect.left >= composeRect.right - 1),
      summaryLeftGEPhoneRight: !!(summaryRect && phoneRect && summaryRect.left >= phoneRect.right - 1),
      networksLeftEqSummaryLeft: !!(networksRect && summaryRect && Math.abs(networksRect.left - summaryRect.left) <= 2),
      networksTopGESummaryBottom: !!(networksRect && summaryRect && networksRect.top >= summaryRect.bottom - 1),
      gridRightWithin24OfContent: !!(gridRect && contentRect && Math.abs(contentRect.right - gridRect.right) <= 24),
      phoneTopWithin40OfComposeTop: !!(phoneRect && composeRect && Math.abs(phoneRect.top - composeRect.top) <= 40),
      scheduleLeftEqPhoneLeft: !!(scheduleRect && phoneRect && Math.abs(scheduleRect.left - phoneRect.left) <= 2),
      scheduleTopGapPhone: !!(scheduleRect && phoneRect && (scheduleRect.top - phoneRect.bottom) >= 12 && (scheduleRect.top - phoneRect.bottom) <= 40),
      scheduleWidthEqPhone: !!(scheduleRect && phoneRect && Math.abs(scheduleRect.width - phoneRect.width) <= 2),
      scheduleNotDescendantCompose: !!(schedule && composeCard && !composeCard.contains(schedule)),
      summaryLeftGEScheduleRight: !!(summaryRect && scheduleRect && summaryRect.left >= scheduleRect.right - 1),
      noHScroll,
      noMojibake: !mojibake,
      // mobile order
      mobileOrder: !!(composeRect && scheduleRect && phoneRect && summaryRect && networksRect &&
        composeRect.top < scheduleRect.top && scheduleRect.top < phoneRect.top &&
        phoneRect.top < summaryRect.top && summaryRect.top < networksRect.top),
    };

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      gridCols: nCols,
      gridColStr: colStr,
      noHScroll,
      mojibake,
      assertions,
      measure: {
        compose: composeRect ? { left: Math.round(composeRect.left), top: Math.round(composeRect.top), right: Math.round(composeRect.right), bottom: Math.round(composeRect.bottom), width: Math.round(composeRect.width) } : null,
        phone: phoneRect ? { left: Math.round(phoneRect.left), top: Math.round(phoneRect.top), right: Math.round(phoneRect.right), bottom: Math.round(phoneRect.bottom), width: Math.round(phoneRect.width) } : null,
        schedule: scheduleRect ? { left: Math.round(scheduleRect.left), top: Math.round(scheduleRect.top), right: Math.round(scheduleRect.right), bottom: Math.round(scheduleRect.bottom), width: Math.round(scheduleRect.width) } : null,
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

// Request capture test
console.log('--- REQUEST CAPTURE TEST ---');
const testPage = await context.newPage();
await testPage.setViewportSize({ width: 1280, height: 720 });
await testPage.route('**/api/**', mockApi);
capturedRequests.length = 0;
await testPage.goto(`http://localhost:${PORT}/src/pages/dashboard/send-sms.html`, { waitUntil: 'networkidle' });
await testPage.waitForTimeout(1500);
try { await testPage.selectOption('#senderId', 'NEDHUB'); } catch (e) { console.log('sender select err', e.message); }
await testPage.fill('#commaSeparatedRecipients', '0241234567');
await testPage.fill('#messageBody', 'Hello world');
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const dateStr = tomorrow.toISOString().split('T')[0];
await testPage.fill('#scheduledDate', dateStr);
await testPage.fill('#scheduledTime', '10:30');
await testPage.waitForTimeout(800);
await testPage.click('#scheduleBtn');
await testPage.waitForTimeout(1200);
try { await testPage.click('#confirmationSendBtn'); } catch (e) { console.log('confirm sched err', e.message); }
await testPage.waitForTimeout(2000);
const schedReq = capturedRequests.find(r => r.url.includes('/sms/schedule') || r.url.includes('/sms-campaigns/schedule'));
console.log('SCHEDULE_REQUEST_BODY', schedReq ? schedReq.body : 'NONE');
let schedHasDate = false, schedHasTime = false, schedNoIssue = true;
if (schedReq && schedReq.body) {
  schedHasDate = schedReq.body.includes(dateStr);
  schedHasTime = schedReq.body.includes('10:30');
}
console.log('SCHED_HAS_DATE', schedHasDate, 'SCHED_HAS_TIME', schedHasTime);

// Send Now on a fresh page
capturedRequests.length = 0;
await testPage.goto(`http://localhost:${PORT}/src/pages/dashboard/send-sms.html`, { waitUntil: 'networkidle' });
await testPage.waitForTimeout(1500);
try { await testPage.selectOption('#senderId', 'NEDHUB'); } catch (e) {}
await testPage.fill('#commaSeparatedRecipients', '0241234567');
await testPage.fill('#messageBody', 'Hello world');
await testPage.waitForTimeout(500);
await testPage.click('#sendNowBtn');
await testPage.waitForTimeout(1200);
try { await testPage.click('#confirmationSendBtn'); } catch (e) { console.log('confirm send err', e.message); }
await testPage.waitForTimeout(2000);
const sendReq = capturedRequests.find(r => (r.url.includes('/sms/send') || r.url.includes('/sms-campaigns/send')) && r.method === 'POST');
console.log('SEND_REQUEST_BODY', sendReq ? sendReq.body : 'NONE');
let sendHasSchedule = false;
if (sendReq && sendReq.body) {
  sendHasSchedule = /scheduledAt/i.test(sendReq.body);
}
console.log('SEND_HAS_SCHEDULE', sendHasSchedule);

await testPage.close();

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
  if (!A.noHScroll) requiredOk = false;
  if (!A.noMojibake) requiredOk = false;
  if (!A.gridRightWithin24OfContent) requiredOk = false;
  // >=1200 (3 cols): placement
  if (vp.width >= 1200) {
    if (!A.phoneLeftGEComposeRight) requiredOk = false;
    if (!A.summaryLeftGEPhoneRight) requiredOk = false; // summary right of phone? kept
    if (!A.networksTopGESummaryBottom) requiredOk = false;
    if (!A.scheduleLeftEqPhoneLeft) requiredOk = false;
    if (!A.scheduleTopGapPhone) requiredOk = false;
    if (!A.scheduleWidthEqPhone) requiredOk = false;
    if (!A.scheduleNotDescendantCompose) requiredOk = false;
    if (!A.summaryLeftGEScheduleRight) requiredOk = false;
  }
  // 2-col
  if (vp.width >= 768 && vp.width < 1200) {
    if (!A.phoneLeftGEComposeRight) requiredOk = false;
    if (!A.phoneTopWithin40OfComposeTop) requiredOk = false;
  }
  // mobile order
  if (vp.width < 768) {
    if (!A.mobileOrder) requiredOk = false;
  }
  if (!colOk || !requiredOk) {
    allPass = false;
    console.log('FAIL', vp.name, { colOk, expCols, gotCols: a.gridCols, requiredOk });
  }
}
// request capture pass
if (!schedHasDate || !schedHasTime) { allPass = false; console.log('FAIL request capture: schedule missing date/time'); }
if (sendHasSchedule) { allPass = false; console.log('FAIL request capture: send now carried schedule'); }

console.log('ALL_PASS', allPass);
console.log('RESULTS_JSON', JSON.stringify(allResults, null, 2));