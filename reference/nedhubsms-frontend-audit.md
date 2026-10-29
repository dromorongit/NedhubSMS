# NedhubSMS Frontend Audit — Redesign Planning

Read-only audit. No files edited. No live API calls. Playwright not installed (Part B skipped).

## Summary table

| Page | Route | Who sees it | Size (lines) | Shell | Risk | Effort |
|------|-------|-------------|--------------|-------|------|--------|
| Login | /auth/login.html | visitor | 286 | duplicated | low | S |
| Register | /auth/register.html | visitor | 283 | duplicated | low | S |
| Verify email | /auth/verify-email.html | visitor | 381 | duplicated | low | S |
| Forgot password | /auth/forgot-password.html | visitor | 178 | duplicated | low | S |
| Reset password | /auth/reset-password.html | visitor | 441 | duplicated | low | S |
| Dashboard home (Overview) | /overview.html | user | 653 | duplicated | medium | M |
| Send SMS | /send-sms.html | user | 7140 | duplicated | high | L |
| Contacts & groups | /contacts.html | user | 1362 | duplicated | medium | M |
| Templates | /templates.html | user | 442 | duplicated | low | M |
| Campaigns & reports | /campaigns.html, /reports.html | user | 1233 / 1705 | duplicated | medium | M |
| Wallet & top-up | /overview.html (wallet card) | user | — | duplicated | high | M |
| Airtime / data / bills | /buy-airtime.html, /buy-data.html, /utility-payments.html | user | 1585 / 1731 / 1578 | duplicated | high | M |
| Sender IDs | /send-sms.html (modal) | user | — | duplicated | medium | M |
| API keys | /settings.html (tab) | user | — | duplicated | medium | M |
| Settings & profile | /settings.html | user | 1611 | duplicated | medium | M |
| Admin dashboard | /admin/admin.html | admin | 145 (+ admin.js 1124) | separate shell | high | L |
| Payment success/cancelled/error | /payment/success, /payment/cancelled, /payment/error | user | 427 / 432 / 333 | standalone | high | S |
| History / blacklist / analytics | /history.html, /blacklist.html, /analytics.html | user | 962 / 901 / 742 | duplicated | low | M |

Total pages/screens: ~26 (5 auth + 17 dashboard + payment ×3 + admin SPA).

## Frontend stack and serving
- Plain HTML + vanilla JS. **No framework, no bundler, no Vite, no build step.** `package.json` scripts: `start` (node server/index.js), `dev` (nodemon), `test`, `install:backend`.
- Frontend and backend live in the **same repo**. Express backend (`server/index.js`) serves static files from `src/` and `assets/`, and registers a `res.sendFile` route per page (auth + dashboard + payment + admin).
- Backend port 3000; deployed to Railway (`nedhubsms-production.up.railway.app`). API base: `http://localhost:3000/api` on localhost, `https://nedhubsms-production.up.railway.app/api` in production (`src/utils/api.js:3-4`).
- Root `index.html` redirects to `src/pages/auth/login.html`.
- CSS: separate files (`main.css`, `dashboard.css`, `auth.css`, `admin.css`, `responsive.css`, `animations.css`) loaded via `<link>`; JS mostly inline `<script>` in each page plus shared utils (`api.js`, `authStorage.js`, `toast.js`, `logger.js`, `messageUtils.js`, `recipientUtils.js`).
- No layout shell shared across pages: every page repeats the full `<html>`/`<body>` and inline sidebar HTML.

## Page inventory (detail)

Auth (each is standalone, image-left + form-right, inline SVG icons, Google Fonts Inter):
- login.html (286): form email/password, remember-me, POST /api/auth/login via apiClient.login; redirects admin→`../admin/admin.html`, else overview.
- register.html (283): name/email/phone/password/confirm/terms; client validation (match, ≥8 chars); POST /api/auth/register.
- verify-email.html (381): 6-digit OTP inputs, resend with 60s cooldown; POST /api/auth/verify-email, /api/auth/resend-otp.
- forgot-password.html (178): email only; POST /api/auth/request-password-reset; stores email in localStorage.
- reset-password.html (441): 6-digit OTP + new/confirm password; POST /api/auth/reset-password, /api/auth/resend-otp.

Dashboard (all reuse copied sidebar HTML, top-nav, `dashboard-layout`):
- overview.html (653): wallet card, low-balance alert, stats grid (SMS balance, messages sent, delivery rate), recent transactions table, top-up modal (form amount/description) → POST /api/payments/initiate → redirect to checkoutUrl; GET /api/wallet, GET /api/wallet/transactions, GET /api/auth/me, GET /api/payments/status/:ref.
- send-sms.html (7140): sender ID select + create (file upload doc), default/personalized mode tabs, manual/upload recipient source tabs, contacts picker modal, char/encoding/cost live calc, schedule date/time, live phone preview, pre-send review modal, send result modal. API: GET /api/sender-ids, POST /api/sender-ids, GET /api/contacts, POST /api/sms/upload-temp, POST /api/sms-campaigns/preview-campaign, POST /api/sms/send, POST /api/sms/schedule, GET /api/wallet. Inline HTML strings built from API data (sender ID list, contacts, duplicates, blacklist) — mostly via `escapeHtml`.
- contacts.html (1362): stats, search + group filter, table, add/edit modal, delete modal, import modal (file + progress). API: GET/POST/PUT/DELETE /api/contacts, POST /api/contacts/import.
- templates.html (442): CRUD templates. API: GET/POST/PUT/DELETE /api/templates.
- campaigns.html (1233): campaign list + create. API: GET/POST/PUT/DELETE /api/campaigns, /api/sms-campaigns/*.
- reports.html (1705): reports/filters.
- analytics.html (742): Chart.js loaded from cdn.jsdelivr.net; charts.
- transactions.html (412): paginated table, filters. API: GET /api/wallet/transactions?page&limit.
- buy-airtime.html (1585): network selection, bundles, qty, wallet. API: POST /api/transfer/airtime, GET /api/transfer/data-bundles/:network.
- buy-data.html (1731): data bundles. API: POST /api/transfer/data.
- utility-payments.html (1578): ECG/Ghana Water/TV bills. API: POST /api/utility/ecg-pay, /api/utility/water-pay, /api/utility/tv-pay.
- history.html (962): message history. API: GET /api/sms/logs.
- blacklist.html (901): blacklist CRUD. API: GET/POST/DELETE /api/blacklist.
- settings.html (1611): profile, password, 2FA, sessions, API keys. API: GET/PUT profile, GET/POST/DELETE /api/settings/api-keys.

Payment pages (standalone, served by Express routes /payment/*): payment-success.html, payment-error.html, payment-cancelled.html.

Admin (`/admin/admin.html`, admin.js): separate dark shell (`admin.css`, Segoe UI, #1a1a2e/#16213e/#ff6b35), SPA-ish content swap via `data-page`. API: GET /auth/verify, GET /admin/sms-traffic, /admin/users, /admin/campaigns, plus user/wallet/sender-id/campaign/system management with modals built as HTML strings in admin.js. Role-gated admin/super_admin.

## Shared UI today
- Sidebar (fixed 260px, navy, logo + nav links + logout), top-nav (white, sticky, user avatar + name + logout), hamburger + off-canvas sidebar + overlay (responsive.css), dashboard-content container, stats cards, wallet card, tables, modals (`.modal`/`modal-content`), toasts, loading spinner, empty states, status badges, form groups, buttons (`btn-primary` orange gradient).
- **No shared layout shell**: every page copies sidebar HTML (~90 lines) inline. No components, no partials, no template mechanism.
- Duplicated per page: sidebar, top-nav, auth form shell, modal markup, error/success toast helpers (each page redefines `showError`/`showSuccess`).
- Icons: inline SVGs only. No Font Awesome / Lucide / iconify loaded anywhere. admin.css uses CSS content emoji icons (.icon-dashboard etc.).
- Toasts: `src/utils/toast.js` (shared), CSS `.toast` in dashboard.css.

## Design tokens in use
Defined CSS variables:
- main.css: `--primary-dark #0B132B`, `--accent-orange #F77F00`, `--neutral-white #FFFFFF`, `--neutral-gray #F4F6F8`
- responsive.css: same four vars + spacing vars, sidebar widths, touch target 44px
- admin.css: entirely separate (#1a1a2e, #16213e, #ff6b35, #0f0f23, Segoe UI)

Top colours by file count (CSS): #ff7f00 ×9, #f8f9fa ×8, #e8e8e8 ×8, #e56a00 ×8, #f8fafc ×7, #e5e7eb ×7, #FFFFFF ×6, #dc2626 ×6, #6b7280 ×6, #c62828 ×5. Plus many ad-hoc: #e74c3c (reset pages), #667eea (verify OTP focus), #43a047/#2e7d32 (success), #e53935/#c62828 (error), #0288d1 (info).

Fonts: `Inter` (Google Fonts) on all dashboard/auth pages; `Segoe UI` on admin. No Manrope.

Biggest differences vs Nedhub marketing design system (navy #0B132B, navy-2 #1C2541, orange #F77F00, orange-dark #E56A00, paper #F4F6F8, muted #46526b, line #dde3ec, Manrope, 16px card radius, orange buttons w/ navy text):
1. Font is Inter/Segoe UI, not Manrope.
2. Card/border radius inconsistent (8–16px), not a consistent 16px.
3. Admin panel uses a wholly different dark palette and font — needs re-skinning to match.
4. Many ad-hoc accent colours (red #e74c3c, indigo #667eea, green #43a047) outside the token set; orange appears as both #F77F00 and #ff7f00.
5. No shared token file; tokens only in main.css/responsive.css and ignored by most pages.
6. Inline styles heavy (auth image backgrounds, gradients hardcoded per page).

## Differences from the Nedhub marketing design system
- Navy #0B132B and orange #F77F00/#E56A00 ARE present (match), good starting point.
- Paper #F4F6F8 present as --neutral-gray. Muted #46526b and line #dde3ec NOT present (uses #667280/#9ca3af and #e5e7eb instead).
- Manrope NOT used; Inter used.
- 16px card radius NOT consistent; modals 16px, cards 10–16px, stat cards 12px.
- Orange buttons with navy text: buttons are orange with WHITE text, not navy text.
- Each page re-defines colours; no single source of truth.

## Per-page detail (12 most important)

1. Login — form email+password (+remember me). Validation: required (HTML). API POST /api/auth/login. States: loading (btn spinner), error (inline error div), session-expired alert via ?session=expired. JS coupled by id (#loginForm, #email, #password) + inline submit handler. CSS-only restyle possible.
2. Register — name/email/phone/password/confirm/terms. Validation client: match, ≥8 chars. API POST /api/auth/register. Shows stats claims 10K+/5M+/99.9% on image side. CSS-only restyle possible.
3. Verify email — 6-digit OTP inputs (data-index), resend timer. API POST /api/auth/verify-email, resend-otp. OTP inputs lack visible labels (a11y gap).
4. Forgot password — email. API POST /api/auth/request-password-reset.
5. Reset password — 6-digit OTP + new/confirm password. API POST /api/auth/reset-password, resend-otp. Inline <style> block.
6. Dashboard home — wallet card, stats grid, transactions table, top-up modal. API GET /api/wallet, GET /api/wallet/transactions, GET /api/auth/me, POST /api/payments/initiate, GET /api/payments/status/:ref. Money handling (top-up). Table rows built with innerHTML from API data (date/type/amount/description escaped? — amount/type interpolated directly, description interpolated directly — XSS risk if API returns unsanitized text).
7. Send SMS — see page inventory above. Complex: file upload, contacts modal, cost calc API, pre-send confirmation, scheduling. High risk, needs markup + JS preserved.
8. Contacts & groups — table, add/edit/delete modals, import (CSV/XLSX). API GET/POST/PUT/DELETE /api/contacts, POST /api/contacts/import. File upload.
9. Templates — CRUD form (name, content). API /api/templates.
10. Campaigns & reports — list + create, filters, pagination. API /api/campaigns, /api/sms-campaigns, /api/reports.
11. Wallet & top-up — on overview; initiate payment → Hubtel checkout redirect; status polling. Money handling. API /api/payments/*.
12. Airtime / data / bills — forms, bundle grids. API /api/transfer/*, /api/utility/*. Money handling.
- Sender IDs — modal in send-sms; file upload (ID doc), POST /api/sender-ids.
- API keys — settings tab; GET/POST/DELETE /api/settings/api-keys. Secret display risk.
- Settings & profile — tabs; forms. API /api/auth/me, PUT profile/password.
- Admin dashboard — separate shell; user/wallet/sender-id/campaign/system management; HTML strings built in admin.js from API data.

## DOM hooks and JS coupling
- Tight coupling: every page uses `document.getElementById(<id>)` and query selectors on specific classes; inline submit handlers; inline `onclick="logout()"` on sidebar logout links; inline `onchange="handleContactSelection(this)"` on checkboxes (contacts.html); inline `onclick="removeManualRecipient(this)"` (send-sms).
- HTML strings from API data: contacts.html (table rows, contact list), send-sms.html (sender IDs, duplicates, blacklist, recipients), admin.js (whole page content via `contentArea.innerHTML = \`...\``), transactions.html (rows). Most use `textContent` for chips but `innerHTML`/`\`...\`` for tables/lists — data is NOT consistently escaped (e.g. transactions.html interpolates `tx.description` directly into innerHTML; send-sms uses `escapeHtml` in some places). XSS risk if API returns unsanitized user content.
- CSS-only restyle feasible for: login, register, verify, forgot, reset, overview, transactions, history, blacklist, templates, reports, analytics, settings (visuals only).
- Markup/JS changes needed for: send-sms (complex form state), contacts (import flow), buy-airtime/data/utility (bundle grids), admin (SPA content swap).

## Mobile and responsiveness
- responsive.css: mobile-first, off-canvas sidebar (hidden left:-100% below 1024px, active shows), hamburger, sidebar overlay, tables scroll horizontally (overflow-x:auto), stats stack to 1 column, modals full-height bottom sheet on mobile, modals centered for pre-send review, touch targets 44px, inputs font-size 16px (prevents iOS zoom).
- Pages likely to break at 390px: buy-airtime.html (`grid-template-columns: 1fr 380px` — fixed 380px sidebar), send-sms.html (`1fr 420px` desktop grid), phone mockup fixed max-width 320px, auth pages (420px max-width form — ok at 390 with padding). No page has a dedicated 390px breakpoint; rely on generic mobile rules.

## Accessibility and quality quick scan
- Most inputs have `<label for=...>` — good. OTP inputs (verify/reset) use `data-index` with no visible label — a11y gap. Reset password shows email in `<span id="userEmail">` (no label).
- Focus styles present (border-color + ring) on dashboard forms; auth inputs have focus ring. No obvious `outline: none` removal except admin inputs (retain border-color).
- Low-contrast pairs: muted text #999/#666 on white (~4.5:1, borderline), #6b7280 on white, placeholder #9ca3af. Auth `.form-group label` #374151 ok.
- Colour alone for status: `.tx-type.credit/debit`, `.status-badge.*`, `.text-success/.text-danger` rely on colour + text (text present, so ok).
- No `alt` issues found: logo images have alt="Nedhub Logo"; decorative images alt="Background".

## Brand assets
- Logo: `assets/images/Nedhublogo.PNG` (used on all pages), favicon `assets/images/Nedhubsymbol.PNG`. Background images: lady.jpg, yellowlady.jpg, bluelady.jpg (auth pages). Provider logos: mtnlogo.jpg, airteltigologo.jpg, telecellogo.jpg, ecglogo.jpg, ghanawaterlogo.jpg, dstvlogo.jpg, gotvlogo.jpg, startimeslogo.jpg (utility/airtime pages).
- No old product name found. Colours consistent with navy/orange in main.css but ad-hoc elsewhere.

## Content and claims (verify with owner — do not change)
- register.html:24-36: "10K+ Active Users", "5M+ Messages Sent", "99.9% Delivery Rate" (stats-preview).
- No per-SMS price or bundle prices visible in frontend (cost calculated live via API). "Minimum top-up: ₵1.00" (overview.html top-up form).

## Risks for a redesign
- Money: wallet top-up (overview → /api/payments/initiate → Hubtel redirect), airtime/data/utility payments. Must preserve checkout flow, status polling, success/error/cancelled pages.
- File uploads: contact import (CSV/XLSX), sender ID document upload (JPG/PNG/PDF, 5MB), Send SMS upload-temp (parse-only).
- API key display: settings API keys tab (shows/revokes keys).
- Admin actions: user/password reset, wallet, sender ID approval, campaigns — role-gated, separate shell.
- Table rows / HTML strings from API data — XSS escaping must be preserved when restyling.
- Backend routes depended on: /api/auth/*, /api/contacts/*, /api/sms/*, /api/sms-campaigns/*, /api/wallet/*, /api/transfer/*, /api/utility/*, /api/payments/*, /api/settings/api-keys, /api/sender-ids, /api/templates, /api/campaigns, /api/reports, /api/analytics, /api/blacklist, /admin/*.

## Recommended redesign order and approach
Build a shared stylesheet + shared layout shell FIRST (S, foundational), then restyle pages:

1. Shared design-token stylesheet (S) — CSS variables for navy/orange/paper/muted/line, Manrope, 16px radius, orange buttons. Given the stack (plain static HTML served by Express), add `src/styles/nedhub.css` and `<link>` it to every page; no build tool needed.
2. Shared layout shell (S) — extract sidebar/top-nav into a single include is not possible in plain HTML; practical approach: keep per-page files but standardise shell classes, or use a build step later. For now, standardise markup classes so one CSS restyles all.
3. Login / Register (S) — high-traffic auth, CSS-only restyle possible.
4. Forgot / Reset / Verify email (S) — OTP and form restyle.
5. Dashboard home / Overview (M) — wallet + stats; preserve money top-up flow.
6. Transactions / History / Blacklist / Templates (M each) — tables, CSS-only.
7. Settings & profile / API keys (M) — tabs; preserve API-key secrecy handling.
8. Contacts & groups (M) — table + import modal; preserve file upload.
9. Buy airtime / data / utility payments (M each) — bundle grids; preserve payment flows.
10. Analytics (M) — Chart.js; preserve charts.
11. Campaigns & reports (M) — filters/pagination.
12. Send SMS (L) — most complex; preserve contacts modal, cost calc, schedule, pre-send confirmation, upload-temp parse-only. Restyle last.
13. Admin panel (L) — separate dark shell; re-skin to navy/orange/Manrope; preserve role gating and all admin API routes.

S = small, M = medium, L = large.

Part B (screenshots): SKIPPED — Playwright/Chromium not installed in this environment (`node_modules/playwright` and `.bin/playwright` absent), and the task forbids installing packages or starting the backend.