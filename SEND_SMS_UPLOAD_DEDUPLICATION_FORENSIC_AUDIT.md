# Send SMS Upload Deduplication Forensic Audit

## Executive Summary

This audit documents the root causes of critical defects in the Send SMS file-upload recipient pipeline, the exact fixes applied, and verification that uploaded contacts remain isolated from the user's Contacts database.

## Pipeline Trace

1. **File Selection** → `send-sms.html` `contactFile` change listener
2. **Parse Request** → `POST /api/sms/upload-temp` (`backend/routes/sms-uploads.js`)
3. **File Parsing** → `ContactImportService.parseFile()` (`backend/services/ContactImportService.js`)
4. **Column Detection** → `ContactImportService.detectColumns()`
5. **Preview Generation** → `ContactImportService.generatePreview()`
6. **Frontend Modal** → `showImportPreviewModal()` + `generatePreviewClientSide()`
7. **Column Mapping** → User selects name/phone columns in modal
8. **Confirm Import** → `confirmImport()` (client-side processing)
9. **Auto-Populate** → `autoPopulateFromImport()` → `addRecipientsWithDeduplication()`
10. **Canonical Store** → `allRecipients[]`
11. **Cost Estimation** → `updateCostEstimation()` → `/api/sms/calculate-cost`
12. **Pre-Send Review** → `openConfirmationModal()` → `analyzeRecipientsForModal()`
13. **Send/Schedule** → `sendOrScheduleCampaign()` → `/api/sms/send` or `/api/sms/schedule`
14. **Backend Processing** → `SmsRecipientService.processRecipientsForCampaign()`
15. **Provider Delivery** → `NaloSmsService.sendSmsWithFinancialTracking()`

## Root Cause Analysis

### RC-1: `recipientName` becomes `phoneNumber`

**File:** `backend/services/ContactImportService.js`  
**Method:** `detectColumns()`  
**Lines:** 231-241 (original)

**Cause:** When no name column was detected in the uploaded file headers, `detectColumns()` fell back to assigning `headers[0]` as the `detectedNameColumn`. For a single-column file containing only phone numbers (e.g., header `"Phone"`), this meant both `detectedNameColumn` and `detectedPhoneColumn` were set to `"Phone"`. Consequently, `generatePreview()` and the frontend `confirmImport()` read the phone number value into both `recipientName` and `phoneNumber`.

**Impact:** Every phone-only upload populated `recipientName` with the raw phone number, causing personalized messages to address recipients by their phone numbers.

**Fix:** Removed the positional fallback in `detectColumns()`. When no name column matches the header patterns, `detectedNameColumn` is returned as `null`. The frontend modal now allows an empty name column selection, and `confirmImport()` correctly sets `recipientName: ''` when no name column is selected.

### RC-2: Duplicates displayed as blocking errors

**File:** `src/pages/dashboard/send-sms.html`  
**Method:** `confirmImport()`  
**Lines:** 3438-3445 (original)

**Cause:** When a duplicate phone number was detected within the uploaded file, the code pushed an error object into the `errors` array with the message `'Duplicate phone number within uploaded file'`. These errors were then rendered in the import summary UI and could mislead users into thinking duplicates blocked the workflow.

**Impact:** Users saw duplicate rows listed as errors. While sending was not technically blocked (duplicates were skipped via `continue`), the error-list presentation violated the business rule that duplicates must be "silently merged" and "never displayed as fatal errors."

**Fix:** Replaced the `Set`-based duplicate tracking with a `Map`-based approach. Duplicate rows are now merged into the existing recipient record. The best available `recipientName` is preserved (prefer non-empty names). Duplicate counts are tracked in `summary.duplicateRows` for informational display only, and no duplicate entries are added to the `errors` array.

### RC-3: "81 total recipients" vs. expected ~80

**File:** `backend/services/ContactImportService.js`  
**Method:** `parseCSV()`  
**Lines:** 94-107 (original)

**Cause:** The CSV parser included rows where all column values were empty strings (e.g., a trailing line containing only commas or whitespace). These empty rows were counted in `totalRows` and shown in the preview, but later failed validation during `confirmImport()`, producing a mismatch between preview totals and final imported counts.

**Fix:** Added a check in `parseCSV()` to skip rows where every parsed value is empty/whitespace: `if (values.length === headers.length) { const allEmpty = values.every(v => !v || !v.trim()); if (allEmpty) continue; ... }`.

### RC-4: Frontend validation blocking personalized sends without names

**File:** `src/pages/dashboard/send-sms.html`  
**Method:** `sendOrScheduleCampaign()`  
**Lines:** 4218-4224 (original)

**Cause:** The frontend validation required every recipient to have a non-empty `recipientName` in personalized mode. This prevented sending personalized campaigns to phone-only uploads, even though the backend `MessagePersonalizationService` correctly falls back to `'Unknown Recipient'` when `recipientName` is empty.

**Fix:** Removed the frontend name-required check for personalized mode. The backend continues to use `'Unknown Recipient'` as the fallback (never the phone number).

## Verification Commands

```bash
# Backend syntax check
node -c server/index.js

# Route registration check
node -e "require('./backend/routes/sms-uploads.js'); console.log('OK')"

# Service syntax check
node -c backend/services/ContactImportService.js
```

## Files Modified

| File | Change Summary |
|------|---------------|
| `backend/services/ContactImportService.js` | Removed positional fallback in `detectColumns()`; fixed `generatePreview()` to handle `null` nameColumn; added empty-row filter in `parseCSV()`. |
| `src/pages/dashboard/send-sms.html` | Rewrote `confirmImport()` to merge duplicates silently and preserve best names; removed blocking name check in `sendOrScheduleCampaign()`; fixed `generatePreviewClientSide()` and `updatePreviewSummary()` for empty name columns. |

## Constraints Verified

- **No MongoDB writes during upload:** `sms-uploads.js` calls only `parseFile`, `detectColumns`, and `generatePreview`. No `Contact.create`, `Contact.save`, `Contact.insertMany`, `Contact.bulkWrite`, `processImport`, or `confirmContactImport` is invoked.
- **No Contacts DB comparison:** Uploaded numbers are never checked against the Contacts collection.
- **No "already exists in contacts" messaging:** The upload flow contains no such UI text.
- **Backend errors never surface in UI:** All backend errors in `sms-uploads.js` return generic friendly messages.
- **Phone number never stored as `recipientName`:** Empty string is used when no name column exists or when name values are empty.

## Remaining Risks

1. **Client-side deduplication only:** The frontend `confirmImport()` deduplicates uploaded files before adding to `allRecipients`. The backend `/api/sms/send` and `/api/sms/schedule` also deduplicate via `SmsRecipientService.processRecipientsForCampaign()`. This dual-layer approach is intentional for defense-in-depth, but future changes to the frontend deduplication logic must be mirrored in backend validation.
2. **Mixed-format duplicates:** The deduplication key is `normalizedPhoneNumber` (233XXXXXXXXX). If a future provider supports non-Ghana numbers, the normalization logic in `validateAndNormalizePhone()` may need extension.
3. **Large-file preview performance:** Preview is limited to 500 rows. Files larger than 500 rows will show truncated previews but full counts. This is acceptable for UX but should be documented if users inquire.
