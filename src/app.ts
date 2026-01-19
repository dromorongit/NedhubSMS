// Main application entry point
console.log('Nedhub Bulk Messaging Platform initialized');

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    
    // Load the initial view (e.g., login or dashboard)
    loadInitialView();
});

function loadInitialView() {
    // Check if user is authenticated (mock check)
    const isAuthenticated = checkAuthentication();
    
    const appContainer = document.getElementById('app');
    if (!appContainer) return;
    
    if (isAuthenticated) {
        loadDashboard(appContainer);
    } else {
        loadLogin(appContainer);
    }
}

function checkAuthentication(): boolean {
    // Mock authentication check
    return localStorage.getItem('isAuthenticated') === 'true';
}

function loadDashboard(container: HTMLElement) {
    console.log('Loading dashboard...');
    // Redirect to dashboard page
    window.location.href = 'src/pages/dashboard/overview.html';
}

function loadLogin(container: HTMLElement) {
    console.log('Loading login...');
    // Redirect to login page
    window.location.href = 'src/pages/auth/login.html';
}