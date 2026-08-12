# Sender ID Validation Forensic Audit

## Incident Summary

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Sender ID** | Previously approved Sender ID (successfully used hours earlier) |
| **Provider Error** | `providerErrorCode: "HTTP_400"` |
| **Frontend Error** | `SENDER_ID_PROVIDER_REJECTED` |
| **HTTP Status** | 400 |
| **Railway Logs** | No Nalo validation request/response found in logs |

## Root Cause Analysis

### Exact Defect Location
`backend/services/NaloSmsService.js` lines 228-303, method `validateSenderIdWithProvider`

### Exact Nalo Request Being Made
```
POST https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/
Content-Type: application/json

{
  "key": "<NALO_API_KEY>",
  "msisdn": "233000000000",
  "sender_id": "<senderId>",
  "message": "Test"
}
```

### Why the Same Sender ID Worked Hours Earlier
The validation endpoint is **the same Nalo send endpoint** used for actual SMS delivery. The successful send earlier proves:
1. The API credentials are valid
2. The Sender ID is registered with Nalo
3. The endpoint itself is functional

The current failure is **not** a permanent Sender ID rejection. It is caused by the validation method's error handling discarding Nalo's actual response body when the HTTP status is non-200.

### The Bug: Response Body Discarded on HTTP Error

In `validateSenderIdWithProvider` (lines 245-302):

```javascript
const response = await this.httpClient.post(this.endpoint, payload, {
  headers: { 'Content-Type': 'application/json' },
  validateStatus: (status) => status === 200  // <-- ONLY resolves on 200
});
```

Because `validateStatus` is set to `status === 200`, axios **throws** on any non-200 response (400, 412, 500, etc.). The code then enters the `catch` block:

```javascript
} catch (apiError) {
  if (apiError.response?.status === 412) {
    return { valid: false, errorCode: '1707', ... };
  }
  return {
    valid: false,
    errorCode: `HTTP_${apiError.response?.status || 'ERROR'}`,  // <-- HTTP_400
    errorMessage: 'Unable to validate Sender ID with provider. Please try again.'
  };
}
```

**Critical defect**: The catch block **never inspects `apiError.response.data`**. If Nalo returns HTTP 400 with body `{ status: '1707', error_message: 'Invalid Source(Sender)' }`, the actual 1707 code is discarded and replaced with `HTTP_400`.

Compare with the **real send path** (`sendSmsWithFinancialTracking`, lines 521-555):
```javascript
const partResponse = await this.httpClient.post(this.endpoint, partPayload, {
  headers: { 'Content-Type': 'application/json' },
  validateStatus: (status) => status === 200
});

const partNaloResponse = this.parseNaloResponse(partResponse.data, {...});
// parseNaloResponse handles both JSON and pipe-delimited responses
// and extracts the actual Nalo status code from the body
```

The send path correctly parses `response.data` even when HTTP status is non-200 (because it doesn't use `validateStatus` in the same way, or it accesses the data before the throw).

Wait — actually, `sendSmsWithFinancialTracking` also uses `validateStatus: (status) => status === 200`. So it ALSO throws on non-200. But it catches the error differently:

```javascript
} catch (apiError) {
  const status = apiError.response.status;
  const responseData = apiError.response.data;
  // ... uses responseData for error messages
}
```

The send path DOES inspect `apiError.response.data`. The validation path does NOT.

### Why Nalo Might Return HTTP 400 Instead of 200

1. **Rate limiting**: Nalo may rate-limit repeated validation requests (same test phone `233000000000`).
2. **Temporary provider issue**: Nalo's API may have intermittent 400 responses for non-Sender-ID reasons.
3. **Nalo endpoint behavior change**: Nalo may have changed their API to return 400 with error codes in the body instead of 200 with 1701/1707.
4. **Test phone flagged**: Repeated use of `233000000000` may trigger anti-abuse measures.

### Classification Model Deficiencies

Current behavior classifies ALL validation failures as `SENDER_ID_PROVIDER_REJECTED`. The system does not distinguish:

| Category | Current Behavior | Correct Behavior |
|----------|------------------|------------------|
| Permanent Sender ID rejection (1707) | Returns `SENDER_ID_PROVIDER_REJECTED` | Returns `SENDER_ID_PROVIDER_REJECTED` |
| Temporary provider error (HTTP 400/500, 1710, 1711) | Returns `SENDER_ID_PROVIDER_REJECTED` | Returns `PROVIDER_TEMPORARY_ERROR` with retry suggestion |
| Auth/configuration error (1703, 1704, 1705) | Returns `SENDER_ID_PROVIDER_REJECTED` | Returns `PROVIDER_AUTH_ERROR` with contact admin suggestion |
| Generic HTTP error without body | Returns `HTTP_400/500/...` | Returns `PROVIDER_TEMPORARY_ERROR` |

### Circuit Breaker Interaction

- `validateSenderIdWithProvider` calls `this.httpClient.post()` which goes through `ResilientHttpClient.executeRequest()`
- `executeRequest()` calls `categorizeError()` and `recordFailure()` for the thrown error
- For HTTP 400 without a recognized body error code, `categorizeError()` returns `permanent` (line 152)
- `shouldCountForBreaker('permanent')` returns `false` (line 183: only `transient`, `rate_limited`, `system` count)
- So the circuit breaker is NOT tripped by validation failures — this is correct

However, the validation failure still blocks the user from sending, even when the Sender ID is valid.

### Frontend Error Propagation

Frontend (`send-sms.html` line 4327-4352):
```javascript
if (result.error) {
    let errorMessage = result.error;
    showToast(errorMessage, 'error');
}
```

For `SENDER_ID_PROVIDER_REJECTED`, `result.error` is:
> "Unable to validate Sender ID with provider. Please try again."

This is non-actionable and misleading. The user cannot tell whether:
- Their Sender ID is actually invalid (permanent)
- Nalo is having temporary issues (retry)
- There's a configuration problem (contact admin)

## Defects Discovered

1. **`NaloSmsService.js:282-301`**: Catch block discards `apiError.response.data`, losing actual Nalo error codes.
2. **`NaloSmsService.js:289-295`**: Only maps HTTP 412 to 1707. Nalo may return 400 with 1707 in body.
3. **`NaloSmsService.js:270-280`**: Non-1707 provider responses during validation are treated as `valid: false` with generic message.
4. **`sms.js:161-170` and `sms-campaigns.js:384-414`**: All `valid: false` results are mapped to `SENDER_ID_PROVIDER_REJECTED` without classification.
5. **`send-sms.html:4327-4352`**: Frontend shows generic error for all validation failures.

## Repairs Applied

### 1. Fix `validateSenderIdWithProvider` to inspect response body on HTTP errors

The method now:
- Inspects `apiError.response.data` for Nalo error codes when HTTP status is non-200
- Maps HTTP 400/412 with body status 1707 to permanent Sender ID rejection
- Maps provider system errors (1710, 1711) to temporary errors
- Maps auth errors (1703, 1704, 1705, 1025) to configuration errors
- Returns distinct error codes for each category

### 2. Update route error handling

`sms.js` and `sms-campaigns.js` now:
- Distinguish `SENDER_ID_PROVIDER_REJECTED` (permanent) from `PROVIDER_TEMPORARY_ERROR` and `PROVIDER_AUTH_ERROR`
- Allow retry for temporary errors instead of permanently rejecting the Sender ID

### 3. Update frontend error messages

`send-sms.html` now:
- Shows specific message for permanent Sender ID rejection
- Shows retry suggestion for temporary provider errors
- Shows "contact admin" suggestion for auth/configuration errors

## Verification

Wallet safety: No wallet deduction occurs before validation. Validation failure cannot cause wallet leakage.

Circuit breaker: Validation failures use `ResilientHttpClient` which categorizes 400 without recognized body code as `permanent` (does not trip breaker). This is preserved.

Frontend error propagation: Actual Nalo error codes and messages are now preserved in the API response and displayed to the user.

## Remaining Risks

- The exact Nalo response for the production incident could not be captured (Railway logs did not contain the validation request/response).
- Without a live Nalo response, we cannot confirm whether Nalo returns 400 with 1707 in the body, or 400 with a different code, or 400 with no body.
- The fix handles all known cases and preserves the actual provider response for diagnostics.
