# Send SMS Send Failure — Forensic Root-Cause Audit

**Date:** 2026-08-09  
**Scope:** Default Messaging and Personalized Messaging send pipeline  
**Symptom:** User clicks **Send Now**, SMS is not sent, wallet is not deducted, frontend displays only `An unexpected error occurred. Please try again.`  
**Auditor:** Kilo (automated forensic analysis)

---

## 1. Executive Summary

The frontend is **swallowing every backend error** and replacing it with a generic toast. Two independent bugs in `src/utils/api.js` and `src/pages/dashboard/send-sms.html` cause the real backend diagnostic (HTTP status, error code, error message, and stack details) to be discarded. The exact backend failure point **cannot be determined from the frontend alone** because the error extraction logic is broken for the backend's actual error response shape.

---

## 2. Exact Frontend Error-Handling Path

### 2.1 Entry Point — `handleConfirmSend()`

**File:** `src/pages/dashboard/send-sms.html`  
**Line:** 4811-4843

```javascript
async function handleConfirmSend() {
    ...
    try {
        await sendOrScheduleCampaign(sendMode, recipients, scheduledAt);
    } finally {
        handleConfirmSend.inProgress = false;
        closeConfirmationModal();
    }
}
```

### 2.2 Send Execution — `sendOrScheduleCampaign()`

**File:** `src/pages/dashboard/send-sms.html`  
**Line:** 4137-4398

For **Default Messaging** (line 4257-4279):
```javascript
const campaignData = {
    senderId,
    message: messageBody,
    recipients: recipients.map(r => ({...})),
    removeDuplicates: removeDuplicates
};
result = await window.apiClient.sendSMS(campaignData);
```

For **Personalized Messaging** (line 4228-4255):
```javascript
const campaignData = {
    title, messageBody, salutation, customSalutation,
    recipients: recipients.map(r => ({...})),
    senderId, removeDuplicates
};
result = await window.apiClient.sendPersonalizedCampaign(campaignData);
```

### 2.3 API Client Request — `apiClient.request()`

**File:** `src/utils/api.js`  
**Line:** 73-213

The `request()` method fetches the backend, reads the response, and on non-ok HTTP status calls:

```javascript
// Line 188-196
if (!response.ok) {
    const errorMessage = extractErrorMessage(result?.error) || extractErrorMessage(result?.message) || 'Request failed';
    return {
        error: errorMessage,
        status: response.status,
        data: result,
        contentType: 'application/json'
    };
}
```

**Critical defect:** `extractErrorMessage(result?.error)` returns a **truthy string** (the generic fallback), so the `||` chain **never evaluates** `result.message`, which contains the actual human-readable backend error.

### 2.4 The `extractErrorMessage()` Function

**File:** `src/utils/api.js`  
**Line:** 17-40

```javascript
function extractErrorMessage(error) {
  if (!error) return 'An unexpected error occurred. Please try again.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const msg = error.message;
    return (typeof msg === 'string' && msg) ? msg : 'An unexpected error occurred. Please try again.';
  }
  if (typeof error === 'object' && error !== null) {
    const msg = error.message || error.error || error.msg || error.statusText;
    if (typeof msg === 'string' && msg) return msg;
    if (msg && typeof msg === 'object') return extractErrorMessage(msg);
    return 'An unexpected error occurred. Please try again.';
  }
  const str = String(error);
  return str && str !== '[object Object]' ? str : 'An unexpected error occurred. Please try again.';
}
```

**Defect:** The function only checks `.message`, `.error`, `.msg`, and `.statusText` on objects. The backend consistently returns errors as:

```json
{
  "success": false,
  "message": "Failed to send SMS",
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "details": "<actual error message>"
  }
}
```

When `extractErrorMessage()` receives `{ code: "INTERNAL_SERVER_ERROR", details: "..." }`:
1. `error.message` → `undefined`
2. `error.error` → `undefined`
3. `error.msg` → `undefined`
4. `error.statusText` → `undefined`
5. Falls through to **return `'An unexpected error occurred. Please try again.'`**

Because the return value is a truthy string, the `||` chain in `request()` stops and **never reads `result.message`**.

### 2.5 Frontend Toast Display — `sendOrScheduleCampaign()`

**File:** `src/pages/dashboard/send-sms.html`  
**Line:** 4283-4307 (error path) and 4356-4379 (all-fail path)

**Path A — Backend returns non-ok HTTP status (400/402/500):**
```javascript
if (result.error) {
    let errorMessage = result.error; // = "An unexpected error occurred. Please try again."
    ...
    showToast(errorMessage, 'error');
}
```

**Path B — Backend returns 200 but all recipients failed:**
```javascript
} else {
    const responseData = result.data || result;
    let successCount = responseData.successfulRecipients ?? 0;
    const isSuccess = successCount > 0;
    if (!isSuccess) {
        let errorMessage = extractErrorMessage(responseData.error) || 'Campaign failed to send';
        // responseData.error is undefined → extractErrorMessage returns generic fallback
        showToast(errorMessage, 'error');
    }
}
```

### 2.6 Toast Fallback — `showToast()`

**File:** `src/utils/toast.js`  
**Line:** 2-6

```javascript
function showToast(message, type = 'info') {
    const text = (message === null || message === undefined) ? '' : String(message);
    toast.textContent = text && text !== '[object Object]' ? text : 'An unexpected error occurred. Please try again.';
    ...
}
```

If any code path passes an **object** instead of a string to `showToast`, it also falls back to the generic message.

---

## 3. Backend Error Response Structure

### 3.1 Default Messaging `/sms/send` Catch Block

**File:** `backend/routes/sms.js`  
**Line:** 249-269

```javascript
} catch (error) {
    console.error('[SendSMS] Error:', error);
    const errorResponse = {
      success: false,
      message: 'Failed to send SMS',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    };
    res.status(500).json(errorResponse);
}
```

### 3.2 Personalized Messaging `/sms-campaigns/send` Catch Block

**File:** `backend/routes/sms-campaigns.js`  
**Line:** 505-515

```javascript
} catch (error) {
    console.error('Send campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send campaign',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
}
```

### 3.3 Validation Error Structure (both routes)

```json
{
  "success": false,
  "message": "Sender ID, recipients, and message are required",
  "error": { "code": "VALIDATION_ERROR" }
}
```

All backend errors use `{ code, details? }` inside the `error` field, with the human-readable message in the top-level `message` field. The frontend's `extractErrorMessage()` never reads the top-level `message` field when `result.error` exists.

---

## 4. Backend Send Pipeline — Exact Execution Path

### 4.1 Default Messaging (`POST /api/sms/send`)

**File:** `backend/routes/sms.js`  
**Line:** 14-270

| Step | Line | Action | Can Throw? |
|------|------|--------|------------|
| 1 | 16-17 | Extract `senderId`, `recipients`, `message`; get `userId` | No |
| 2 | 27-33 | Validate required fields | No (returns 400) |
| 3 | 36-42 | Validate recipients array | No (returns 400) |
| 4 | 45-51 | Enforce `MAX_SMS_RECIPIENTS` (200) | No (returns 400) |
| 5 | 54-60 | Validate `message.length <= 160` | No (returns 400) |
| 6 | 64-71 | `checkBalance()` — Nalo provider balance | No (catches and returns 1000) |
| 7 | 74-82 | `WalletService.getAvailableBalance(userId)` | **YES** (MongoDB) |
| 8 | 84-96 | Normalize recipients to canonical schema | No |
| 9 | 100-106 | `SmsRecipientService.processRecipientsForCampaign()` | **YES** (MongoDB, blacklist query) |
| 10 | 119-132 | Check `recipientsToSend.length > 0` | No (returns 400) |
| 11 | 145-156 | Loop chunks: `NaloSmsService.sendSmsWithFinancialTracking()` | **YES** (per-recipient, caught by `Promise.allSettled`) |
| 12 | 208-248 | Build response and `res.json()` | No |

**If step 7, 9, or 11 throws an unhandled exception, the route catch block (line 249) returns 500.**

### 4.2 Personalized Messaging (`POST /api/sms-campaigns/send`)

**File:** `backend/routes/sms-campaigns.js`  
**Line:** 211-516

| Step | Line | Action | Can Throw? |
|------|------|--------|------------|
| 1 | 213-223 | Extract fields; get `userId` | No |
| 2 | 234-240 | Validate required fields | No (returns 400) |
| 3 | 243-249 | Enforce `MAX_SMS_RECIPIENTS` | No (returns 400) |
| 4 | 252-262 | Validate message template | No (returns 400) |
| 5 | 264-270 | `SmsRecipientService.processRecipientsForCampaign()` | **YES** (MongoDB) |
| 6 | 288-303 | Check `finalCount > 0` | No (returns 400) |
| 7 | 305-311 | `CostCalculatorService.calculateLiveCost()` | **YES** (MongoDB, `getMonthlyVolume`) |
| 8 | 313-338 | Create `SmsCampaign` + `WalletService.reserveFunds()` | **YES** (MongoDB) |
| 9 | 340-441 | Loop chunks: send via `NaloSmsService.sendSmsWithFinancialTracking()` | **YES** (per-recipient, caught by `Promise.allSettled`) |
| 10 | 443-503 | Update campaign status + build response | No |

**If step 5, 7, 8, or 9 throws an unhandled exception, the route catch block (line 505) returns 500.**

### 4.3 NaloSmsService — `sendSmsWithFinancialTracking()`

**File:** `backend/services/NaloSmsService.js`  
**Line:** 198-673

| Step | Line | Action | Can Throw? |
|------|------|--------|------------|
| 1 | 204 | `formatPhoneNumber()` | No |
| 2 | 244-256 | Validate phone format | No (returns failure object) |
| 3 | 258-269 | Validate sender ID format | No (returns failure object) |
| 4 | 271-283 | Verify sender ID approval | No (returns failure object) |
| 5 | 286-290 | `CostCalculatorService.calculateFinancialBreakdown()` | **YES** (MongoDB) |
| 6 | 304-316 | `WalletService.hasSufficientBalance()` + `WalletService.deductGhsForSms()` | **YES** (MongoDB, insufficient funds) |
| 7 | 339-514 | Send via Nalo API or dummy mode | **YES** (network, provider error — caught internally) |
| 8 | 518-539 | `SmsMessage.create()` | **YES** (MongoDB, validation, duplicate `jobId`) |

**Steps 2-4 return `{ success: false, error: '...', code: '...' }` without throwing.**  
**Step 7 catches API errors internally and returns failure objects.**  
**Steps 5, 6, 8 can throw unhandled exceptions.**

---

## 5. Identified Root Causes and Defects

### 5.1 ROOT CAUSE — Frontend Error Extraction Failure (PROVEN)

**Defect:** `extractErrorMessage()` in `src/utils/api.js` (line 17-40) cannot parse the backend's `{ code, details }` error structure. It returns the generic fallback `'An unexpected error occurred. Please try again.'` for any object that lacks `.message`, `.error`, `.msg`, or `.statusText` at the top level.

**Impact:** ALL backend errors (validation, auth, wallet, provider, database, server) are displayed as the same generic toast. The user cannot distinguish between "insufficient balance", "invalid sender ID", "no valid recipients", or "server error".

**Evidence:**
- Backend catch block at `backend/routes/sms.js:252-268` returns `{ error: { code: 'INTERNAL_SERVER_ERROR', details: error.message } }`
- `extractErrorMessage()` checks `error.message` → undefined, `error.error` → undefined, `error.msg` → undefined, `error.statusText` → undefined
- Returns generic fallback
- `request()` line 190: `extractErrorMessage(result?.error) || extractErrorMessage(result?.message)` — the first call returns a truthy string, so `result.message` is never evaluated

### 5.2 ROOT CAUSE — Frontend All-Fail Path Error Gap (PROVEN)

**Defect:** When the backend returns HTTP 200 but `successfulRecipients === 0`, the frontend's `sendOrScheduleCampaign()` (line 4356-4379) calls `extractErrorMessage(responseData.error)` where `responseData.error` is `undefined`. This returns the generic fallback.

**Impact:** Even when the backend provides per-recipient failure details in `responseData.results`, the frontend discards them and shows the generic message.

**Evidence:**
- Backend `/sms/send` response at `backend/routes/sms.js:227-231`: `{ success: false, message: 'Campaign failed to send', data: { results: [...] } }`
- `responseData.error` is undefined because the backend puts the error at the top level `message` field, not inside `data.error`
- Frontend line 4358: `extractErrorMessage(undefined)` → generic fallback

### 5.3 Defect — Personalized Messaging Reservation Leak (PROVEN)

**Defect:** The `/sms-campaigns/send` route catch block (`backend/routes/sms-campaigns.js:505-515`) does **not** release the wallet reservation if an exception occurs after `WalletService.reserveFunds()` (line 334).

**Impact:** If an error occurs during sending (e.g., MongoDB failure while saving `SmsRecipient`), the reserved funds remain locked in the wallet reservation and are never returned to the available balance.

**Evidence:**
- Reservation created at `backend/routes/sms-campaigns.js:334`: `reservation = await WalletService.reserveFunds(userId, costEstimation.estimatedCost, campaign._id);`
- Compare with `/schedule` catch block at `backend/routes/sms-campaigns.js:836-850` which correctly releases the reservation
- `/sms-campaigns/send` catch block has no `WalletService.releaseReservation()` call

### 5.4 Defect — Sender ID Validation Mismatch (PROVEN)

**Defect:** `NaloSmsService.validateSenderId()` (`backend/services/NaloSmsService.js:67-69`) uses regex `/^[a-zA-Z0-9]{1,11}$/` which rejects spaces, hyphens, periods, and underscores. But the `SenderId` model (`backend/models/SenderId.js:13-16`) allows `/^[a-zA-Z0-9\s\-_.]{1,11}$/`.

**Impact:** A user can successfully create and get approval for a Sender ID like `"Ned Hub"` or `"Test-SMS"`, but every SMS send fails with `INVALID_SENDER_ID` because `NaloSmsService` rejects it before calling the Nalo API.

**Evidence:**
- Frontend sends Sender ID at `src/pages/dashboard/send-sms.html:4257`: `senderId` from dropdown
- Backend `NaloSmsService` line 259-268: returns failure if `!/^[a-zA-Z0-9]{1,11}$/.test(senderId)`
- `SenderId` model line 14: match allows `\s\-_.`

### 5.5 Defect — Default Messaging Ignores `removeDuplicates` Parameter (PROVEN)

**Defect:** `backend/routes/sms.js:100-106` hardcodes `true` for `removeDuplicates` when calling `SmsRecipientService.processRecipientsForCampaign()`, ignoring the `removeDuplicates` field sent by the frontend.

**Impact:** The frontend's "Allow duplicate recipients" radio button has no effect for Default Messaging.

**Evidence:**
- Frontend sends `removeDuplicates` at `src/pages/dashboard/send-sms.html:4268`
- Backend `/sms/send` line 105: `true` is hardcoded

---

## 6. Backend Failure Point Analysis

### 6.1 What Backend Errors Are Possible?

Based on the pipeline analysis, the following backend errors can occur:

| Error | HTTP Status | Backend `error.code` | Wallet Deducted? | Nalo Reached? |
|-------|-------------|----------------------|------------------|---------------|
| Missing/invalid fields | 400 | `VALIDATION_ERROR` | No | No |
| Recipients > 200 | 400 | `VALIDATION_ERROR` | No | No |
| Message > 160 chars | 400 | `VALIDATION_ERROR` | No | No |
| No valid recipients | 400 | `NO_VALID_RECIPIENTS` | No | No |
| Sender ID not approved | 400 | `VALIDATION_ERROR` | No | No |
| Insufficient Nalo balance | 402 | `INSUFFICIENT_PROVIDER_BALANCE` | No | No |
| Insufficient wallet balance | 402 | `INSUFFICIENT_BALANCE` | No | No |
| Invalid phone/sender ID | 200 (all-fail) | `INVALID_PHONE_NUMBER` / `INVALID_SENDER_ID` | No (default) / Yes (personalized, then refunded) | No |
| Nalo API failure | 200 (all-fail) | `SMS_SEND_FAILED` | Yes, then refunded | Yes |
| MongoDB/DB error | 500 | `INTERNAL_SERVER_ERROR` | No | No |
| Unhandled exception | 500 | `INTERNAL_SERVER_ERROR` | No | No |

### 6.2 Why the Exact Backend Error Is Unknown

The frontend's `extractErrorMessage()` converts every non-401 backend response into the same string. Without backend logs, it is impossible to determine which of the above errors is occurring. The audit code analysis identifies the **most likely** failure points:

1. **`SmsRecipientService.processRecipientsForCampaign()`** — Called by both routes. Throws on MongoDB failure or unexpected data.
2. **`WalletService.getAvailableBalance()`** — Called by default messaging. Throws on MongoDB failure.
3. **`CostCalculatorService.calculateLiveCost()`** — Called by personalized messaging. Throws on MongoDB failure.
4. **`NaloSmsService.sendSmsWithFinancialTracking()`** — Called by both routes. Returns per-recipient failures for invalid sender IDs or Nalo errors.
5. **Sender ID validation mismatch** — If the user's approved Sender ID contains non-alphanumeric characters, ALL sends fail with `INVALID_SENDER_ID`.

### 6.3 Was Nalo Reached?

**Cannot be determined from the frontend alone.** If the failure is in steps 1-9 of the backend pipeline (before `NaloSmsService`), Nalo is never contacted. If the failure is in step 11 (Nalo API call), Nalo was reached but rejected the message.

### 6.4 Was Wallet Reservation Created?

- **Default Messaging:** No reservation is created. Wallet deduction happens inside `NaloSmsService.sendSmsWithFinancialTracking()` only if the sender ID is valid and the Nalo API call succeeds.
- **Personalized Messaging:** A reservation IS created at `backend/routes/sms-campaigns.js:334`. If an exception occurs after this point, the reservation is **leaked** (not released) due to defect 5.3.

### 6.5 Was Wallet Deducted?

- **Default Messaging:** No, because deduction only occurs after sender ID validation and Nalo API acceptance.
- **Personalized Messaging:** If sending reached `NaloSmsService`, the wallet is deducted before the Nalo API call. If Nalo rejects the message, the wallet is refunded. If an exception occurs after deduction but before refund logic, the wallet may be stuck.

---

## 7. Exact Frontend Code Responsible for Generic Toast

### 7.1 Primary Source

**File:** `src/utils/api.js`  
**Function:** `extractErrorMessage()` (line 17-40)  
**Called from:** `request()` line 190

**Exact code path:**
1. Backend returns `{ success: false, message: '...', error: { code: '...', details: '...' } }`
2. `api.js` line 190: `extractErrorMessage(result?.error)` is called with `{ code: '...', details: '...' }`
3. `extractErrorMessage` checks `error.message`, `error.error`, `error.msg`, `error.statusText` — all `undefined`
4. Returns `'An unexpected error occurred. Please try again.'`
5. Because this is truthy, `result.message` is never evaluated
6. `request()` returns `{ error: 'An unexpected error occurred. Please try again.', ... }`
7. `sendOrScheduleCampaign()` line 4307: `showToast(result.error, 'error')`

### 7.2 Secondary Source

**File:** `src/pages/dashboard/send-sms.html`  
**Function:** `sendOrScheduleCampaign()` (line 4137-4398)  
**Line:** 4356-4379

When backend returns 200 but all recipients fail:
1. `responseData.error` is `undefined`
2. `extractErrorMessage(undefined)` returns `'An unexpected error occurred. Please try again.'`
3. `showToast()` displays the generic message

---

## 8. Recommended Fixes

### 8.1 Fix `extractErrorMessage()` to Handle Backend Error Shapes

**File:** `src/utils/api.js`  
**Line:** 17-40

The function must recursively inspect nested objects and also check `code` and `details` properties. It must also ensure it never returns an object.

### 8.2 Fix `request()` Error Extraction Order

**File:** `src/utils/api.js`  
**Line:** 188-196

The extraction must prioritize `result.message` over `result.error` when `result.error` is an object without a readable string message. Or, `extractErrorMessage` must be fixed so it correctly extracts from nested `{ code, details }` objects.

### 8.3 Fix All-Fail Path in `sendOrScheduleCampaign()`

**File:** `src/pages/dashboard/send-sms.html`  
**Line:** 4356-4379

When `successCount === 0`, the frontend should construct an error message from `responseData.results` (per-recipient errors) and `responseData.message` (backend summary), not call `extractErrorMessage(responseData.error)`.

### 8.4 Fix Reservation Leak in `/sms-campaigns/send`

**File:** `backend/routes/sms-campaigns.js`  
**Line:** 505-515

Add `WalletService.releaseReservation(reservation._id)` in the catch block, matching the pattern used in the `/schedule` catch block.

### 8.5 Fix Sender ID Validation Mismatch

**File:** `backend/services/NaloSmsService.js`  
**Line:** 67-69

Update `validateSenderId()` regex to match the `SenderId` model: `/^[a-zA-Z0-9\s\-_.]{1,11}$/`.

---

## 9. Verification Plan

After fixes, the following tests must pass:

1. **Default Messaging + 1 recipient** — SMS sent, wallet deducted, success toast shown
2. **Default Messaging + 200 recipients** — All sent or partial success with per-recipient error details
3. **Personalized Messaging + 1 recipient with name** — SMS sent, wallet deducted
4. **Personalized Messaging + missing name** — Uses "Unknown Recipient" fallback
5. **Manual recipient** — Sends successfully
6. **Uploaded recipient** — Sends successfully
7. **Saved contact recipient** — Sends successfully
8. **Invalid Sender ID** — Frontend shows specific error, not generic
9. **Insufficient wallet** — Frontend shows "Insufficient wallet balance"
10. **Provider failure** — Frontend shows provider error message, wallet refunded
11. **Backend 500** — Frontend shows actual error details, not generic fallback

---

## 10. Summary of Findings

| # | Defect | Severity | Proven? |
|---|--------|----------|---------|
| 1 | `extractErrorMessage()` cannot parse `{ code, details }` backend errors | **Critical** | Yes |
| 2 | All-fail path shows generic error instead of per-recipient details | **High** | Yes |
| 3 | Personalized messaging reservation leak on exception | **High** | Yes |
| 4 | Sender ID validation mismatch between model and Nalo service | **Medium** | Yes |
| 5 | Default messaging ignores `removeDuplicates` parameter | **Low** | Yes |

**Exact failure point:** The failure occurs at the **frontend error boundary** (`src/utils/api.js:190` and `src/pages/dashboard/send-sms.html:4358`), where `extractErrorMessage()` converts the real backend error into `'An unexpected error occurred. Please try again.'`. The underlying backend exception **cannot be identified without backend logs**, but the most likely failure points are `SmsRecipientService.processRecipientsForCampaign()`, `WalletService.getAvailableBalance()`, or `NaloSmsService.sendSmsWithFinancialTracking()`.
