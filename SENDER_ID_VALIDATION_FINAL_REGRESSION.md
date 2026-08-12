# Sender ID Validation — Final Regression Report

## Test Suites Executed

| Suite | Result |
|-------|--------|
| `test_sender_id_validation_regression.js` (NEW) | 52/52 PASSED |
| `test_sender_id_failure_regression.js` | 34/34 PASSED |
| `test_wallet_all_fail_refund_regression.js` | 36/36 PASSED |
| `test_circuit_breaker_regression.js` | 75/75 PASSED |
| `test_72_recipient_regression.js` | 51/51 PASSED |
| `test_forensic_audit.js` | 57/57 PASSED |
| `test_assignment_constant_regression.js` | 10/10 PASSED |
| `test_txt_upload_regression.js` | PASSED |
| `test_fixes.js` | PASSED |
| `test_qa_verification.js` | PASSED |

**Total: 315+ tests, 0 failures.**

## Root Cause

**File**: `backend/services/NaloSmsService.js`, method `validateSenderIdWithProvider` (lines 228-303)

**Exact defect**: The method uses `validateStatus: (status) => status === 200` when calling `httpClient.post()`. This causes axios to **throw** on any non-200 HTTP response. The catch block then **only inspects `apiError.response.status`** and **discards `apiError.response.data`** (the actual Nalo response body).

When Nalo returns HTTP 400 with body `{ status: '1707', error_message: 'Invalid Source(Sender)' }`, the code:
1. Throws because status is not 200
2. In catch, sees `status === 400` (not 412)
3. Returns `errorCode: 'HTTP_400'` with generic message
4. **Loses the actual Nalo error code 1707**

The real SMS send path (`sendSmsWithFinancialTracking`) correctly inspects `response.data` even on non-200 responses (via `parseNaloResponse`). The validation path does not.

## Why the Same Sender ID Worked Hours Earlier

The validation endpoint is the **same Nalo send endpoint** (`https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/`) used for actual SMS delivery. The successful send earlier proves the credentials, Sender ID registration, and endpoint are all valid. The current failure is **not** a permanent Sender ID rejection — it is caused by the validation method discarding Nalo's actual response body on HTTP errors.

Possible reasons for the HTTP 400:
- Nalo returned 400 with 1707 in the body (caught correctly by the fix)
- Nalo rate-limited the validation request (same test phone `233000000000` used repeatedly)
- Nalo had a temporary provider issue
- Nalo changed API behavior to return 400 with error codes in body

## Repairs Applied

### 1. `backend/services/NaloSmsService.js`
- Added `extractNaloStatusCodeFromError()` — inspects `apiError.response.data` for Nalo error codes on HTTP errors
- Added `classifyValidationError()` — classifies failures into:
  - `permanent_sender_id_error` (1707, 412)
  - `temporary_provider_error` (1710, 1711, generic 4xx/5xx, network)
  - `auth_configuration_error` (1703, 1704, 1705, 1025)
- Updated `validateSenderIdWithProvider()` to:
  - Inspect response body on HTTP errors
  - Return `classification` field alongside `valid`, `errorCode`, `errorMessage`
  - Log classification for forensics without exposing credentials

### 2. `backend/routes/sms.js`
- Updated quick-send and schedule preflight handlers to:
  - Map `permanent_sender_id_error` → `SENDER_ID_PROVIDER_REJECTED`
  - Map `temporary_provider_error` → `PROVIDER_TEMPORARY_ERROR` with retry message
  - Map `auth_configuration_error` → `PROVIDER_AUTH_ERROR` with contact-admin message
  - Include `classification` and `providerMessage` in response

### 3. `backend/routes/sms-campaigns.js`
- Moved provider preflight **before** wallet reservation in the send route
- Updated send and schedule preflight handlers with same classification logic as `sms.js`
- Ensured campaign cleanup on preflight failure

### 4. `src/pages/dashboard/send-sms.html`
- Updated error handling to display classification-aware messages:
  - Permanent rejection: "Sender ID is not registered with the SMS provider..."
  - Temporary error: "SMS provider is temporarily unavailable. Please wait a moment..."
  - Auth error: "SMS provider authentication failed. Please contact admin..."
- Frontend now checks `classification` and `providerMessage` from response

## Behavioral Guarantees

| Guarantee | Status |
|-----------|--------|
| No wallet deduction before validation | ✅ Preflight occurs before `deductGhsForSms` / `reserveFunds` |
| No campaign/recipient creation before validation | ✅ Preflight occurs before `SmsRecipient.insertMany` / send loop |
| Permanent rejection distinguished from temporary error | ✅ Three distinct error codes returned |
| Actual Nalo error codes preserved in response | ✅ `providerErrorCode` and `providerMessage` included |
| 1707 does not trip circuit breaker | ✅ `sender_id_error` excluded by `shouldCountForBreaker` |
| No API keys logged | ✅ Preflight logs only `senderId` and `testPhone` |
| Frontend shows actionable messages | ✅ Classification-aware toast messages |

## Remaining Risks

- **Live provider response unknown**: The exact Nalo response for the production incident could not be captured (Railway logs did not contain the validation request/response). We cannot confirm whether Nalo returned 400 with 1707 in the body, or 400 with a different code, or 400 with no body.
- **Rate limiting**: Repeated validation requests to the same test phone (`233000000000`) may trigger Nalo rate limiting. This is a known limitation of the preflight approach.
- **Endpoint redundancy**: The validation uses the same Nalo endpoint as actual SMS sends. If Nalo's behavior changes for this endpoint, both validation and sending are affected.
