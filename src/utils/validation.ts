// Form validation utilities
export function validateEmail(email: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

export function validatePassword(password: string): boolean {
    return password.length >= 8;
}

export function validatePhoneNumber(phone: string): boolean {
    const re = /^\+?[0-9\s-]{10,}$/;
    return re.test(phone);
}

export function validateRequired(field: string): boolean {
    return field.trim().length > 0;
}