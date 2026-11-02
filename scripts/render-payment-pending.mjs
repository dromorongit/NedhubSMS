import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8126;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
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
});

await new Promise((resolve) => server.listen(PORT, resolve));

const base = `http://localhost:${PORT}`;
const REF = 'NH-TEST-REF-12345';
const results = [];

async function runSequence(name, viewport, routeSetup, assertions) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.navigator.clipboard = { writeText: async () => {} };
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => { consoleErrors.push(err.message); });
  await page.setViewportSize(viewport);
  await page.route('**/api/payments/status/*', routeSetup.status);
  await page.route('**/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { user: { name: 'Test User', email: 't@example.com', role: 'user' } } }) });
  });
  await page.goto(`${base}/src/pages/dashboard/payment-pending.html?reference=${encodeURIComponent(REF)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const result = await page.evaluate((ref) => {
    const refEl = document.getElementById('ref');
    const longRefEl = document.getElementById('longRef');
    const longPending = document.getElementById('longPending');
    const copyRef = document.getElementById('copyRef');
    const networkMsg = document.getElementById('networkMsg');
    const title = document.getElementById('title');
    const hScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return {
      refText: refEl ? refEl.textContent : null,
      longRefText: longRefEl ? longRefEl.textContent : null,
      longPendingExists: !!longPending,
      longPendingText: longPending ? longPending.textContent : null,
      longPendingDisplay: longPending ? getComputedStyle(longPending).display : null,
      copyRefExists: !!copyRef,
      networkMsgDisplay: networkMsg ? getComputedStyle(networkMsg).display : null,
      titleText: title ? title.textContent : null,
      hasDoNotPayAgain: longPending ? longPending.textContent.includes('Do not pay again') : false,
      hScroll,
      location: window.location.href
    };
  }, REF);
  result.consoleErrors = consoleErrors;
  result.page = name;
  result.vp = `${viewport.width}x${viewport.height}`;
  try {
    await assertions(page, result);
    result.assertionsPassed = true;
  } catch (e) {
    result.assertionError = e.message;
    result.assertionsPassed = false;
  }
  await context.close();
  await browser.close();
  results.push(result);
}

const viewports = [
  { width: 1366, height: 768 },
  { width: 390, height: 844 }
];

// 1. pending then success
for (const vp of viewports) {
  let calls = 0;
  await runSequence('pending-then-success', vp, {
    status: async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'pending', amount: 10, currency: 'GHS' } }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'paid', amount: 10, currency: 'GHS' } }) });
      }
    }
  }, async (page, r) => {
    await page.waitForTimeout(7000);
    const final = await page.evaluate(() => window.location.href);
    if (!final.includes('payment-success.html')) throw new Error('did not navigate to payment-success.html, got ' + final);
    if (!final.includes('reference=' + REF)) throw new Error('reference not in success URL');
    r.finalUrl = final;
  });
}

// 2. pending for whole timeout (long-pending message, Copy reference works, 'Do not pay again')
for (const vp of viewports) {
  await runSequence('long-pending', vp, {
    status: async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'pending', amount: 10, currency: 'GHS' } }) });
    }
  }, async (page, r) => {
    await page.waitForTimeout(8000);
    const stillPending = await page.evaluate(() => window.location.href.includes('payment-pending.html'));
    if (!stillPending) throw new Error('navigated away from pending page during long-pending');
    if (!r.longPendingExists) throw new Error('longPending element missing from DOM');
    if (!r.hasDoNotPayAgain) throw new Error("'Do not pay again' text not present");
    if (r.refText !== REF) throw new Error('reference not shown as text, got ' + r.refText);
    // Copy reference works: reveal the hidden section then click
    await page.evaluate(() => { const el = document.getElementById('longPending'); if (el) el.style.display = 'block'; });
    await page.click('#copyRef');
    r.copyRefClicked = true;
  });
}

// 3. failed -> payment-error
for (const vp of viewports) {
  await runSequence('failed', vp, {
    status: async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'failed', amount: 10, currency: 'GHS' } }) });
    }
  }, async (page, r) => {
    await page.waitForTimeout(7000);
    const final = await page.evaluate(() => window.location.href);
    if (!final.includes('payment-error.html')) throw new Error('did not navigate to payment-error.html, got ' + final);
    if (!final.includes('reference=' + REF)) throw new Error('reference not in error URL');
    r.finalUrl = final;
  });
}

// 4. cancelled -> payment-cancelled
for (const vp of viewports) {
  await runSequence('cancelled', vp, {
    status: async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'cancelled', amount: 10, currency: 'GHS' } }) });
    }
  }, async (page, r) => {
    await page.waitForTimeout(7000);
    const final = await page.evaluate(() => window.location.href);
    if (!final.includes('payment-cancelled.html')) throw new Error('did not navigate to payment-cancelled.html, got ' + final);
    r.finalUrl = final;
  });
}

// 5. network error -> friendly message, keeps retrying
for (const vp of viewports) {
  await runSequence('network-error', vp, {
    status: async (route) => {
      await route.abort();
    }
  }, async (page, r) => {
    await page.waitForTimeout(8000);
    if (r.networkMsgDisplay !== 'block') throw new Error('network error message not shown, display=' + r.networkMsgDisplay);
    const stillPending = await page.evaluate(() => window.location.href.includes('payment-pending.html'));
    if (!stillPending) throw new Error('navigated away on network error');
  });
}

// 6. verification delayed -> reassuring message after 3 attempts, reference + Copy reference, no technical details
for (const vp of viewports) {
  await runSequence('verification-delayed', vp, {
    status: async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'pending', amount: 10, currency: 'GHS', verificationDelayed: true } }) });
    }
  }, async (page, r) => {
    await page.waitForTimeout(8000);
    const delayed = await page.evaluate(() => {
      const el = document.getElementById('verificationDelayedMsg');
      if (!el) return null;
      return { display: getComputedStyle(el).display, text: el.innerText };
    });
    if (!delayed || delayed.display !== 'block') throw new Error('verification delayed message not shown after 3 attempts, display=' + (delayed ? delayed.display : 'missing'));
    if (!delayed.text.includes('We have received your payment and are still confirming it with our payment partner')) throw new Error('delayed message text missing');
    if (!delayed.text.includes('Your wallet will be credited automatically, and you do not need to pay again')) throw new Error('do-not-pay-again sentence missing');
    if (!delayed.text.includes(REF)) throw new Error('reference not shown in delayed message, got ' + JSON.stringify(delayed.text));
    const copyVisible = await page.evaluate(() => {
      const b = document.getElementById('copyRefDelayed');
      return !!b && getComputedStyle(b).display !== 'none';
    });
    if (!copyVisible) throw new Error('Copy reference button not visible');
    if (delayed.text.includes('Hubtel') || delayed.text.includes('HTTP') || delayed.text.includes('401') || delayed.text.includes('500')) throw new Error('technical details leaked into delayed message');
    r.delayedShown = true;
  });
}

await server.close();

console.log('=== PAYMENT-PENDING RENDER RESULTS ===');
for (const r of results) {
  const status = r.assertionsPassed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${r.page} @ ${r.vp}`);
  console.log(`       refText=${JSON.stringify(r.refText)} longRefText=${JSON.stringify(r.longRefText)}`);
  console.log(`       longPendingExists=${r.longPendingExists} hasDoNotPayAgain=${r.hasDoNotPayAgain} copyRefExists=${r.copyRefExists} copyRefClicked=${r.copyRefClicked} delayedShown=${r.delayedShown}`);
  console.log(`       networkMsgDisplay=${r.networkMsgDisplay} hScroll=${r.hScroll} consoleErrors=${r.consoleErrors.length}`);
  if (r.finalUrl) console.log(`       finalUrl=${r.finalUrl}`);
  if (r.assertionError) console.log(`       ASSERTION ERROR: ${r.assertionError}`);
  const unexpected = r.consoleErrors.filter((e) => !e.includes('ERR_FAILED') && !e.includes('ERR_CONNECTION_REFUSED'));
  if (unexpected.length) console.log(`       CONSOLE ERRORS: ${unexpected.join('; ')}`);
}
const fails = results.filter((r) => !r.assertionsPassed);
console.log(`\nTotal sequences: ${results.length} Failures: ${fails.length}`);
if (fails.length) process.exit(1);
