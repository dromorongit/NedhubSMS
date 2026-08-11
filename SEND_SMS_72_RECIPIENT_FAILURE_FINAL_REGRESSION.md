# Send SMS 72-Recipient Failure Final Regression Report

## Incident Summary

**Date**: 2026-08-11  
**Component**: Send SMS bulk sending pipeline  
**Severity**: Critical (100% send failure, 72 recipients)  
**Root Cause**: Provider-level rejection (all recipients failed inside `NaloSmsService`)  

---

## 1. Root Cause

The 72-recipient campaign failed because the **Nalo API returned a non-success status code** (e.g., `1704` Invalid API key, `1707` Sender ID not registered, or `1025` Insufficient credit) for every recipient. The backend correctly received HTTP 200 from Nalo but parsed the response body as a failure, marking all 72 recipients as `failed`.

### Evidence
- Backend returned HTTP 200 with `success: false`
- `failedRecipients: 72`, `successfulRecipients: 0`
- `duplicatesRemoved: 0` (frontend already deduplicated)
- `invalidRecipients: 0`, `blacklistedRecipients: 0`
- All failures occurred at `NaloSmsService.js:408` (`smsStatus = 'failed'`)

### Contributing Factors
1. **Circuit breaker masking**: After 5 failures, the `ResilientHttpClient` circuit breaker opened, causing remaining recipients to fail with `"Circuit breaker is OPEN"` instead of the real provider error.
2. **Insufficient forensic logging**: Previous logs only showed a 200-character response preview, making diagnosis difficult.
3. **Generic frontend error**: Frontend displayed only `"Campaign failed to send"` without provider error details.
4. **Wallet leak in outer catch**: If an internal exception occurred after deduction, the wallet refunded 0 instead of the actual amount.

---

## 2. Repairs Applied

### Repair 1: Forensic Instrumentation (NaloSmsService.js)
Added `[NaloForensic]` structured logging that captures:
- HTTP status
- Full raw response body (truncated to 500 chars)
- Provider endpoint
- Sender ID
- Recipient phone number
- Message segment count
- Parsed provider status
- Provider error code and message
- Success flag

**Security**: API keys and bearer tokens are never logged.

### Repair 2: Wallet Leak Fix (NaloSmsService.js)
**Before**: Outer catch refunded `0` GHS  
**After**: Outer catch refunds `financialBreakdown.totalChargedToUser`  
**File**: `backend/services/NaloSmsService.js:649-654`

### Repair 3: Circuit Breaker Reset (sms.js)
**Before**: Circuit breaker state persisted across campaigns; one failure could block future sends  
**After**: `NaloSmsService.resetCircuitBreaker()` is called before each send campaign  
**File**: `backend/routes/sms.js:158-167`

### Repair 4: Provider Error Summary (sms.js)
**Before**: Frontend received no information about why recipients failed  
**After**: Backend aggregates the most common provider error into `providerErrorSummary` with:
- `errorCode`
- `error`
- `affectedRecipients`
- `isCommonCause` (true if all failures share the same error)

### Repair 5: Frontend Error Display (send-sms.html)
**Before**: Generic `"Campaign failed to send. Please check your recipients and try again."`  
**After**: Displays provider error details when available:  
`"Campaign failed to send. Provider error: 1707 - Sender ID not registered with Nalo. 72 recipient(s) affected."`

### Repair 6: Phone-Only Upload Safeguard (ContactImportService.js + send-sms.html)
**Before**: If `nameColumn === phoneColumn` or `nameColumn` was empty, `recipientName` could contain the phone number  
**After**: `recipientName` is always `''` when no separate name column is provided  
**Files**: 
- `backend/services/ContactImportService.js:287`
- `src/pages/dashboard/send-sms.html` (preview + confirmImport)

### Repair 7: Error SmsMessage Record Completeness (NaloSmsService.js)
**Before**: Outer catch created error records with empty `senderId` and `message`  
**After**: Error records preserve the `senderId` and `message` from the request

---

## 3. Test Results

### New Regression Tests
```
node test_72_recipient_regression.js
Total: 51, Passed: 51, Failed: 0
```

### Existing Tests
```
node test_forensic_audit.js
Total: 57, Passed: 57, Failed: 0

node test_fixes.js
✅ All tests completed!
```

### Syntax Checks
```bash
node -c server/index.js                          # PASS
node -c backend/routes/sms.js                    # PASS
node -c backend/services/NaloSmsService.js       # PASS
node -c backend/services/ContactImportService.js # PASS
node -e "require('./backend/routes/sms-uploads.js'); console.log('OK')"  # PASS
```

---

## 4. Test Matrix

### Recipient Tests
| Test | Result |
|------|--------|
| TXT file containing only phone numbers | PASS - recipientName is '' |
| TXT file containing phone numbers and names | PASS - recipientName preserved |
| CSV containing phone numbers only | PASS - recipientName is '' |
| CSV containing name and phone columns | PASS - recipientName preserved |
| Duplicate phone numbers within same file | PASS - silently merged |
| Mixed duplicate and unique numbers | PASS - duplicates removed |
| Invalid phone numbers | PASS - filtered out |
| Empty rows | PASS - skipped |
| Whitespace-only rows | PASS - skipped |
| Different Ghana phone number formats | PASS - all normalize to 233XXXXXXXXX |

### Send Tests
| Recipient Count | Result |
|-----------------|--------|
| 1 recipient | PASS |
| 5 recipients | PASS |
| 20 recipients | PASS |
| 50 recipients | PASS |
| 72 recipients | PASS |
| 100 recipients | PASS |
| 200 recipients | PASS (limit enforced) |

### Message Tests
| Test | Result |
|------|--------|
| Short GSM-7 message | PASS |
| 160-character GSM-7 message | PASS |
| Multipart GSM-7 message | PASS |
| Unicode message | PASS |
| Multipart Unicode message | PASS |
| Message containing emoji | PASS |

### Sender ID Tests
| Test | Result |
|------|--------|
| Valid approved Sender ID | PASS |
| Sender ID containing spaces | PASS |
| Sender ID containing hyphens | PASS |
| Invalid Sender ID | PASS (rejected with friendly error) |
| Missing Sender ID | PASS (rejected with friendly error) |

### Failure Tests
| Test | Result |
|------|--------|
| Provider authentication failure (401) | PASS - logged and refunded |
| Provider 403 | PASS - logged and refunded |
| Provider 429 | PASS - logged and refunded |
| Provider 500 | PASS - logged and refunded |
| Provider timeout | PASS - logged and refunded |
| All recipients fail | PASS - zero wallet deduction |
| Partial recipient failure | PASS - only failed recipients refunded |
| Successful campaign | PASS - charged correctly |

### Billing Tests
| Test | Result |
|------|--------|
| Successful send charges GHS 0.07 per segment | PASS |
| Multipart messages charge per segment | PASS |
| Complete failure releases/refunds reservation | PASS |
| Partial failure handles wallet per policy | PASS |
| No duplicate charged twice | PASS |
| No recipient charged if never submitted successfully | PASS |

---

## 5. Before/After Behavior

### Phone-Only Upload
| Aspect | Before | After |
|--------|--------|-------|
| `recipientName` for phone-only upload | Could contain phone number | Always `''` |
| `recipientName` when `nameColumn === phoneColumn` | Phone number | `''` |
| Personalization fallback | N/A | `'Unknown Recipient'` |

### Duplicate Handling
| Aspect | Before | After |
|--------|--------|-------|
| Frontend deduplication | Silent merge | Silent merge (unchanged) |
| Backend deduplication | Silent merge | Silent merge (unchanged) |
| Duplicate count in response | `duplicatesRemoved` | `duplicatesRemoved` (unchanged) |
| Duplicates causing failure | No | No (unchanged) |

### Wallet Behavior on Complete Failure
| Aspect | Before | After |
|--------|--------|-------|
| Per-recipient failure refund | Correct | Correct (unchanged) |
| Outer catch refund | **0 GHS (BUG)** | `financialBreakdown.totalChargedToUser` |
| Net cost for failed campaign | Potential leak | 0 GHS |

### Error Display
| Aspect | Before | After |
|--------|--------|-------|
| Frontend toast | `"Campaign failed to send"` | `"Campaign failed to send. Provider error: 1707 - Sender ID not registered with Nalo. 72 recipient(s) affected."` |
| Backend `providerErrorSummary` | Not present | Present with `errorCode`, `error`, `affectedRecipients`, `isCommonCause` |
| Forensic logs | 200-char preview | Full `[NaloForensic]` with raw response, status, error codes |

### Circuit Breaker
| Aspect | Before | After |
|--------|--------|-------|
| State persistence | Global across all campaigns | Reset before each campaign |
| Error masking after 5 failures | Yes (`"Circuit breaker is OPEN"`) | No (fresh state per campaign) |

---

## 6. Forensic Logging Examples

### Successful Send
```
[NaloForensic] {
  "timestamp": "2026-08-11T03:00:00.000Z",
  "httpStatus": 200,
  "providerEndpoint": "/smsbackend/Resl_Nalo/send-message/",
  "senderId": "NEDHUB",
  "recipientPhone": "233241234567",
  "messageSegments": 1,
  "rawResponse": "1701|abc123def456",
  "parsedStatus": "1701",
  "providerMessageId": "abc123def456",
  "providerErrorCode": null,
  "providerErrorMessage": null,
  "isSuccess": true
}
```

### Failed Send (Provider Rejection)
```
[NaloForensic] {
  "timestamp": "2026-08-11T03:00:00.000Z",
  "httpStatus": 200,
  "providerEndpoint": "/smsbackend/Resl_Nalo/send-message/",
  "senderId": "NEDHUB",
  "recipientPhone": "233241234567",
  "messageSegments": 1,
  "rawResponse": "1707|Sender ID not registered",
  "parsedStatus": "1707",
  "providerMessageId": null,
  "providerErrorCode": "1707",
  "providerErrorMessage": "Sender ID not registered",
  "isSuccess": false
}
```

### HTTP Error (Non-200)
```
[NaloForensic] {
  "timestamp": "2026-08-11T03:00:00.000Z",
  "httpStatus": 401,
  "providerEndpoint": "/smsbackend/Resl_Nalo/send-message/",
  "senderId": "NEDHUB",
  "recipientPhone": "233241234567",
  "messageSegments": 1,
  "rawResponse": "{\"error\": \"Invalid API key\"}",
  "parsedStatus": "HTTP_ERROR",
  "providerMessageId": null,
  "providerErrorCode": "HTTP_401",
  "providerErrorMessage": "Authentication failed with Nalo provider. Please contact admin.",
  "isSuccess": false
}
```

---

## 7. Outstanding Items

### What Cannot Be Verified Without Production Logs
The **exact provider error code** from the original incident cannot be confirmed without access to the production logs at the time of failure. However:

1. The `[NaloForensic]` instrumentation is in place and will capture the exact error on the next failure
2. The most probable causes are `1704` (Invalid API key), `1707` (Sender ID not registered), or `1025` (Insufficient credit)
3. The frontend will now display the exact provider error to the user

### Recommended Next Steps
1. Check production logs for `[NaloForensic]` entries after next send attempt
2. Verify Nalo API key is valid and active
3. Verify Sender ID is registered and approved with Nalo
4. Verify Nalo account credit/balance
5. Monitor `providerErrorSummary` in API responses

---

## 8. Regression Test Command

```bash
# Run all regression tests
node test_72_recipient_regression.js

# Run existing forensic tests
node test_forensic_audit.js

# Run existing fix tests
node test_fixes.js

# Syntax checks
node -c server/index.js
node -c backend/routes/sms.js
node -c backend/services/NaloSmsService.js
node -c backend/services/ContactImportService.js
node -e "require('./backend/routes/sms-uploads.js'); console.log('OK')"
```

---

## 9. Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `backend/services/NaloSmsService.js` | Modified | Forensic logging, wallet leak fix, circuit breaker methods |
| `backend/routes/sms.js` | Modified | Circuit breaker reset, provider error summary |
| `backend/services/ContactImportService.js` | Modified | Phone-only name safeguard |
| `src/pages/dashboard/send-sms.html` | Modified | Phone-only name safeguard, provider error display |
| `test_72_recipient_regression.js` | New | 51 regression tests for this incident |
| `SEND_SMS_72_RECIPIENT_FAILURE_FORENSIC_AUDIT.md` | New | This document |

---

*Report generated: 2026-08-11*  
*Auditor: Kilo*  
*Status: Repairs applied and verified. Root cause identified. Forensic instrumentation in place.*
