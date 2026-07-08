# Forensic Audit Report: Send SMS Authentication Redirect Issue

## Executive Summary
**Root Cause:** The Send SMS page (`send-sms.html`) is missing the `authStorage.js` script include and uses `localStorage.getItem('authToken')` directly instead of using `window.getStorage().getItem('authToken')`. This causes authentication failures when users log in with "Remember Me" unchecked, as their token is stored in `sessionStorage` but the page only checks `localStorage`.

---

## Complete Execution Flow Analysis

### Page Load Sequence (send-sms.html)

| Step | Script/File | Line | Execution Details |
|------|-------------|------|-----------------|
| 1 | HTML `<head>` | 12-13 | Scripts `api.js` and `toast.js` loaded with `defer` attribute |
| 2 | **MISSING** | - | `authStorage.js` is NOT included - **ROOT CAUSE** |
| 3 | api.js | 7 | `const getStorageFunc = window.getStorage \|\| (() => localStorage)` executes during script parse |
| 4 | api.js | 12 | `ApiClient` constructor runs: `this.token = storage.getItem('authToken')` using localStorage (wrong storage) |
| 5 | DOMContentLoaded | 798 | `checkAuthAndLoad()` fires on DOM ready |
| 6 | checkAuthAndLoad() | 803 | `const token = localStorage.getItem('authToken')` - **FAILS** when token in sessionStorage |
| 7 | checkAuthAndLoad() | 805 | Redirect to login occurs: `window.location.href = '../auth/login.html'` |

---

## Evidence of Differences

### Script Loading - Head Section Comparison

**send-sms.html (BROKEN):**
```html
<!-- Lines 12-13 -->
<script src="../../utils/api.js" defer></script>
<script src="../../utils/toast.js" defer></script>
```

**overview.html (WORKING):**
```html
<!-- Lines 306-308 -->
<script src="../../utils/authStorage.js"></script>
<script src="../../utils/api.js"></script>
<script src="../../utils/toast.js"></script>
```

**contacts.html (WORKING):**
```html
<!-- Lines 12-14 -->
<script src="../../utils/authStorage.js"></script>
<script src="../../utils/api.js" defer></script>
<script src="../../utils/toast.js" defer></script>
```

**history.html (WORKING):**
```html
<!-- Lines 12-14 -->
<script src="../../utils/authStorage.js"></script>
<script src="../../utils/api.js" defer></script>
<script src="../../utils/toast.js" defer></script>
```

### Authentication Check Comparison

**send-sms.html (BROKEN):**
```javascript
// Line 802-803
async function checkAuthAndLoad() {
    const token = localStorage.getItem('authToken');  // DIRECT localStorage access
```

**overview.html (WORKING):**
```javascript
// Line 315-316
async function checkAuthAndLoad() {
    const token = window.getStorage ? window.getStorage().getItem('authToken') : localStorage.getItem('authToken');
```

**contacts.html (WORKING):**
```javascript
// Line 392-393
async function checkAuthAndLoad() {
    const token = window.getStorage ? window.getStorage().getItem('authToken') : localStorage.getItem('authToken');
```

### Logout Function Comparison

**send-sms.html (BROKEN):**
```javascript
// Line 2728-2732
function logout() {
    localStorage.removeItem('authToken');  // Only localStorage
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    window.location.href = '../auth/login.html';
}
```

**overview.html (WORKING):**
```javascript
// Line 588-595
function logout() {
    const storage = window.getStorage ? window.getStorage() : localStorage;
    storage.removeItem('authToken');      // Uses correct storage
    storage.removeItem('userName');
    storage.removeItem('userEmail');
    // Also clear the storage type preference
    localStorage.removeItem('authStorageType');
    window.location.href = '../auth/login.html';
}
```

---

## Root Cause Analysis

### Primary Issue: Missing authStorage.js Include
- **File:** `src/pages/dashboard/send-sms.html`
- **Location:** `<head>` section, lines 12-13
- **Evidence:** No `<script src="../../utils/authStorage.js">` tag exists in the file

### Secondary Issue: Direct localStorage Access
- **File:** `src/pages/dashboard/send-sms.html`
- **Location:** Line 803
- **Code:** `const token = localStorage.getItem('authToken')`

### Tertiary Issue: Incomplete logout() Function
- **File:** `src/pages/dashboard/send-sms.html`
- **Location:** Lines 2728-2732
- **Code:** Only clears localStorage, ignores sessionStorage if used

---

## Why the Redirect Occurs

1. User logs in with "Remember Me" **unchecked**
2. `login.html` (line 209) sets storage type to `'session'`:
   ```javascript
   window.setStorageType(rememberMe ? 'local' : 'session');
   ```
3. Token is stored in `sessionStorage` by `apiClient.setToken()`
4. User navigates to Overview - works because page includes `authStorage.js` and uses `window.getStorage()`
5. User navigates to Send SMS - **fails** because:
   - `authStorage.js` not loaded, so `window.getStorage` is undefined
   - `localStorage.getItem('authToken')` returns `null` (token in sessionStorage, not localStorage)
   - `checkAuthAndLoad()` redirects to login immediately

---

## Execution Timeline Diagram

```
User navigates to send-sms.html
    ↓
<head> loads scripts
    ├── api.js (defer) → executes during DOM parse
    │   └── getStorageFunc = window.getStorage || (() => localStorage)
    │       → window.getStorage is UNDEFINED (authStorage.js not loaded)
    │       → Falls back to localStorage
    ├── toast.js (defer)
    └── authStorage.js → MISSING - NEVER LOADS
    ↓
DOMContentLoaded fires (api.js already executed)
    ↓
checkAuthAndLoad() executes
    ├── token = localStorage.getItem('authToken') → NULL
    │   (token was stored in sessionStorage, not localStorage)
    └── window.location.href = '../auth/login.html' → REDIRECT
```

---

## Minimal Fix Required

Add the missing script include to `send-sms.html` head section:

```html
<script src="../../utils/authStorage.js"></script>
```

And update the authentication check:

```javascript
const token = window.getStorage ? window.getStorage().getItem('authToken') : localStorage.getItem('authToken');
```

And update the logout function:

```javascript
function logout() {
    const storage = window.getStorage ? window.getStorage() : localStorage;
    storage.removeItem('authToken');
    storage.removeItem('userName');
    storage.removeItem('userEmail');
    localStorage.removeItem('authStorageType');
    window.location.href = '../auth/login.html';
}
```

---

## Classification

- **Category:** Frontend Authentication/Storage Issue
- **Impact:** Users with session-only authentication (Remember Me unchecked) cannot access Send SMS page
- **Severity:** High - Affects core functionality
- **Affected Component:** `src/pages/dashboard/send-sms.html`
- **Scope:** Frontend only, no backend changes required