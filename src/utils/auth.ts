// Authentication utilities
export function login(email: string, password: string): boolean {
    // Mock authentication
    if (email === 'user@example.com' && password === 'password') {
        localStorage.setItem('isAuthenticated', 'true');
        console.log('[Auth] Login successful for email:', email);
        return true;
    }
    console.log('[Auth] Login failed for email:', email);
    return false;
}

export function register(name: string, email: string, password: string): boolean {
    // Mock registration
    localStorage.setItem('userName', name);
    localStorage.setItem('userEmail', email);
    localStorage.setItem('isAuthenticated', 'true');
    console.log('[Auth] Registration successful for email:', email);
    return true;
}

export function logout(): void {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    console.log('[Auth] User logged out');
}

export function isAuthenticated(): boolean {
    const isAuth = localStorage.getItem('isAuthenticated') === 'true';
    console.log('[Auth] Auth check:', isAuth);
    return isAuth;
}