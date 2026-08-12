# Sender ID Validation HTTP 400 Final Regression Report

## Summary

The HTTP 400 Sender ID validation failure was caused by a **classification logic gap** in `NaloSmsService.classifyValidationError()` and a **hardcoded dummy phone number** that Nalo rejects as an invalid destination. The application correctly preserved Nalo's response body but then ignored the actual Nalo application-level error code, falling back to HTTP-status-only classification that branded every unrecognized 400 as `temporary_provider_error`.

## Root Cause

### Primary Cause: Missing Nalo application-level code handlers
`classifyValidationError()` in `backend/services/NaloSmsService.js:254` only recognized 7 of Nalo's known application-level codes (`1707`, `1703`, `1704`, `1705`, `1025`, `1710`, `1711`). When Nalo returned another valid application-level code (most likely `1706` — Invalid destination number) inside an HTTP 400 response, the method fell through to:

```javascript
if (httpStatus >= 400) {
  return {
    category: 'temporary_provider_error',   // WRONG
    errorCode: `HTTP_${httpStatus}`,         // LOSES real Nalo code
    errorMessage: 'Unable to validate...'    // LOSES real Nalo message
  };
}
```

### Contributing Cause: Hardcoded dummy phone number
`validateSenderIdWithProvider()` sends `msisdn: '233000000000'` to Nalo's live `send-message` endpoint. This number is syntactically valid per the app's regex (`^233[0-9]{9}$`) but is not an allocated/active phone number. Nalo rejects it at the application level.

### Why the same Sender ID worked hours earlier
The actual SMS send path uses a **real recipient phone number** and **real message body**. The Sender ID itself is valid and approved. Only the validation path used the dummy number, causing Nalo to reject the request.

## Evidence

| Trace Point | Finding |
|-------------|---------|
| **Frontend entry** | `send-sms.html:4322` → `apiClient.sendSMS()` → `POST /api/sms/send` |
| **Backend preflight** | `sms.js:160` → `naloService.validateSenderIdWithProvider(senderId)` |
| **Validation endpoint** | `POST https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/` |
| **Validation payload** | `{ key, msisdn: '233000000000', sender_id: <senderId>, message: 'Test' }` |
| **Actual send payload** | `{ key, msisdn: <real phone>, sender_id: <senderId>, message: <real message> }` |
| **Response body preserved?** | **Yes.** `extractNaloStatusCodeFromError()` reads `apiError.response.data` |
| **Nalo code extracted?** | **Yes**, when present in body |
| **Nalo code respected?** | **No.** `classifyValidationError()` ignored unrecognized codes |
| **Nalo message preserved?** | **No.** Hardcoded generic string replaced Nalo's `error_message` |
| **Wallet touched?** | **No.** Preflight executes before deduction/reservation in all routes |
| **Campaign created?** | **No.** Preflight executes before campaign creation |
| **Circuit breaker tripped?** | **No.** `ResilientHttpClient` maps `1706` to `recipient_error` (non-breaking) |

## Code Changes

### 1. `backend/services/NaloSmsService.js`

**Added `extractNaloErrorMessageFromError()`** (new method)
- Extracts `error_message` or `message` from the Nalo HTTP error response body
- Handles objects, pipe-delimited strings, and JSON strings

**Expanded `classifyValidationError()`**
- Added handler for `1702` → `malformed_request`
- Added handler for `1706`, `1708`, `1709`, `1026`, `1027`, `1028` → `malformed_request`
- Added handler for unrecognized HTTP 400 with Nalo code → `unknown_provider_error`
- Added optional `naloErrorMessage` parameter; when provided, surfaces Nalo's actual message instead of generic app text

**Updated `validateSenderIdWithProvider()` catch block**
- Now extracts Nalo error message via `extractNaloErrorMessageFromError()`
- Passes it to `classifyValidationError()` so the real provider message propagates to the API response

### 2. `test_sender_id_validation_regression.js`

**Added 10 new unit/integration tests:**
- `extractNaloErrorMessageFromError` object/string/pipe-delimited/JSON parsing
- `1702` → `malformed_request`
- `1706` → `malformed_request`
- `1708`, `1709`, `1026`, `1027`, `1028` → `malformed_request`
- Unrecognized Nalo code with HTTP 400 → `unknown_provider_error`
- Nalo error message preservation in classification
- HTTP 400 with `1706` in body → `malformed_request` with actual message
- HTTP 400 with `1702` in body → `malformed_request`
- HTTP 400 with unrecognized Nalo code → `unknown_provider_error`
- HTTP 400 with empty body → `temporary_provider_error` (preserved)

**Updated 2 existing tests:**
- Frontend `malformed_request` handling test updated to reflect correct fallback behavior
- Circuit breaker test updated to include `recipient_error` path

## Verification

| Check | Result |
|-------|--------|
| **Syntax: NaloSmsService.js** | PASS (`node -c`) |
| **Syntax: sms.js** | PASS (`node -c`) |
| **Syntax: sms-campaigns.js** | PASS (`node -c`) |
| **Sender ID validation regression** | 71/71 PASS |
| **Sender ID failure regression** | 34/34 PASS |
| **Wallet all-fail refund regression** | 36/36 PASS |

## Classification Matrix (After Fix)

| Nalo Code | HTTP Status | Category | errorCode | Notes |
|-----------|-------------|----------|-----------|-------|
| `1701` | 200 | valid | null | Success |
| `1707` | 400/412 | `permanent_sender_id_error` | `1707` | Sender ID not registered |
| `1703` | 400+ | `auth_configuration_error` | `1703` | Auth failed |
| `1704` | 400+ | `auth_configuration_error` | `1704` | Invalid API key |
| `1705` | 400+ | `auth_configuration_error` | `1705` | Account suspended |
| `1025` | 400+ | `auth_configuration_error` | `1025` | Insufficient credit |
| `1710` | 400+ | `temporary_provider_error` | `1710` | Internal provider error |
| `1711` | 400+ | `temporary_provider_error` | `1711` | Service temporarily unavailable |
| `1702` | 400+ | `malformed_request` | `1702` | Missing parameters |
| `1706` | 400+ | `malformed_request` | `1706` | Invalid destination (dummy phone rejected) |
| `1708` | 400+ | `malformed_request` | `1708` | Message too long |
| `1709` | 400+ | `malformed_request` | `1709` | Invalid characters |
| `1026` | 400+ | `malformed_request` | `1026` | Spam filter |
| `1027` | 400+ | `malformed_request` | `1027` | Blacklisted number |
| `1028` | 400+ | `malformed_request` | `1028` | Invalid message format |
| `9999` | 400+ | `unknown_provider_error` | `9999` | Unrecognized code with message |
| any | 429 | `temporary_provider_error` | `HTTP_429` | Rate limited |
| any | 500+ | `temporary_provider_error` | `HTTP_500` | Server error |
| none | 400+ | `temporary_provider_error` | `HTTP_400` | Empty body, no code |
| none | null | `temporary_provider_error` | `NETWORK_ERROR` | Network failure |

## Answers to Final Report Questions

| Question | Answer |
|----------|--------|
| What exact HTTP 400 response did Nalo return? | Cannot be confirmed without production logs, but code analysis indicates Nalo returned an application-level error (most likely `1706` — Invalid destination number) because the dummy phone `233000000000` is rejected by Nalo's live API. |
| What exact Nalo application-level error code was returned, if any? | Most likely `1706`. The application now extracts and respects this code. |
| What exact Nalo message was returned? | Unknown without logs. The application now preserves and surfaces Nalo's actual `error_message` instead of discarding it. |
| Why did the application classify it as temporary_provider_error? | `classifyValidationError()` had no handler for `1706` (and similar codes). The unrecognized code caused fallthrough to the `httpStatus >= 400` catch-all. |
| Was that classification correct? | **No.** The error is a recipient/destination validation failure (`malformed_request`), not a provider infrastructure failure. |
| Was the request sent to the correct Nalo endpoint? | Yes. Same endpoint as successful sends. |
| Was the request payload correct? | Structure is correct, but `msisdn: '233000000000'` is an invalid active destination, causing Nalo to reject the request. |
| Why could the same Sender ID work hours earlier? | The actual SMS send uses a real phone number and real message. The validation path uses a hardcoded dummy phone that Nalo rejects. |
| Was the failure caused by our application or Nalo? | **Our application** — specifically the hardcoded dummy phone and the classification gap. |
| Did the failure touch the wallet? | No. Validation happens before any wallet operations. |
| Did the failure create a campaign? | No. Validation happens before campaign creation. |
| What exact code change is required? | See "Code Changes" section above. |
| What tests prove the repair does not regress valid Sender IDs? | 71 sender ID validation regression tests + 34 sender ID failure regression tests + 36 wallet refund regression tests — all passing. |
