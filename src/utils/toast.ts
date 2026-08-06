// Toast notification utility
export function showToast(message: any, type: 'success' | 'error' | 'info' = 'info'): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const text = (message === null || message === undefined) ? '' : String(message);
    toast.textContent = text && text !== '[object Object]' ? text : 'An unexpected error occurred. Please try again.';
    
    // Add toast to DOM
    document.body.appendChild(toast);
    
    // Remove toast after timeout
    setTimeout(() => {
        toast.remove();
    }, 3000);
}