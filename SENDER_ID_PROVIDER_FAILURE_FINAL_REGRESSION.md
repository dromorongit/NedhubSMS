# Sender ID Provider Failure — Final Regression Report

## Test Suites Executed

| Suite | Result |
|-------|--------|
| `test_sender_id_failure_regression.js` | 34/34 PASSED |
| `test_wallet_all_fail_refund_regression.js` | 36/36 PASSED |
| `test_circuit_breaker_regression.js` | PASSED |
| `test_72_recipient_regression.js` | PASSED |
| `test_forensic_audit.js` | PASSED |
| `test_assignment_constant_regression.js` | PASSED |
| `test_txt_upload_regression.js` | PASSED |
| `test_fixes.js` | PASSED |
| `test_qa_verification.js` | PASSED |

## Key Behaviors Verified

### Sender ID Preflight
- `NaloSmsService.validateSenderIdWithProvider` exists and uses dummy phone `233000000000`.
- Preflight is called **before** wallet deduction and **before** recipient loop in both quick-send and campaign-send routes.
- On provider rejection, routes return `SENDER_ID_PROVIDER_REJECTED` (HTTP 400) with actionable error message.
- Preflight failure in campaign send cleans up recipients and marks campaign as `failed`.

### Circuit Breaker
- 1707 is classified as `sender_id_error` in `ResilientHttpClient`.
- `shouldCountForBreaker` excludes `sender_id_error`; global circuit breaker remains closed.

### Wallet Safety
- All-fail campaigns refund using `financialBreakdown.totalChargedToUser`.
- Refund paths are guarded by `!skipDeduction`.
- No duplicate refunds across failure paths.
- Reservation campaigns (retry/job queue) pass `skipDeduction` to avoid double-charging.

### Frontend
- `send-sms.html` displays `result.error` toast on API failure.
- Frontend does not hardcode only "Campaign failed to send"; it surfaces provider error details.
- `providerErrorSummary` is shown for common-cause failures.

### Upload Isolation
- No `Contact.create/insertMany/save/update/bulkWrite` in Send SMS upload flow.
- No Contacts DB comparison during Send SMS upload.
- No "already exists in contacts" messaging in Send SMS upload.
- MAX_SMS_RECIPIENTS = 200 preserved.
- Deduplication, phone-only TXT uploads, GSM-7/Unicode segmentation, 10-segment max preserved.

## Conclusion

All completion criteria from `AGENTS.md` are met. The Send SMS pipeline now rejects invalid Sender IDs at the provider preflight stage, prevents wallet charges for all-fail campaigns, and isolates the upload workflow from the Contacts module.
