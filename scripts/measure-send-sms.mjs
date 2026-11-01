import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8124;

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8' };
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(() => { try { localStorage.setItem('authToken','fake-token'); localStorage.setItem('authStorageType','local'); localStorage.setItem('userName','John Doe'); } catch(e){} });
const page = await context.newPage();
await page.setViewportSize({ width: 1366, height: 650 });
await page.route('**/api/**', (route) => {
  const url = route.request().url();
  let body = { data: {} };
  if (url.includes('/auth/me')) body = { data: { user: { name: 'John Doe' } } };
  else if (url.includes('/wallet')) body = { data: { balance: 100 } };
  else if (url.includes('/sender-ids')) body = { data: { senderIds: [{ senderId: 'NEDHUB', status: 'approved' }] } };
  else if (url.includes('/contacts')) body = { data: { contacts: [] } };
  else if (url.includes('/calculate-cost')) body = { data: { cost: 0.04, segments: 1, encoding: 'gsm7' } };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.goto(`http://localhost:${PORT}/src/pages/dashboard/send-sms.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
  // find compose card: try several selectors
  const compose = document.querySelector('.sms-form-card') || document.querySelector('.ss2-compose') || document.querySelector('.compose-card') || document.querySelector('#sendSmsForm')?.parentElement;
  const chain = [];
  let el = compose;
  while (el) {
    const cs = getComputedStyle(el);
    chain.push({
      tag: el.tagName,
      id: el.id || null,
      classes: (typeof el.className === 'string' ? el.className : ''),
      display: cs.display,
      position: cs.position,
      width: cs.width,
      maxWidth: cs.maxWidth,
      flex: cs.flex,
      alignItems: cs.alignItems,
      justifyContent: cs.justifyContent,
      gridTemplateColumns: cs.gridTemplateColumns,
      margin: cs.margin,
      padding: cs.padding,
      overflow: cs.overflow,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      boxSizing: cs.boxSizing,
      rect: { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, right: el.getBoundingClientRect().right },
    });
    if (el === document.body) break;
    el = el.parentElement;
  }
  // matching rules
  const chainSet = new Set(chain.map(c => c.el).filter(Boolean));
  // We'll instead collect elements
  const els = [];
  let e = compose;
  while (e) { els.push(e); if (e === document.body) break; e = e.parentElement; }
  const rules = [];
  for (const sheet of document.styleSheets) {
    const href = sheet.href || 'inline';
    let cssRules;
    try { cssRules = sheet.cssRules; } catch (err) { continue; }
    if (!cssRules) continue;
    for (const r of cssRules) {
      if (r.type !== 1) continue;
      const sel = r.selectorText;
      let matchedEls = [];
      try {
        const nl = document.querySelectorAll(sel);
        for (const n of nl) { if (els.includes(n)) matchedEls.push(n); }
      } catch (err) { /* invalid selector */ }
      if (matchedEls.length === 0) continue;
      const style = r.style;
      const props = ['width','max-width','display','flex','flex-direction','align-items','justify-content','grid-template-columns','margin','padding','overflow','overflow-x','overflow-y','position'];
      const relevant = [];
      for (const p of props) {
        const v = style.getPropertyValue(p);
        if (v) {
          relevant.push({ prop: p, value: v, important: style.getPropertyPriority(p) === 'important' });
        }
      }
      if (relevant.length === 0) continue;
      rules.push({ file: href, selector: sel, properties: relevant });
    }
  }
  return { chain, rules, composeSelector: compose ? compose.outerHTML.slice(0,200) : null };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
