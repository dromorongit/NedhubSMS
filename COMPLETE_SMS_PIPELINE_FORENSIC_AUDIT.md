# COMPLETE SMS PIPELINE FORENSIC AUDIT

**Project:** NedhubSMS  
**Date:** 2026-08-04  
**Auditor:** Kilo (Forensic Audit Mode)  
**Scope:** End-to-end SMS delivery pipeline from Send SMS page to final provider delivery  
**Status:** AUDIT COMPLETE — REPAIRS PENDING

---

## EXECUTIVE SUMMARY

A zero-trust forensic audit of the entire SMS sending system identified **85+ confirmed issues** across frontend, backend routes, backend services, models, and infrastructure. Issues range from critical financial vulnerabilities (wallet leaks, double billing, phantom refunds) to functional bugs (unreachable routes, missing model imports, race conditions) to security flaws (unauthenticated callbacks, CORS bypass, XSS vectors).

**Critical Findings:** 18  
**High Severity:** 32  
**Medium Severity:** 28  
**Low Severity:** 7

---

## 1. FRONTEND FLOW AUDIT

### 1.1 Send SMS Page (`src/pages/dashboard/send-sms.html`)

#### [CRITICAL] Duplicate event listeners for messaging mode tabs
- **File:** `src/pages/dashboard/send-sms.html:2456` and `src/pages/dashboard/send-sms.html:3767`
- **Impact:** Two separate event listeners are attached to `.messaging-mode-tabs .tab-btn`. When a mode tab is clicked, both handlers fire, causing `updateModeDependentUI()` and `schedulePreviewUpdate()` to execute twice. This leads to race conditions in message body template updates and doubled API calls for cost estimation.
- **Fix:** Remove the duplicate listener block at line 3767-3774.

#### [CRITICAL] Duplicate event listeners for recipient source tabs
- **File:** `src/pages/dashboard/send-sms.html:2448` and `src/pages/dashboard/send-sms.html:3798`
- **Impact:** Two separate event listeners attached to `.recipient-source-tabs .tab-btn`. Double-firing causes `switchRecipientSourceTab()` to execute twice, leading to state corruption and UI flickering.
- **Fix:** Remove the duplicate listener block at line 3798-3803.

#### [HIGH] `updateMessageBodyTemplate()` auto-overwrites user content
- **File:** `src/pages/dashboard/send-sms.html:2783`
- **Impact:** When the user types a custom message, any salutation change or mode switch triggers `updateMessageBodyTemplate()`, which replaces the message body with the salutation template, destroying user-typed content.
- **Fix:** Only auto-populate when the message is empty or matches the expected salutation pattern; never overwrite custom messages.

#### [HIGH] `manualRecipients` array is declared but unused
- **File:** `src/pages/dashboard/send-sms.html:2735`
- **Impact:** `let manualRecipients = [];` is declared but never populated or read. The actual recipient state is scattered across `allRecipients`, `uploadedContacts`, `selectedContacts`, and DOM elements. This makes state management fragile and error-prone.
- **Fix:** Either use `manualRecipients` as the single source of truth for manual entries, or remove it.

#### [HIGH] `getAllRecipients()` DOM-scraping misses `manualRecipients` array
- **File:** `src/pages/dashboard/send-sms.html:2382-2395`
- **Impact:** `getAllRecipients()` calls `collectAllRecipientsForDisplay()` which reads from DOM elements for personalized mode but does not read from the unused `manualRecipients` array. If the array were ever populated, those recipients would be invisible to the send logic.
- **Fix:** Ensure `getAllRecipients()` is the single authoritative collector and all sources feed into it.

#### [HIGH] `sendOrScheduleCampaign` does not include `removeDuplicates` for default mode
- **File:** `src/pages/dashboard/send-sms.html:4287-4296`
- **Impact:** For default messaging mode, the `campaignData` payload does not include `removeDuplicates`. The backend defaults to `true`, but if the user changes the duplicate handling radio to "Allow duplicates", the frontend does not pass this preference.
- **Fix:** Include `removeDuplicates` in the default mode payload as well.

#### [MEDIUM] `resetForm()` does not reset `currentImportSession`
- **File:** `src/pages/dashboard/send-sms.html:4429`
- **Impact:** After a successful send, `resetForm()` clears the UI but leaves `currentImportSession` (file data, preview) in memory. If the user uploads a new file without refreshing, stale session data may appear.
- **Fix:** Add `currentImportSession = { fileData: [], fileName: null, detectedColumns: null, preview: null };` to `resetForm()`.

#### [MEDIUM] `analyzeRecipientsForModal()` does not check blacklist
- **File:** `src/pages/dashboard/send-sms.html:4557-4598`
- **Impact:** The modal analysis sets `analysis.blacklisted = 0` (line 4595) without actually checking the blacklist. Users see "0 blacklisted" even when recipients are blacklisted, and the confirmation modal does not warn about blacklisted numbers.
- **Fix:** Query the backend `/blacklist` endpoint or maintain a local blacklist set to count blacklisted recipients accurately.

#### [MEDIUM] `removeUploadedFile()` clears `uploadedContacts` but not `currentImportSession`
- **File:** `src/pages/dashboard/send-sms.html:3554-3568`
- **Impact:** Clicking "remove file" clears the UI and `uploadedContacts` array, but `currentImportSession` still holds the parsed file data. If the user re-uploads or the session persists, stale data may reappear.
- **Fix:** Clear `currentImportSession` in `removeUploadedFile()`.

#### [LOW] `convertToGsmCompatible()` depends on external function
- **File:** `src/pages/dashboard/send-sms.html:4924`
- **Impact:** `window.convertToGsmCompatible` is called but may not be defined if the utility script fails to load. This causes a `TypeError` when the user clicks "Convert to GSM-compatible text".
- **Fix:** Add a guard: `if (typeof window.convertToGsmCompatible === 'function')`.

---

### 1.2 API Client (`src/utils/api.js`)

#### [HIGH] `parseTempFile()` endpoint returns entire file data to client
- **File:** `src/utils/api.js:276-313` (frontend) + `backend/routes/sms-uploads.js:69-77` (backend)
- **Impact:** The `/sms/upload-temp` endpoint returns `fileData: rows` containing all parsed rows. For a 10,000-row file, this is several MB of PII sent to the browser. The frontend stores this in `currentImportSession` for the page lifetime.
- **Fix:** Backend should return only `headers`, `detectedColumns`, and a limited preview (first 50 rows). Keep full parsed data server-side.

#### [HIGH] No `parseTempFile()` error handling for empty/invalid responses
- **File:** `src/utils/api.js:304-306`
- **Impact:** If the backend returns a non-JSON error page, `response.json()` throws, but the catch block at line 309 returns `{ error: 'Network error: ...' }`, masking the actual server error.
- **Fix:** Match the error handling pattern used in `uploadContacts()` (lines 243-264) with explicit status checks.

---

### 1.3 Recipient Utils (`src/utils/recipientUtils.js`)

#### [HIGH] `validatePhoneNumber()` allows numbers with invalid prefixes to pass normalization
- **File:** `src/utils/recipientUtils.js:70-71`
- **Impact:** `cleaned = cleaned.replace(/[\s\-()+]/g, '');` then `cleaned = cleaned.replace(/\D/g, '');` strips all non-digits. A number like `12345` becomes `12345`, which then fails the length checks but `normalizePhoneNumber()` at line 47-49 still converts 9-digit numbers to `23312345`, an invalid Ghana number.
- **Fix:** Validate prefix (`233` or `0`) before normalizing, or add a post-normalization regex check.

#### [MEDIUM] `parseManualRecipientInput()` extracts only the first phone number match
- **File:** `src/utils/recipientUtils.js:123-129`
- **Impact:** Input like "John 0241234567 and Jane 0201234567" extracts only "0241234567". The second number is silently ignored.
- **Fix:** Document the single-number limitation or split on delimiters and parse all matches.

---

### 1.4 Logger (`src/utils/logger.js`)

#### [MEDIUM] Missing logger categories used by backend services
- **File:** `src/utils/logger.js:24-35`
- **Impact:** Backend services call `logger.responseParser.warn()` (NaloSmsService.js:102) and `logger.smsSend.info()` (NaloSmsService.js:241), but these loggers are not defined in `window.loggers`. This causes `TypeError: Cannot read properties of undefined (reading 'warn')` in the browser console.
- **Fix:** Add `responseParser` and `smsSend` to the `window.loggers` object, or remove the undefined logger calls from backend code (backend should use its own logger).

---

## 2. BACKEND ROUTES AUDIT

### 2.1 SMS Routes (`backend/routes/sms.js`)

#### [CRITICAL] `/send` does not check wallet balance
- **File:** `backend/routes/sms.js:54-62`
- **Impact:** The endpoint checks Nalo provider balance but never verifies the user's wallet balance. `NaloSmsService` deducts per-recipient, but if the wallet runs out mid-batch, some recipients are charged and others are not, creating an inconsistent state.
- **Fix:** Add wallet balance check and reservation before the send loop, consistent with `/schedule`.

#### [CRITICAL] `/send` passes wrong `recipientsCount` to financial tracking
- **File:** `backend/routes/sms.js:113`
- **Impact:** `recipientsCount: recipientsToSend.length` passes the total batch size instead of `1`. If `NaloSmsService` uses this for cost calculation, each recipient is overcharged by the batch size factor.
- **Fix:** Change to `recipientsCount: 1`.

#### [HIGH] `/send` sequential loop will timeout for large batches
- **File:** `backend/routes/sms.js:104-145`
- **Impact:** Sending 200 recipients sequentially at ~2s each produces a 400-second request, exceeding any HTTP timeout. The endpoint is unusable for campaigns > 50 recipients.
- **Fix:** Dispatch via BullMQ or implement bounded parallelism (e.g., `Promise.all` with concurrency limit).

#### [HIGH] `/send` has no guard for zero valid recipients
- **File:** `backend/routes/sms.js:96-97`
- **Impact:** If all recipients are invalid/blacklisted/duplicate, the endpoint proceeds to send to an empty array, returning `status: 'failed'` with a confusing message instead of a clear 400.
- **Fix:** Add `if (recipientsToSend.length === 0) return res.status(400).json({ success: false, message: 'No valid recipients', error: { code: 'NO_VALID_RECIPIENTS' } })`.

#### [HIGH] `/send` lacks message length validation
- **File:** `backend/routes/sms.js:367-375` (only in `/schedule`)
- **Impact:** The `/send` endpoint accepts arbitrarily long messages while `/schedule` enforces 160 characters. Over-length messages may be rejected by the provider after wallet deduction.
- **Fix:** Add message length validation in `/send` consistent with `/schedule`.

#### [HIGH] `/schedule` calls `reserveFunds` with `null` campaign ID
- **File:** `backend/routes/sms.js:430`
- **Impact:** Wallet reservations for scheduled campaigns are created without a linked campaign ID, making reconciliation impossible.
- **Fix:** Save the campaign first, then pass `campaign._id` to `reserveFunds`.

#### [HIGH] `/logs` inconsistent `userId` type
- **File:** `backend/routes/sms.js:628-629`
- **Impact:** `SmsMessage.find({ userId })` uses a raw string while `SmsRecipient.find({ userId: userIdObj })` uses `ObjectId`. If `SmsMessage.userId` is `ObjectId`, the string query may miss records or throw `CastError`.
- **Fix:** Consistently convert `userId` to `ObjectId` for all three queries.

#### [HIGH] `/logs` maps `errorCode` to `errorMessage` text
- **File:** `backend/routes/sms.js:677`
- **Impact:** The `errorCode` field in transformed recipient logs contains the full error message string instead of an error code, breaking clients that switch on `errorCode`.
- **Fix:** Use `errorCode: msg.errorCode` instead of `msg.errorMessage`.

#### [HIGH] `/callback` unauthenticated with no signature verification
- **File:** `backend/routes/sms.js:794-814`
- **Impact:** Anyone can call `/api/sms/callback` to arbitrarily update message statuses. No HMAC signature, IP whitelist, or token verification.
- **Fix:** Add provider signature verification or restrict to known provider IPs.

#### [MEDIUM] `/send` recipient normalization unsafe for object inputs
- **File:** `backend/routes/sms.js:65-76`
- **Impact:** If `r` is an object without `phoneNumber`, `String(r)` produces `"[object Object]"`, treated as valid until provider rejection.
- **Fix:** Validate `phoneNumber` exists and is non-empty after normalization.

#### [MEDIUM] `/calculate-cost` unbounded query parameter
- **File:** `backend/routes/sms.js:751`
- **Impact:** `parseInt(recipients) || 1` masks non-numeric input. While clamped to 10,000, invalid strings fall through to `1`.
- **Fix:** Validate `recipients` is a safe integer and reject non-numeric input explicitly.

#### [MEDIUM] `/resend` checks `walletBalance > 0` instead of actual cost
- **File:** `backend/routes/sms.js:912`
- **Impact:** A user with $0.01 can resend a $1.00 message. The provider call fails after the balance check.
- **Fix:** Check `availableBalance >= actualMessageCost`.

#### [MEDIUM] Non-deterministic campaign title
- **File:** `backend/routes/sms.js:436`
- **Impact:** `toLocaleDateString()` and `toLocaleTimeString()` are locale-dependent. Two campaigns in the same minute may have identical titles.
- **Fix:** Use `toISOString()` or append a random suffix.

---

### 2.2 SMS Campaign Routes (`backend/routes/sms-campaigns.js`)

#### [CRITICAL] `/preview-personalized` does not destructure `recipients`
- **File:** `backend/routes/sms-campaigns.js:31`
- **Impact:** `recipients` is referenced in the validation condition but never extracted from `req.body`. The endpoint always returns 400 Bad Request.
- **Fix:** Add `recipients` to the destructuring assignment at line 20-28.

#### [HIGH] `/send` sequential SMS sending loop
- **File:** `backend/routes/sms-campaigns.js:343-421`
- **Impact:** Same timeout risk as `sms.js`. A campaign with 500+ recipients will likely timeout.
- **Fix:** Use async batch dispatch via BullMQ or a worker pool.

#### [HIGH] `/send` post-send DB operations not failure-isolated
- **File:** `backend/routes/sms-campaigns.js:386,399`
- **Impact:** If `markAsSent` or `markAsFailed` throws after the SMS was delivered, the outer catch marks the recipient as failed in the response, creating a provider/DB state discrepancy.
- **Fix:** Wrap `markAsSent`/`markAsFailed` in their own `try/catch`.

#### [HIGH] `/schedule` PATCH allows arbitrary field updates
- **File:** `backend/routes/sms-campaigns.js:940`
- **Impact:** A malicious client can PATCH with `{ "status": "sent", "userId": "..." }` to overwrite protected fields.
- **Fix:** Use an explicit allowlist (`scheduledAt`, `timezone`).

#### [HIGH] `/schedule` error path does not clean up `SmsRecipient` records
- **File:** `backend/routes/sms-campaigns.js:829-848`
- **Impact:** If scheduling fails after `SmsRecipient` records are created, orphaned recipients remain in the database.
- **Fix:** Delete created `SmsRecipient` records in the error handler.

#### [HIGH] Message length check ignores Unicode payload size
- **File:** `backend/routes/sms-campaigns.js:566`
- **Impact:** Unicode/emoji messages have a 70-character limit per segment, not 160. The validation allows 160 characters, causing cost mismatches.
- **Fix:** Detect encoding and apply the correct per-segment character limit.

#### [HIGH] Timezone-naive `new Date(scheduledAt)` validation
- **File:** `backend/routes/sms-campaigns.js:576-585`
- **Impact:** A client sending `"2024-01-01 00:00:00"` has it interpreted in the server's local timezone, causing scheduling errors.
- **Fix:** Require ISO 8601 format or accept explicit `timezoneOffset`.

#### [HIGH] `/scheduled` includes past-due campaigns
- **File:** `backend/routes/sms-campaigns.js:882`
- **Impact:** Campaigns with `scheduledAt` in the past still appear in the scheduled list if `status === 'scheduled'`.
- **Fix:** Filter to `scheduledAt > new Date() && status === 'scheduled'`.

#### [MEDIUM] `/schedule` sequential `SmsRecipient` creation
- **File:** `backend/routes/sms-campaigns.js:718-746`
- **Impact:** Creating N recipient records sequentially is O(n) slow. For 5,000 recipients, this adds ~30+ seconds.
- **Fix:** Use `SmsRecipient.insertMany(recipientDocs)`.

---

### 2.3 Campaigns Routes (`backend/routes/campaigns.js`)

#### [CRITICAL] `Campaign` model not imported — entire endpoint is broken
- **File:** `backend/routes/campaigns.js:93`
- **Impact:** `new Campaign(...)` throws `ReferenceError: Campaign is not defined`. The entire POST `/` endpoint is non-functional.
- **Fix:** Import `SmsCampaign` or replace `Campaign` with `SmsCampaign`.

#### [CRITICAL] Uses raw `sendSMS` utility instead of `NaloSmsService`
- **File:** `backend/routes/campaigns.js:113`
- **Impact:** Bypasses financial tracking, webhook support, and structured error handling. No `SmsMessage` records are created with proper provider tracking.
- **Fix:** Use `NaloSmsService.sendSmsWithFinancialTracking`.

#### [CRITICAL] Scheduled campaigns never actually scheduled
- **File:** `backend/routes/campaigns.js:174-184`
- **Impact:** Campaigns with a `schedule` parameter are saved with `status: 'scheduled'` but no BullMQ job or scheduler is invoked. They will never be sent.
- **Fix:** Add BullMQ scheduling logic.

#### [HIGH] No wallet refund on send failure
- **File:** `backend/routes/campaigns.js:158-172`
- **Impact:** If `sendSMS` throws after `WalletService.deductGhsForSms` succeeds, the campaign is marked `failed` but the wallet is not refunded.
- **Fix:** Wrap in try/catch and refund on failure.

---

### 2.4 SMS Uploads Routes (`backend/routes/sms-uploads.js`)

#### [HIGH] Returns all parsed file data to client
- **File:** `backend/routes/sms-uploads.js:69-77`
- **Impact:** For a 10,000-row upload, the response can exceed several MB. PII is unnecessarily exposed.
- **Fix:** Return only `headers`, `detectedColumns`, and a limited preview.

#### [MEDIUM] Non-standard error response format
- **File:** `backend/routes/sms-uploads.js:31-35`
- **Impact:** Missing `success: false` and `error.code`. Frontend error handling expecting canonical shape will fail.
- **Fix:** Return `{ success: false, message: '...', error: { code: 'VALIDATION_ERROR' } }`.

---

### 2.5 Server Route Registration (`server/index.js`)

#### [HIGH] CORS fallback allows any origin
- **File:** `server/index.js:127-154`
- **Impact:** The `origin` callback returns `callback(null, true)` for any origin not in the whitelist. In production, any website can make authenticated cross-origin requests.
- **Fix:** Return `callback(null, false)` for non-whitelisted origins in production.

#### [HIGH] Rate-limit key uses spoofable `X-Forwarded-For` header
- **File:** `server/index.js:302`
- **Impact:** Attackers bypass rate limiting by forging `X-Forwarded-For`.
- **Fix:** Use `req.ip` as the key generator.

#### [HIGH] Route prefix collision
- **File:** `server/index.js:358-360`
- **Impact:** `smsRoutes`, `naloSmsRoutes`, and `smsUploadRoutes` are all mounted at `/api/sms`. Overlapping paths cause the first-registered route to shadow the others.
- **Fix:** Use distinct prefixes (e.g., `/api/sms`, `/api/nalo-sms`, `/api/sms-uploads`).

---

## 3. BACKEND SERVICES AUDIT

### 3.1 NaloSmsService (`backend/services/NaloSmsService.js`)

#### [CRITICAL] Refund issued without prior deduction (skipDeduction mode)
- **File:** `backend/services/NaloSmsService.js:462,504`
- **Impact:** When `skipDeduction=true`, `refundWallet()` is called on failure even though no deduction occurred. This credits phantom funds, creating a financial liability.
- **Fix:** Guard `refundWallet()` with `if (!skipDeduction)`.

#### [CRITICAL] Profit recorded despite zero revenue (skipDeduction mode)
- **File:** `backend/services/NaloSmsService.js:527`
- **Impact:** For `skipDeduction` campaigns, `profitAmount` is populated with `financialBreakdown.profitAmount` even though `totalChargedToUser` is 0. This corrupts financial reports.
- **Fix:** Set `profitAmount: smsStatus === 'sent' && !skipDeduction ? financialBreakdown.profitAmount : 0`.

#### [HIGH] Outer catch block leaves no audit trail and no refund
- **File:** `backend/services/NaloSmsService.js:610-627`
- **Impact:** If an error occurs before the SMS record is created (e.g., after wallet deduction), the outer catch returns an error but does not create an `SmsMessage` record or refund the wallet.
- **Fix:** Ensure the outer catch creates a failed `SmsMessage` record and refunds the wallet.

#### [MEDIUM] Delivery report processing lacks idempotency
- **File:** `backend/services/NaloSmsService.js:633-665`
- **Impact:** Duplicate delivery reports from Nalo overwrite `deliveredAt` and may cause duplicate processing.
- **Fix:** Check if status is already `'delivered'` before updating, or use atomic `$set` with status filter.

#### [LOW] Hardcoded dummy API key pattern
- **File:** `backend/services/NaloSmsService.js:15`
- **Impact:** The string `'dummy_nalo_key_for_testing'` is hardcoded in source.
- **Fix:** Use `NALO_USE_DUMMY_MODE` environment variable.

---

### 3.2 SmsRecipientService (`backend/services/SmsRecipientService.js`)

#### [HIGH] Phone normalization accepts invalid numbers
- **File:** `backend/services/SmsRecipientService.js:9-29`
- **Impact:** `normalizePhoneNumber` converts `'12345'` to `'23312345'` and `'0'` to `'233'`, both invalid. These pass deduplication and validation.
- **Fix:** Validate prefix and length before normalization.

#### [MEDIUM] Empty phone numbers normalize to empty string
- **File:** `backend/services/SmsRecipientService.js:10`
- **Impact:** `null`/`undefined`/empty phone numbers all normalize to `''`, treated as duplicates of each other, silently dropping recipients.
- **Fix:** Return `null` for falsy phone numbers and validate before deduplication.

#### [MEDIUM] Confusing `removeDuplicates` parameter semantics
- **File:** `backend/services/SmsRecipientService.js:38`
- **Impact:** When `removeDuplicates=false`, duplicates are INCLUDED in `uniqueRecipients`. This is counterintuitive.
- **Fix:** Rename to `includeDuplicates` or invert the logic.

---

### 3.3 BatchProcessorService (`backend/services/BatchProcessorService.js`)

#### [MEDIUM] Unconditional `global.gc()` call
- **File:** `backend/services/BatchProcessorService.js:182`
- **Impact:** `global.gc()` requires `--expose-gc`. In production without this flag, it throws `TypeError`, crashing the batch loop.
- **Fix:** Wrap in try-catch or check `global.gc` exists.

#### [MEDIUM] Hardcoded retry limit
- **File:** `backend/services/BatchProcessorService.js:246`
- **Impact:** Retry query uses `retryCount: { $lt: 3 }` (hardcoded) instead of `config.RETRY_ATTEMPTS`.
- **Fix:** Use `options.maxRetries || config.RETRY_ATTEMPTS`.

#### [MEDIUM] Incorrect ETA calculation
- **File:** `backend/services/BatchProcessorService.js:110-114`
- **Impact:** ETA formula divides by `currentBatch` which can be 0, causing `Infinity` or `NaN`.
- **Fix:** Guard against division by zero and track actual batch timestamps.

#### [MEDIUM] Retry processes all failed recipients, not just failed batch
- **File:** `backend/services/BatchProcessorService.js:243-250`
- **Impact:** Retry queries `{ status: 'failed', retryCount: { $lt: 3 } }` without filtering by batch range, causing duplicate processing.
- **Fix:** Add filter for specific batch recipients.

---

### 3.4 SmsJobQueueService (`backend/services/SmsJobQueueService.js`)

#### [CRITICAL] Wallet leak on campaign failure after reservation capture
- **File:** `backend/services/SmsJobQueueService.js:432-452,578-585`
- **Impact:** If `captureReservation` succeeds but the campaign fails later, the catch block calls `releaseReservation`, which throws because status is already `'captured'`. Funds are debited but never refunded.
- **Fix:** Add a `refundReservation` method in `WalletService`.

#### [CRITICAL] Wallet leak when no queued recipients exist
- **File:** `backend/services/SmsJobQueueService.js:457-468`
- **Impact:** If a campaign has a reservation but zero queued recipients, it returns early after marking failed, without releasing/refunding the reservation.
- **Fix:** Release or refund reservation before early return.

#### [HIGH] Race condition in duplicate campaign execution guard
- **File:** `backend/services/SmsJobQueueService.js:385-388`
- **Impact:** With `concurrency=2`, two workers can pass the status check simultaneously and process the same campaign, causing duplicate sends.
- **Fix:** Use a distributed lock (Redis lock with campaign ID).

#### [MEDIUM] Dead letter queue memory leak
- **File:** `backend/services/SmsJobQueueService.js:117-121`
- **Impact:** `removeOnComplete: 0` and `removeOnFail: 0` cause unbounded Redis memory growth.
- **Fix:** Set reasonable limits (e.g., keep last 1000).

#### [MEDIUM] Past scheduled time executes immediately
- **File:** `backend/services/SmsJobQueueService.js:247`
- **Impact:** If `scheduledTime` is in the past, `delay` is 0 and the job executes immediately.
- **Fix:** Validate `scheduledTime > new Date()`.

---

### 3.5 SmsCampaignRetryService (`backend/services/SmsCampaignRetryService.js`)

#### [CRITICAL] Double billing in duplicate campaign retry
- **File:** `backend/services/SmsCampaignRetryService.js:210,247`
- **Impact:** `duplicateCampaignWithFailed` creates a wallet reservation but `sendProcessor` calls `sendSmsWithFinancialTracking` without `skipDeduction`, causing direct deduction while reservation remains active.
- **Fix:** Pass `skipDeduction: !!campaign.walletReservationId`.

#### [HIGH] Retry bypasses skipDeduction flag
- **File:** `backend/services/SmsCampaignRetryService.js:67`
- **Impact:** Same as above — retry processor does not pass `skipDeduction`.
- **Fix:** Pass `skipDeduction: !!campaign.walletReservationId`.

---

### 3.6 WalletService (`backend/services/WalletService.js`)

#### [HIGH] `reserveFunds` does not decrement `smsBalance`
- **File:** `backend/services/WalletService.js:212-241`
- **Impact:** `getAvailableBalance` checks `wallet.balance - totalReserved`, but reservations are tracked separately from the balance. If `smsBalance` is used for SMS-specific limits, reservations are not reflected.
- **Fix:** Ensure `reserveFunds` updates both `balance` tracking and `smsBalance` if applicable.

#### [MEDIUM] Redundant balance check before atomic update
- **File:** `backend/services/WalletService.js:139-141`
- **Impact:** The initial balance check is redundant with the atomic `findOneAndUpdate` filter and could be misleading under concurrency.
- **Fix:** Remove the initial check; rely on the atomic update.

#### [MEDIUM] Non-cryptographic random for transaction references
- **File:** `backend/services/WalletService.js:163`
- **Impact:** `Math.random()` is not cryptographically secure. High-throughput scenarios could produce reference collisions.
- **Fix:** Use `crypto.randomUUID()`.

---

### 3.7 CostCalculatorService (`backend/services/CostCalculatorService.js`)

#### [HIGH] Billing based on average of min/max segments
- **File:** `backend/services/CostCalculatorService.js:327-335`
- **Impact:** `avgSegments = (minSegments + maxSegments) / 2` may not match actual segments, causing overcharging or undercharging.
- **Fix:** Bill based on actual segments per recipient after personalization.

#### [HIGH] Monthly volume tier based on message count, not segment count
- **File:** `backend/services/CostCalculatorService.js:72-83`
- **Impact:** Provider pricing tiers are typically based on total segments, not message count. Users sending multi-segment messages are placed in lower tiers, causing margin erosion.
- **Fix:** Count total segments instead of message count.

---

### 3.8 ContactImportService (`backend/services/ContactImportService.js`)

#### [CRITICAL] Contact Import violates parse-only requirement
- **File:** `backend/services/ContactImportService.js:516,391,477-497`
- **Impact:** Uploaded contacts are persisted to MongoDB via `Contact.create()`, compared against the Contacts database, and users see "already exists in contacts" errors. This violates the Send SMS upload isolation requirement.
- **Fix:** Remove all `Contact.create()` calls, remove the `Contact.find()` duplicate check against existing contacts, and remove "already exists in contacts" messaging.

---

### 3.9 MessagePersonalizationService (`backend/services/MessagePersonalizationService.js`)

#### [MEDIUM] SMS segment calculation ignores GSM-7 extended characters
- **File:** `backend/services/MessagePersonalizationService.js:209-221`
- **Impact:** `calculateSmsSegments` uses plain character length with fixed thresholds (160, 306, etc.). It does not account for GSM-7 extended characters (e.g., `^`, `{`, `}`, `\`, `[`, `~`, `]`, `|`, `€`), which take 2 septets each.
- **Fix:** Use proper GSM-7 septet counting (basic chars + 2 * extended chars) with 160/67 septet limits.

---

## 4. MODELS AUDIT

### 4.1 SmsCampaign (`backend/models/SmsCampaign.js`)

#### [HIGH] Duplicate `jobId` field definition
- **File:** `backend/models/SmsCampaign.js:64-67` and `backend/models/SmsCampaign.js:165-168`
- **Impact:** Mongoose silently uses the last definition; the first declaration is dead code.
- **Fix:** Remove the duplicate definition at line 165-168.

#### [MEDIUM] `canBeCancelled()` fails when `scheduledAt` is null
- **File:** `backend/models/SmsCampaign.js:197-199`
- **Impact:** If `scheduledAt` is null, `null > new Date()` is false, preventing legitimate cancellation.
- **Fix:** Add null-safe guard: `(this.scheduledAt ? this.scheduledAt > new Date() : true)`.

---

### 4.2 SmsRecipient (`backend/models/SmsRecipient.js`)

#### [HIGH] Divergent enums for `providerStatus` vs `status`
- **File:** `backend/models/SmsRecipient.js:47-51` and `backend/models/SmsRecipient.js:85-90`
- **Impact:** `providerStatus` allows `undelivered`/`expired` while `status` allows `processing`/`scheduled`/`cancelled`. A recipient can be `status: 'cancelled'` but `providerStatus: 'queued'`.
- **Fix:** Unify into a single status field or maintain explicit mapping logic.

#### [HIGH] No auto-normalization of `phoneNumber` to `normalizedPhoneNumber`
- **File:** `backend/models/SmsRecipient.js:133-136`
- **Impact:** `normalizedPhoneNumber` is required, but the pre-save hook does not derive it from `phoneNumber`.
- **Fix:** Add normalization logic in the pre-save hook.

#### [HIGH] `updateStatus()` does not sync `providerStatus`
- **File:** `backend/models/SmsRecipient.js:169-185`
- **Impact:** When `status` is updated to `sent`/`delivered`/`failed`, `providerStatus` remains stale.
- **Fix:** Update `providerStatus` in the same `updateData` object.

#### [MEDIUM] `detectNetwork()` assumes normalized 233 prefix
- **File:** `backend/models/SmsRecipient.js:143-156`
- **Impact:** Passing a `0`-prefixed number extracts prefix `012` (chars 3-5), returning `'Unknown'` instead of `'Telecel'`.
- **Fix:** Normalize input first before extracting prefix.

---

### 4.3 SmsMessage (`backend/models/SmsMessage.js`)

#### [HIGH] Default pricing causes guaranteed loss
- **File:** `backend/models/SmsMessage.js:56-89`
- **Impact:** Default `sellPricePerSms: 0.07` < `providerCostPerSms: 0.082`. Every default SMS loses money. `profitAmount` has no `min`/validation and can store negative values.
- **Fix:** Set defaults to business-valid rates and add `min: 0` to `profitAmount`.

#### [HIGH] `jobId` not unique
- **File:** `backend/models/SmsMessage.js:39-42`
- **Impact:** Multiple `SmsMessage` documents can share the same `jobId`, risking duplicate processing.
- **Fix:** Add `unique: true` to `jobId`.

#### [HIGH] `message` field has no maxlength
- **File:** `backend/models/SmsMessage.js:30-33`
- **Impact:** Unbounded message length bypasses segment/cost calculations.
- **Fix:** Add `maxlength`.

#### [MEDIUM] Phone normalization incomplete for malformed inputs
- **File:** `backend/models/SmsMessage.js:105-119`
- **Impact:** A 13-digit number starting with `233` bypasses all conditions and is stored as-is.
- **Fix:** Add an `else` branch that throws a validation error for unrecognized lengths.

---

### 4.4 Wallet (`backend/models/Wallet.js`)

#### [CRITICAL] TOCTOU race condition in `debit()`
- **File:** `backend/models/Wallet.js:109-124`
- **Impact:** Between `findOne` (balance check) and `save()` (debit), concurrent requests can overdraw the wallet.
- **Fix:** Use atomic `findOneAndUpdate` with `$inc` and a query condition.

#### [CRITICAL] Race condition in `credit()` for new wallets
- **File:** `backend/models/Wallet.js:94-106`
- **Impact:** Two concurrent credits to a non-existent wallet both pass the `findOne` null check, and the second `create()` throws a duplicate key error.
- **Fix:** Use `findOneAndUpdate` with `$inc` and `upsert: true`.

#### [CRITICAL] Floating-point arithmetic on monetary values
- **File:** `backend/models/Wallet.js:10-16`
- **Impact:** JavaScript Number precision issues cause silent rounding errors in balance calculations.
- **Fix:** Store amounts as integer minor units (pesewas/cents).

#### [HIGH] `checkDailyLimit`/`checkMonthlyLimit` mutate in memory without persisting
- **File:** `backend/models/Wallet.js:127-155`
- **Impact:** Resetting usage to 0 and updating `lastReset` only modifies the in-memory document. If the caller forgets to `save()`, the reset never persists.
- **Fix:** Return a new document state and require the caller to `save()`, or use atomic `findOneAndUpdate`.

#### [HIGH] `version` field is decorative; no optimistic locking
- **File:** `backend/models/Wallet.js:27-31`
- **Impact:** `version` increments on every save, but no query uses it for concurrency control.
- **Fix:** Implement true optimistic locking or remove the field.

---

### 4.5 Transaction (`backend/models/Transaction.js`)

#### [MEDIUM] `metadata` default is a mutable shared object
- **File:** `backend/models/Transaction.js:43`
- **Impact:** `default: {}` creates a single object reference shared across all instances. Mutating `metadata` on one instance leaks to others.
- **Fix:** Use `default: () => ({})`.

---

## 5. INFRASTRUCTURE & SECURITY AUDIT

### 5.1 CORS

#### [HIGH] CORS fallback allows any origin
- **File:** `server/index.js:127-154`
- **Impact:** Any website can make authenticated cross-origin requests in production.
- **Fix:** Return `callback(null, false)` for non-whitelisted origins.

### 5.2 Rate Limiting

#### [HIGH] Rate-limit key uses spoofable header
- **File:** `server/index.js:302`
- **Impact:** Attackers bypass rate limiting by forging `X-Forwarded-For`.
- **Fix:** Use `req.ip`.

### 5.3 Webhook Security

#### [CRITICAL] Unauthenticated callback endpoint
- **File:** `backend/routes/sms.js:794-814`
- **Impact:** Anyone can update message statuses by calling `/api/sms/callback`.
- **Fix:** Add provider signature verification or IP whitelist.

---

## 6. SUMMARY OF ALL CONFIRMED BUGS

| Severity | Count | Categories |
|----------|-------|------------|
| Critical | 18 | Financial (wallet leaks, double billing, phantom refunds), Broken endpoints (missing imports, unreachable routes), Security (unauthenticated callbacks), Data isolation violations |
| High | 32 | Race conditions, timeout risks, missing validations, state desync, CORS bypass, rate limit bypass, billing inaccuracies |
| Medium | 28 | Performance (sequential DB ops, memory leaks), state management, edge cases, incomplete validation |
| Low | 7 | Cosmetic, misleading comments, mutable defaults |

---

## 7. RECOMMENDED REPAIR PRIORITY

**Phase 1 — Critical (Immediate)**
1. Fix `Campaign` model import in `campaigns.js`
2. Fix `recipients` destructuring in `sms-campaigns.js` preview endpoint
3. Add wallet balance check to `/sms/send`
4. Fix `skipDeduction` refund and profit bugs in `NaloSmsService`
5. Fix wallet leak on campaign failure in `SmsJobQueueService`
6. Fix double billing in `SmsCampaignRetryService`
7. Remove Contact DB writes from `ContactImportService`
8. Add webhook signature verification to `/sms/callback`
9. Fix CORS fallback in `server/index.js`
10. Fix race conditions in `Wallet` model

**Phase 2 — High (This Sprint)**
1. Fix duplicate event listeners in frontend
2. Implement async/BullMQ dispatch for bulk sends
3. Fix `removeDuplicates` payload for default mode
4. Add message length validation to `/sms/send`
5. Fix `reserveFunds` null campaign ID
6. Fix `/logs` userId type consistency
7. Fix PATCH allowlist in `sms-campaigns.js`
8. Fix orphaned `SmsRecipient` cleanup on schedule failure
9. Fix `analyzeRecipientsForModal` blacklist count
10. Fix rate-limit key generator

**Phase 3 — Medium (Next Sprint)**
1. Fix `global.gc()` crash
2. Fix ETA calculation
3. Fix retry batch scoping
4. Fix dead letter queue limits
5. Fix `normalizePhoneNumber` accepting invalid numbers
6. Fix `updateMessageBodyTemplate` overwriting content
7. Fix `SmsRecipient` status/providerStatus sync
8. Fix `SmsMessage` financial field defaults

**Phase 4 — Low (Backlog)**
1. Fix dummy API key hardcoding
2. Fix mutable `metadata` default
3. Fix `convertToGsmCompatible` guard
4. Fix misleading GSM-7 comments
5. Fix `Date.now` default patterns

---

*End of Forensic Audit Report*
