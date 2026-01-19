// Toast notification utility
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // Add toast to DOM
    document.body.appendChild(toast);
    
    // Remove toast after timeout
    setTimeout(() => {
        toast.remove();
    }, 3000);
}