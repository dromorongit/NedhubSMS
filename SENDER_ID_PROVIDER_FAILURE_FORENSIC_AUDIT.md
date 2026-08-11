# Sender ID Provider Failure Forensic Audit

## Incident Summary

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Sender ID** | `H.ELEVATION` |
| **Provider Error** | HTTP 412 / code `1707` / message "Invalid Source(Sender)" |
| **Recipients** | 73 |
| **Success** | 0 |
| **Segments** | 4 |
| **Wallet Charged** | GHS 0.28 |
| **Balance After** | GHS 49.72 |
| **Root Cause** | Invalid Sender ID accepted by local validation but rejected by Nalo provider during send |

## Root Cause Analysis

1. **Local validation gap**: The local `SenderId` model only checked `status: 'approved'` in MongoDB. It did not verify current provider registration status.
2. **No preflight check**: The Send SMS routes (`sms.js`, `sms-campaigns.js`) sent directly to the provider without validating the Sender ID first.
3. **Wallet deducted before provider rejection**: Wallet was debited per-recipient before the provider rejected the Sender ID, resulting in a non-zero charge for a completely failed campaign.
4. **Generic frontend error**: The frontend displayed "Campaign failed to send" without surfacing the actionable provider error (1707 / Invalid Source).

## Fixes Applied

### Backend

| File | Change |
|------|--------|
| `backend/services/NaloSmsService.js` | Added `validateSenderIdWithProvider(senderId)` method. Sends a test SMS to dummy phone `233000000000` to verify provider registration without deducting wallet or delivering real SMS. |
| `backend/routes/sms.js` | Added fail-fast provider preflight in quick-send and schedule routes **before** wallet deduction and recipient loop. Returns `SENDER_ID_PROVIDER_REJECTED` (HTTP 400) with actionable error. |
| `backend/routes/sms-campaigns.js` | Added fail-fast provider preflight in personalized send and schedule routes **before** campaign send. On failure, cleans up recipients and sets campaign status to `failed`. |
| `backend/utils/ResilientHttpClient.js` | Verified 1707 is classified as `sender_id_error` and excluded from circuit breaker (`shouldCountForBreaker`). No change required. |

### Frontend

| File | Change |
|------|--------|
| `src/pages/dashboard/send-sms.html` | Already displays `result.error` toast and `providerErrorSummary` for common-cause failures. No change required. |

### Behavioral Guarantees

- **No DB save for uploaded contacts**: Uploaded recipients are processed client-side/local only. No `Contact.create/insertMany/save/update/bulkWrite` during Send SMS upload.
- **No Contacts comparison**: Uploaded contacts are not compared against the Contacts database.
- **No "already exists in contacts" messaging**: Send SMS upload does not display contact-existence messaging.
- **Preserved constraints**: MAX_SMS_RECIPIENTS = 200, deduplication, phone-only TXT uploads, GSM-7/Unicode segmentation, 10-segment max, circuit breaker protection, wallet atomicity, partial-success handling, provider error propagation.
- **No pricing changes**: SMS price remains GHS 0.07 per segment.

## Verification

All regression tests passed:

- `test_sender_id_failure_regression.js` — 34/34 passed
- `test_wallet_all_fail_refund_regression.js` — 36/36 passed
- `test_circuit_breaker_regression.js` — passed
- `test_72_recipient_regression.js` — passed
- `test_forensic_audit.js` — passed
- `test_assignment_constant_regression.js` — passed
- `test_txt_upload_regression.js` — passed
- `test_fixes.js` — passed
- `test_qa_verification.js` — passed

## Completion Criteria

| Criterion | Status |
|-----------|--------|
| Provider preflight blocks invalid Sender ID before send | ✅ |
| 1707 does not trip circuit breaker | ✅ |
| Frontend shows actionable Sender ID error | ✅ |
| All-fail campaign refunds wallet to exact GHS 0.00 net | ✅ |
| No uploaded contacts saved to MongoDB | ✅ |
| No Contacts DB comparison during Send SMS upload | ✅ |
| No "already exists in contacts" messaging | ✅ |
| All regression tests pass | ✅ |
