# Migration Notes — Phase 1 Design System

**Scope:** Only `src/pages/dashboard/overview.html` was migrated to the new
design system. All other dashboard pages still use the old CSS files, so the
old files were intentionally **not deleted** and remain fully functional for
the other 16 dashboard pages.

## New files

- `src/styles/tokens.css` — design tokens (colors, type scale, spacing,
  radius, shadows, z-index, transitions, breakpoints 480/768/1024)
- `src/styles/components.css` — buttons, inputs, form groups, cards, tables,
  badges, alerts, modals (centered desktop / bottom-sheet mobile), toasts,
  empty/loading/error states; built only on tokens
- `src/styles/layout.css` — reset, typography, focus-visible outlines,
  skip-to-content link, sidebar/top-nav/overlay shell, responsive behavior
- `src/utils/layout.js` — renders sidebar, top-nav and overlay once from a
  single nav config; active-link detection, hamburger toggle, scroll lock,
  resize + Escape handling; logout delegates to the page's `window.logout`
- `src/pages/dashboard/overview.html` — migrated to the new shell
- `docs/MIGRATION_NOTES.md` — this file

## Old rules now unused on Overview

The following rules from `src/styles/dashboard.css` and
`src/styles/responsive.css` are no longer applied by `overview.html`
(superseded by `tokens.css` + `components.css` + `layout.css`). They remain in
use by the other dashboard pages until those are migrated.

### dashboard.css — fully superseded on Overview
- `.dashboard-layout` (replaced by `.page` / `main` / `.page-content` shell)
- `.sidebar`, `.sidebar-header`, `.sidebar-logo`, `.sidebar-header h1`,
  `.sidebar-nav` + `ul`/`li`/`a`, `.nav-icon`, `.sidebar-logout` and all
  `.sidebar-logout` overrides (incl. `!important` rules)
- `.main-content`, `.top-nav`, `.user-info`, `.user-avatar`, `#userName`,
  `.logout-btn`
- `.dashboard-content`
- `.welcome-section`, `.welcome-section h2`, `.welcome-subtitle`
- `.wallet-card` + `::before`, `.wallet-header`, `.wallet-icon`, `.wallet-icon
  svg`, `.wallet-info h3`, `.wallet-subtitle`, `.balance-display`,
  `.balance-amount`, `.balance-currency`, `.btn-topup`, `.wallet-card.compact`
  (+ all compact sub-rules)
- `.alert`, `.alert svg`, `.low-balance-alert`
- `.stats-grid`, `.stat-card`, `.stat-card:hover`, `.stat-icon`, `.stat-icon
  svg`, `.sms-icon`, `.sent-icon`, `.delivery-icon`, `.stat-content`,
  `.stat-content h3`, `.stat-value`, `.stat-label`
- `.transactions-section`, `.section-header`, `.section-header h3`,
  `.view-all`, `.view-all:hover`
- `.table-container`, `.transactions-table` + `th`/`td`/`tr` rules,
  `.tx-type` + `.tx-type.credit`/`.tx-type.debit`, `.text-success`,
  `.text-danger`
- `.loading-spinner`, `.spinner`, `@keyframes spin`
- `.empty-state` + `svg`/`p`/`span` rules
- `.modal`, `@keyframes modalSlide`, `.modal-content`, `.modal-close`,
  `.modal-close:hover`, `.modal-header`, `.modal-icon`, `.modal-icon svg`,
  `.modal-header h3`, `.modal-header p`
- `#importPreviewModal .modal-content`, `.import-preview-content`,
  `.column-mapping`, `.mapping-row`, `.mapping-row label/select`, `.preview-summary`,
  `.summary-stats`, `.stat-item` (+ `.stat-item.valid/.invalid/.duplicate`),
  `.preview-table-container`, `.preview-table` (+ `th`/`td`/`tr` rules),
  `.validation-status` (both duplicate blocks), `.virtual-scroll-notice`,
  `.import-summary` (+ all sub-rules), duplicated `.preview-table-container`/
  `.preview-table` blocks, duplicated `.summary-stats`/`.stat-item` blocks
- `.form-group`, `.form-group label`, `.form-group input`/`textarea` + focus,
  `.input-wrapper`, `.currency-symbol`, `.input-wrapper input`,
  `.form-group small`, `.form-group .form-hint` (+ svg/a rules),
  `.btn-primary` + `:hover` + svg, `.error-message`
- `.toast`, `@keyframes toastSlide`, `.toast-success`, `.toast-error`,
  `.toast-info`
- `.page-header`, `.page-header h2`, `.page-subtitle`
- `.quick-amounts`, `.quick-amount-btn` (+ hover/active), `.bundle-grid`,
  `.bundle-card` (+ hover/selected), `.bundle-name`, `.bundle-price`
- `.status-badge` + all status variants (queued/delivered/sent/scheduled/
  processing/failed/cancelled/draft/partial_success)
- `.filter-section`, `.filter-group`, `.filter-group label/select`
- `.pagination`, `.pagination-btn` (+ disabled/hover), `.page-info`
- `.form-container`, `.form-card`, `.form-header`, `.form-icon` (+ icon
  variants), `.form-header h3/p`
- `.transfer-summary`, `.transfer-summary h4`, `.summary-row` (+ total)
- `.input-prefix`, `.input-wrapper input` (`!important` override)
- `.description-cell`, `.reference-cell`
- `.live-preview-section`, `.section-title`, `.mobile-preview-wrapper`,
  `.phone-mockup`, `.phone-frame` (+ hover), `.phone-notch` (+ `::before`),
  `.phone-screen`, `.sms-header-bar`, `.header-time`, `.header-sender`,
  `.sms-messages-container`, `.sms-message-bubble` (+ received/sent),
  `.message-text`, `.message-time` (+ sent), `@keyframes messageSlideIn`,
  `.live-preview-wrapper`, 768px preview overrides
- Dark-mode `prefers-color-scheme` block for sms-preview
- `.schedule-section` + all schedule sub-rules (`.form-row`, `.form-group`,
  inputs, small, `.schedule-info`, `.timezone-display` + svg,
  `.schedule-preview`), `#livePreviewText` rules, `.preview-updating`

### responsive.css — superseded on Overview
- Mobile sidebar block (`.sidebar` off-canvas `left: -100%`, `.active`),
  `.sidebar-close-btn` show/hide, `.sidebar-overlay`, 480px base typography,
  and all other mobile sidebar/overlay/hamburger rules (logic now in
  `layout.js`, styles in `layout.css`)

### nedhub-app.css
- No longer loaded by Overview, so its six `!important` override groups no
 longer apply to this page.

### Inline markup removed from Overview
- Duplicated ~110-line sidebar markup
- Duplicated top-nav + `.sidebar-overlay` markup
- Duplicated inline mobile sidebar script (~50 lines: hamburger/close/overlay/
  nav-link/resize handling — now in `layout.js`)
- Inline `style="display: none"` on low-balance alert and empty state
  (now `.is-hidden` classes)
- Inline `onclick="logout()"` (sidebar logout now handled by `layout.js`,
  delegating to the page's `window.logout`)
- Raw backend error surfacing: `errorDiv.textContent = response.error` replaced
  with friendly messages

## Still used by other pages (not migrated yet)
All of the above remain active for the 16 unmigrated dashboard pages, which
continue to load `main.css`, `dashboard.css`, `responsive.css` and
`nedhub-app.css` with their duplicated sidebar markup and inline scripts.

## Accessibility changes on Overview
- Skip-to-content link (`.skip-link`) added
- All icon SVGs marked `aria-hidden="true" focusable="false"`
- Nav links use `aria-current="page"` on active item
- Sidebar close button and hamburger use `aria-label` / `aria-expanded` /
  `aria-controls`; `focus-visible` outlines on all interactive elements
- Modal uses `role="dialog" aria-modal="true"`; alerts use `role="alert"`
  / `aria-live="polite"`
- `focusable="false"` added to logo and decorative SVGs

## Constraints honored
- No inline `<style>` blocks and no `!important` in new files
- No raw backend error messages rendered in UI
- Fonts loaded via pinned Google Fonts weights (Inter 400/500/600/700,
  Manrope 400/500/700/800); no other CDN assets
- Backend, API calls and business logic untouched (`window.apiClient` calls
  and flows identical to before)
- Old CSS files retained; no other pages touched
