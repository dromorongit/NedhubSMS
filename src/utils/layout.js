/* ==========================================================================
   NedhubSMS — Shared layout shell (Phase 1)
   Renders the sidebar, top-nav and mobile overlay once from a single nav
   config, with active-link detection, hamburger toggle, scroll lock and
   resize/Escape handling. Imported by dashboard pages.
========================================================================== */

const MOBILE_BREAKPOINT = 1024;

const ICONS = {
  overview:
    '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>',
  send:
    '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>',
  campaigns:
    '<path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16"></path><path d="M3 11h18"></path><path d="M9 7v18"></path><path d="M15 7v18"></path>',
  contacts:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
  history:
    '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  blacklist:
    '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
  'buy-airtime':
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>',
  'buy-data':
    '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>',
  'utility-payments':
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line>',
  transactions:
    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
  reports:
    '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>',
  settings:
    '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
};

const NAV_LINKS = [
  { href: 'overview.html', label: 'Overview', icon: 'overview' },
  { href: 'send-sms.html', label: 'Send SMS', icon: 'send' },
  { href: 'campaigns.html', label: 'Campaigns', icon: 'campaigns' },
  { href: 'contacts.html', label: 'Contacts', icon: 'contacts' },
  { href: 'history.html', label: 'Message History', icon: 'history' },
  { href: 'blacklist.html', label: 'Blacklist', icon: 'blacklist' },
  { href: 'buy-airtime.html', label: 'Buy Airtime', icon: 'buy-airtime' },
  { href: 'buy-data.html', label: 'Buy Data', icon: 'buy-data' },
  { href: 'utility-payments.html', label: 'Utility Payments', icon: 'utility-payments' },
  { href: 'transactions.html', label: 'Transactions', icon: 'transactions' },
  { href: 'reports.html', label: 'Reports', icon: 'reports' },
  { href: 'settings.html', label: 'Settings', icon: 'settings' },
  { href: null, label: 'Logout', icon: 'logout', action: 'logout' },
];

const LOGO_SRC = '../../assets/images/Nedhublogo.PNG';

function escapeHtml(text) {
  if (typeof window.escapeHtml === 'function') return window.escapeHtml(text);
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text == null ? '' : text).replace(/[&<>"']/g, ch => map[ch]);
}

function navIcon(key) {
  return `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">${ICONS[key] || ''}</svg>`;
}

function currentPage() {
  return window.location.pathname.split('/').pop() || 'overview.html';
}

function renderShell() {
  const shell = document.getElementById('layout-shell');
  if (!shell) return;

  const current = currentPage();
  const activeLabel = NAV_LINKS.find(link => link.href === current)?.label || 'Dashboard';

  const navItems = NAV_LINKS.map(link => {
    if (link.action === 'logout') {
      return `<li class="sidebar-logout"><a href="#" data-action="logout">${navIcon('logout')}<span>${escapeHtml(link.label)}</span></a></li>`;
    }
    const isActive = current === link.href;
    return `<li><a href="${escapeHtml(link.href)}" class="nav-link${isActive ? ' active' : ''}"${isActive ? ' aria-current="page"' : ''}>${navIcon(link.icon)}<span>${escapeHtml(link.label)}</span></a></li>`;
  }).join('');

  shell.innerHTML = `
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="sidebar-header">
        <img src="${escapeHtml(LOGO_SRC)}" alt="Nedhub" class="sidebar-logo" aria-hidden="true">
        <div class="sidebar-title">Nedhub</div>
        <button class="sidebar-close" id="sidebarCloseBtn" aria-label="Close navigation menu" aria-controls="sidebar">&times;</button>
      </div>
      <nav class="sidebar-nav" id="sidebarNav">
        <ul>${navItems}</ul>
      </nav>
    </aside>
    <div class="sidebar-overlay" id="sidebarOverlay" aria-hidden="true"></div>
  `;

  const topNav = document.getElementById('top-nav');
  if (topNav) {
    topNav.innerHTML = `
      <button class="hamburger" id="hamburgerBtn" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="sidebar">
        <span class="hamburger-bar"></span>
        <span class="hamburger-bar"></span>
        <span class="hamburger-bar"></span>
      </button>
      <span class="mobile-header-title">${escapeHtml(activeLabel)}</span>
      <div class="user-info">
        <div class="user-avatar" id="userAvatar" aria-hidden="true">U</div>
        <span id="userName">Loading...</span>
        <button class="top-nav-logout" id="topNavLogoutBtn" aria-label="Logout account">${navIcon('logout')}</button>
      </div>
    `;
  }
}

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const hamburger = document.getElementById('hamburgerBtn');
  if (sidebar) sidebar.classList.add('sidebar--open');
  if (overlay) overlay.classList.add('sidebar-overlay--open');
  if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
  document.body.classList.add('no-scroll');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const hamburger = document.getElementById('hamburgerBtn');
  if (sidebar) sidebar.classList.remove('sidebar--open');
  if (overlay) overlay.classList.remove('sidebar-overlay--open');
  if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('no-scroll');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('sidebar--open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function handleLogoutClick(event) {
  event.preventDefault();
  if (typeof window.logout === 'function') {
    window.logout();
  }
}

function initLayout() {
  renderShell();

  const hamburger = document.getElementById('hamburgerBtn');
  const closeBtn = document.getElementById('sidebarCloseBtn');
  const overlay = document.getElementById('sidebarOverlay');

  hamburger && hamburger.addEventListener('click', toggleSidebar);
  closeBtn && closeBtn.addEventListener('click', closeSidebar);
  overlay && overlay.addEventListener('click', closeSidebar);

  document.querySelectorAll('#sidebarNav a, #sidebar .sidebar-logout a').forEach(link => {
    link.addEventListener('click', event => {
      if (link.dataset.action === 'logout') {
        handleLogoutClick(event);
        return;
      }
      if (isMobile()) closeSidebar();
    });
  });

  const topNavLogout = document.getElementById('topNavLogoutBtn');
  if (topNavLogout) {
    topNavLogout.addEventListener('click', handleLogoutClick);
  }

  window.addEventListener('resize', () => {
    if (!isMobile() && document.getElementById('sidebar').classList.contains('sidebar--open')) {
      closeSidebar();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('sidebar').classList.contains('sidebar--open')) {
      closeSidebar();
    }
  });
}

document.addEventListener('DOMContentLoaded', initLayout);
