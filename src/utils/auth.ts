// Authentication utilities
// Get storage function from authStorage
function getStorage() {
    return (window as any).getStorage ? (window as any).getStorage() : localStorage;
}

export function login(email: string, password: string): boolean {
    // Mock authentication
    if (email === 'user@example.com' && password === 'password') {
        getStorage().setItem('isAuthenticated', 'true');
        console.log('[Auth] Login successful for email:', email);
        return true;
    }
    console.log('[Auth] Login failed for email:', email);
    return false;
}

export function register(name: string, email: string, password: string): boolean {
    // Mock registration
    getStorage().setItem('userName', name);
    getStorage().setItem('userEmail', email);
    getStorage().setItem('isAuthenticated', 'true');
    console.log('[Auth] Registration successful for email:', email);
    return true;
}

export function logout(): void {
    const storage = getStorage();
    storage.removeItem('isAuthenticated');
    storage.removeItem('userName');
    storage.removeItem('userEmail');
    console.log('[Auth] User logged out');
}

export function isAuthenticated(): boolean {
    const isAuth = getStorage().getItem('isAuthenticated') === 'true';
    console.log('[Auth] Auth check:', isAuth);
    return isAuth;
}