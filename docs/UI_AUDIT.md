# NedhubSMS Frontend UI Audit

**Scope:** `src/pages/**`, shared CSS/JS/assets, layout/nav/sidebar/component partials.  
**Constraint:** Read-only audit — no files modified. Vanilla JS, static HTML, no build step.

---

## Page Inventory

| Page | Path | Purpose | API Status |
|------|------|---------|------------|
| Landing (redirect) | `index.html` | Immediate redirect to login | None |
| Login | `src/pages/auth/login.html` | Sign in (email/password), role-based redirect to dashboard/admin | Real API (`apiClient.login`) |
| Register | `src/pages/auth/register.html` | Account creation with password match/length validation | Real API (`apiClient.register`) |
| Forgot Password | `src/pages/auth/forgot-password.html` | Request password reset code via email | Real API (`apiClient.requestPasswordReset`) |
| Reset Password | `src/pages/auth/reset-password.html` | OTP-based password reset | Real API (`apiClient.resetPassword`) |
| Verify Email | `src/pages/auth/verify-email.html` | 6-digit OTP verification with resend cooldown | Real API (`apiClient.verifyEmail`, `resendOTP`) |
| Overview | `src/pages/dashboard/overview.html` | Dashboard home: wallet, stats (SMS balance, sent, delivery rate), recent transactions | Real API (wallet, transactions, user profile) |
| Send SMS | `src/pages/dashboard/send-sms.html` | Compose/send/schedule SMS, sender IDs, contacts picker, file upload preview, live phone preview, cost estimation | Real API (sender IDs, contacts, cost calc, send/schedule) |
| Contacts | `src/pages/dashboard/contacts.html` | CRUD contacts, groups, search/filter, CSV/Excel import | Real API (contacts CRUD + import) |
| Message History | `src/pages/dashboard/history.html` | Sent message list with status badges, search/filter, resend failed | Real API (`getMessageHistory`, `resendSms`) |
| Campaigns | `src/pages/dashboard/campaigns.html` | SMS campaign management | Real API (campaigns endpoints) |
| Blacklist | `src/pages/dashboard/blacklist.html` | Blacklisted number management | Real API (blacklist endpoints) |
| Buy Airtime | `src/pages/dashboard/buy-airtime.html` | Airtime top-up (MTN/Telecel/AirtelTigo), quick amounts, purchase summary | Real API (`buyAirtime`) |
| Buy Data | `src/pages/dashboard/buy-data.html` | Data bundle purchase | Real API (`buyData`, `getDataBundles`) |
| Utility Payments | `src/pages/dashboard/utility-payments.html` | TV/ECG/water bill payments | Real API (utility endpoints) |
| Transactions | `src/pages/dashboard/transactions.html` | Wallet transaction history | Real API (`getTransactionHistory`) |
| Reports | `src/pages/dashboard/reports.html` | SMS campaign reports | Real API (`getCampaignReports`) |
| Settings | `src/pages/dashboard/settings.html` | Account/api-key settings | Real API (settings/api-keys) |
| Templates | `src/pages/dashboard/templates.html` | SMS template management | Real API (templates endpoints) |
| Analytics | `src/pages/dashboard/analytics.html` | Analytics charts (Chart.js CDN) | Mixed — Chart.js CDN; page data pattern follows dashboard API |
| Payment Success | `src/pages/dashboard/payment-success.html` | Post-payment confirmation with countdown redirect | Real API (`checkPaymentStatusWithRetries`) |
| Payment Error | `src/pages/dashboard/payment-error.html` | Payment failure page | Real API |
| Payment Cancelled | `src/pages/dashboard/payment-cancelled.html` | Payment cancellation page | Real API |
| Admin | `src/pages/admin/admin.html` + `admin.js` | Admin panel: users, wallets, sender IDs, campaigns, system (tabbed SPA within one HTML) | Real API (`/auth/verify`); dashboard widgets are static placeholders |

**Total:** 24 HTML pages (1 public, 5 auth, 17 dashboard, 1 admin).

---

## Shared Components and Duplication

### Repeated layout shell (duplicated verbatim on every dashboard page)
- `.dashboard-layout` flex container
- `.sidebar` (fixed, 260px, navy) with logo, `.sidebar-close-btn`, `.sidebar-nav` (11-13 nav links with inline SVG icons + text spans), `.sidebar-logout`
- `.main-content` > `.top-nav` (sticky): `.hamburger-btn`, `.mobile-header-title`, `.user-info` (`.user-avatar` letter badge, `#userName`, `.logout-btn`)
- `.sidebar-overlay` for mobile
- Identical inline `<script>` blocks for mobile sidebar toggle (hamburger/close/overlay/click-nav-link/resize) copied into ~15 pages
- Identical `checkAuthAndLoad` / `loadUserProfile` / `useStoredUserName` / `updateUserDisplay` / `logout` functions copied across dashboard pages

### Shared UI components
- **Modals:** `.modal` (backdrop, `z-index: 2000`, `display:none`), `.modal-content`, `.modal-close` (×), `.modal-header` (icon + h3 + p), `.modal-actions` — used in top-up, contacts add/edit/delete, import, sender-ID create, pre-send review, contacts picker, message detail
- **Forms:** `.form-group` + `.input-wrapper` (leading SVG icon), `.btn-primary` (orange gradient), `.error-message` / `.success-message` inline injected divs
- **Tables:** `.table-container` (overflow-x auto), `.transactions-table` / `.contacts-table` / `.history-table` / `.preview-table` (near-identical header/cell styles)
- **Cards:** `.stat-card`, `.wallet-card` (gradient navy), `.form-card`, `.contacts-card`, `.transactions-section`
- **Alerts/toasts:** `.alert`, `.low-balance-alert`, `.toast` (JS-injected, `toast.js`), plus inline `.error-message-modern` on buy-airtime
- **Badges:** `.status-badge` (queued/delivered/sent/scheduled/processing/failed/cancelled/draft), `.tx-type` (credit/debit), `.validation-status` (valid/invalid/duplicate), `.group-badge`
- **Icons:** Inline `<svg>` (lucide-style path data) everywhere; admin page uses CSS-content emoji icons (`.icon-dashboard::before { content: "📊"; }`)

### Duplication concerns
1. **Sidebar markup duplicated** on all 17 dashboard pages (~100 lines each). Any nav change requires editing every page.
2. **Mobile sidebar script duplicated** on all dashboard pages.
3. **Auth pages** share `auth.css` but each repeats the `auth-page` / two-column image+form shell; OTP input block duplicated in verify-email/reset-password.
4. **Payment result pages** (success/error/cancelled) share identical card structure differing only in border color/icon color.
5. **Inline `<style>` blocks** scattered per-page (buy-airtime has ~700 lines of inline CSS; forgot-password, verify-email, contacts, history have page-local styles), causing CSS specificity wars with `nedhub-app.css` (which uses 6 documented `!important` overrides to fight inline styles).
6. **`btn-primary`** defined in 4+ places (dashboard.css, auth.css, nedhub-app.css, animation.css, plus page inline styles) with conflicting gradients/shadows.

---

## Current Design System

### CSS files
- `src/styles/main.css` — base reset, CSS variables, body typography
- `src/styles/dashboard.css` — dashboard layout, sidebar, top-nav, wallet, stats grid, tables, modals, alerts, toasts, forms, buttons, pagination, live SMS preview (desktop phone mockup)
- `src/styles/auth.css` — auth two-column layout, form inputs, social buttons, OTP, register-specific stats/testimonials
- `src/styles/admin.css` — admin sidebar/topbar/cards/tables/modals (dark theme)
- `src/styles/responsive.css` — mobile-first responsive (1538 lines): off-canvas sidebar, hamburger, touch targets (44px), modal full-screen on mobile, contacts picker modal, send-SMS two-column desktop layout
- `src/styles/sms-preview.css` — scoped `.sp-*` SMS preview component (phone mockup, bubbles, summary, progress)
- `src/styles/animations.css` — button/sidebar/form focus animations, spinners, page fade
- `src/styles/nedhub-app.css` — design-system overlay loaded last, uses `!important` to override page inline styles (6 documented override groups)

### Frameworks / CDNs
- No UI framework (no Bootstrap, Tailwind, React, Vue). Vanilla CSS + vanilla JS.
- Fonts: **Inter** (400/500/600/700) and **Manrope** (400/500/700/800) via Google Fonts CDN on every page
- **Chart.js** via jsDelivr CDN on `analytics.html` only
- All icons are hand-written inline `<svg>` (lucide-style); no icon font library

### Color palette (CSS variables)
- `--primary-dark`: `#0B132B` (navy) — primary text, sidebar, wallet gradient
- `--accent-orange`: `#F77F00` (+`#e56a00` dark) — primary buttons, links, focus rings, badges
- `--neutral-white`: `#FFFFFF`
- `--neutral-gray`: `#F4F6F8` — page background
- `nedhub-app.css` adds: `--nh-navy`, `--nh-orange`, `--nh-paper`, `--nh-success` (`#0A6B3D`), `--nh-error` (`#B3261E`), `--nh-info` (`#1C5FA8`) with tint variants
- Admin (separate): `--admin-primary` `#1a1a2e`, `--admin-accent` `#ff6b35`, `--admin-success` `#4caf50`, `--admin-danger` `#f44336`
- Status colors: green/blue/orange/purple/red tints (Material-like)

### Spacing / breakpoints
- Spacing tokens in `responsive.css`: `--spacing-xs` 0.5rem, `--sm` 0.75rem, `--md` 1rem, `--lg` 1.5rem; `--touch-target-min: 44px`
- Breakpoints: 480px, 768px, 1024px, 1100px (sms-preview), 992px (send-SMS desktop grid)
- Sidebar: 260px desktop, 80px collapsed (dashboard.css), off-canvas 280px mobile (responsive.css)

### Dark mode
- Nearly absent. Only `sms-preview.css` has `@media (prefers-color-scheme: dark)` for the phone mockup screen. `responsive.css` has an empty dark-mode block. No toggle.

### Inline styles
- Frequent: `style="display: none"`, `style="display: flex"`, background images (`auth.css` uses `url('../assets/images/lady.jpg')` with relative path inconsistencies), per-page `<style>` blocks (buy-airtime ~700 lines, verify-email OTP colors `#667eea`, contacts/history stat-mini styles).

---

## Issues Found (grouped by severity)

### Critical
1. **Route-relative asset paths break on refresh/deep links.** CSS/JS assets use `../../styles/...` and `../../utils/...`. Pages like `payment-success.html` link `../../styles/main.css`; when served from a Rails/Express static mount or nested route, relative resolution is fragile. (Verify with `server/index.js` how pages are served.)
2. **Buy-airtime bundles ~700 lines of inline CSS** in `<head>`, duplicating dashboard component styles and conflicting with `nedhub-app.css`.
3. **`index.html` is a hard redirect** to login — no public landing page exists.

### High
4. **Sidebar/nav markup duplicated on all 17 dashboard pages** — no partial/include mechanism; high risk of inconsistent nav during redesign.
5. **Mobile sidebar script duplicated** across all dashboard pages — touch-target and overflow-handling logic copy-pasted.
6. **Inconsistent `.btn-primary`**: gradient orange in dashboard.css/auth.css vs flat orange in nedhub-app.css vs inline on payment pages; hover/shadow differ per file.
7. **Accessibility:** many icon SVGs lack `aria-hidden`/`focusable`; OTP input uses 6 separate inputs without clear `aria-label`/`aria-describedby` grouping; color-only status cues in some badges; skip-to-content link absent.
8. **Backend errors can leak to UI:** `api.js` `extractErrorMessage` returns server strings; some pages render `escapeHtml(message)` but several (e.g. buy-airtime `showError`) may surface raw provider messages. Constraint from AGENTS.md: backend errors must never surface in frontend UI — currently not fully honored.
9. **No loading state on form submits in some flows** (login/register do disable button; smaller actions rely solely on toasts).

### Medium
10. **Empty/error states inconsistent:** overview/history/contacts have `.empty-state` + spinner; send-sms upload and campaigns have partial handling; some tables render inline `<td colspan>Failed to load...</td>` instead of shared empty component.
11. **Form validation mixed:** HTML5 `required`/`pattern` on some inputs (buy-airtime `pattern="[0-9]{9}"`), JS validation on others; no unified validation UI pattern.
12. **Visual hierarchy:** page titles use `<h2>` in dashboard `welcome-section` but `<h1>` in admin topbar; font sizes vary (1.5rem–2rem).
13. **Auth image section:** `lady.jpg` background on login; register/verify use different images (`yellowlady.jpg`/`bluelady.jpg`) via inline class overrides — inconsistent brand imagery.
14. **Fonts:** Inter declared on body (main.css) but Manrope in nedhub-app.css — mixed font stacks across pages.
15. **Charts dependency:** `analytics.html` pulls Chart.js from unpinned CDN (`cdn.jsdelivr.net/npm/chart.js`) without version or fallback.

### Low
16. **Reduced motion:** `animations.css` and `responsive.css` both define `prefers-reduced-motion` overrides; `sms-preview.css` has its own — duplicated logic.
17. **Print styles:** only `responsive.css` has `@media print`.
18. **`admin.html` uses emoji icons** (`📊` etc.) via CSS content — inconsistent with SVG icon system used elsewhere.
19. **`verified/payment pages`** lack the Manrope font link (only Inter).

---

## Recommended Redesign Order and Approach

**Priority ranking (traffic/business importance first):**

1. **Login / Register / Forgot / Verify (auth)** — entry point, highest traffic, first impression
2. **Overview (dashboard home)** — primary daily landing page; wallet + stats
3. **Send SMS** — core revenue action; most complex page (form, upload, preview, scheduler, modals)
4. **Message History** — high-frequency recurring task
5. **Contacts** — core data management used by Send SMS
6. **Buy Airtime / Buy Data / Utility Payments / Transactions** — monetization flows (buy-airtime already has modern UI worth preserving)
7. **Campaigns / Templates / Reports / Analytics / Settings / Blacklist** — secondary admin-like features
8. **Payment success/error/cancelled** — transactional, low volume
9. **Admin panel** — internal tool, separate dark theme, lowest priority for premium consumer redesign

**Approach (no framework, no build step):**
1. Extract the duplicated sidebar/top-nav into a shared partial pattern (server-side include or a single HTML template copied per page) — or at minimum a single shared `layout.css` + `layout.js` module imported by all pages.
2. Consolidate the design system: one CSS variables file (navy/orange/white/gray), one button scale (`btn-primary/secondary/ghost/outline/danger`), one input style, one modal system — remove per-page inline `<style>` blocks and the `!important` override arms race in `nedhub-app.css`.
3. Adopt consistent breakpoints (480/768/1024), 44px touch targets, sticky off-canvas sidebar, centered modals on desktop / bottom-sheet on mobile.
4. Add shared loading/empty/error components and a toast API; centralize error handling so backend errors never render raw in UI (friendly validation messages only).
5. Accessibility pass: `aria-label` on icon buttons, `aria-describedby` for OTP group, focus-visible outlines, color + icon/status text for badges, skip link.
6. Pin CDN versions (fonts, Chart.js) or self-host; add fallbacks.
7. Redesign pages in priority order, reusing the shared component library; keep vanilla JS — no React/Vue.

---

**Verification note:** Backend syntax/route checks (`node -c server/index.js`, `node -e "require('./backend/routes/sms-uploads.js')"`) are out of scope for this frontend-only audit; no files were modified and no build/test commands were run.