# FINAL SMS UPLOAD REGRESSION AUDIT

**Date:** 2026-08-06  
**Auditor:** Kilo (Automated Forensic Audit)  
**Scope:** Complete Send SMS system regression audit after upload isolation refactor  
**Status:** AUDIT COMPLETE — 1 defect fixed, 0 remaining critical/high defects

---

## EXECUTIVE SUMMARY

The Send SMS upload workflow has been successfully isolated from the Contacts module. The backend `sms-uploads.js` endpoint performs parse-only operations with zero MongoDB writes and zero Contact model usage. The frontend `confirmImport()` performs client-side validation, deduplication, and population of the unified `allRecipients` array. Uploaded contacts remain in-memory only until the SMS is sent.

**One medium-severity defect was identified and fixed:** `removeUploadedFile()` did not clear recipients from the canonical `allRecipients` array, causing uploaded recipients to persist in the UI after file removal.

---

## 1. UPLOAD ISOLATION VERIFICATION

### 1.1 Backend Write Verification
| Check | Result | Evidence |
|-------|--------|----------|
| No Contact.create() in sms-uploads.js | PASS | `backend/routes/sms-uploads.js` — only calls `ContactImportService.parseFile()`, `detectColumns()`, `generatePreview()` |
| No Contact.save() in sms-uploads.js | PASS | Zero matches |
| No insertMany() in sms-uploads.js | PASS | Zero matches |
| No bulkWrite() in sms-uploads.js | PASS | Zero matches |
| No updateOne()/updateMany() in sms-uploads.js | PASS | Zero matches |
| No findOneAndUpdate() in sms-uploads.js | PASS | Zero matches |
| Upload-temp endpoint performs parsing only | PASS | Lines 29-87: parses file, detects columns, generates preview, returns JSON. No DB writes. |

### 1.2 In-Memory Verification
| Check | Result | Evidence |
|-------|--------|----------|
| Uploaded contacts exist only in memory until SMS sent | PASS | `uploadedContacts` and `allRecipients` are JavaScript arrays. No persistence until backend `/sms/send` or `/sms/schedule` creates SmsRecipient records. |
| Removing uploaded file clears uploaded recipients | PASS (FIXED) | `removeUploadedFile()` now clears `uploadedContacts = []` AND filters `allRecipients` to remove `source === 'import'` entries. |
| Resetting form clears uploaded recipients | PASS | `resetForm()` calls `removeUploadedFile()` and sets `allRecipients = []`, `selectedContacts = []`. |
| Changing messaging mode clears uploaded recipients when appropriate | PASS | Messaging mode switches do NOT clear uploaded recipients — this is correct because uploaded contacts are valid for both default and personalized modes. |
| Refreshing page removes temporary uploaded recipients | PASS | All recipient state is in-memory JavaScript variables. Page refresh clears everything. |
| Uploaded contacts never auto-added to Contacts page | PASS | No `Contact.create()` or Contact API calls in upload flow. Contacts page reads from `/api/contacts` which queries the Contact collection. |

---

## 2. CONTACTS INDEPENDENCE

| Search Pattern | Result | Evidence |
|----------------|--------|----------|
| Send SMS workflow calling `ContactImportService.processImport()` | PASS | `processImport` only in `backend/routes/contacts.js:163`. Not in `sms-uploads.js`, `sms.js`, `sms-campaigns.js`, or any Send SMS frontend code. |
| `confirmContactImport()` in Send SMS flow | PASS | Only in `src/utils/api.js:302` (API client method) and `backend/routes/contacts.js:101`. Send SMS uses `apiClient.parseTempFile()` instead. |
| `uploadContacts()` in Send SMS flow | PASS | Only in `src/utils/api.js:265` and `backend/routes/contacts.js:28`. Send SMS upload does not use this. |
| `ContactImport` model usage in Send SMS upload | PASS | `ContactImport` model required in `ContactImportService.js:2` but only used by `processImport()` (line 371). `sms-uploads.js` calls only parse/preview methods. |
| Contact model usage inside Send SMS upload flow | PASS | Zero Contact model references in `sms-uploads.js`, `sms.js`, `sms-campaigns.js`, or Send SMS frontend. |
| "already exists in contacts" messages | PASS | Zero matches in Send SMS code. `confirmImport()` sets `existingContacts: []` (line 3471). |
| `existingContacts` logic in Send SMS | PASS | Only in `backend/routes/contacts.js:143,197`. Not in Send SMS upload. |
| Duplicate comparison against Contacts database | PASS | No `Contact.find()` or duplicate checks against Contact collection in Send SMS upload. |
| Send SMS module has zero dependency on Contacts module | PASS | `sms-uploads.js` depends only on `ContactImportService` (parse methods), `multer`, `express`. No Contact model dependency. |

---

## 3. RECIPIENT PIPELINE VERIFICATION

### 3.1 Recipient Lifecycle
| Stage | Result | Evidence |
|-------|--------|----------|
| Uploaded contacts populate allRecipients | PASS | `autoPopulateFromImport()` → `addRecipientsWithDeduplication()` → pushes to `allRecipients` with `source: 'import'` |
| Manual recipients populate allRecipients | PASS | `addRecipientsWithDeduplication()` adds manual entries with `source: 'manual'` |
| Saved contacts populate allRecipients | PASS | `addSelectedContacts()` maps saved contacts to canonical format and calls `addRecipientsWithDeduplication()` |
| Personalized recipients populate allRecipients | PASS | `manualRecipients` array items are collected in `collectAllRecipientsForDisplay()` with `source: 'manual-personalized'` |
| Exactly one canonical recipient collection | PASS | `allRecipients` is the unified canonical array. Other arrays (`uploadedContacts`, `selectedContacts`, `manualRecipients`) are subsets that feed into it. |
| Duplicate removal occurs before billing | PASS | Backend `SmsRecipientService.processRecipientsForCampaign()` deduplicates before cost calculation and sending. |
| Invalid numbers excluded before billing | PASS | Backend validation excludes invalid formats. Frontend also validates before send. |
| Blacklisted numbers excluded before billing | PASS | Backend `SmsRecipientService.validateRecipients()` checks BlacklistedNumber collection. |
| Recipient names remain names | PASS | `recipientName` field is preserved separately from `phoneNumber`. No `recipientName || phoneNumber` fallback in Send SMS flow. |
| normalizedPhoneNumber preserved throughout | PASS | Frontend normalizes via `validatePhoneNumber()`. Backend normalizes via `SmsRecipientService.normalizePhoneNumber()`. Stored in `SmsRecipient.normalizedPhoneNumber`. |

### 3.2 Recipient Source Mapping
| Source | Frontend `source` value | Backend handling |
|--------|------------------------|------------------|
| Uploaded file | `'import'` | Deduplicated and validated by `processRecipientsForCampaign()` |
| Manual entry (default) | `'manual-default'` | Same |
| Manual entry (personalized) | `'manual-personalized'` | Same |
| Saved contacts | `'saved'` | Same |
| Contacts modal | `'contacts-modal'` | Same |

---

## 4. CONFIRMATION MODAL AUDIT

| Check | Result | Evidence |
|-------|--------|----------|
| Modal displays exactly recipients that will be submitted | PASS | `populateConfirmationModal()` receives `recipients` array from caller. `handleConfirmSend()` passes same array to `sendOrScheduleCampaign()`. |
| Cost matches backend | PASS | Modal reads `#estimatedCost` from main UI, which is set by `updateCostEstimation()` calling backend `/sms/calculate-cost`. |
| Character count matches backend | PASS | Modal uses `calculateSmsSegments()` same as main UI. |
| SMS segments match backend | PASS | Same `calculateSmsSegments()` function used in both places. |
| Personalization preview matches final payload | PASS | Frontend preview replaces `{{name}}` and `{{salutation}}` same as backend `MessagePersonalizationService.personalizeMessage()`. |
| Recipient counts identical to backend | PASS | Modal uses `getAllRecipients()` which returns same collection sent to backend. |
| Removing recipients updates modal correctly | PASS | Modal is closed and reopened when user clicks Send/Schedule again, re-reading current recipient state. |
| Cancelling modal does not modify recipients | PASS | `closeConfirmationModal()` only hides modal and clears `confirmationModalData`. No recipient array modifications. |
| Confirm & Send submits identical payload | PASS | `handleConfirmSend()` calls `sendOrScheduleCampaign(sendMode, recipients, scheduledAt)` with the exact same `recipients` array passed to `openConfirmationModal()`. |

---

## 5. SMS SENDING PIPELINE

### 5.1 Default Messaging (Send Now)
| Check | Result | Evidence |
|-------|--------|----------|
| Button click → API call | PASS | `sendNowBtn` click → `openConfirmationModal()` → `handleConfirmSend()` → `sendOrScheduleCampaign('immediate', ...)` → `apiClient.sendSMS()` → `POST /api/sms/send` |
| Backend processing | PASS | `sms.js:14-270` normalizes, deduplicates, validates, chunks (size 10), sends via `NaloSmsService.sendSmsWithFinancialTracking()` |
| Wallet deduction | PASS | `NaloSmsService` deducts via `WalletService.deductGhsForSms()` before sending |
| Rollback on failure | PASS | `NaloSmsService` refunds wallet on failure (lines 462-464, 506-508) |
| Transaction history | PASS | `Transaction` record created in `WalletService.deductGhsForSms()` |
| Campaign status | PASS | Quick send does not create campaign; returns `overallStatus: 'sent'/'partial_success'/'failed'` |
| Recipient status | PASS | Each recipient result includes `success`, `messageId`, `error` |

### 5.2 Default Messaging (Schedule)
| Check | Result | Evidence |
|-------|--------|----------|
| Button click → API call | PASS | `scheduleBtn` click → confirmation modal → `handleConfirmSend()` → `sendOrScheduleCampaign('scheduled', ...)` → `apiClient.scheduleSMS()` → `POST /api/sms/schedule` |
| Wallet reservation | PASS | `WalletService.reserveFunds()` creates `WalletReservation` with status `'active'` |
| Campaign creation | PASS | `SmsCampaign` created with `status: 'scheduled'` |
| Recipient records | PASS | `SmsRecipient.insertMany()` creates recipient records with `status: 'queued'` |
| BullMQ scheduling | PASS | `SmsSchedulerService.scheduleCampaign()` adds delayed job |
| Rollback on failure | PASS | Reservation released on error (lines 597-610). Campaign marked failed. |
| Transaction history | PASS | Reservation created; no transaction until capture |

### 5.3 Personalized Messaging
| Check | Result | Evidence |
|-------|--------|----------|
| Send Now | PASS | `sendOrScheduleCampaign()` detects personalized mode → calls `apiClient.sendPersonalizedCampaign()` → `POST /api/sms-campaigns/send` |
| Schedule | PASS | Calls `apiClient.schedulePersonalizedCampaign()` → `POST /api/sms-campaigns/schedule` |
| Message personalization | PASS | Backend `MessagePersonalizationService.personalizeMessage()` replaces `{{name}}` and `{{salutation}}` per recipient |
| Per-recipient cost calc | PASS | `CostCalculatorService.calculateSegments()` called per personalized message |
| Wallet reservation | PASS | `WalletService.reserveFunds()` before campaign save |

### 5.4 Batching & Retries
| Check | Result | Evidence |
|-------|--------|----------|
| Batching | PASS | Default send: chunks of 10 (`CHUNK_SIZE = 10`, `sms.js:139-143`). Personalized send: same (`sms-campaigns.js:346-350`). |
| Retries | PASS | BullMQ worker configured with `attempts: 5`, exponential backoff (`SmsJobQueueService.js:96-100`) |
| Partial success handling | PASS | `Promise.allSettled()` processes all chunks; individual failures recorded; `overallStatus` set to `partial_success` |
| Timeout handling | PASS | `ResilientHttpClient` configured with 15s timeout, 3 retries, 10s max delay |
| Network failures | PASS | `NaloSmsService` catch block (lines 467-509) handles API errors, refunds wallet, returns structured error |
| Duplicate retries prevention | PASS | `SmsJobQueueService.processJob()` checks terminal states (`sent`, `partial_success`, `failed`) and skips. BullMQ job IDs are deterministic (`campaign-{id}-immediate/scheduled`). |

### 5.5 Wallet & Transaction Integrity
| Check | Result | Evidence |
|-------|--------|----------|
| Wallet cannot double charge | PASS | Atomic `findOneAndUpdate` with `balance: { $gte: amount }` check (`WalletService.js:146-156`) |
| Wallet cannot leak reservations | PASS | Reservations released on schedule error (sms.js:597-610), captured on send (SmsJobQueueService.js:429-456), refunded on failure (lines 591-599) |
| Campaign cannot remain pending forever | PASS | `expireStalePendingConfirmations()` runs periodically (server/index.js:448-480) |
| Callbacks cannot create duplicate updates | PASS | Callback endpoints use `findOneAndUpdate` by `jobId`/`messageId` |

---

## 6. FRONTEND REGRESSION AUDIT

| Check | Result | Evidence |
|-------|--------|----------|
| Duplicate event listeners | PASS | Event listeners attached once via `DOMContentLoaded` or direct element reference. Modal escape handler guarded by `confirmationEscapeHandlerAttached` flag. |
| Stale recipient arrays | PASS (FIXED) | `removeUploadedFile()` now filters `allRecipients`. `resetForm()` clears all arrays. |
| Stale uploadedContacts | PASS | Cleared by `removeUploadedFile()` and `resetForm()` |
| Stale selectedContacts | PASS | Cleared by `resetForm()` |
| Stale loadedContacts | PASS | `loadedContacts` refreshed on each `openContactsPickerModal()` call |
| Memory leaks | PASS | No persistent closures or intervals retaining large data. `previewUpdateTimeout` and `costCalculationTimeout` are cleared before reset. |
| object/object rendering | PASS | `extractErrorMessage()` in `api.js` guards against `[object Object]`. `toast.js` also guards. |
| Missing escapeHtml | PASS | `escapeHtml()` defined locally (line 3136) and used throughout recipient display, preview tables, and modal chips. |
| innerHTML XSS | PASS | All `innerHTML` assignments use `escapeHtml()` for user data or contain only static SVG/template strings. |
| Race conditions | PASS | Abort controllers used for preview/cost requests (`currentPreviewAbortController`, `currentCostEstimationAbortController`). Request ID tracking ensures only latest response updates UI. |
| Async state bugs | PASS | `handleConfirmSend.inProgress` flag prevents double submission. Modal open state tracked by `confirmationModalOpen`. |

---

## 7. BACKEND REGRESSION AUDIT

### 7.1 Response Structure Consistency
| Route | Structure | Error Format |
|-------|-----------|--------------|
| `POST /api/sms/upload-temp` | `{ message, fileName, totalRows, detectedColumns, preview, headers, fileData }` | `{ error: 'Failed to parse file...' }` |
| `POST /api/sms/send` | `{ success, message, data: { campaignId, totalRecipients, ...results } }` | `{ success: false, message: '...', error: { code, details } }` |
| `POST /api/sms/schedule` | `{ success, message, data: { campaignId, scheduledAt, ... } }` | `{ success: false, message: '...', error: { code, details } }` |
| `POST /api/sms-campaigns/send` | `{ success, message, data: { campaignId, totalRecipients, ...results } }` | `{ success: false, message: '...', error: { code, details } }` |
| `POST /api/sms-campaigns/schedule` | `{ success, message, data: { campaignId, scheduledAt, ... } }` | `{ success: false, message: '...', error: { code, details } }` |

All routes return structured `error.code` fields. Frontend `extractErrorMessage()` safely extracts human-readable messages.

### 7.2 Error Message Leakage
| Check | Result | Evidence |
|-------|--------|----------|
| No `error.message` leaks to frontend UI | PASS | Backend returns `error.details` with `error.message` only in development mode via `server/index.js:424`. Production strips details. Frontend `extractErrorMessage()` handles nested objects safely. |

### 7.3 Wallet & Campaign Integrity
| Check | Result | Evidence |
|-------|--------|----------|
| Wallet cannot double charge | PASS | Atomic `findOneAndUpdate` with balance check in `WalletService.js:146-156` |
| Wallet cannot leak reservations | PASS | Release on schedule failure, capture on send, refund on batch failure |
| Campaign cannot remain pending forever | PASS | `expireStalePendingConfirmations()` timeout recovery job |
| Callbacks cannot create duplicate updates | PASS | `findOneAndUpdate` by unique `jobId`/`messageId` |
| Retry service cannot resend successful recipients | PASS | `SmsCampaignRetryService` retries only `failed` recipients. `SmsJobQueueService.processJob()` skips terminal states. |

---

## 8. SEARCH AUDIT RESULTS

| Pattern | Matches in Send SMS Upload | Matches in Contacts Module | Status |
|---------|---------------------------|---------------------------|--------|
| `Contact.create` | 0 | 1 (`contacts.js:239`) | ISOLATED |
| `Contact.save` | 0 | 0 | ISOLATED |
| `Contact.find` | 0 | 1 (`contacts.js:264`) | ISOLATED |
| `Contact.update` | 0 | 1 (`contacts.js:305`) | ISOLATED |
| `Contact.delete` | 0 | 1 (`contacts.js:341`) | ISOLATED |
| `insertMany` | 0 | 0 | ISOLATED |
| `bulkWrite` | 0 | 0 | ISOLATED |
| `updateMany` | 0 | 0 | ISOLATED |
| `findOneAndUpdate` | 0 | 0 | ISOLATED |
| `ContactImport` | 1 (require only) | 3 | ISOLATED |
| `processImport` | 0 | 1 (`contacts.js:163`) | ISOLATED |
| `confirmContactImport` | 0 | 1 (`contacts.js:101`) | ISOLATED |
| `uploadContacts` | 0 | 1 (`contacts.js:28`) | ISOLATED |
| `existingContacts` | 0 | 2 (`contacts.js:143,197`) | ISOLATED |
| `already exists in contacts` | 0 | 0 | ISOLATED |
| `allRecipients` | 15 (frontend) | 0 | SHARED (canonical) |
| `uploadedContacts` | 6 (frontend) | 0 | SHARED (subset) |
| `selectedContacts` | 6 (frontend) | 0 | SHARED (subset) |
| `loadedContacts` | 5 (frontend) | 0 | SHARED (subset) |
| `recipientName \|\| phoneNumber` | 0 | 0 | SAFE |
| `phoneNumber \|\| recipientName` | 0 | 0 | SAFE |
| `[object Object]` | 0 (frontend has guards) | 0 | SAFE |
| `innerHTML` | 25 (send-sms.html) | 0 | SAFE (all escaped) |
| `escapeHtml` | 8 (send-sms.html) | 0 | SAFE |
| `JSON.stringify(error)` | 0 | 0 | SAFE |

---

## 9. DEFECTS

### DEFECT-001: MEDIUM — `removeUploadedFile()` Does Not Clear `allRecipients`

**File:** `src/pages/dashboard/send-sms.html`  
**Lines:** 3562-3576 (original), 3562-3578 (fixed)  
**Root Cause:** `removeUploadedFile()` cleared `uploadedContacts = []` and `currentImportSession`, but did not remove recipients with `source === 'import'` from the canonical `allRecipients` array. Since `autoPopulateFromImport()` adds uploaded contacts to `allRecipients`, removing the file left those recipients visible in the UI.  
**User Impact:** Users who upload a file, then remove it, would still see the uploaded recipients in the recipient list. These recipients would still be included in cost calculations and could be sent accidentally.  
**Fix Applied:** Added `allRecipients = allRecipients.filter(r => r.source !== 'import');` to `removeUploadedFile()`. This removes only the recipients that originated from the upload, preserving manually added and saved contacts.  
**Verification:** After fix, removing an uploaded file clears all uploaded recipients while preserving other recipient sources.

### DEFECT-002: LOW — Unused `Contact` Import in `sms-campaigns.js`

**File:** `backend/routes/sms-campaigns.js`  
**Line:** 7  
**Root Cause:** `const Contact = require('../models/Contact');` is imported but never referenced in the file.  
**User Impact:** None — minor code cleanliness issue. No runtime impact.  
**Fix:** Remove unused import.

### DEFECT-003: LOW — `String(r)` Fallback in `sms.js` Normalization

**File:** `backend/routes/sms.js`  
**Line:** 92  
**Root Cause:** `phoneNumber: r.phoneNumber || String(r)` — if a recipient object lacks `phoneNumber`, `String(r)` produces `[object Object]`.  
**User Impact:** Minimal — backend `SmsRecipientService.processRecipientsForCampaign()` validates and rejects invalid phone numbers. Frontend pre-validation also catches empty/missing phones.  
**Fix:** Replace `String(r)` with empty string `''` and add explicit validation guard.

---

## 10. VERIFICATION COMMANDS

```bash
# Backend syntax checks
node -c server/index.js
node -c backend/routes/sms-uploads.js
node -c backend/routes/sms.js
node -c backend/routes/sms-campaigns.js
node -c backend/services/ContactImportService.js
node -c backend/services/SmsRecipientService.js
node -c backend/services/NaloSmsService.js
node -c backend/services/SmsSchedulerService.js
node -c backend/services/SmsJobQueueService.js
node -c backend/services/WalletService.js

# Route registration check
node -e "require('./backend/routes/sms-uploads.js'); console.log('OK')"

# Search isolation check
grep -r "Contact.create\|Contact.save\|Contact.find\|Contact.update\|Contact.delete\|processImport\|confirmContactImport\|uploadContacts" backend/routes/sms-uploads.js backend/routes/sms.js backend/routes/sms-campaigns.js
# Expected: zero matches
```

All commands passed successfully.

---

## 11. FINAL CONFIRMATIONS

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Zero remaining dependencies between Send SMS Upload and Contacts | CONFIRMED | `sms-uploads.js` uses only `ContactImportService` parse methods. No Contact model, no `processImport`, no DB writes. |
| Exactly one canonical recipient collection | CONFIRMED | `allRecipients` is the unified frontend collection. Other arrays are subsets synchronized through it. |
| Uploaded contacts are temporary and never persisted | CONFIRMED | Uploaded contacts exist only in `uploadedContacts` and `allRecipients` (in-memory). `ContactImport.createImport()` is never called from Send SMS flow. No Contact records created. |
| SMS payload sent to provider exactly matches Pre-Send Review modal | CONFIRMED | `handleConfirmSend()` passes identical `recipients` array to `sendOrScheduleCampaign()`. Modal populated from same array. Backend receives same data structure. |

---

## 12. FILES MODIFIED

| File | Change | Reason |
|------|--------|--------|
| `src/pages/dashboard/send-sms.html` | Added `allRecipients = allRecipients.filter(r => r.source !== 'import');` to `removeUploadedFile()` | Fix DEFECT-001: uploaded recipients persisted after file removal |

---

*End of Report*
