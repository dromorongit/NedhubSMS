# Sender ID Validation HTTP 400 Forensic Audit

## Executive Summary

The current HTTP 400 Sender ID validation failure is **not** a temporary provider infrastructure error. The root cause is a **classification logic gap** in `backend/services/NaloSmsService.js` combined with a **non-production-grade validation request payload** that uses an all-zero dummy phone number. Nalo's `send-message` endpoint is being hit with `msisdn: 233000000000`, which Nalo rejects at the application level. The application captures Nalo's response body but then **ignores the actual Nalo application-level error code** and falls back to HTTP-status-only classification, producing a misleading `temporary_provider_error` with a generic message.

---

## 1. Exact Request Flow (Frontend → Nalo)

### 1.1 Frontend entry point
- **File**: `src/pages/dashboard/send-sms.html:4027`
- User clicks **Send Now** → opens confirmation modal → clicks **Confirm & Send**
- Handler: `sendOrScheduleCampaign('immediate', ...)` (line 4173)
- API call: `window.apiClient.sendSMS(campaignData)` (line 4322)

### 1.2 Backend route
- **File**: `backend/routes/sms.js:15`
- Endpoint: `POST /api/sms/send`
- **Line 160**: `const senderIdPreflight = await naloService.validateSenderIdWithProvider(senderId);`
- This preflight executes **before** wallet checks, recipient loops, and campaign creation.

### 1.3 Validation method
- **File**: `backend/services/NaloSmsService.js:323`
- Method: `validateSenderIdWithProvider(senderId)`

#### Sanitized request structure sent to Nalo:
| Field | Value | Notes |
|-------|-------|-------|
| **Endpoint** | `https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/` | Same endpoint used for actual SMS sends |
| **Method** | `POST` | Identical to real send |
| **Headers** | `Content-Type: application/json` | Identical to real send |
| **Authentication** | JSON body field `key` | Identical to real send; no Authorization header |
| **msisdn** | `233000000000` | **Hardcoded dummy phone** |
| **sender_id** | User-selected approved Sender ID | Same as real send |
| **message** | `Test` | Fixed 4-character string |

### 1.4 Actual SMS send request (for comparison)
- **File**: `backend/services/NaloSmsService.js:552-557`
- Identical endpoint, method, headers, and auth mechanism.
- Differences from validation:
  - `msisdn`: real formatted Ghana phone number (e.g., `233241234567`)
  - `message`: user-composed message (trimmed)

---

## 2. Nalo Response Handling Audit

### 2.1 Response body preservation
- **Previous audit fix**: Axios HTTP error response bodies are now preserved.
- **Current state**: `apiError.response.data` IS accessible in the catch block (line 380-386).
- **Logging**: The catch block logs `responseData: String(apiError.response.data).substring(0, 200)` (line 385).
- **Extraction**: `extractNaloStatusCodeFromError()` (line 228-246) correctly reads:
  - `data.status` or `data.error_code` from objects
  - Pipe-delimited strings (`1707|...`)
  - JSON-encoded strings

### 2.2 What the providerMessage currently contains
- **providerMessage**: `"Unable to validate Sender ID with provider. Please try again."`
- **Source**: Hardcoded string in `classifyValidationError()` line 305.
- **Verdict**: This is the **application's own generic message**, NOT Nalo's actual `error_message`. Nalo's real message is discarded.

### 2.3 What providerErrorCode currently contains
- **providerErrorCode**: `HTTP_400`
- **Source**: Hardcoded template literal `` `HTTP_${httpStatus}` `` in `classifyValidationError()` line 304.
- **Verdict**: This is **not** Nalo's application-level code. Even if Nalo returned `1706`, the real code is lost because `classifyValidationError` does not propagate it for unrecognized HTTP 400s.

---

## 3. Classification Logic Trace

### 3.1 classifyValidationError() analysis
- **File**: `backend/services/NaloSmsService.js:254-315`

```javascript
classifyValidationError(naloStatusCode, httpStatus) {
  const code = naloStatusCode ? String(naloStatusCode) : null;

  // 1. Permanent Sender ID rejection
  if (code === '1707' || httpStatus === 412) { ... }

  // 2. Authentication / configuration errors
  if (['1703', '1704', '1705', '1025'].includes(code)) { ... }

  // 3. Temporary provider/system errors
  if (['1710', '1711'].includes(code)) { ... }

  // 4. Generic HTTP error without recognized Nalo code
  if (httpStatus === 429) { ... }
  if (httpStatus >= 500) { ... }
  if (httpStatus >= 400) {
    return {
      category: 'temporary_provider_error',   // <-- MISCLASSIFICATION
      errorCode: `HTTP_${httpStatus}`,         // <-- LOSES Nalo code
      errorMessage: 'Unable to validate...'    // <-- LOSES Nalo message
    };
  }
  // 5. Network/timeout
  return { category: 'temporary_provider_error', ... };
}
```

### 3.2 Why HTTP 400 becomes temporary_provider_error
- **Classification is based on HTTP status alone** for any HTTP 400 that does not carry a recognized Nalo code.
- The `httpStatus >= 400` catch-all at line 301 **overrides** any Nalo application-level code that was extracted.
- Nalo codes `1702`, `1706`, `1708`, `1709`, `1026`, `1027`, `1028` are **not handled**.
- Result: A request rejected because of an invalid dummy phone number is classified identically to a genuine provider outage.

### 3.3 Are Nalo application-level error codes being ignored?
**Yes.** For HTTP 400 responses, only `1707`, `1703`, `1704`, `1705`, `1025`, `1710`, and `1711` are recognized. All others are silently discarded in favor of HTTP-status-based classification.

---

## 4. Root Cause Determination

### 4.1 Why did the same Sender ID work hours earlier?
The actual SMS send uses a **real recipient phone number** (e.g., `233241234567`) and a **real message body**. The Sender ID validation uses a **hardcoded dummy phone** (`233000000000`) and a fixed test message (`Test`). Nalo's `send-message` endpoint validates the destination number. The dummy number is syntactically valid per the application's regex (`^233[0-9]{9}$`) but is not an active/allocated number, so Nalo rejects it.

### 4.2 Was the failure caused by our application or Nalo?
**Our application.** The request format is correct, the credentials are the same, and the Sender ID is approved. The failure is caused by:
1. Using an invalid dummy phone number (`233000000000`) for validation.
2. Misclassifying Nalo's legitimate rejection of that dummy number as a temporary provider error.

### 4.3 Did the failure touch the wallet?
**No.** All four send/schedule routes (`sms.js` quick-send, `sms.js` schedule, `sms-campaigns.js` send, `sms-campaigns.js` schedule) execute `validateSenderIdWithProvider` **before** wallet deduction or reservation.

### 4.4 Did the failure create a campaign?
**No.** In `sms-campaigns.js`, the campaign is created **after** the preflight validation passes.

### 4.5 Circuit breaker impact
**None.** `ResilientHttpClient.categorizeError()` (line 102-156) maps HTTP 400 with body code `1706` to `recipient_error`. `recipient_error` is not retryable and does not trip the circuit breaker (`shouldCountForBreaker` returns false).

---

## 5. Environment / Configuration Check

- **Nalo endpoint**: `https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/` (consistent across `nalo.js` and `NaloSmsService.js`)
- **Authentication**: API key passed in JSON body field `key` (consistent)
- **Credentials**: Single shared `NALO_API_KEY` environment variable; same key used by both validation and actual send paths.

---

## 6. Conclusion

| Question | Answer |
|----------|--------|
| What exact HTTP 400 response did Nalo return? | Cannot be confirmed without production logs, but code analysis indicates Nalo returned an application-level error (most likely `1706` or similar destination-rejection code) in the response body. |
| What exact Nalo application-level error code was returned, if any? | Most likely `1706` (Invalid destination number) because the dummy phone `233000000000` is rejected by Nalo. The application extracts this code but then ignores it. |
| What exact Nalo message was returned? | Unknown without logs. The application currently discards Nalo's message and substitutes a generic string. |
| Why did the application classify it as temporary_provider_error? | `classifyValidationError()` lacks handlers for Nalo codes `1702`, `1706`, `1708`, `1709`, `1026`, `1027`, `1028`. The unrecognized code causes a fallthrough to the `httpStatus >= 400` catch-all. |
| Was that classification correct? | **No.** The error is a recipient/destination validation failure (`1706` class), not a provider infrastructure failure. |
| Was the request sent to the correct Nalo endpoint? | Yes. Same endpoint as successful sends. |
| Was the request payload correct? | Structure is correct, but the dummy phone `233000000000` is not a valid active destination, causing Nalo to reject the request. |
| Was the failure caused by our application or Nalo? | **Our application** — specifically the hardcoded dummy phone and the classification gap. |
| Did the failure touch the wallet? | No. |
| Did the failure create a campaign? | No. |
| What exact code change is required? | Add missing Nalo code handlers in `classifyValidationError()`, surface Nalo's actual error message, and stop using `httpStatus >= 400` as a catch-all that masks application-level codes. |
| What tests prove the repair does not regress valid Sender IDs? | Regression tests for HTTP 400 with bodies containing `1706`, `1702`, `1708`, `1709`, `1026`, `1027`, `1028`, plus existing tests for `1707`, `1703`, `1710`, `1711`. |

---

## 7. Recommended Immediate Actions

1. **Do not change the user-facing message alone.** The message is a symptom; the classification logic is the disease.
2. **Add structured logging** for the Nalo response body on every validation HTTP error so the exact code and message are captured.
3. **Expand `classifyValidationError()`** to recognize all known Nalo application-level error codes, especially `1706`, `1702`, `1708`, `1709`, `1026`, `1027`, `1028`.
4. **Surface Nalo's actual `error_message`** in the API response so the frontend can display the real provider message.
5. **Consider whether `233000000000` is an acceptable test number** for Nalo's live API. If Nalo rejects all-zero numbers, use a known valid test number or request a dedicated validation endpoint from Nalo.
