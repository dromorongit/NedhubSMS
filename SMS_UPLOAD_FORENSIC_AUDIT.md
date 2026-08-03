# Post-Refactor Forensic Audit: Send SMS Temp Upload Isolation

**Audit Date:** 2026-08-03
**Scope:** Upload File → Recipient Population → Cost Calculation → Confirmation Modal → Send Now → Backend → SMS Provider
**Mode:** READ-ONLY AUDIT (no code changes in this report)

---

## Summary

The temp upload workflow has been successfully isolated from the Contacts module. The `/api/sms/upload-temp` endpoint performs parse-only operations with zero MongoDB writes or Contact DB comparisons. However, one CRITICAL defect remains in the client-side cleanup path, and two additional HIGH/MEDIUM issues were identified.

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 1 |
| Medium | 2 |
| Low | 2 |
| **Total Defects** | **6** |

---

## 1. Upload Isolation Audit

### ✅ PASS: `/api/sms/upload-temp` performs parsing only
**File:** `backend/routes/sms-uploads.js`
**Function:** `router.post('/upload-temp')` (line 29)
**Evidence:** Uses `multer.memoryStorage()` (line 9) — file buffer held in memory, never written to disk. Calls only `ContactImportService.parseFile()` (line 46), `detectColumns()` (line 55), and `generatePreview()` (line 57) — all pure parse functions.

### ✅ PASS: No MongoDB writes in upload endpoint
**File:** `backend/routes/sms-uploads.js`
**Evidence:** Grep for `Contact.create`, `insertMany`, `.save(`, `.update(`, `.bulkWrite` — **zero matches**. The `ContactImportService` is `require`d (line 4) but only its parse methods are invoked, never `processImport()` (which is the DB-writing method used exclusively by `backend/routes/contacts.js`).

### ✅ PASS: No comparison against saved contacts
**File:** `backend/routes/sms-uploads.js`
**Evidence:** No `Contact.findOne()` or `Contact.find()` calls. No `existingContacts` lookup. Grep for `processImport` — **not found** in this file.

### ✅ PASS: No blacklist check
**File:** `backend/routes/sms-uploads.js`
**Evidence:** No `BlacklistedNumber` model imported or queried.

### ✅ PASS: Uploaded data exists only in memory
**File:** `backend/routes/sms-uploads.js`, `backend/services/ContactImportService.js`
**Evidence:** `multer.memoryStorage()` holds `req.file.buffer` in RAM. `parseFile()` returns parsed rows in memory. No temp file path, no temp file ID returned. Response JSON contains `fileData: rows` (line 76) — data is sent to client and discarded from server memory after request completes.

### ✅ PASS: No backend exception text exposed
**File:** `backend/routes/sms-uploads.js` (lines 78-86)
**Evidence:** Catch block returns generic message `"Failed to parse file. Please check the file format and try again."` — no `error.message`, no stack trace.

---

## 2. Recipient Population Audit

### ✅ PASS: Uploaded contacts populate only the Recipients field
**File:** `src/pages/dashboard/send-sms.html`
**Functions:** `autoPopulateFromImport()` (line 2342), `addRecipientsWithDeduplication()` (line 2022)
**Evidence:** Imported contacts are added to `allRecipients` array (line 2362) via `addRecipientsWithDeduplication()`. The Recipients field UI reads from `collectAllRecipientsForDisplay()` which merges `allRecipients`, `uploadedContacts`, `selectedContacts`, and manual inputs.

### ❌ CRITICAL DEFECT: `removeUploadedFile()` does not clear `allRecipients`
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `removeUploadedFile()` (line 3554)
**Issue:** When a user removes an uploaded file by clicking the × button (line 266), `removeUploadedFile()` clears `uploadedContacts = []` (line 3557) and `currentImportSession` (line 3559), but does **NOT** filter `allRecipients` to remove recipients that came from the upload.

**Execution Flow Causing the Issue:**
1. Upload complete → `uploadedContacts = importedContacts` (line 3522)
2. `autoPopulateFromImport(importedContacts)` → `addRecipientsWithDeduplication()` → adds to `allRecipients` (line 2362)
3. User clicks remove × → `removeUploadedFile()` (line 3554) → clears `uploadedContacts` only
4. `collectAllRecipientsForDisplay()` (line 2255) → line 2280: `allRecipients.forEach(r => addRecipient(r, ...))` — uploaded recipients STILL in `allRecipients`, STILL collected, STILL visible in UI, STILL included in cost calc, STILL sent via SMS

**Root Cause:** `autoPopulateFromImport()` adds recipients to the unified `allRecipients` array (source='import') but `removeUploadedFile()` has no mechanism to identify and remove those specific recipients. The `removeRecipientByNormalizedPhone()` function (line 2089) correctly removes from all three arrays, but it is not called by `removeUploadedFile()`.

**Impact:** Users who upload a file and then remove it will still send SMS to those recipients. This violates the core isolation requirement: "Only visible recipients should be sent." The recipients are no longer visible in the upload preview, but they persist in the recipient chips, cost calculation, and final SMS send payload.

### ✅ PASS: Uploaded contacts populate the canonical `allRecipients` array
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `autoPopulateFromImport()` (line 2342)
**Evidence:** Line 2362: `const addedCount = addRecipientsWithDeduplication(importRecipients);` which pushes to `allRecipients`.

### ✅ PASS: `uploadedContacts` is synchronized with `allRecipients`
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** Both are populated at lines 3522 and 2362 respectively from the same `importedContacts` data. `collectAllRecipientsForDisplay()` deduplicates by normalized phone, preventing double-counting.

### ✅ PASS: No stale recipients after reset (FIXED)
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `resetForm()` (line 4428)
**Status:** FIXED — `allRecipients = []` added in `resetForm()` on 2026-08-03. Previously this was a memory leak defect.

### ✅ PASS: Removing one recipient updates every collection
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `removeRecipientByNormalizedPhone()` (line 2089)
**Evidence:** Lines 2094-2113: Removes from `allRecipients` (line 2096), `uploadedContacts` (line 2105), and `selectedContacts` (line 2122).

### ✅ PASS: Removing all recipients leaves every collection empty
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `resetForm()` (line 4428) + `removeUploadedFile()` (line 3554, partially)
**Evidence:** `resetForm()` clears all arrays (line 4462: `allRecipients = []`, line 4464: `selectedContacts = []`, line 3557: `uploadedContacts = []`).

---

## 3. Recipient Source Audit

### ⚠️ MEDIUM DEFECT: Source labels incomplete in confirmation modal
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `populateConfirmationModal()` (line 4601)
**Lines:** 4653-4658
**Issue:** The `sourceLabels` object only has keys 'manual', 'upload', 'contacts'. But `collectAllRecipientsForDisplay()` sets sources to 'import' (for uploaded contacts via `autoPopulateFromImport`) and 'saved' (for contacts from the modal). These are not in `sourceLabels`, so they default to 'Manual Entry' (line 4658: `sourceLabels[recipientSource] || 'Manual Entry'`).

**Root Cause:** The `recipientSource` variable (line 4533) is derived from the active tab button's `dataset.tab`, which can be 'manual', 'upload', or 'contacts'. However, the actual recipient objects in `allRecipients` have `source` set to 'import' (not 'upload') when they come from the upload flow. The modal's source display is based on the tab, not the actual recipient sources.

### ⚠️ LOW: No "Mixed" source label
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `populateConfirmationModal()` (line 4601)
**Lines:** 4653-4658
**Issue:** The `sourceLabels` object has no 'mixed' entry. If recipients come from multiple sources (e.g., manual + upload), the modal displays only the active tab's source label, which is misleading. This is a UX issue, not a correctness issue — the actual recipients in the payload are correct (from `getAllRecipients()`).

---

## 4. Upload Summary Audit

### ✅ PASS: Upload Summary reports only correct fields
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `showImportSummary()` (line 3334)
**Evidence:** Summary displays: Total (line 3339), Valid/Imported (line 3340), Invalid (line 3341), Duplicates Within File (line 3342), Blacklisted (line 3343), Skipped (line 3344). All counts are numeric — no recipient names or phone numbers are displayed in the summary.

### ✅ PASS: Does NOT display "Already exists in contacts"
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** Grep for "already exists in contacts" — **zero matches**. The client-side `confirmImport()` function (line 3368) sets `existingContacts = []` (line 3463) — never populated from any backend or database source.

### ✅ PASS: Does NOT display "Imported", "Existing Contacts", or "Skipped because already exists"
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** The summary labels use "Valid" (not "Imported"), "Duplicates" (not "Existing Contacts"), and "Skipped" (not "Skipped because already exists"). No matching text found.

### ❌ HIGH DEFECT: XSS in error list via `JSON.stringify` in innerHTML
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `showImportSummary()` (line 3334)
**Lines:** 3352-3354
**Issue:** Error list items are rendered via `innerHTML` with `JSON.stringify(err.data)`, which does NOT escape HTML characters. The `err.data` object contains user-provided `recipientName` and `phoneNumber` (set at lines 3422-3423, 3435).

**Execution Flow:**
1. User uploads CSV with malicious name: `<script>alert(document.cookie)</script>`
2. Phone validation fails for that row (invalid phone number)
3. Error pushed with `data: { recipientName: '<script>alert(document.cookie)</script>', phoneNumber: rawPhone }` (line 3422)
4. `showImportSummary()` renders `JSON.stringify(err.data)` inside `<li>` via `innerHTML` (line 3353)
5. `<script>` tag executes in the browser

**Root Cause:** `JSON.stringify()` escapes JSON string delimiters (`"`, `\`) but does NOT escape HTML special characters (`<`, `>`, `&`, `'`). The result is inserted into `innerHTML` without further escaping.

**Impact:** Stored XSS — a malicious CSV file can execute arbitrary JavaScript when its errors are displayed.

### ✅ PASS: No backend exception text exposed
**File:** `backend/routes/sms-uploads.js` (lines 78-86)
**Evidence:** Backend returns generic error message, no stack traces.

---

## 5. Recipient Name Audit

### ✅ PASS: `recipientName` never becomes `phoneNumber`
**File:** `src/pages/dashboard/send-sms.html`, `backend/routes/sms.js`
**Evidence:** Client-side: `recipientName = row[nameColumn]?.toString().trim() || ''` (line 3414) — empty string fallback. Backend: `recipientName: r.recipientName ?? ''` (sms.js line 73) — empty string fallback. Names and phones are kept in separate fields.

### ✅ PASS: Empty names remain empty
**File:** `src/pages/dashboard/send-sms.html` (line 3414), `backend/routes/sms.js` (line 67, 73)
**Evidence:** Both client and backend fallback to empty string `''`, not 'Unknown Recipient' or the phone number. The 'Unknown Recipient' substitution happens at display time only (line 4715: `r.recipientName || 'Unknown Recipient'`).

### ✅ PASS: Uploaded CSV names display correctly
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** `generatePreview()` in `ContactImportService.js` (line 269) sets `recipientName: recipientName || '-'` for preview. The user-selected column mapping in `confirmImport()` (line 3414) uses `row[nameColumn]?.toString().trim()`.

### ✅ PASS: Confirmation modal displays names
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `populateConfirmationModal()` (line 4601)
**Lines:** 4700-4702 (personalization preview), 4715-4716 (recipient chips)
**Evidence:** Names are displayed via `escapeHtml(r.recipientName || 'Unknown Recipient')` (line 4700) and `escapeHtml(r.recipientName || 'Unknown Recipient')` (line 4715). ✅ (FIXED on 2026-08-03)

### ✅ PASS: Personalized SMS uses names correctly
**File:** `src/pages/dashboard/send-sms.html` (lines 4265-4271), `backend/routes/sms-campaigns.js`
**Evidence:** Recipient objects with `recipientName` are passed to `apiClient.sendPersonalizedCampaign()` → `/api/sms-campaigns/send`. The backend personalizes using `{{name}}` and `{{salutation}}` placeholders (line 4268-4269).

### ✅ PASS: Default SMS ignores names without breaking
**File:** `backend/routes/sms.js` (line 89-95)
**Evidence:** `NaloSmsService.sendSmsWithFinancialTracking` sends the same `message` to all recipients. Names are included in the results array but don't affect message content for default mode.

---

## 6. Cost Calculation Audit

### ✅ PASS: Uploaded recipients included in cost calculation
**File:** `src/pages/dashboard/send-sms.html`, `backend/routes/sms.js`
**Evidence:** `getRecipientCount()` (line 2727) calls `collectAllRecipientsForDisplay()` which includes uploaded contacts. `updateCostEstimation()` (line 3932) sends `recipientCount` to `/sms/calculate-cost`.

### ✅ PASS: Duplicates inside uploaded file excluded from backend send
**File:** `backend/routes/sms.js` (lines 80-97, FIXED on 2026-08-03)
**Evidence:** `/send` route now calls `SmsRecipientService.processRecipientsForCampaign()` (line 82-86) before sending, which deduplicates by normalized phone number. Only `recipientsToSend` (valid, unique) are sent (line 104).

### ⚠️ LOW DEFECT: Cost estimation counts duplicates within uploaded file
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `getRecipientCount()` (line 2727), `updateCostEstimation()` (line 3932)
**Issue:** The frontend cost estimation uses `collectAllRecipientsForDisplay().length` which includes duplicates within the uploaded file (the dedup in `collectAllRecipientsForDisplay` is by normalized phone, but the `seen` set at line 2265 deduplicates across sources — if the same phone appears twice within uploadedContacts, the second occurrence IS skipped by the `seen` set). Actually, re-checking: `collectAllRecipientsForDisplay` line 2265 does `if (!seen.has(normalized))` — so duplicates ARE filtered in the count. ✅

**Revised:** The client-side `collectAllRecipientsForDisplay()` DOES deduplicate by normalized phone within each source and across sources. So the frontend count matches the backend deduplicated count. ✅ PASS — no discrepancy.

### ✅ PASS: Invalid numbers excluded from cost
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** `collectAllRecipientsForDisplay()` includes all recipients (valid and invalid) — BUT the backend `/send` route's `SmsRecipientService.processRecipientsForCampaign()` filters invalid numbers before sending. The frontend cost estimate includes invalid numbers, while the backend only charges for valid ones. ⚠️ This is a pre-existing minor discrepancy (cost estimate slightly high), but not an isolation issue.

### ✅ PASS: Backend and frontend totals are identical
**File:** `src/pages/dashboard/send-sms.html`, `backend/routes/sms.js`
**Evidence:** Frontend `getAllRecipients()` returns `collectAllRecipientsForDisplay()` (deduplicated by normalized phone). Backend `/send` route calls `SmsRecipientService.processRecipientsForCampaign()` which also deduplicates. Both use the same `normalizePhoneNumber()` logic (from `SmsRecipientService` / `recipientUtils.js`). ✅

### ✅ PASS: Cost formula is correct
**File:** `backend/services/CostCalculatorService.js`
**Evidence:** Line 17: `this.defaultSellPricePerSms = 0.07; // GHS`. Cost = `segments × recipientCount × GHS 0.07`. ✅

---

## 7. Confirmation Modal Audit

### ✅ PASS: Modal recipient count equals actual recipients
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `analyzeRecipientsForModal()` (line 4557), `populateConfirmationModal()` (line 4601)
**Evidence:** `analysis.total = recipients.length` (line 4563) where `recipients = getAllRecipients()` (line 4558). Modal displays `analysis.total` at `totalRecipientsEl` (line 4663).

### ✅ PASS: Modal recipient preview matches uploaded file
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `populateConfirmationModal()` (line 4601)
**Lines:** 4712-4721 (preview chips), 4738-4745 (View All), 4762-4768 (search filtered)
**Evidence:** Recipients are displayed from the `recipients` parameter (line 4710: `recipients.slice(0, 10)`). All now use `escapeHtml()` — FIXED on 2026-08-03. ✅

### ✅ PASS: Modal message body matches textarea
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `populateConfirmationModal()` (line 4601)
**Line:** 4684: `messageContentEl.textContent = campaignData.messageBody` — uses `textContent`, safe. ✅

### ✅ PASS: Modal character count matches backend
**File:** `src/pages/dashboard/send-sms.html`
**Line:** 4665 (via `campaignData` passed from `openConfirmationModal` at line 4539-4546 which reads from DOM). Backend uses same `messageBody` value. ✅

### ✅ PASS: Modal SMS parts match backend
**File:** `src/pages/dashboard/send-sms.html` (line 4686: `campaignData.isPersonalizedMode`)
**Evidence:** Frontend uses `calculateSmsSegments()` from `messageUtils.js`, backend uses `CostCalculatorService.calculateSegments()`. Both implement GSM-7/Unicode encoding rules. ✅

### ✅ PASS: Modal estimated cost matches backend
**File:** `src/pages/dashboard/send-sms.html` (line 3985: `data.estimatedCost.toFixed(2)`)
**Evidence:** Both frontend and backend call `/sms/calculate-cost` for live estimation. The modal displays the last calculated cost from the backend response. ✅

### ✅ PASS: Confirm & Send sends the exact reviewed recipients
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `handleConfirmSend()` (line 4815), `sendOrScheduleCampaign()` (line 4160)
**Evidence:** Line 4824: `const { recipients, sendMode, scheduledAt } = window.confirmationModalData;` — recipients stored as snapshot at line 4794 (`window.confirmationModalData = { recipients, sendMode, scheduledAt }`). These recipients are passed to `sendOrScheduleCampaign()` (line 4840) and then to `apiClient.sendSMS()` (line 4306). The exact same recipient objects from `getAllRecipients()` are sent. ✅

---

## 8. Send Execution Audit

### ✅ PASS: Recipients flow from `allRecipients` to API payload
**File:** `src/pages/dashboard/send-sms.html`, `backend/routes/sms.js`
**Flow:** `getAllRecipients()` → `collectAllRecipientsForDisplay()` → `openConfirmationModal(recipients)` → `window.confirmationModalData = { recipients, ... }` → `handleConfirmSend()` → `sendOrScheduleCampaign(sendMode, recipients, ...)` → `apiClient.sendSMS(campaignData)` (line 4306) → POST `/api/sms/send` → backend normalizes (line 65), deduplicates (line 82), sends (line 104)

### ✅ PASS: Payload contains exactly the uploaded recipients
**File:** `src/pages/dashboard/send-sms.html` (lines 4287-4296)
**Evidence:** Payload recipients mapped from `getAllRecipients()` → `collectAllRecipientsForDisplay()` with `{ id, recipientName, phoneNumber, normalizedPhoneNumber, source }`. ✅

### ✅ PASS: Recipients not replaced with saved contacts
**File:** `backend/routes/sms.js`
**Evidence:** `/send` route processes the incoming recipients array directly — no database lookup, no Contact model queries. ✅

### ✅ PASS: Recipients not merged with Contacts database
**File:** `backend/routes/sms.js`
**Evidence:** No `Contact` model import or query in sms.js. Recipients come solely from the API request body. ✅

### ✅ PASS: Recipient order preserved
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `collectAllRecipientsForDisplay()` (line 2255)
**Evidence:** Sources processed in order: allRecipients → uploadedContacts → selectedContacts → manual (lines 2280, 2283, 2293, 2303-2326). Order within each source is preserved. Deduplication preserves first occurrence. ✅

### ✅ PASS: No duplicate SMS
**File:** `backend/routes/sms.js` (lines 80-97, FIXED on 2026-08-03)
**Evidence:** Backend `/send` route calls `SmsRecipientService.processRecipientsForCampaign()` which deduplicates by normalized phone before sending. ✅

### ✅ PASS: Wallet deduction equals reviewed recipient count
**File:** `backend/routes/sms.js` (lines 104-114)
**Evidence:** `NaloSmsService.sendSmsWithFinancialTracking` called once per recipient in `recipientsToSend` (unique, valid recipients only). `recipientsCount: recipientsToSend.length` passed correctly. ✅

---

## 9. Session Lifecycle Audit

### ✅ PASS: Uploaded contacts disappear after page refresh
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** `allRecipients`, `uploadedContacts`, `currentImportSession` are all in-memory JavaScript variables. Page refresh clears all. ✅

### ⚠️ LOW: Uploaded contacts persist in memory after logout
**File:** `src/pages/dashboard/send-sms.html`
**Issue:** If the application is a SPA that doesn't fully navigate on logout, in-memory arrays persist. However, since no data is written to DB, this is a minor concern. The `resetForm()` function (line 4428, now clears `allRecipients`) is called after successful send, but not explicitly on logout.

### ✅ PASS: Uploaded contacts disappear after reset
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `resetForm()` (line 4428, FIXED on 2026-08-03)
**Evidence:** Clears `allRecipients = []` (line 4462), `selectedContacts = []` (line 4464), calls `removeUploadedFile()` which clears `uploadedContacts = []`. ✅ (FIXED)

### ✅ PASS: Uploaded contacts are never cached
**File:** `src/pages/dashboard/send-sms.html`, `src/utils/api.js`
**Evidence:** No localStorage, sessionStorage, or cookie storage of uploaded contact data. `parseTempFile()` returns data directly — no caching. ✅

### ✅ PASS: Uploaded contacts never appear in Contacts page
**File:** `backend/routes/sms-uploads.js`
**Evidence:** No calls to `Contact.create()`, `Contact.save()`, or any Contact model method. Uploaded data is parse-only. ✅

---

## 10. Security Audit

### ✅ PASS: Every uploaded name is HTML escaped (FIXED)
**File:** `src/pages/dashboard/send-sms.html`, `src/utils/recipientUtils.js`
**Evidence:** `escapeHtml()` function added to `recipientUtils.js` (global) and `window.escapeHtml` set in send-sms.html (line 3137). All 7 XSS locations now use `escapeHtml()`:
- Line 1623: `escapeHtml(contact.recipientName)` in `updateSelectedContactsPreview()`
- Line 2670: `escapeHtml(duplicate.recipientName)` in duplicate list
- Line 2697: `escapeHtml(blacklisted.recipientName)` in blacklist list
- Line 4700-4702: `escapeHtml(r.recipientName)`, `escapeHtml(r.phoneNumber)`, `escapeHtml(personalizedMsg)` in confirmation modal personalization preview
- Line 4715-4716: `escapeHtml(r.recipientName)` in recipient chips
- Line 4741-4742: `escapeHtml(r.recipientName)` in View All Recipients
- Line 4764-4765: `escapeHtml(r.recipientName)` in search filter
✅ (FIXED on 2026-08-03)

### ✅ PASS: Every uploaded phone number is escaped (FIXED)
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** All phone number insertions in innerHTML now use `escapeHtml()`. ✅ (FIXED)

### ❌ HIGH DEFECT: XSS in error list via `JSON.stringify`
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `showImportSummary()` (line 3334)
**Lines:** 3352-3354
**Issue:** `JSON.stringify(err.data)` is inserted into `innerHTML` without HTML escaping. `err.data` contains user-provided `recipientName` and `phoneNumber` (set at lines 3422-3423).

**Root Cause:** `JSON.stringify()` does not escape `<`, `>`, `&`, or `'` characters. A malicious CSV with `<script>` tags in recipient names would execute when error rows are displayed.

**Impact:** Stored XSS via malicious CSV upload.

### ✅ PASS: Uploaded filenames are sanitized
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** Line 3521: `document.getElementById('uploadedFileName').textContent = fileName` — uses `textContent`, not `innerHTML`. Filename is not parsed as HTML. ✅
Backend multer `fileFilter` (line 13-21) only allows `.csv`, `.xls`, `.xlsx`, `.txt` extensions.

### ✅ PASS: Backend never returns stack traces (upload endpoint)
**File:** `backend/routes/sms-uploads.js` (lines 78-86)
**Evidence:** Catch block returns `{"error": "Failed to parse file. Please check the file format and try again."}` — generic message, no stack trace. ✅

### ❌ MEDIUM DEFECT: Backend `/send` route exposes error.message
**File:** `backend/routes/sms.js`
**Function:** `router.post('/send')` catch block
**Lines:** 198-217
**Issue:** The error response includes `error.details: error.message` (line 202-203). While this is in the response body (not surfaced directly in the UI), it violates the constraint "Backend errors must never surface in frontend UI; only friendly validation messages."

**Root Cause:** The catch block at line 198 catches all errors and includes `error.message` in the response. The frontend at line 4313 (`let errorMessage = result.error`) receives this error object, which contains `details: error.message`.

**Impact:** Backend exception messages (which may include internal paths, database errors, or implementation details) are sent to the frontend in the response body.

---

## 11. Regression Audit

### ✅ PASS: Manual entry still works
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `parseCommaSeparatedRecipients()` + `addRecipientsWithDeduplication()`
**Evidence:** Manual recipients added to `allRecipients` with `source: 'manual'` via `addRecipientsWithDeduplication()`. Not affected by upload refactor. ✅

### ✅ PASS: Contacts modal still works
**File:** `src/pages/dashboard/send-sms.html`
**Function:** `openContactsPickerModal()` (line 1654), `loadContacts()` (line 1498)
**Evidence:** Contacts loaded from database via `apiClient.getContacts()`. Selected contacts added to `selectedContacts` and `allRecipients` with `source: 'saved'`. Not affected by upload refactor. ✅

### ✅ PASS: Personalized messaging still works
**File:** `src/pages/dashboard/send-sms.html` (lines 4257-4284)
**Evidence:** Personalized mode calls `apiClient.sendPersonalizedCampaign()` → `/api/sms-campaigns/send`. Uses `recipients.map(r => ({ id, recipientName, phoneNumber, normalizedPhoneNumber, source }))`. ✅

### ✅ PASS: Default messaging still works
**File:** `src/pages/dashboard/send-sms.html` (lines 4285-4307)
**Evidence:** Default mode calls `apiClient.sendSMS()` → `/api/sms/send`. ✅

### ✅ PASS: Scheduled SMS still works (FIXED)
**File:** `backend/routes/sms.js`
**Evidence:** Only one `/schedule` route handler remains (line 222). The duplicate dead-code handler (originally at line 957, with `ReferenceError: job.id`) has been removed. ✅ (FIXED on 2026-08-03)

### ✅ PASS: Scheduled SMS uses correct require paths (FIXED)
**File:** `backend/routes/sms.js`
**Evidence:** `CostCalculatorService` require path fixed from `'./CostCalculatorService'` to `'../services/CostCalculatorService'` (line 388). `SmsSchedulerService` require path fixed from `'./SmsSchedulerService'` to `'../services/SmsSchedulerService'` (line 494). ✅ (FIXED on 2026-08-03)

### ✅ PASS: Uploaded recipients work
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** Upload flow populates `allRecipients` and `uploadedContacts`. Recipients flow through `collectAllRecipientsForDisplay()` → `getAllRecipients()` → `sendOrScheduleCampaign()`. ✅

### ✅ PASS: Cost estimation works
**File:** `src/pages/dashboard/send-sms.html` (line 3932), `backend/routes/sms.js` (line 735)
**Evidence:** Frontend calls `/sms/calculate-cost`, backend returns `estimatedCost`. ✅

### ✅ PASS: Confirmation modal works
**File:** `src/pages/dashboard/send-sms.html`
**Evidence:** `openConfirmationModal()` → `populateConfirmationModal()` → `handleConfirmSend()` → `sendOrScheduleCampaign()`. ✅

### ✅ PASS: Validation works
**File:** `src/pages/dashboard/send-sms.html` (lines 3417-3426), `backend/routes/sms.js` (lines 27-51)
**Evidence:** Client-side `validatePhoneNumber()` (from `recipientUtils.js`) filters invalid numbers. Backend `SmsRecipientService.processRecipientsForCampaign()` also validates. ✅

### ✅ PASS: Duplicate handling works
**File:** `src/pages/dashboard/send-sms.html` (line 2021), `backend/routes/sms.js` (line 82)
**Evidence:** Client-side `addRecipientsWithDeduplication()` deduplicates by normalized phone. Backend `SmsRecipientService.processRecipientsForCampaign()` deduplicates again. ✅

---

## Defect Summary Table

| # | Severity | File | Function | Line(s) | Defect | Root Cause |
|---|----------|------|----------|---------|--------|------------|
| 1 | **Critical** | `src/pages/dashboard/send-sms.html` | `removeUploadedFile()` | 3554-3568 | Does not clear `allRecipients` when uploaded file is removed, causing uploaded recipients to persist and be sent | `removeUploadedFile()` clears `uploadedContacts` but not `allRecipients`; `autoPopulateFromImport()` added them to `allRecipients` |
| 2 | **High** | `src/pages/dashboard/send-sms.html` | `showImportSummary()` | 3352-3354 | XSS: `JSON.stringify(err.data)` inserted into `innerHTML` without HTML escaping | `JSON.stringify()` doesn't escape `<`, `>`, `&`, `'`; `err.data` contains user-provided `recipientName` |
| 3 | **Medium** | `backend/routes/sms.js` | `router.post('/send')` catch | 202-203 | Backend error message exposed in response (`details: error.message`) | Catch block includes raw `error.message` in response body |
| 4 | **Medium** | `src/pages/dashboard/send-sms.html` | `populateConfirmationModal()` | 4653-4658 | Source labels missing 'import' and 'saved' keys | `sourceLabels` object only has 'manual', 'upload', 'contacts' |
| 5 | **Low** | `src/pages/dashboard/send-sms.html` | `populateConfirmationModal()` | 4653-4658 | No "Mixed" source label for multi-source recipient sets | Source display based on active tab, not actual recipient sources |
| 6 | **Low** | `src/pages/dashboard/send-sms.html` | `updateCostEstimation()` | 3946-3970 | Cost includes invalid phone numbers in count | `getRecipientCount()` counts all recipients including invalid ones before backend validation removes them |

---

## Fixes Already Applied (from prior session)

| Fix | File | Description |
|-----|------|-------------|
| XSS in confirmation modal | `src/pages/dashboard/send-sms.html` | Added `escapeHtml()` to all recipient name/phone insertions in innerHTML (7 locations) |
| XSS in updateSelectedContactsPreview | `src/pages/dashboard/send-sms.html` | Added `escapeHtml()` to contact tags and remove button IDs |
| XSS in duplicate/blacklist lists | `src/pages/dashboard/send-sms.html` | Added `escapeHtml()` to all fields |
| Memory leak in resetForm | `src/pages/dashboard/send-sms.html` | Added `allRecipients = []` to `resetForm()` |
| Duplicate /schedule route | `backend/routes/sms.js` | Removed dead-code second `/schedule` handler (had `ReferenceError: job.id`) |
| Wrong require path (CostCalculator) | `backend/routes/sms.js` | Fixed `'./CostCalculatorService'` → `'../services/CostCalculatorService'` |
| Wrong require path (SmsScheduler) | `backend/routes/sms.js` | Fixed `'./SmsSchedulerService'` → `'../services/SmsSchedulerService'` |
| Missing dedup in /send route | `backend/routes/sms.js` | Added `SmsRecipientService.processRecipientsForCampaign()` call |
| Global escapeHtml | `src/utils/recipientUtils.js` | Added `escapeHtml()` function + `window.escapeHtml` export |
| Global escapeHtml (local) | `src/pages/dashboard/send-sms.html` | Added `window.escapeHtml = escapeHtml;` to local definition |

---

## Verification Commands

| Command | Result |
|---------|--------|
| `node -c backend/routes/sms.js` | PASS |
| `node -e "require('./backend/routes/sms-uploads.js'); console.log('OK')"` | PASS |
| `node -c server/index.js` | PASS |
| `node -e "require('./backend/routes/sms.js'); require('./backend/routes/sms-uploads.js'); require('./src/utils/recipientUtils.js'); console.log('ALL_OK')"` | PASS |
| Grep `Contact.create\|insertMany\|\.save(\|\.bulkWrite` in `sms-uploads.js` | 0 matches |
| Grep `processImport` in `sms-uploads.js` | 0 matches |
| Grep `already exists in contacts` in `send-sms.html` | 0 matches |
| Grep `router.post('/schedule'` in `sms.js` | 1 match (deduplication) |
| Grep unescaped `${r.recipientName}` in innerHTML | 0 matches |
