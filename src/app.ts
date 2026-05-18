// Main application entry point
console.log('Nedhub Bulk Messaging Platform initialized');

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    
    // Load the initial view (e.g., login or dashboard)
    loadInitialView();
});

// Get API base URL (matches api.js logic)
function getApiBaseUrl() {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocalhost ? 'http://localhost:3000/api' : 'https://nedhubsms-production.up.railway.app/api';
}

// Get storage function from authStorage
function getStorageFunc() {
    return (window as any).getStorage ? (window as any).getStorage() : localStorage;
}

async function loadInitialView() {
    // Check if user is authenticated using storage-aware function
    const storage = getStorageFunc();
    const token = storage.getItem('authToken');
    const storageType = storage === sessionStorage ? 'sessionStorage' : 'localStorage';
    console.log('[AuthBootstrap] [App] loadInitialView - token present:', !!token, 'Storage type:', storageType);
    
    if (!token) {
        console.log('[AuthBootstrap] [App] No token found, redirecting to login');
        loadLogin();
        return;
    }

    try {
        console.log('[AuthBootstrap] [App] Verifying token with backend...');
        // Verify token and get user info
        const apiBaseUrl = getApiBaseUrl();
        const response = await fetch(`${apiBaseUrl}/auth/verify`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('[AuthBootstrap] [App] Verification response status:', response.status);

        if (!response.ok) {
            throw new Error('Token invalid');
        }

        const userData = await response.json();
        const user = userData.user;

        console.log('[AuthBootstrap] [App] Token verified, user role:', user.role);

        // Check if admin and redirect to admin panel
        if (user.role === 'admin' || user.role === 'super_admin') {
            console.log('[Redirect] [App] Redirecting to admin panel');
            window.location.href = 'src/pages/admin/admin.html';
            return;
        }

        // Regular user dashboard
        loadDashboard();
    } catch (error) {
        console.error('[AuthBootstrap] [App] Auth verification failed:', error);
        // Clear invalid token
        getStorageFunc().removeItem('authToken');
        loadLogin();
    }
}

function checkAuthentication(): boolean {
    const storage = getStorageFunc();
    const token = storage.getItem('authToken');
    const storageType = storage === sessionStorage ? 'sessionStorage' : 'localStorage';
    console.log('[AuthBootstrap] [App] checkAuthentication - token present:', !!token, 'Storage type:', storageType);
    return !!token;
}

function loadDashboard() {
    console.log('Loading dashboard...');
    // Redirect to dashboard page
    window.location.href = 'src/pages/dashboard/overview.html';
}

function loadLogin() {
    console.log('Loading login...');
    // Redirect to login page
    window.location.href = 'src/pages/auth/login.html';
}