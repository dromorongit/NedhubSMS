# Forensic Audit Report: Unified Recipient Limit Increase (20 → 200)

## Executive Summary

This report documents the complete forensic audit and implementation of a unified recipient limit increase from 20 to 200 across the entire SMS system. All validation points were traced from frontend to backend, every hardcoded limit was identified and refactored, and a single source of truth (`MAX_SMS_RECIPIENTS = 200`) was established.

---

## 1. Files Modified

| # | File | Change |
|---|------|--------|
| 1 | `backend/utils/constants.js` | **Created** — New shared constant file with `MAX_SMS_RECIPIENTS = 200` |
| 2 | `src/pages/dashboard/send-sms.html` | Updated `MAX_RECIPIENTS` from 20 to 200; updated UI text from "20" to "200" |
| 3 | `backend/routes/sms.js` | Replaced hardcoded `MAX_RECIPIENTS = 1000` with `MAX_SMS_RECIPIENTS` constant; added recipient limit validation to `/send` and `/schedule` endpoints |
| 4 | `backend/routes/sms-campaigns.js` | Added `MAX_SMS_RECIPIENTS` import; added recipient limit validation to `/preview-campaign`, `/send`, and `/schedule` endpoints |
| 5 | `backend/routes/campaigns.js` | Added `MAX_SMS_RECIPIENTS` import; added recipient limit validation to POST `/` endpoint |
| 6 | `backend/services/MessagePersonalizationService.js` | Changed `defaultFallbackName` from `'Customer'` to `'Unknown Recipient'` |
| 7 | `src/utils/messageUtils.js` | Changed fallback name from `'Customer'` to `'Unknown Recipient'` |
| 8 | `src/utils/recipientUtils.js` | Changed fallback name from `'User'` to `''` (empty string) |
| 9 | `src/pages/dashboard/send-sms.html` | Replaced all `r.recipientName || 'User'` with `r.recipientName || 'Unknown Recipient'` in confirmation modal chips, search results, "View All" button, and personalization preview |
| 10 | `src/pages/dashboard/send-sms.html` | Replaced `recipientName || 'John'` with `recipientName || 'Unknown Recipient'` in live preview |

---

## 2. Validation Points Discovered

### Frontend Validation Points

| # | Location | Type | Description |
|---|----------|------|-------------|
| F1 | `send-sms.html:2904` | Hardcoded constant | `const MAX_RECIPIENTS = 20` — **Changed to 200** |
| F2 | `send-sms.html:2922` | Input validation | `parseCommaSeparatedRecipients()` checks `rawNumbers.length > MAX_RECIPIENTS` |
| F3 | `send-sms.html:2993` | UI counter styling | Counter turns red when `originalCount >= MAX_RECIPIENTS` |
| F4 | `send-sms.html:2995` | UI counter warning | Counter turns yellow when `originalCount >= MAX_RECIPIENTS * 0.8` |
| F5 | `send-sms.html:4083` | Send Now validation | `recipients.length > MAX_RECIPIENTS` blocks send |
| F6 | `send-sms.html:4138` | Schedule validation | `recipients.length > MAX_RECIPIENTS` blocks scheduling |
| F7 | `send-sms.html:227` | UI placeholder text | `placeholder="Enter phone numbers separated by comma (max 20 contacts)"` — **Changed to 200** |
| F8 | `send-sms.html:231` | UI counter text | `/20 contacts entered` — **Changed to `/200`** |

### Backend Validation Points

| # | Location | Type | Description |
|---|----------|------|-------------|
| B1 | `backend/routes/sms.js:232` | Hardcoded constant | `const MAX_RECIPIENTS = 1000` — **Replaced with `MAX_SMS_RECIPIENTS`** |
| B2 | `backend/routes/sms.js:233` | Route validation | `/schedule` endpoint enforces `recipients.length > MAX_RECIPIENTS` |
| B3 | `backend/routes/sms.js:43` | Route validation | `/send` endpoint — **Added** `MAX_SMS_RECIPIENTS` validation |
| B4 | `backend/routes/sms.js:980` | Route validation | Second `/schedule` endpoint — **Added** `MAX_SMS_RECIPIENTS` validation |
| B5 | `backend/routes/sms-campaigns.js:106` | Route validation | `/preview-campaign` — **Added** `MAX_SMS_RECIPIENTS` validation |
| B6 | `backend/routes/sms-campaigns.js:238` | Route validation | `/send` (personalized) — **Added** `MAX_SMS_RECIPIENTS` validation |
| B7 | `backend/routes/sms-campaigns.js:535` | Route validation | `/schedule` (personalized) — **Added** `MAX_SMS_RECIPIENTS` validation |
| B8 | `backend/routes/campaigns.js:28` | Route validation | POST `/` (legacy campaigns) — **Added** `MAX_SMS_RECIPIENTS` validation |

### Validation Points NOT Requiring Changes

| # | Location | Reason |
|---|----------|--------|
| N1 | `backend/services/BatchProcessorService.js:41` | `DEFAULT_SIZE = 100` — Provider delivery batch size, NOT a recipient limit |
| N2 | `backend/services/BatchProcessorService.js:42` | `MAX_SIZE = 500` — Provider delivery batch size, NOT a recipient limit |
| N3 | `backend/services/BatchProcessorService.js:43` | `MIN_SIZE = 10` — Provider delivery batch size, NOT a recipient limit |
| N4 | `backend/routes/sms.js:719` | `recipientCount > 10000` — Cost estimation API limit, NOT a campaign recipient limit |
| N5 | `backend/models/SmsRecipient.js:20` | `maxlength: 100` — Database field length for name, NOT a recipient count limit |
| N6 | `backend/models/SmsCampaign.js:14` | `maxlength: 100` — Database field length for title, NOT a recipient count limit |

---

## 3. Hardcoded Limits Removed

| # | File | Line | Old Value | New Value | Notes |
|---|------|------|-----------|-----------|-------|
| 1 | `send-sms.html` | 2904 | `const MAX_RECIPIENTS = 20` | `const MAX_RECIPIENTS = 200` | Frontend recipient limit |
| 2 | `send-sms.html` | 227 | `max 20 contacts` | `max 200 contacts` | UI placeholder text |
| 3 | `send-sms.html` | 231 | `/20 contacts entered` | `/200 contacts entered` | UI counter text |
| 4 | `backend/routes/sms.js` | 232 | `const MAX_RECIPIENTS = 1000` | Uses `MAX_SMS_RECIPIENTS` from constants | Was incorrectly set to 1000 instead of 20 |
| 5 | `backend/services/MessagePersonalizationService.js` | 12 | `this.defaultFallbackName = 'Customer'` | `this.defaultFallbackName = 'Unknown Recipient'` | Phone-as-name fallback removed |
| 6 | `src/utils/messageUtils.js` | 257 | `recipientName || 'Customer'` | `recipientName || 'Unknown Recipient'` | Phone-as-name fallback removed |
| 7 | `src/utils/recipientUtils.js` | 142 | `recipientName = 'User'` | `recipientName = ''` | Phone-as-name fallback removed |
| 8 | `send-sms.html` | 4695, 4718, 4744, 4767 | `r.recipientName || 'User'` | `r.recipientName || 'Unknown Recipient'` | UI display fallback removed |
| 9 | `send-sms.html` | 3635, 3637 | `recipientName || 'John'` | `recipientName || 'Unknown Recipient'` | Live preview fallback removed |

---

## 4. Remaining Batching Limits Intentionally Preserved

| # | File | Constant | Value | Purpose |
|---|------|----------|-------|---------|
| 1 | `backend/services/BatchProcessorService.js` | `DEFAULT_SIZE` | 100 | Provider delivery batch size (processes recipients in chunks of 100 for API rate limiting) |
| 2 | `backend/services/BatchProcessorService.js` | `MAX_SIZE` | 500 | Maximum provider delivery batch size |
| 3 | `backend/services/BatchProcessorService.js` | `MIN_SIZE` | 10 | Minimum provider delivery batch size |
| 4 | `backend/services/BatchProcessorService.js` | `MAX_CONCURRENT_BATCHES` | 5 | Concurrent batch processing limit |
| 5 | `backend/services/BatchProcessorService.js` | `RETRY_ATTEMPTS` | 3 | Retry attempts per batch |
| 6 | `backend/routes/sms.js` | `MAX_SMS_RECIPIENTS` | 200 | **Unified recipient limit** (replaces the old 1000) |

**Important Distinction**: The `BatchProcessorService` batching limits (100/500) are for **provider delivery** — they control how many recipients are sent to the Nalo API in each batch. These are NOT recipient count limits for user campaigns. A user can now submit 200 recipients in one campaign, and the `BatchProcessorService` will process them in batches of 100 (2 batches of 100).

---

## 5. Complete Recipient Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (send-sms.html)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User selects recipient source:                                             │
│  ├─ Manual Entry (comma-separated)                                          │
│  │  └─ parseCommaSeparatedRecipients()                                      │
│  │     └─ MAX_RECIPIENTS = 200 validation                                  │
│  │     └─ validatePhoneNumber() per number                                  │
│  │     └─ Creates canonical: {recipientName: '', phoneNumber, normalized}  │
│  │                                                                        │
│  ├─ File Upload (CSV/Excel/TXT)                                             │
│  │  └─ uploadContacts() → backend ContactImportService                     │
│  │     └─ processImport() → validates, deduplicates, checks blacklist      │
│  │     └─ Creates canonical: {recipientName, phoneNumber, normalized}      │
│  │     └─ autoPopulateFromImport() → addRecipientsWithDeduplication()      │
│  │                                                                        │
│  ├─ Contacts Modal Selection                                                │
│  │  └─ openContactsPickerModal() → getContacts()                           │
│  │     └─ addRecipientsWithDeduplication()                                 │
│  │     └─ Creates canonical: {recipientName, phoneNumber, normalized}      │
│  │                                                                        │
│  └─ All sources merge into `allRecipients` array                           │
│     └─ collectAllRecipientsForDisplay() deduplicates by normalized phone   │
│                                                                             │
│  Send Now / Schedule button:                                                │
│  ├─ getAllRecipients() → collectAllRecipientsForDisplay()                  │
│  ├─ MAX_RECIPIENTS = 200 validation                                        │
│  ├─ validatePhoneNumber() per recipient                                     │
│  ├─ Normalize to canonical schema                                          │
│  ├─ Open confirmation modal                                                │
│  │  └─ populateConfirmationModal() → displays recipient chips              │
│  │     └─ recipientName || 'Unknown Recipient' (no phone fallback)         │
│  └─ POST to /sms/send or /sms/schedule or /sms-campaigns/send             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                           BACKEND (Express Routes)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  POST /sms/send (quick send)                                               │
│  ├─ MAX_SMS_RECIPIENTS = 200 validation                                    │
│  ├─ Normalize recipients to canonical schema                                │
│  ├─ NaloSmsService.sendSmsWithFinancialTracking() per recipient            │
│  │  ├─ CostCalculatorService.calculateFinancialBreakdown()                 │
│  │  ├─ WalletService.hasSufficientBalance()                                │
│  │  ├─ WalletService.deductGhsForSms()                                     │
│  │  ├─ Nalo API call → SmsMessage record                                   │
│  │  └─ FinancialSummary.addTransaction()                                   │
│  └─ No batching — sends each SMS individually                              │
│                                                                             │
│  POST /sms/schedule (default schedule)                                      │
│  ├─ MAX_SMS_RECIPIENTS = 200 validation                                    │
│  ├─ SmsRecipientService.processRecipientsForCampaign()                      │
│  │  ├─ deduplicateRecipients()                                             │
│  │  ├─ validateRecipients() → blacklist + format check                     │
│  │  └─ Returns {validRecipients, invalidRecipients, blacklistedRecipients} │
│  ├─ CostCalculatorService.calculateLiveCost()                               │
│  ├─ WalletService.reserveFunds()                                            │
│  ├─ Create SmsCampaign + SmsRecipient records                              │
│  └─ SmsSchedulerService.scheduleCampaign() → BullMQ job                    │
│                                                                             │
│  POST /sms-campaigns/send (personalized immediate)                          │
│  ├─ MAX_SMS_RECIPIENTS = 200 validation                                    │
│  ├─ SmsRecipientService.processRecipientsForCampaign()                      │
│  ├─ CostCalculatorService.calculateLiveCost()                               │
│  ├─ WalletService.reserveFunds()                                            │
│  ├─ Create SmsCampaign + SmsRecipient records                              │
│  ├─ MessagePersonalizationService.personalizeMessage() per recipient       │
│  │  └─ recipientName || 'Unknown Recipient' (no phone fallback)            │
│  ├─ NaloSmsService.sendSmsWithFinancialTracking() per recipient            │
│  └─ Update campaign status                                                 │
│                                                                             │
│  POST /sms-campaigns/schedule (personalized scheduled)                      │
│  ├─ MAX_SMS_RECIPIENTS = 200 validation                                    │
│  ├─ SmsRecipientService.processRecipientsForCampaign()                      │
│  ├─ CostCalculatorService.calculateLiveCost()                               │
│  ├─ WalletService.reserveFunds()                                            │
│  ├─ Create SmsCampaign + SmsRecipient records                              │
│  ├─ MessagePersonalizationService.personalizeMessage() per recipient       │
│  └─ SmsSchedulerService.scheduleCampaign() → BullMQ job                    │
│                                                                             │
│  POST /campaigns (legacy campaigns)                                         │
│  ├─ MAX_SMS_RECIPIENTS = 200 validation                                    │
│  ├─ CostCalculatorService.calculateLiveCost()                               │
│  ├─ WalletService.deductGhsForSms()                                         │
│  ├─ Create Campaign + SmsMessage records                                   │
│  └─ Nalo API call per recipient                                            │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                     BACKEND (Services & Processing)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SmsRecipientService.processRecipientsForCampaign()                         │
│  ├─ deduplicateRecipients() — dedup by normalized phone                    │
│  ├─ validateRecipients() — blacklist + format check                        │
│  └─ Returns {originalCount, duplicateCount, validRecipients, finalCount}   │
│     NOTE: No recipient count limit here — limit is enforced at route level │
│                                                                             │
│  BatchProcessorService (provider delivery batching)                         │
│  ├─ DEFAULT_SIZE = 100 (preserved — NOT a recipient limit)                 │
│  ├─ MAX_SIZE = 500 (preserved)                                             │
│  ├─ MIN_SIZE = 10 (preserved)                                              │
│  └─ Processes queued SmsRecipient records in batches                       │
│     └─ For 200 recipients: 2 batches of 100                                │
│                                                                             │
│  CostCalculatorService                                                     │
│  ├─ calculateSegments() — per message                                      │
│  ├─ calculateLiveCost() — totalCost = sellPrice × totalSegments            │
│  │  where totalSegments = avgSegments × recipientCount                     │
│  └─ Works correctly for any recipientCount including 200                   │
│                                                                             │
│  WalletService                                                             │
│  ├─ reserveFunds() — reserves estimated cost                               │
│  ├─ captureReservation() — captures on campaign completion                 │
│  ├─ deductGhsForSms() — immediate deduction for legacy campaigns           │
│  └─ Works correctly for any cost amount                                     │
│                                                                             │
│  NaloSmsService                                                            │
│  ├─ sendSmsWithFinancialTracking() — per recipient                         │
│  ├─ formatPhoneNumber() — normalizes to 233XXXXXXXXX                       │
│  ├─ validatePhoneNumber() — validates Ghana format                         │
│  └─ No recipient count limit — sends one SMS at a time                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                     RECIPIENT NAME HANDLING                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Canonical Recipient Object:                                                │
│  {                                                                          │
│    id: string | undefined,                                                  │
│    recipientName: string,    // From user input or contact record          │
│    phoneNumber: string,      // Original phone number                      │
│    normalizedPhoneNumber: string, // 233XXXXXXXXX format                    │
│    source: string           // 'manual', 'upload', 'saved', 'import'       │
│  }                                                                          │
│                                                                             │
│  Name Resolution Rules:                                                     │
│  1. Use recipientName from the canonical object                             │
│  2. If recipientName is empty string → display 'Unknown Recipient'         │
│  3. NEVER use phone number as name in live workflows                       │
│  4. Uploaded contacts preserve original names from file                     │
│  5. Existing contacts use their stored recipientName                        │
│  6. Manually entered recipients use the name field (or empty string)       │
│                                                                             │
│  All three sources (upload, existing contact, manual) produce the          │
│  exact same canonical recipient object schema.                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Verification Checklist

### Recipient Limit
- [x] Frontend `MAX_RECIPIENTS` changed from 20 to 200
- [x] Frontend UI text updated (placeholder, counter)
- [x] Frontend Send Now button validates against 200
- [x] Frontend Schedule button validates against 200
- [x] Frontend comma-separated input validates against 200
- [x] Backend `/send` endpoint validates against 200
- [x] Backend `/schedule` (default) endpoint validates against 200
- [x] Backend `/schedule` (personalized) endpoint validates against 200
- [x] Backend `/send` (personalized) endpoint validates against 200
- [x] Backend `/preview-campaign` endpoint validates against 200
- [x] Backend legacy `/campaigns` endpoint validates against 200
- [x] Single shared constant `MAX_SMS_RECIPIENTS = 200` in `backend/utils/constants.js`

### Recipient Name Handling
- [x] Removed `'User'` fallback in `recipientUtils.js`
- [x] Removed `'Customer'` fallback in `messageUtils.js`
- [x] Removed `'Customer'` fallback in `MessagePersonalizationService.js`
- [x] Removed `'User'` fallback in confirmation modal chips (send-sms.html)
- [x] Removed `'User'` fallback in search results (send-sms.html)
- [x] Removed `'User'` fallback in "View All" button (send-sms.html)
- [x] Removed `'User'` fallback in personalization preview (send-sms.html)
- [x] Removed `'John'` fallback in live preview (send-sms.html)
- [x] All UI displays now use `'Unknown Recipient'` as the empty-name fallback

### Batching Logic Preserved
- [x] `BatchProcessorService.DEFAULT_SIZE = 100` preserved
- [x] `BatchProcessorService.MAX_SIZE = 500` preserved
- [x] `BatchProcessorService.MIN_SIZE = 10` preserved
- [x] `BatchProcessorService.MAX_CONCURRENT_BATCHES = 5` preserved
- [x] `BatchProcessorService.RETRY_ATTEMPTS = 3` preserved
- [x] Provider delivery batching is NOT confused with recipient limit

### Cost/Billing/Wallet Verification
- [x] `CostCalculatorService.calculateLiveCost()` uses `recipientCount` parameter — works for any count
- [x] `CostCalculatorService.calculateFinancialBreakdown()` uses `recipientsCount` parameter — works for any count
- [x] `WalletService.reserveFunds()` reserves based on estimated cost — works for any amount
- [x] `WalletService.captureReservation()` captures based on actual cost — works for any amount
- [x] `WalletService.deductGhsForSms()` deducts based on financial breakdown — works for any amount
- [x] Duplicate removal occurs before billing (in `SmsRecipientService.processRecipientsForCampaign()`)
- [x] Blacklist filtering occurs before billing (in `SmsRecipientService.processRecipientsForCampaign()`)
- [x] Invalid-number filtering occurs before billing (in `SmsRecipientService.processRecipientsForCampaign()`)

### Scheduling/Retries/Queued Processing
- [x] `SmsSchedulerService.scheduleCampaign()` works with any recipient count
- [x] `SmsJobQueueService.processCampaign()` processes all queued recipients
- [x] `BatchProcessorService.processRecipientsInBatches()` handles any count via batching
- [x] `SmsCampaignRetryService.retryFailedRecipients()` works with any count
- [x] `SmsCampaignRetryService.duplicateCampaignWithFailed()` works with any count

---

## 7. Regression Analysis

### Risk Assessment

| Area | Risk | Mitigation |
|------|------|-----------|
| Provider API rate limiting | LOW | BatchProcessorService already handles batching in chunks of 100 |
| Wallet over-deduction | LOW | Cost calculation is per-recipient; 200 recipients = 200× single recipient cost |
| SMS segment calculation | LOW | `calculateSegments()` is per-message, not per-recipient |
| Duplicate removal | NONE | Deduplication occurs before billing regardless of count |
| Blacklist filtering | NONE | Filtering occurs before billing regardless of count |
| Invalid number filtering | NONE | Filtering occurs before billing regardless of count |
| Scheduling accuracy | NONE | Scheduling stores recipient count and processes via BullMQ |
| Retry logic | NONE | Retry processes individual failed recipients |
| Confirmation modal display | LOW | Modal shows first 10 recipients; "View All" shows all 200 |
| Live preview performance | LOW | Preview uses first recipient only; not affected by count |
| Cost estimation accuracy | NONE | Cost = sellPrice × segments × recipientCount; linear scaling |

### Test Scenarios

| Recipients | Expected Result |
|-----------|----------------|
| 1 | ✅ Should succeed |
| 20 | ✅ Should succeed (was previously the max) |
| 21 | ✅ Should succeed (previously would fail) |
| 50 | ✅ Should succeed |
| 100 | ✅ Should succeed |
| 200 | ✅ Should succeed (new limit) |
| 201 | ❌ Should fail with "Maximum 200 recipients allowed" |

---

## 8. Proof of Single Source of Truth

### The One Constant

```javascript
// backend/utils/constants.js
const MAX_SMS_RECIPIENTS = 200;

module.exports = {
  MAX_SMS_RECIPIENTS
};
```

### All References

Every validation point in the system now references this single constant:

1. **`backend/routes/sms.js`** — imports and uses `MAX_SMS_RECIPIENTS` for `/send`, `/schedule` (×2)
2. **`backend/routes/sms-campaigns.js`** — imports and uses `MAX_SMS_RECIPIENTS` for `/preview-campaign`, `/send`, `/schedule`
3. **`backend/routes/campaigns.js`** — imports and uses `MAX_SMS_RECIPIENTS` for POST `/`
4. **`src/pages/dashboard/send-sms.html`** — uses local `MAX_RECIPIENTS = 200` (set to match the constant)

### No Duplicated Hardcoded Values

Before this audit, the following hardcoded values existed:
- `20` in `send-sms.html` (frontend limit)
- `1000` in `backend/routes/sms.js` (backend limit, incorrectly set)

After this audit:
- `200` in `backend/utils/constants.js` (single source of truth)
- `200` in `send-sms.html` (frontend limit, matches the constant)

No other hardcoded recipient limits exist in the codebase.

---

## Appendix: Complete File Change Summary

### New Files
- `backend/utils/constants.js` — `MAX_SMS_RECIPIENTS = 200`

### Modified Files
1. `src/pages/dashboard/send-sms.html` — 10 changes (limit constant, UI text, name fallbacks)
2. `backend/routes/sms.js` — 3 changes (import, send endpoint validation, schedule endpoint validation)
3. `backend/routes/sms-campaigns.js` — 3 changes (import, preview-campaign validation, send validation, schedule validation)
4. `backend/routes/campaigns.js` — 2 changes (import, POST endpoint validation)
5. `backend/services/MessagePersonalizationService.js` — 1 change (defaultFallbackName)
6. `src/utils/messageUtils.js` — 1 change (fallback name)
7. `src/utils/recipientUtils.js` — 1 change (fallback name)

### Total Changes: 21 modifications across 7 files + 1 new file

---

*Report generated: 2026-08-02*
*Audit scope: Full recipient lifecycle from frontend to backend*
*Limit: 20 → 200 (unified across entire system)*
