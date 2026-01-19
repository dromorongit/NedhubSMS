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
    if (!token) {
        loadLogin();
        return;
    }

    try {
        // Verify token and get user info
        const response = await fetch('http://localhost:3000/api/auth/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Token invalid');
        }

        const userData = await response.json();
        const user = userData.user;

        // Check if admin and redirect to admin panel
        if (user.role === 'admin' || user.role === 'super_admin') {
            window.location.href = 'src/pages/admin/dashboard.html';
            return;
        }

        // Regular user dashboard
        loadDashboard();
    } catch (error) {
        console.error('Auth verification failed:', error);
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