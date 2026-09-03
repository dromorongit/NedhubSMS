// Admin Panel JavaScript
// Using shared api.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin panel initializing...');
    initializeAdminPanel();
});

let currentPage = 'dashboard';
let currentUser = null;

async function initializeAdminPanel() {
    // Check authentication and role
    const token = window.apiClient.getToken();
    if (!token) {
        window.location.href = '../auth/login.html';
        return;
    }

    try {
        // Verify admin access
        const response = await window.apiClient.request('GET', '/auth/verify');

        if (response.error) {
            throw new Error('Authentication failed');
        }

        const userData = response.data;
        currentUser = userData.user;

        if (!['admin', 'super_admin'].includes(currentUser.role)) {
            showToast('Access denied. Admin privileges required.', 'error');
            window.location.href = '../dashboard/overview.html';
            return;
        }

        // Update UI with user info
        document.getElementById('admin-name').textContent = currentUser.name;

        // Initialize sidebar navigation
        initializeNavigation();

        // Load initial dashboard data
        loadDashboardData();

    } catch (error) {
        console.error('Admin initialization failed:', error);
        showToast('Failed to initialize admin panel', 'error');
        window.location.href = '../auth/login.html';
    }
}

function initializeNavigation() {
    console.log('Initializing navigation...');
    const menuItems = document.querySelectorAll('.menu-item');
    console.log('Menu items found:', menuItems.length);
    
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const logoutBtn = document.getElementById('logout-btn');

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            console.log('Menu item clicked:', item.dataset.page);
            const page = item.dataset.page;
            navigateToPage(page);
            // Close sidebar on mobile after navigation
            if (window.innerWidth <= 768) {
                closeSidebar();
            }
        });
    });

    sidebarToggle.addEventListener('click', toggleSidebar);
    // Add touch support for mobile
    sidebarToggle.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleSidebar();
    });
    logoutBtn.addEventListener('click', handleLogout);

    // Mobile sidebar close button
    const sidebarClose = document.getElementById('sidebar-close');
    if (sidebarClose) {
        sidebarClose.addEventListener('click', closeSidebar);
    }
}

function toggleSidebar() {
    document.querySelector('.admin-sidebar').classList.toggle('collapsed');
    document.querySelector('.admin-main').classList.toggle('sidebar-collapsed');
}

function closeSidebar() {
    document.querySelector('.admin-sidebar').classList.remove('collapsed');
    document.querySelector('.admin-main').classList.remove('sidebar-collapsed');
}

function navigateToPage(page) {
    // Update active menu item
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    // Update page title
    const titles = {
        dashboard: 'Dashboard',
        users: 'User Management',
        wallets: 'Wallet Management',
        'sender-ids': 'Sender ID Governance',
        campaigns: 'Campaign Monitoring',
        system: 'System Controls'
    };
    document.getElementById('page-title').textContent = titles[page] || 'Admin Panel';

    // Load page content
    loadPageContent(page);
}

async function loadPageContent(page) {
    const contentArea = document.getElementById('admin-content');

    try {
        switch (page) {
            case 'dashboard':
                await loadDashboardContent();
                break;
            case 'users':
                await loadUsersContent();
                break;
            case 'wallets':
                await loadWalletsContent();
                break;
            case 'sender-ids':
                await loadSenderIdsContent();
                break;
            case 'campaigns':
                await loadCampaignsContent();
                break;
            case 'system':
                await loadSystemContent();
                break;
        }
    } catch (error) {
        console.error(`Failed to load ${page} content:`, error);
        contentArea.innerHTML = '<div class="error-message">Failed to load page content</div>';
    }
}

async function loadDashboardContent() {
    const contentArea = document.getElementById('admin-content');
    contentArea.innerHTML = `
        <div class="dashboard-grid">
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="icon-users"></i>
                </div>
                <div class="stat-info">
                    <h3 id="total-users">0</h3>
                    <p>Total Users</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="icon-sms"></i>
                </div>
                <div class="stat-info">
                    <h3 id="total-sms">0</h3>
                    <p>SMS Sent Today</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="icon-wallet"></i>
                </div>
                <div class="stat-info">
                    <h3 id="total-revenue">₵0.00</h3>
                    <p>Revenue Today</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="icon-campaigns"></i>
                </div>
                <div class="stat-info">
                    <h3 id="active-campaigns">0</h3>
                    <p>Active Campaigns</p>
                </div>
            </div>
        </div>
        <div class="recent-activity">
            <h2>Recent Activity</h2>
            <div class="activity-list" id="activity-list">
                <div class="activity-item">
                    <div class="activity-icon">
                        <i class="icon-user"></i>
                    </div>
                    <div class="activity-content">
                        <p>New user registered</p>
                        <span class="activity-time">2 minutes ago</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    await loadDashboardData();
}

async function loadDashboardData() {
    try {
        // Load SMS traffic data
        const trafficResponse = await window.apiClient.request('GET', '/admin/sms-traffic');
        if (trafficResponse.data) {
            document.getElementById('total-sms').textContent = trafficResponse.data.totalVolume;
            document.getElementById('total-revenue').textContent = `₵${trafficResponse.data.totalCost.toFixed(2)}`;
        }

        // Load users count
        const usersResponse = await window.apiClient.request('GET', '/admin/users?limit=1');
        if (usersResponse.data) {
            document.getElementById('total-users').textContent = usersResponse.data.total;
        }

        // Load campaigns count
        const campaignsResponse = await window.apiClient.request('GET', '/admin/campaigns?status=scheduled&limit=1');
        if (campaignsResponse.data) {
            document.getElementById('active-campaigns').textContent = campaignsResponse.data.total;
        }
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
    }
}

async function loadUsersContent() {
    const contentArea = document.getElementById('admin-content');
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>User Management</h2>
            <div class="page-actions">
                <input type="text" id="user-search" placeholder="Search users..." class="search-input">
                <select id="user-role-filter" class="filter-select">
                    <option value="">All Roles</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                </select>
                <select id="user-status-filter" class="filter-select">
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                </select>
            </div>
        </div>
        <div class="data-table-container">
            <table class="data-table" id="users-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="users-tbody">
                    <!-- Users will be populated here -->
                </tbody>
            </table>
        </div>
        <div class="pagination" id="users-pagination"></div>
    `;

    // Add event listeners
    document.getElementById('user-search').addEventListener('input', debounce(loadUsers, 300));
    document.getElementById('user-role-filter').addEventListener('change', loadUsers);
    document.getElementById('user-status-filter').addEventListener('change', loadUsers);

    await loadUsers();
}

async function loadUsers(page = 1) {
    try {
        const search = document.getElementById('user-search').value;
        const role = document.getElementById('user-role-filter').value;
        const status = document.getElementById('user-status-filter').value;

        const params = new URLSearchParams({
            page,
            limit: 10,
            ...(search && { search }),
            ...(role && { role }),
            ...(status && { status })
        });

        const response = await window.apiClient.request('GET', `/admin/users?${params}`);
        if (response.data) {
            renderUsersTable(response.data.users);
            renderPagination(response.data, 'users-pagination', loadUsers);
        }
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.name}</td>
            <td>${user.email}</td>
            <td><span class="role-badge role-${user.role}">${user.role}</span></td>
            <td><span class="status-badge status-${user.status}">${user.status}</span></td>
            <td>${new Date(user.createdAt).toLocaleDateString()}</td>
            <td class="actions">
                <button class="btn-sm btn-secondary" onclick="editUser('${user._id}')">Edit</button>
                ${user.status === 'active' ?
                    `<button class="btn-sm btn-danger" onclick="suspendUser('${user._id}')">Suspend</button>` :
                    `<button class="btn-sm btn-success" onclick="activateUser('${user._id}')">Activate</button>`
                }
            </td>
        </tr>
    `).join('');
}

async function suspendUser(userId) {
    if (await confirmAction('Are you sure you want to suspend this user?')) {
        try {
            await window.apiClient.request('PATCH', `/admin/users/${userId}/status`, { status: 'suspended' });
            showToast('User suspended successfully', 'success');
            loadUsers();
        } catch (error) {
            showToast('Failed to suspend user', 'error');
        }
    }
}

async function activateUser(userId) {
    if (await confirmAction('Are you sure you want to activate this user?')) {
        try {
            await window.apiClient.request('PATCH', `/admin/users/${userId}/status`, { status: 'active' });
            showToast('User activated successfully', 'success');
            loadUsers();
        } catch (error) {
            showToast('Failed to activate user', 'error');
        }
    }
}

async function loadWalletsContent() {
    const contentArea = document.getElementById('admin-content');
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>Wallet Management</h2>
            <div class="page-actions">
                <input type="text" id="wallet-search" placeholder="Search by user..." class="search-input">
            </div>
        </div>
        <div class="data-table-container">
            <table class="data-table" id="wallets-table">
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Balance</th>
                        <th>Frozen</th>
                        <th>Updated</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="wallets-tbody">
                    <!-- Wallets will be populated here -->
                </tbody>
            </table>
        </div>
        <div class="pagination" id="wallets-pagination"></div>
    `;

    document.getElementById('wallet-search').addEventListener('input', debounce(loadWallets, 300));
    await loadWallets();
}

async function loadWallets(page = 1) {
    try {
        const search = document.getElementById('wallet-search').value;
        const params = new URLSearchParams({
            page,
            limit: 10,
            ...(search && { search })
        });

        const response = await window.apiClient.request('GET', `/admin/wallets?${params}`);
        if (response.data) {
            renderWalletsTable(response.data.wallets);
            renderPagination(response.data, 'wallets-pagination', loadWallets);
        }
    } catch (error) {
        console.error('Failed to load wallets:', error);
    }
}

function renderWalletsTable(wallets) {
    const tbody = document.getElementById('wallets-tbody');
    tbody.innerHTML = wallets.map(wallet => `
        <tr>
            <td>${wallet.userId.name}</td>
            <td>${wallet.userId.email}</td>
            <td>₵${wallet.balance.toFixed(2)}</td>
            <td><span class="status-badge status-${wallet.frozen ? 'suspended' : 'active'}">${wallet.frozen ? 'Frozen' : 'Active'}</span></td>
            <td>${new Date(wallet.updatedAt).toLocaleDateString()}</td>
            <td class="actions">
                <button class="btn-sm btn-secondary" onclick="adjustBalance('${wallet._id}')">Adjust</button>
                ${wallet.frozen ?
                    `<button class="btn-sm btn-success" onclick="unfreezeWallet('${wallet._id}')">Unfreeze</button>` :
                    `<button class="btn-sm btn-danger" onclick="freezeWallet('${wallet._id}')">Freeze</button>`
                }
            </td>
        </tr>
    `).join('');
}

async function freezeWallet(walletId) {
    if (await confirmAction('Are you sure you want to freeze this wallet?')) {
        try {
            await window.apiClient.request('PATCH', `/admin/wallets/${walletId}`, { frozen: true });
            showToast('Wallet frozen successfully', 'success');
            loadWallets();
        } catch (error) {
            showToast('Failed to freeze wallet', 'error');
        }
    }
}

async function unfreezeWallet(walletId) {
    if (await confirmAction('Are you sure you want to unfreeze this wallet?')) {
        try {
            await window.apiClient.request('PATCH', `/admin/wallets/${walletId}`, { frozen: false });
            showToast('Wallet unfrozen successfully', 'success');
            loadWallets();
        } catch (error) {
            showToast('Failed to unfreeze wallet', 'error');
        }
    }
}

async function adjustBalance(walletId) {
    const amount = prompt('Enter adjustment amount (positive to credit, negative to debit):');
    if (amount !== null && !isNaN(amount)) {
        if (await confirmAction(`Are you sure you want to adjust the balance by ₵${amount}?`)) {
            try {
                // First get current balance
                const wallets = await window.apiClient.request('GET', '/admin/wallets');
                const wallet = wallets.data.wallets.find(w => w._id === walletId);
                const newBalance = wallet.balance + parseFloat(amount);

                await window.apiClient.request('PATCH', `/admin/wallets/${walletId}`, { balance: newBalance });
                showToast('Balance adjusted successfully', 'success');
                loadWallets();
            } catch (error) {
                showToast('Failed to adjust balance', 'error');
            }
        }
    }
}

async function loadSenderIdsContent() {
    const contentArea = document.getElementById('admin-content');
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>Sender ID Governance</h2>
            <div class="page-actions">
                <select id="sender-status-filter" class="filter-select">
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                </select>
            </div>
        </div>
        <div class="data-table-container">
            <table class="data-table" id="sender-ids-table">
                <thead>
                    <tr>
                        <th>Sender ID</th>
                        <th>User</th>
                        <th>Status</th>
                        <th>Remarks</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="sender-ids-tbody">
                    <!-- Sender IDs will be populated here -->
                </tbody>
            </table>
        </div>
        <div class="pagination" id="sender-ids-pagination"></div>
    `;

    document.getElementById('sender-status-filter').addEventListener('change', loadSenderIds);
    await loadSenderIds();
}

async function loadSenderIds(page = 1) {
    try {
        const status = document.getElementById('sender-status-filter').value;
        const params = new URLSearchParams({
            page,
            limit: 10,
            ...(status && { status })
        });

        const response = await window.apiClient.request('GET', `/admin/sender-ids?${params}`);
        if (response.data) {
            renderSenderIdsTable(response.data.senderIds);
            renderPagination(response.data, 'sender-ids-pagination', loadSenderIds);
        }
    } catch (error) {
        console.error('Failed to load sender IDs:', error);
    }
}

function renderSenderIdsTable(senderIds) {
    const tbody = document.getElementById('sender-ids-tbody');
    tbody.innerHTML = senderIds.map(senderId => `
        <tr>
            <td>${senderId.senderId}</td>
            <td>${senderId.userId.name} (${senderId.userId.email})</td>
            <td><span class="status-badge status-${senderId.status}">${senderId.status}</span></td>
            <td>${senderId.remarks || '-'}</td>
            <td>${new Date(senderId.createdAt).toLocaleDateString()}</td>
            <td class="actions">
                ${senderId.status === 'pending' ? `
                    <button class="btn-sm btn-success" onclick="approveSenderId('${senderId._id}')">Approve</button>
                    <button class="btn-sm btn-danger" onclick="rejectSenderId('${senderId._id}')">Reject</button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

async function approveSenderId(senderId) {
    if (await confirmAction('Are you sure you want to approve this Sender ID?')) {
        try {
            await window.apiClient.request('PATCH', `/admin/sender-ids/${senderId}`, { status: 'approved' });
            showToast('Sender ID approved successfully', 'success');
            loadSenderIds();
        } catch (error) {
            showToast('Failed to approve Sender ID', 'error');
        }
    }
}

async function rejectSenderId(senderId) {
    const remarks = prompt('Enter rejection remarks:');
    if (remarks !== null) {
        if (await confirmAction('Are you sure you want to reject this Sender ID?')) {
            try {
                await window.apiClient.request('PATCH', `/admin/sender-ids/${senderId}`, { status: 'rejected', remarks });
                showToast('Sender ID rejected successfully', 'success');
                loadSenderIds();
            } catch (error) {
                showToast('Failed to reject Sender ID', 'error');
            }
        }
    }
}

async function loadCampaignsContent() {
    const contentArea = document.getElementById('admin-content');
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>Campaign Monitoring</h2>
            <div class="page-actions">
                <select id="campaign-status-filter" class="filter-select">
                    <option value="">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="sent">Sent</option>
                    <option value="failed">Failed</option>
                </select>
            </div>
        </div>
        <div class="data-table-container">
            <table class="data-table" id="campaigns-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>User</th>
                        <th>Status</th>
                        <th>Recipients</th>
                        <th>Cost</th>
                        <th>Scheduled/Sent</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="campaigns-tbody">
                    <!-- Campaigns will be populated here -->
                </tbody>
            </table>
        </div>
        <div class="pagination" id="campaigns-pagination"></div>
    `;

    document.getElementById('campaign-status-filter').addEventListener('change', loadCampaigns);
    await loadCampaigns();
}

async function loadCampaigns(page = 1) {
    try {
        const status = document.getElementById('campaign-status-filter').value;
        const params = new URLSearchParams({
            page,
            limit: 10,
            ...(status && { status })
        });

        const response = await window.apiClient.request('GET', `/admin/campaigns?${params}`);
        if (response.data) {
            renderCampaignsTable(response.data.campaigns);
            renderPagination(response.data, 'campaigns-pagination', loadCampaigns);
        }
    } catch (error) {
        console.error('Failed to load campaigns:', error);
    }
}

function renderCampaignsTable(campaigns) {
    const tbody = document.getElementById('campaigns-tbody');
    tbody.innerHTML = campaigns.map(campaign => `
        <tr>
            <td>${campaign.name}</td>
            <td>${campaign.userId.name}</td>
            <td><span class="status-badge status-${campaign.status}">${campaign.status}</span></td>
            <td>${campaign.recipientsCount}</td>
            <td>₵${campaign.cost.toFixed(2)}</td>
            <td>${campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleDateString() : (campaign.sentAt ? new Date(campaign.sentAt).toLocaleDateString() : '-')}</td>
            <td class="actions">
                ${campaign.status === 'scheduled' ? `<button class="btn-sm btn-danger" onclick="stopCampaign('${campaign._id}')">Stop</button>` : ''}
            </td>
        </tr>
    `).join('');
}

async function stopCampaign(campaignId) {
    if (await confirmAction('Are you sure you want to stop this campaign?')) {
        try {
            // This would need a backend endpoint to stop campaigns
            showToast('Campaign stop functionality not implemented yet', 'info');
        } catch (error) {
            showToast('Failed to stop campaign', 'error');
        }
    }
}

async function loadSystemContent() {
    const contentArea = document.getElementById('admin-content');
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>System Controls</h2>
        </div>
        <div class="system-controls">
            <div class="control-card">
                <h3>SMS Rate Limiting</h3>
                <div class="control-group">
                    <label>Global Rate Limit (per minute)</label>
                    <input type="number" id="global-rate-limit" value="100" min="1">
                </div>
                <button class="btn-primary" onclick="updateRateLimit()">Update Rate Limit</button>
            </div>
            <div class="control-card">
                <h3>Platform Status</h3>
                <div class="status-indicator">
                    <span class="status-dot status-active"></span>
                    <span>All Systems Operational</span>
                </div>
                <button class="btn-secondary" onclick="checkSystemStatus()">Refresh Status</button>
            </div>
            <div class="control-card">
                <h3>Nalo Provider Balance</h3>
                <p class="control-help">Distinct from user wallet balances. This is the SMS provider's prepaid balance used to deliver messages.</p>
                <div class="status-indicator" id="nalo-balance-indicator">
                    <span class="status-dot status-unknown"></span>
                    <span id="nalo-balance-text">Loading...</span>
                </div>
                <div id="nalo-balance-warning" style="display:none; margin-top:12px; padding:12px; border-radius:6px; background:#fff4e5; color:#7a3e00; font-size:14px;">
                    <strong>SMS provider account balance is low.</strong>
                    Top up the Nalo account to resume SMS delivery. This is a separate pool from the in-app user wallet balances shown elsewhere.
                </div>
                <div id="nalo-balance-error" style="display:none; margin-top:12px; padding:12px; border-radius:6px; background:#fdecea; color:#7a1f1a; font-size:14px;"></div>
                <div style="margin-top:8px; font-size:12px; color:#666;" id="nalo-balance-meta"></div>
                <button class="btn-secondary" onclick="refreshNaloBalance()" style="margin-top:12px;">Refresh Balance</button>
            </div>
        </div>
    `;
    refreshNaloBalance();
}

async function refreshNaloBalance() {
    const indicator = document.getElementById('nalo-balance-indicator');
    const text = document.getElementById('nalo-balance-text');
    const warning = document.getElementById('nalo-balance-warning');
    const errorEl = document.getElementById('nalo-balance-error');
    const meta = document.getElementById('nalo-balance-meta');
    if (!indicator || !text) return;

    warning.style.display = 'none';
    errorEl.style.display = 'none';
    indicator.innerHTML = '<span class="status-dot status-unknown"></span><span>Loading...</span>';

    try {
        const response = await window.apiClient.request('GET', '/admin/nalo/balance');
        if (response.error) {
            throw new Error(response.error.message || 'Failed to fetch balance');
        }
        const data = response.data || {};
        const balance = Number(data.balance);
        const isLow = !!data.isLow;
        const threshold = data.threshold;

        const dotClass = isLow ? 'status-warning' : 'status-active';
        const statusLabel = isLow ? 'Low' : 'OK';
        indicator.innerHTML = `<span class="status-dot ${dotClass}"></span><span>Nalo Provider Balance: ${Number.isFinite(balance) ? balance : 'N/A'} credits — ${statusLabel}</span>`;
        meta.textContent = `Last checked: ${new Date().toLocaleString()} (threshold: ${threshold} credits)`;

        if (isLow) {
            warning.style.display = 'block';
        }
    } catch (error) {
        indicator.innerHTML = '<span class="status-dot status-error"></span><span>Nalo Provider Balance: Unavailable</span>';
        errorEl.textContent = `Could not reach Nalo balance-check endpoint. The provider status is unknown. Error: ${error.message}`;
        errorEl.style.display = 'block';
        meta.textContent = `Last attempt: ${new Date().toLocaleString()}`;
    }
}

function renderPagination(data, containerId, loadFunction) {
    const container = document.getElementById(containerId);
    const { currentPage, totalPages } = data;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let paginationHTML = '<div class="pagination-controls">';

    if (currentPage > 1) {
        paginationHTML += `<button onclick="${loadFunction.name}(${currentPage - 1})">Previous</button>`;
    }

    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
        paginationHTML += `<button class="${i === currentPage ? 'active' : ''}" onclick="${loadFunction.name}(${i})">${i}</button>`;
    }

    if (currentPage < totalPages) {
        paginationHTML += `<button onclick="${loadFunction.name}(${currentPage + 1})">Next</button>`;
    }

    paginationHTML += '</div>';
    container.innerHTML = paginationHTML;
}

function toggleSidebar() {
    document.querySelector('.admin-sidebar').classList.toggle('collapsed');
    document.querySelector('.admin-main').classList.toggle('sidebar-collapsed');
}

async function handleLogout() {
    window.apiClient.clearToken();
    window.location.href = '../auth/login.html';
}

async function confirmAction(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmation-modal');
        const title = document.getElementById('modal-title');
        const msg = document.getElementById('modal-message');
        const cancelBtn = document.getElementById('modal-cancel');
        const confirmBtn = document.getElementById('modal-confirm');

        title.textContent = 'Confirm Action';
        msg.textContent = message;
        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            cancelBtn.removeEventListener('click', cancelHandler);
            confirmBtn.removeEventListener('click', confirmHandler);
        };

        const cancelHandler = () => {
            cleanup();
            resolve(false);
        };

        const confirmHandler = () => {
            cleanup();
            resolve(true);
        };

        cancelBtn.addEventListener('click', cancelHandler);
        confirmBtn.addEventListener('click', confirmHandler);
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Make functions global for onclick handlers
window.editUser = async function(userId) {
    try {
        const response = await window.apiClient.request('GET', `/admin/users/${userId}`);
        if (response.error) {
            showToast('Failed to load user details', 'error');
            return;
        }
        
        const user = response.data;
        showEditUserModal(user);
    } catch (error) {
        showToast('Failed to load user details', 'error');
    }
};

function showEditUserModal(user) {
    const modal = document.getElementById('edit-user-modal');
    if (!modal) {
        // Create modal if it doesn't exist
        createEditUserModal();
    }
    
    const modalEl = document.getElementById('edit-user-modal');
    
    // Populate form
    document.getElementById('edit-user-id').value = user._id;
    document.getElementById('edit-user-name').value = user.name || '';
    document.getElementById('edit-user-email').value = user.email || '';
    document.getElementById('edit-user-phone').value = user.phone || '';
    document.getElementById('edit-user-role').value = user.role || 'user';
    document.getElementById('edit-user-status').value = user.status || 'active';
    
    modalEl.style.display = 'flex';
}

function createEditUserModal() {
    const modalHTML = `
        <div id="edit-user-modal" class="modal">
            <div class="modal-content">
                <h3>Edit User</h3>
                <form id="edit-user-form">
                    <input type="hidden" id="edit-user-id">
                    <div class="form-group">
                        <label for="edit-user-name">Name</label>
                        <input type="text" id="edit-user-name" required>
                    </div>
                    <div class="form-group">
                        <label for="edit-user-email">Email</label>
                        <input type="email" id="edit-user-email" required>
                    </div>
                    <div class="form-group">
                        <label for="edit-user-phone">Phone</label>
                        <input type="text" id="edit-user-phone">
                    </div>
                    <div class="form-group">
                        <label for="edit-user-role">Role</label>
                        <select id="edit-user-role">
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                            <option value="super_admin">Super Admin</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-user-status">Status</label>
                        <select id="edit-user-status">
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                        </select>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" onclick="closeEditUserModal()">Cancel</button>
                        <button type="submit" class="btn-primary">Save Changes</button>
                        <button type="button" class="btn-danger" id="delete-user-btn">Delete User</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add form submit handler
    document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveUserChanges();
    });
    
    // Add delete button handler
    document.getElementById('delete-user-btn').addEventListener('click', async () => {
        const userId = document.getElementById('edit-user-id').value;
        await deleteUser(userId);
    });
}

window.closeEditUserModal = function() {
    const modal = document.getElementById('edit-user-modal');
    if (modal) {
        modal.style.display = 'none';
    }
};

async function saveUserChanges() {
    const userId = document.getElementById('edit-user-id').value;
    const name = document.getElementById('edit-user-name').value;
    const email = document.getElementById('edit-user-email').value;
    const phone = document.getElementById('edit-user-phone').value;
    const role = document.getElementById('edit-user-role').value;
    const status = document.getElementById('edit-user-status').value;
    
    try {
        const response = await window.apiClient.request('PUT', `/admin/users/${userId}`, {
            name,
            email,
            phone,
            role,
            status
        });
        
        if (response.error) {
            showToast(extractErrorMessage(response.error) || 'Failed to update user', 'error');
            return;
        }
        
        showToast('User updated successfully', 'success');
        closeEditUserModal();
        loadUsers(); // Refresh the table
    } catch (error) {
        showToast('Failed to update user', 'error');
    }
}

async function deleteUser(userId) {
    if (!await confirmAction('Are you sure you want to delete this user? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await window.apiClient.request('DELETE', `/admin/users/${userId}`);
        
        if (response.error) {
            showToast(extractErrorMessage(response.error) || 'Failed to delete user', 'error');
            return;
        }
        
        showToast('User deleted successfully', 'success');
        closeEditUserModal();
        loadUsers(); // Refresh the table
    } catch (error) {
        showToast('Failed to delete user', 'error');
    }
}

window.suspendUser = suspendUser;
window.activateUser = activateUser;
window.adjustBalance = adjustBalance;
window.freezeWallet = freezeWallet;
window.unfreezeWallet = unfreezeWallet;
window.approveSenderId = approveSenderId;
window.rejectSenderId = rejectSenderId;
window.stopCampaign = stopCampaign;