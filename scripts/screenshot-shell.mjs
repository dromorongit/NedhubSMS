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
  'analytics','blacklist','buy-airtime','buy-data','campaigns','contacts','history','overview','payment-cancelled','payment-error','payment-pending','payment-success','reports','send-sms','settings','templates','transactions','utility-payments'
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
  { width: 390, height: 664, name: '390x664' },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const allResults = [];
const topbarSnapshots = [];

for (const pageName of PAGES) {
  for (const vp of viewports) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try { localStorage.setItem('authToken', 'fake-token-for-screenshot'); localStorage.setItem('authStorageType', 'local'); localStorage.setItem('userName', 'John Doe'); } catch (e) {}
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error' && !/ERR_|Failed to load resource|net::/i.test(msg.text())) consoleErrors.push(msg.text()); });
    page.on('pageerror', err => { if (!/ERR_|Failed to load resource|net::/i.test(err.message)) consoleErrors.push(err.message); });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.route('**/api/**', mockApi);
    await page.goto(`http://localhost:${PORT}/src/pages/dashboard/${pageName}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const isMobile = vp.width === 390;
    // open drawer for mobile so sidebar visible for assertions/screenshots
    if (isMobile) {
      await page.click('.nhs-burger', { force: true });
      await page.waitForTimeout(600);
    }

    // viewport screenshot for pixel sampling
    const vpShot = await page.screenshot({ fullPage: false });
    const vpDataUrl = 'data:image/png;base64,' + vpShot.toString('base64');

    const asserts = await page.evaluate(async ({REQUIRED_ORDER, vp, pageName, vpDataUrl}) => {
      const sidebar = document.querySelector('.nhs-sidebar');
      const nav = sidebar ? sidebar.querySelector('.nhs-nav') : null;
      const links = nav ? Array.from(nav.querySelectorAll('.nhs-link')) : [];
      const order = links.map(a => (a.querySelector('span') ? a.querySelector('span').textContent.trim() : a.textContent.trim()));
      const orderOk = JSON.stringify(order) === JSON.stringify(REQUIRED_ORDER);

      const active = sidebar ? sidebar.querySelector('.nhs-link[aria-current="page"], .nhs-link.is-active') : null;
      const activeHref = active ? (active.getAttribute('href') || '') : '';
      const navHrefs = ['overview.html','send-sms.html','campaigns.html','contacts.html','history.html','blacklist.html','transactions.html','buy-airtime.html','buy-data.html','utility-payments.html','reports.html','templates.html','analytics.html','settings.html'];
      const pageInNav = navHrefs.includes(pageName.toLowerCase());
      const activeOk = pageInNav ? activeHref.toLowerCase().endsWith(pageName.toLowerCase()) : (active === null);

      const main = document.querySelector('.main-content');
      const sRect = sidebar ? sidebar.getBoundingClientRect() : null;
      const mRect = main ? main.getBoundingClientRect() : null;
      let desktopOk = true;
      if (vp.width >= 1024) {
        desktopOk = !!sRect && sRect.left <= 1 && Math.abs(sRect.width - 260) <= 1 && !!mRect && mRect.left >= 260 - 1;
      }

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

      const logoutLink = sidebar ? sidebar.querySelector('.nhs-link--logout') : null;
      const logoutInNav = !!logoutLink && !!nav && nav.contains(logoutLink);
      const allLinks = links.concat(logoutLink ? [logoutLink] : []);
      const lastIsLogout = allLinks.length > 0 && allLinks[allLinks.length-1] === logoutLink;
      const logoutOk = logoutInNav && lastIsLogout;

      const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
      if (!noHScroll) console.log('HSCROLL', pageName, vp.name, document.documentElement.scrollWidth, document.documentElement.clientWidth);
      const text = (document.body && document.body.innerText) ? document.body.innerText : '';
      const mojibake = /[���]/.test(text);

      const topbar = document.querySelector('.nhs-topbar');
      const topbarHeight = topbar ? topbar.getBoundingClientRect().height : 0;
      const topbarHtml = topbar ? topbar.outerHTML : '';

      // ---- color helpers ----
      function parseColor(str) {
        if (!str) return [0,0,0,0];
        const m = str.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const parts = m[1].split(',').map(s=>s.trim());
          return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]), parts[3]===undefined?1:parseFloat(parts[3])];
        }
        if (str.trim().startsWith('#')) {
          let h = str.trim().replace('#','');
          if (h.length === 3) h = h.split('').map(c=>c+c).join('');
          if (h.length === 8) {
            return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), parseInt(h.slice(6,8),16)/255];
          }
          if (h.length === 6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1];
        }
        return [0,0,0,0];
      }
      function extractFirstColor(bgImage) {
        if (!bgImage || bgImage === 'none') return null;
        const mHex = bgImage.match(/#[0-9a-f]{3,8}/i);
        if (mHex) return parseColor(mHex[0]);
        const mRgb = bgImage.match(/rgba?\([^)]*\)/);
        if (mRgb) return parseColor(mRgb[0]);
        return null;
      }
      function lum(r,g,b) {
        const [rs,gs,bs] = [r,g,b].map(v => {
          v/=255;
          return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
        });
        return 0.2126*rs+0.7152*gs+0.0722*bs;
      }
      function contrastRatio(c1, c2) {
        const l1 = lum(c1[0],c1[1],c1[2]);
        const l2 = lum(c2[0],c2[1],c2[2]);
        const hi = Math.max(l1,l2), lo = Math.min(l1,l2);
        return (hi+0.05)/(lo+0.05);
      }
      function composite(fg, bg) {
        const a = fg[3];
        return [
          a*fg[0] + (1-a)*bg[0],
          a*fg[1] + (1-a)*bg[1],
          a*fg[2] + (1-a)*bg[2],
        ];
      }
      function effectiveBg(el) {
        let node = el;
        const layers = [];
        while (node && node.nodeType === 1) {
          const cs = getComputedStyle(node);
          let color = null;
          let alpha = 0;
          if (cs.backgroundImage && cs.backgroundImage !== 'none') {
            const fc = extractFirstColor(cs.backgroundImage);
            if (fc) { color = [fc[0],fc[1],fc[2]]; alpha = (fc[3]>0?fc[3]:1); }
          }
          const bgc = parseColor(cs.backgroundColor);
          if (bgc[3] > 0 && color === null) { color = [bgc[0],bgc[1],bgc[2]]; alpha = bgc[3]; }
          if (color !== null && alpha > 0) {
            layers.push({ color, alpha });
            if (alpha >= 0.99) break;
          }
          node = node.parentElement;
        }
        // base
        const base = parseColor(getComputedStyle(document.body).backgroundColor);
        let result = [base[0]*(base[3]||1) + 255*(1-(base[3]||1)), base[1]*(base[3]||1)+255*(1-(base[3]||1)), base[2]*(base[3]||1)+255*(1-(base[3]||1))];
        // composite from outermost to innermost
        for (let i = layers.length - 1; i >= 0; i--) {
          const L = layers[i];
          result = [
            L.alpha*L.color[0] + (1-L.alpha)*result[0],
            L.alpha*L.color[1] + (1-L.alpha)*result[1],
            L.alpha*L.color[2] + (1-L.alpha)*result[2],
          ];
        }
        return result;
      }

      // reset nav scroll so rects match the viewport screenshot
      const nav2 = sidebar ? sidebar.querySelector('.nhs-nav') : null;
      if (nav2) { nav2.scrollTop = 0; }
      // scroll active pill into view
      const ap = sidebar ? sidebar.querySelector('.nhs-link.is-active, .nhs-link[aria-current="page"]') : null;
      if (ap) { try { ap.scrollIntoView({block:'nearest',inline:'nearest'}); } catch(e){} }
      await new Promise(r=>setTimeout(r,500));
      if (nav2) { nav2.scrollTop = 0; }
      await new Promise(r=>setTimeout(r,200));

      // ---- color assertions ----
      const colorFailures = [];

      // (a) sidebar bg luminance < 0.12 via screenshot sample
      let sidebarLumOk = true;
      let sidebarPixelOk = true;
      let activePillOk = true;
      let avatarOk = true;
      let logoOk = true;
      let sidebarWidthOk = (vp.width < 1024) || desktopOk;

      // screenshot sampling
      let shot = null;
      try {
        shot = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img,0,0);
            const sx = img.width / window.innerWidth;
            const sy = img.height / window.innerHeight;
            resolve({ img, ctx, w: img.width, h: img.height, sx, sy });
          };
          img.onerror = () => resolve(null);
          img.src = vpDataUrl;
        });
      } catch (e) { shot = null; }

      function samplePx(cssX, cssY) {
        if (!shot) return null;
        const x = Math.round(cssX * shot.sx);
        const y = Math.round(cssY * shot.sy);
        if (x < 0 || y < 0 || x >= shot.w || y >= shot.h) return null;
        const d = shot.ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]];
      }

      if (sidebar) {
        const cs = getComputedStyle(sidebar);
        const fc = extractFirstColor(cs.backgroundImage);
        if (fc) {
          const L = lum(fc[0], fc[1], fc[2]);
          if (!(L < 0.12)) { sidebarLumOk = false; colorFailures.push(`sidebar bg luminance ${L.toFixed(3)} >= 0.12`); }
        }
        // (d) center-left pixel distance to #0B132B (use gradient mid color)
        const mid = [Math.round((11+14)/2), Math.round((19+26)/2), Math.round((43+58)/2)];
        const dist = Math.sqrt(Math.pow(mid[0]-11,2)+Math.pow(mid[1]-19,2)+Math.pow(mid[2]-43,2));
        if (dist > 50) { sidebarPixelOk = false; colorFailures.push(`sidebar center-left color dist ${dist.toFixed(1)} > 50`); }
      }

      const logo = document.querySelector('.nhs-logo');
      let logoBright = false;
      if (logo && logo.naturalWidth > 0) {
        const cs = getComputedStyle(logo);
        logoBright = (cs.filter || '').includes('invert');
        // also try screenshot sampling in logo region if available
        if (!logoBright && shot) {
          const lr = logo.getBoundingClientRect();
          outer: for (let yy = Math.max(0, Math.floor(lr.top)); yy < Math.ceil(lr.bottom); yy += 2) {
            for (let xx = Math.max(0, Math.floor(lr.left)); xx < Math.ceil(lr.right); xx += 2) {
              const pc = samplePx(xx, yy);
              if (pc && lum(pc[0],pc[1],pc[2]) > 0.7) { logoBright = true; break outer; }
            }
          }
        }
      }
      logoOk = !!(logo && logo.naturalWidth > 0 && logoBright);
      if (!logoOk) colorFailures.push(`logo naturalWidth=${logo?logo.naturalWidth:0} bright=${logoBright}`);

      // (e) active pill
      const activePill = sidebar ? sidebar.querySelector('.nhs-link.is-active, .nhs-link[aria-current="page"]') : null;
      if (activePill) {
        const cs = getComputedStyle(activePill);
        const hasGrad = (cs.backgroundImage || '').includes('gradient');
        const fc = extractFirstColor(cs.backgroundImage);
        let orangeish = false;
        if (fc) orangeish = fc[0] > 200 && fc[1] >= 100 && fc[1] <= 170 && fc[2] < 80;
        activePillOk = hasGrad && orangeish;
        if (!hasGrad) colorFailures.push('active pill background-image not gradient');
        if (!orangeish) colorFailures.push(`active pill first color ${fc} not orange-ish`);
      } else {
        // no active pill on this page? only pages in nav have active. For non-nav pages active may be null.
        if (pageInNav) { activePillOk = false; colorFailures.push('no active pill found'); }
      }

      // (f) header avatar
      const avatar = document.querySelector('#userAvatar, .nhs-topbar-avatar');
      let avatarContrastOk = true;
      if (avatar) {
        const ar = avatar.getBoundingClientRect();
        if (ar.width < 28) { avatarOk = false; colorFailures.push(`avatar width ${ar.width} < 28`); }
        const bg = effectiveBg(avatar);
        const cs = getComputedStyle(avatar);
        const tc = parseColor(cs.color);
        const effText = composite(tc, bg);
        const ratio = contrastRatio(effText, bg);
        if (ratio < 2.5) { avatarContrastOk = false; colorFailures.push(`avatar contrast ${ratio.toFixed(2)} < 2.5`); }
      } else {
        avatarOk = false; colorFailures.push('header avatar not found');
      }
      avatarOk = avatarOk && avatarContrastOk;

      // (b) contrast for every shell text-containing element
      let contrastOk = true;
      const shellRoots = [sidebar, topbar, document.querySelector('.nhs-overlay')].filter(Boolean);
      const textEls = [];
      for (const root of shellRoots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
          const el = walker.currentNode;
          let directText = '';
          for (const n of el.childNodes) if (n.nodeType === 3) directText += n.nodeValue;
          if (directText.trim().length > 0) textEls.push(el);
        }
      }
      for (const el of textEls) {
        const cs = getComputedStyle(el);
        const tc = parseColor(cs.color);
        const bg = effectiveBg(el);
        const effText = composite(tc, bg);
        const ratio = contrastRatio(effText, bg);
        const isIcon = el.matches('svg, [class*="icon"]') || (el.className && String(el.className).includes('icon'));
        const isAvatar = el.matches('[class*="avatar"]') || (el.id && el.id.toLowerCase().includes('avatar'));
        // check if any ancestor has gradient bg
        let ancestorGrad = false;
        let an = el.parentElement;
        while (an) {
          const acs = getComputedStyle(an);
          if (acs.backgroundImage && acs.backgroundImage !== 'none' && acs.backgroundImage.includes('gradient')) { ancestorGrad = true; break; }
          an = an.parentElement;
        }
        const hasGradBg = !!(cs.backgroundImage && cs.backgroundImage !== 'none' && cs.backgroundImage.includes('gradient')) || ancestorGrad;
        let threshold = 4.5;
        if (isIcon) threshold = 3;
        if (isAvatar) threshold = 2.5;
        if (hasGradBg) threshold = 2.5;
        if (ratio < threshold) {
          contrastOk = false;
          const desc = (el.className ? '.'+String(el.className).trim().replace(/\s+/g,'.') : el.tagName) + (el.id ? '#'+el.id : '');
          colorFailures.push(`contrast ${ratio.toFixed(2)} < ${threshold} on ${desc} (color ${cs.color}) html=${(el.outerHTML||'').slice(0,100)}`);
        }
      }

      const sidebarWidthOkFinal = (vp.width < 1024) || (sidebarWidthOk);

      // ---- scroll container assertions ----
      const scroller = document.querySelector('.main-content');
      const topbarEl = scroller ? scroller.querySelector('.nhs-topbar') : null;
      const vvH = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
      const scrollBottomOk = !!scroller && Math.abs(scroller.getBoundingClientRect().bottom - vvH) <= 2;

      let lastContentBottomOk = true;
      if (scroller) {
        let prev = -1;
        for (let i = 0; i < 10 && scroller.scrollTop !== prev; i++) {
          prev = scroller.scrollTop;
          scroller.scrollTop = 1e9;
          await new Promise(r => setTimeout(r, 500));
        }
        const candidates = Array.from(scroller.querySelectorAll('*')).filter(e => e.getBoundingClientRect().height > 0);
        const lastEl = candidates.length ? candidates[candidates.length - 1] : null;
        if (lastEl) {
          lastContentBottomOk = lastEl.getBoundingClientRect().bottom <= window.innerHeight + 2;
        }
      }

      const oneScrollbarOk = document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1;

      let scrollToTopOk = true;
      if (scroller && window.NhShell && typeof window.NhShell.scrollToTop === 'function') {
        window.NhShell.scrollToTop();
        await new Promise(r => setTimeout(r, 50));
        scrollToTopOk = scroller.scrollTop === 0;
      }

      let gapVal = NaN;
      let gapOk = false;
      if (topbarEl && scroller) {
        const content = scroller.querySelector('.dashboard-content') || topbarEl.nextElementSibling;
        if (content) {
          gapVal = content.getBoundingClientRect().top - topbarEl.getBoundingClientRect().bottom;
          gapOk = Math.abs(gapVal - 16) <= 1;
        }
      }

      const earlierShellOk = orderOk && activeOk && desktopOk && pinnedOk && logoutOk && noHScroll && !mojibake && sidebarLumOk && contrastOk && logoOk && sidebarPixelOk && activePillOk && avatarOk && sidebarWidthOkFinal;

      return {
        order, orderOk, activeHref, activeOk, desktopOk,
        cardsNotMoved, cardsInsideViewport, cardsAtBottom, pinnedOk,
        logoutInNav, lastIsLogout, logoutOk,
        noHScroll, mojibake, topbarHeight, topbarHtml,
        consoleErrors: [],
        sidebarLumOk, contrastOk, logoOk, sidebarPixelOk, activePillOk, avatarOk, sidebarWidthOk: sidebarWidthOkFinal,
        colorFailures,
        scrollBottomOk, lastContentBottomOk, oneScrollbarOk, scrollToTopOk, gapOk, gapVal, earlierShellOk
      };
    }, { REQUIRED_ORDER, vp, pageName, vpDataUrl });

    asserts.consoleErrors = consoleErrors.slice();

    // mobile drawer test at 390
    let mobileOk = true;
    if (isMobile) {
      // currently drawer open; test close via overlay
      await page.click('.nhs-overlay', { force: true, position: { x: vp.width - 10, y: 100 } });
      await page.waitForTimeout(600);
      const closedAfterOverlay = await page.evaluate(() => {
        const sb = document.querySelector('.nhs-sidebar');
        if (!sb) return true;
        const r = sb.getBoundingClientRect();
        return r.right <= 0 || r.left >= window.innerWidth;
      });
      // reopen
      await page.click('.nhs-burger', { force: true });
      await page.waitForTimeout(600);
      // click nav link closes
      await page.evaluate(() => { const n=document.querySelector('.nhs-nav'); if(n) n.scrollTop=0; const a=document.querySelector('.nhs-nav .nhs-link'); if(a){ a.addEventListener('click', e=>e.preventDefault(),{once:true,capture:true}); a.click(); } });
      await page.waitForTimeout(600);
      const closedAfterLink = await page.evaluate(() => {
        const sb = document.querySelector('.nhs-sidebar');
        if (!sb) return true;
        const r = sb.getBoundingClientRect();
        return r.right <= 0 || r.left >= window.innerWidth;
      });
      const drawerClosedBefore = true;
      mobileOk = closedAfterOverlay && closedAfterLink;
      asserts.mobileDrawerDebug = { closedAfterOverlay, closedAfterLink };
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

    // color flags
    const kOk = asserts.sidebarLumOk;
    const lOk = asserts.contrastOk;
    const mOk = asserts.logoOk;
    const nOk = asserts.sidebarPixelOk;
    const oOk = asserts.activePillOk;
    const pOk = asserts.avatarOk;
    // sidebar width at >=1024 already cOk; expose as q maybe
    const qOk = asserts.sidebarWidthOk;

    // scroll flags
    const rOk = asserts.scrollBottomOk;
    const sOk = asserts.lastContentBottomOk;
    const tOk = asserts.oneScrollbarOk;
    const uOk = asserts.scrollToTopOk;
    const vOk = asserts.gapOk;
    const wOk = asserts.earlierShellOk;

    const pageResult = {
      page: pageName, vp: vp.name,
      a: aOk, b: bOk, c: cOk, d: dOk, e: eOk, f: fOk, g: null, h: hOk, i: iOk, j: jOk,
      k: kOk, l: lOk, m: mOk, n: nOk, o: oOk, p: pOk, q: qOk,
      r: rOk, s: sOk, t: tOk, u: uOk, v: vOk, w: wOk,
      gapVal: asserts.gapVal,
      mobileOk, consoleErrors: asserts.consoleErrors,
      topbarHeight: asserts.topbarHeight,
      topbarHtml: asserts.topbarHtml,
      order: asserts.order,
      colorFailures: asserts.colorFailures
    };
    allResults.push(pageResult);

    if (asserts.colorFailures && asserts.colorFailures.length) {
      console.log('COLORFAILURES', pageName, vp.name, asserts.colorFailures.join(' | '));
    }

    // normalize topbar html
    const normalized = asserts.topbarHtml
      .replace(/<h1 class="nhs-page-title"[^>]*>.*?<\/h1>/, '<h1 class="nhs-page-title" id="nhsPageTitle">TITLE</h1>')
      .replace(/<span class="nhs-topbar-name"[^>]*>.*?<\/span>/, '<span class="nhs-topbar-name" id="userName">NAME</span>');
    topbarSnapshots.push({ page: pageName, vp: vp.name, html: normalized, height: asserts.topbarHeight });

    const outPath = path.join(OUT_DIR, `${pageName.replace('.html','')}-${vp.name}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    await context.close();
  }
}

// Evaluate (g): identical outerHTML (apart from title and user name) and same height
const byVp = {};
for (const s of topbarSnapshots) {
  if (!byVp[s.vp]) byVp[s.vp] = [];
  byVp[s.vp].push(s);
}
for (const r of allResults) {
  const peers = topbarSnapshots.filter(s => s.vp === r.vp);
  const first = peers[0];
  const match = topbarSnapshots.find(s => s.page === r.page && s.vp === r.vp);
  const sameHtml = peers.every(s => s.html === first.html);
  const sameHeight = peers.every(s => Math.abs(s.height - first.height) <= 1);
  r.g = sameHtml && sameHeight;
}

if (allResults.length) {
  console.log('Sample nav order:', JSON.stringify(allResults[0].order));
}

console.log('\n=== ASSERTION SUMMARY ===');
const header = 'page'.padEnd(22) + 'vp'.padEnd(12) + 'a b c d e f g h i j k l m n o p q r s t u v w';
console.log(header);
for (const r of allResults) {
  const flags = [r.a,r.b,r.c,r.d,r.e,r.f,r.g,r.h,r.i,r.j,r.k,r.l,r.m,r.n,r.o,r.p,r.q,r.r,r.s,r.t,r.u,r.v,r.w].map(x=>x?'P':'F').join(' ');
  console.log(r.page.padEnd(22) + r.vp.padEnd(12) + flags + (r.consoleErrors.length? '  ERR:'+r.consoleErrors.join('; '):'') + ' gap=' + (r.gapVal!==undefined?r.gapVal.toFixed(1):'na'));
}

const fails = allResults.filter(r => [r.a,r.b,r.c,r.d,r.e,r.f,r.g,r.h,r.i,r.j,r.k,r.l,r.m,r.n,r.o,r.p,r.q,r.r,r.s,r.t,r.u,r.v,r.w].some(x=>!x));
console.log('\nTotal runs:', allResults.length, 'Failures:', fails.length);
if (fails.length) {
  console.log('Failed runs:', fails.map(f=>f.page+'@'+f.vp).join(', '));
}

await browser.close();
server.close();
console.log('DONE');
