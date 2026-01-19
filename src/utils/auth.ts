// Authentication utilities
export function login(email: string, password: string): boolean {
    // Mock authentication
    if (email === 'user@example.com' && password === 'password') {
        localStorage.setItem('isAuthenticated', 'true');
        return true;
    }
    return false;
}

export function register(name: string, email: string, password: string): boolean {
    // Mock registration
    localStorage.setItem('userName', name);
    localStorage.setItem('userEmail', email);
    localStorage.setItem('isAuthenticated', 'true');
    return true;
}

export function logout(): void {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
}

export function isAuthenticated(): boolean {
    return localStorage.getItem('isAuthenticated') === 'true';
}