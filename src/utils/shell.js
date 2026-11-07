(function () {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function ico(inner) {
    return '<svg class="nhs-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  const NAV = [
    { label: 'Overview', href: 'overview.html', icon: ico('<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>') },
    { label: 'Send SMS', href: 'send-sms.html', icon: ico('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>') },
    { label: 'Campaigns', href: 'campaigns.html', icon: ico('<path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16"></path><path d="M3 11h18"></path><path d="M9 7v18"></path><path d="M15 7v18"></path>') },
    { label: 'Contacts', href: 'contacts.html', icon: ico('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>') },
    { label: 'Message History', href: 'history.html', icon: ico('<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>') },
    { label: 'Blacklist', href: 'blacklist.html', icon: ico('<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>') },
    { label: 'Transactions', href: 'transactions.html', icon: ico('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>') },
    { label: 'Buy Airtime', href: 'buy-airtime.html', icon: ico('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>') },
    { label: 'Buy Data', href: 'buy-data.html', icon: ico('<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>') },
    { label: 'Utility Payments', href: 'utility-payments.html', icon: ico('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line>') },
    { label: 'Reports', href: 'reports.html', icon: ico('<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>') },
    { label: 'Templates', href: 'templates.html', icon: ico('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>') },
    { label: 'Analytics', href: 'analytics.html', icon: ico('<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>') },
    { label: 'Settings', href: 'settings.html', icon: ico('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>') },
    { label: 'Payment', href: 'payment-pending.html', titleOnly: true, icon: ico('<rect x="2" y="11" width="20" height="7" rx="1" ry="1"></rect><path d="M12 17v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3"></path>') },
    { label: 'Payment', href: 'payment-success.html', titleOnly: true, icon: ico('<rect x="2" y="11" width="20" height="7" rx="1" ry="1"></rect><path d="M12 17v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3"></path>') },
    { label: 'Payment', href: 'payment-error.html', titleOnly: true, icon: ico('<rect x="2" y="11" width="20" height="7" rx="1" ry="1"></rect><path d="M12 17v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3"></path>') },
    { label: 'Payment', href: 'payment-cancelled.html', titleOnly: true, icon: ico('<rect x="2" y="11" width="20" height="7" rx="1" ry="1"></rect><path d="M12 17v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3"></path>') },
  ];

  const current = (location.pathname.split('/').pop() || 'overview.html').toLowerCase();

  function isMobile() { return window.innerWidth < 900; }

  function initials(name) {
    const parts = String(name || 'User').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'UU';
    if (parts.length === 1) return (parts[0].charAt(0) + (parts[0].charAt(1) || '')).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  function getRoleFromToken() {
    try {
      const storage = window.getStorage ? window.getStorage() : localStorage;
      const token = storage.getItem('authToken');
      if (!token) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload && payload.role ? String(payload.role) : null;
    } catch (e) { return null; }
  }
  function accountLabelFor(role) {
    const r = (role || 'user').toLowerCase();
    return (r === 'admin' || r === 'super_admin') ? 'Admin Account' : 'Personal Account';
  }

  const sidebarMount = document.getElementById('nhs-sidebar-mount');
  const topbarMount = document.getElementById('nhs-topbar-mount');
  if (!sidebarMount || !topbarMount) return;

  document.body.classList.add('nhs-has-shell');
  document.documentElement.classList.add('nhs-has-shell');

  // Sidebar markup
  const navItemsHtml = NAV.filter(function (item) { return !item.titleOnly; }).map(function (item) {
    const active = item.href.toLowerCase() === current && !item.titleOnly;
    return '<li><a class="nhs-link' + (active ? ' is-active' : '') + '" href="' + item.href + '"' + (active ? ' aria-current="page"' : '') + '>' + item.icon + '<span>' + item.label + '</span></a></li>';
  }).join('');
  const logoutIcon = ico('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>');
  const sidebarHtml =
    '<aside class="nhs-sidebar" id="nhsSidebar" aria-label="Main navigation">' +
      '<div class="nhs-sidebar-header"><img src="../../../Nedhublogo.PNG" alt="Nedhub Logo" class="nhs-logo"></div>' +
      '<nav class="nhs-nav" aria-label="Primary"><ul class="nhs-nav-list">' + navItemsHtml +
        '<li><a class="nhs-link nhs-link--logout" href="#" data-logout="1">' + logoutIcon + '<span>Logout</span></a></li>' +
      '</ul></nav>' +
      '<div class="nhs-sidebar-footer">' +
        '<div class="nhs-help">' +
          '<svg class="nhs-help-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>' +
          '<p class="nhs-help-title">Need Help?</p>' +
          '<p class="nhs-help-text">Our support team is here for you.</p>' +
          '<a href="settings.html" class="nhs-help-btn">Contact Support<span class="nhs-help-arrow">&#8594;</span></a>' +
        '</div>' +
        '<a class="nhs-user" href="settings.html">' +
          '<div class="nhs-user-avatar" id="sidebarUserAvatar">U</div>' +
          '<div class="nhs-user-meta">' +
            '<div class="nhs-user-name" id="sidebarUserName">User</div>' +
            '<div class="nhs-user-account" id="sidebarAccountLabel">Personal Account</div>' +
          '</div>' +
          '<svg class="nhs-user-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
        '</a>' +
      '</div>' +
    '</aside>' +
    '<div class="nhs-overlay" id="nhsOverlay"></div>';
  sidebarMount.innerHTML = sidebarHtml;

  // Topbar markup
  const activeItem = NAV.find(function (i) { return i.href.toLowerCase() === current; }) || NAV[0];
  const pageTitle = (activeItem && activeItem.label) ? activeItem.label : 'Dashboard';
  const topbarHtml =
    '<header class="nhs-topbar">' +
      '<div class="nhs-topbar-left">' +
        '<button class="nhs-burger" id="nhsBurger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nhsSidebar"><span></span><span></span><span></span></button>' +
        '<h1 class="nhs-topbar-title" id="nhsTopbarTitle">' + pageTitle + '</h1>' +
        '<div class="nhs-topbar-search" id="nhsTopbarSearch" style="display:none;">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
          '<input type="search" id="nhsTopbarSearchInput" class="nhs-topbar-search-input" placeholder="Search..." aria-label="Search">' +
        '</div>' +
      '</div>' +
      '<div class="nhs-topbar-right">' +
        '<button class="nhs-icon-btn" id="nhsNotifBtn" type="button" aria-label="Notifications" aria-haspopup="true" aria-controls="nhsNotifBadge">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>' +
          '<span class="nhs-badge" id="nhsNotifBadge" aria-label="3 new notifications">3</span>' +
        '</button>' +
        '<a class="nhs-topbar-user" href="settings.html">' +
        '<div class="nhs-topbar-avatar" id="nhsTopbarAvatar">U</div>' +
        '<span class="nhs-topbar-name" id="nhsTopbarName">User</span>' +
        '<svg class="nhs-topbar-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
        '</a>' +
      '</div>' +
    '</header>';
  topbarMount.innerHTML = topbarHtml;

  // Add userName/userAvatar ids expected by pages: reuse topbar? We'll add hidden? 
  // Existing page code expects #userName and #userAvatar in document. Insert into topbar user pill? 
  // We'll alias by adding ids to existing topbar elements? They already have nhsTopbarName/Avatar. 
  // To satisfy pages, rename? Instead, set id="userName" on name span and id="userAvatar" on avatar div 
  // would break nhsTopbarName references. We'll handle by exposing both ids via duplicate attributes impossible.
  // Solution: keep nhsTopbar* ids AND add userName/userAvatar ids by changing topbar markup ids to userName/userAvatar,
  // and update NhShell to use those. But NhShell uses nhsTopbar*. Let's instead give topbar name id="userName" 
  // and avatar id="userAvatar", and update NhShell references accordingly.
  // (Done below by post-adjusting elements.)
  const topbarNameEl = document.getElementById('nhsTopbarName');
  if (topbarNameEl) topbarNameEl.id = 'userName';
  const topbarAvatarEl = document.getElementById('nhsTopbarAvatar');
  if (topbarAvatarEl) topbarAvatarEl.id = 'userAvatar';

  const sidebar = document.getElementById('nhsSidebar');
  const overlay = document.getElementById('nhsOverlay');
  const burger = document.getElementById('nhsBurger');

  function setSidebarFocusable(enabled) {
    sidebar.querySelectorAll('a, button, [tabindex]').forEach(function (el) {
      if (enabled) { el.removeAttribute('tabindex'); } else { el.setAttribute('tabindex', '-1'); }
    });
  }
  function openDrawer() {
    sidebar.classList.add('is-open');
    overlay.classList.add('is-visible');
    document.body.classList.add('nhs-drawer-open');
    burger.setAttribute('aria-expanded', 'true');
    if (isMobile()) { sidebar.setAttribute('aria-hidden', 'false'); setSidebarFocusable(true); }
    const first = sidebar.querySelector('.nhs-link');
    if (first) { try { first.focus(); } catch (e) {} }
  }
  function closeDrawer() {
    sidebar.classList.remove('is-open');
    overlay.classList.remove('is-visible');
    document.body.classList.remove('nhs-drawer-open');
    burger.setAttribute('aria-expanded', 'false');
    if (isMobile()) { sidebar.setAttribute('aria-hidden', 'true'); setSidebarFocusable(false); }
    try { burger.focus(); } catch (e) {}
  }
  function resetDesktop() {
    if (!isMobile()) {
      sidebar.classList.remove('is-open');
      overlay.classList.remove('is-visible');
      document.body.classList.remove('nhs-drawer-open');
      sidebar.removeAttribute('aria-hidden');
      setSidebarFocusable(true);
      burger.setAttribute('aria-expanded', 'false');
    } else {
      if (!sidebar.classList.contains('is-open')) { sidebar.setAttribute('aria-hidden', 'true'); setSidebarFocusable(false); }
      else { sidebar.setAttribute('aria-hidden', 'false'); setSidebarFocusable(true); }
    }
  }
  if (isMobile()) { sidebar.setAttribute('aria-hidden', 'true'); setSidebarFocusable(false); }

  if (burger) burger.addEventListener('click', function () { 
    if (sidebar.classList.contains('is-open')) closeDrawer(); else openDrawer();
  });
  if (overlay) overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) closeDrawer();
  });
  sidebar.querySelectorAll('.nhs-link').forEach(function (link) {
    link.addEventListener('click', function () {
      if (isMobile()) closeDrawer();
    });
  });
  window.addEventListener('resize', resetDesktop);

  function doLogout() {
    if (typeof window.logout === 'function') { window.logout(); return; }
    const storage = window.getStorage ? window.getStorage() : localStorage;
    try { storage.removeItem('authToken'); } catch (e) {}
    try { storage.removeItem('userName'); } catch (e) {}
    try { storage.removeItem('userEmail'); } catch (e) {}
    try { localStorage.removeItem('authStorageType'); } catch (e) {}
    window.location.href = '../auth/login.html';
  }
  const logoutLink = sidebar.querySelector('[data-logout="1"]');
  if (logoutLink) {
    logoutLink.addEventListener('click', function (e) { e.preventDefault(); doLogout(); });
  }

  window.NhShell = {
    initials: initials,
    init: function (opts) {
      opts = opts || {};
      const search = opts.search === true;
      const searchEl = document.getElementById('nhsTopbarSearch');
      const titleEl = document.getElementById('nhsTopbarTitle');
      if (searchEl) searchEl.style.display = search ? '' : 'none';
      if (titleEl) titleEl.style.display = search ? 'none' : '';
      if (search && opts.placeholder) {
        const input = document.getElementById('nhsTopbarSearchInput');
        if (input) input.placeholder = opts.placeholder;
      }
      try { window.__nhShellSearch = search; } catch (e) {}
    },
    scroller: function () {
      return document.querySelector('.main-content');
    },
    scrollToTop: function (smooth) {
      const el = document.querySelector('.main-content');
      if (!el) return;
      if (smooth) { try { el.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { el.scrollTop = 0; } }
      else { el.scrollTop = 0; }
    },
    scrollTo: function (el) {
      const sc = document.querySelector('.main-content');
      if (!sc || !el) return;
      try {
        const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
        sc.scrollTo({ top: top, behavior: 'auto' });
      } catch (e) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e2) {} }
    },
    setUser: function (opts) {
      opts = opts || {};
      if (opts.name !== undefined) {
        const name = opts.name;
        const first = String(name).trim().split(/\s+/)[0] || 'User';
        const ids = ['userName', 'sidebarUserName'];
        ids.forEach(function (id) { const el = document.getElementById(id); if (el) el.textContent = (id === 'sidebarUserName' ? name : first); });
        const avIds = ['userAvatar', 'sidebarUserAvatar'];
        avIds.forEach(function (id) { const el = document.getElementById(id); if (el) el.textContent = initials(name); });
        const tn = document.getElementById('nhsTopbarName');
        if (tn) tn.textContent = first;
        const ta = document.getElementById('nhsTopbarAvatar');
        if (ta) ta.textContent = initials(name);
      }
      if (opts.accountLabel !== undefined) {
        const al = document.getElementById('sidebarAccountLabel');
        if (al) al.textContent = opts.accountLabel;
      } else {
        const al = document.getElementById('sidebarAccountLabel');
        if (al) al.textContent = accountLabelFor(getRoleFromToken());
      }
    },
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    logout: doLogout
  };
  try { var st = window.getStorage ? window.getStorage() : localStorage; var sn = st.getItem('userName'); if (sn) window.NhShell.setUser({ name: sn }); } catch (e) {}
  try { if (window.nhShellOptions) window.NhShell.init(window.nhShellOptions); else window.NhShell.init({ search: false }); } catch (e) {}
})();
