// Main application entry point
console.log('Nedhub Bulk Messaging Platform initialized');

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    
    // Load the initial view (e.g., login or dashboard)
    loadInitialView();
});

async function loadInitialView() {
    // Check if user is authenticated
    const token = localStorage.getItem('authToken');
    console.log('[App] loadInitialView - token present:', !!token);
    
    if (!token) {
        console.log('[App] No token found, redirecting to login');
        loadLogin();
        return;
    }

    try {
        console.log('[App] Verifying token with backend...');
        // Verify token and get user info
        const response = await fetch('http://localhost:3000/api/auth/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('[App] Verification response status:', response.status);

        if (!response.ok) {
            throw new Error('Token invalid');
        }

        const userData = await response.json();
        const user = userData.user;

        console.log('[App] Token verified, user role:', user.role);

        // Check if admin and redirect to admin panel
        if (user.role === 'admin' || user.role === 'super_admin') {
            window.location.href = 'src/pages/admin/admin.html';
            return;
        }

        // Regular user dashboard
        loadDashboard();
    } catch (error) {
        console.error('[App] Auth verification failed:', error);
        loadLogin();
    }
}

function checkAuthentication(): boolean {
    return !!localStorage.getItem('authToken');
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