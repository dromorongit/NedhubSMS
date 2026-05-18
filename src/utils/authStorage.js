// Auth storage utility to handle persistent vs session storage based on 'remember me' choice
const AUTH_STORAGE_TYPE_KEY = 'authStorageType';

export function getStorageType() {
    const type = localStorage.getItem(AUTH_STORAGE_TYPE_KEY);
    return type === 'session' ? 'session' : 'local'; // default to local
}

export function setStorageType(type) {
    localStorage.setItem(AUTH_STORAGE_TYPE_KEY, type);
}

export function getStorage() {
    return getStorageType() === 'session' ? sessionStorage : localStorage;
}

// Attach to window for use in non-module scripts
if (typeof window !== 'undefined') {
    window.getStorageType = getStorageType;
    window.setStorageType = setStorageType;
    window.getStorage = getStorage;
}