# SMS Message Length Forensic Audit

## Executive Summary

A forensic investigation was performed on the Send SMS messaging pipeline to determine why valid multipart SMS messages longer than 160 characters were being rejected with the error **"Message exceeds maximum length of 160 characters"**, and to verify the SMS segmentation and billing calculations.

### Key Findings

1. **Root Cause of 160-Character Rejection**: Three backend route endpoints contain a hardcoded `message.length > 160` validation that treats 160 as an absolute message-length limit instead of a single-segment threshold. This rejects all valid multipart SMS messages regardless of encoding or segment count.

2. **Segmentation Algorithm**: The current segmentation algorithms in `CostCalculatorService`, `messageUtils`, and `billing.js` are mathematically correct for standard GSM-7 and Unicode/UCS-2 multipart SMS. A 221-character Unicode message correctly calculates to **4 segments** (221 ÷ 67 = 3.30, ceil = 4), not 288.

3. **288-Segment Mystery**: The reported 288-segment result for 221 Unicode characters could not be reproduced with the current codebase. It may have originated from a prior buggy version, a different message composition path, or a client-side caching/race condition. All current segmentation paths return 4 segments for 221 Unicode characters.

4. **Frontend-Backend Inconsistency**: The frontend `send-sms.html` correctly supports multipart SMS (no 160-character hard block), but the backend rejected the same messages before they could reach the provider.

5. **Provider Constraints**: Nalo SMS provider returns error code `1708` ("Message too long") for messages exceeding a single-segment limit. The application should split long messages into multipart SMS before sending, but the current implementation sends the full message and relies on the provider to handle concatenation.

---

## 1. Affected Files and Lines

### Critical Defects

| File | Line(s) | Defect | Severity |
|------|---------|--------|----------|
| `backend/routes/sms.js` | 54 | `if (message.length > 160)` — hardcoded absolute limit in `/api/sms/send` | **Critical** |
| `backend/routes/sms.js` | 417 | `if (message.length > 160)` — hardcoded absolute limit in `/api/sms/schedule` | **Critical** |
| `backend/routes/sms-campaigns.js` | 626 | `if (messageBody.length > 160)` — hardcoded absolute limit in `/api/sms-campaigns/schedule` | **Critical** |
| `backend/services/NaloSmsService.js` | 422 | Error message "Maximum 160 characters per SMS segment" is misleading when multipart SMS is intended | **Medium** |
| `src/pages/dashboard/campaigns.html` | 571-573 | Uses single-segment limit (70) instead of multipart limit (67) for Unicode messages | **Medium** |

### Related Files (No Defects Found)

| File | Status |
|------|--------|
| `backend/services/CostCalculatorService.js` | Segmentation logic correct |
| `src/utils/messageUtils.js` | Frontend segmentation logic correct |
| `backend/utils/billing.js` | Legacy billing utility correct |
| `backend/services/MessagePersonalizationService.js` | Personalized segmentation correct |
| `backend/services/WalletService.js` | Wallet deduction uses `avgSegments` correctly |
| `backend/controllers/naloSmsController.js` | Pass-through to service, no validation |
| `backend/routes/naloSms.js` | No 160-character limit |

---

## 2. Data Flow Analysis

### Send SMS Default Messaging Flow

```
User types message in send-sms.html textarea
    ↓
Frontend: calculateSmsSegments() updates character count, encoding, segments, cost
    ↓
User clicks Send Now or Schedule
    ↓
Frontend validation (pre-fix): NO message length check
    ↓
openConfirmationModal() → Pre-Send Review
    ↓
handleConfirmSend() → sendOrScheduleCampaign()
    ↓
API call: POST /api/sms/send or POST /api/sms/schedule
    ↓
Backend validation (PRE-FIX): if (message.length > 160) → REJECT
    ↓
[If fixed] CostCalculatorService.calculateSegments() → segment count
    ↓
[If fixed] Validate segments <= MAX_SMS_SEGMENTS
    ↓
Recipient processing (deduplication, validation, blacklist)
    ↓
Wallet reservation/deduction using CostCalculatorService.calculateLiveCost()
    ↓
NaloSmsService.sendSmsWithFinancialTracking()
    ↓
Provider payload: { msisdn, sender_id, message } (full message sent)
    ↓
Nalo API response parsed → success/failure
    ↓
Wallet refund on failure
```

### Send SMS Personalized Messaging Flow

```
User types template with {{name}}, {{salutation}} placeholders
    ↓
Frontend: calculateSmsSegments() on raw template (no placeholders replaced)
    ↓
User clicks Send Now or Schedule
    ↓
API call: POST /api/sms-campaigns/send or POST /api/sms-campaigns/schedule
    ↓
Backend validation: NO 160-char limit in /send; HAD 160-char limit in /schedule
    ↓
MessagePersonalizationService.personalizeMessage() for each recipient
    ↓
CostCalculatorService.calculateSegments(personalizedMessage) per recipient
    ↓
Wallet reservation using avgSegments
    ↓
NaloSmsService.sendSmsWithFinancialTracking() per recipient
```

---

## 3. Segmentation Calculation Analysis

### GSM-7 Single-Part SMS
- **Limit**: 160 septets (bytes)
- **Correct Calculation**: `byteLength <= 160 ? 1 : ceil(byteLength / 153)`
- **Status**: ✅ Correct in all implementations

### GSM-7 Multipart SMS
- **Limit**: 153 septets per segment (7 bytes reserved for concatenation header)
- **Correct Calculation**: `ceil(byteLength / 153)`
- **Status**: ✅ Correct

### Unicode/UCS-2 Single-Part SMS
- **Limit**: 70 characters (140 bytes ÷ 2 bytes per character)
- **Correct Calculation**: `charCount <= 70 ? 1 : ceil(charCount / 67)`
- **Status**: ✅ Correct in backend; ⚠️ Frontend `campaigns.html` was using 70 instead of 67 for multipart

### Unicode/UCS-2 Multipart SMS
- **Limit**: 67 characters per segment (140 - 7 header bytes = 133 bytes ÷ 2 = 66.5, rounded to 67)
- **Correct Calculation**: `ceil(charCount / 67)`
- **Status**: ✅ Correct in backend and `send-sms.html`; ❌ Was incorrect in `campaigns.html`

### Emoji and Surrogate Pair Handling
- JavaScript `String.length` counts UTF-16 code units.
- BMP characters (most accented characters): 1 code unit = 1 character.
- Emojis/supplementary plane characters: 2 code units = 1 character.
- **Impact**: The current code uses `message.length` directly, which overcounts emojis as 2 characters each. This produces a higher segment count than strictly necessary but does not cause undercounting.
- **Status**: ⚠️ Acceptable for now; would require `Array.from(message).length` or `for...of` iteration for exact code-point counting.

---

## 4. Provider Constraints (Nalo SMS)

### Nalo API Endpoint
- **URL**: `https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/`
- **Method**: POST
- **Payload**: `{ key, msisdn, sender_id, message }`
- **Response**: Pipe-delimited string (e.g., `1701|message_id`) or JSON

### Nalo Error Codes
| Code | Meaning | App Handling |
|------|---------|--------------|
| 1701 | Success | Mark as sent |
| 1707 | Sender ID not registered | User-friendly error |
| 1708 | Message too long | Previously: "Maximum 160 characters per SMS segment" |
| 1704 | Invalid API key | User-friendly error |
| 1705 | Account suspended | User-friendly error |

### Multipart SMS Support
- Nalo does **not** appear to auto-split long messages. Error code `1708` indicates rejection of over-length single-segment messages.
- **However**, the current integration sends the full message in one API call. Many SMS providers handle concatenation server-side.
- **Recommendation**: If Nalo does not auto-concatenate, the application must split messages into segments of ≤160 GSM-7 or ≤70 Unicode characters before sending. This requires further investigation with Nalo documentation.

---

## 5. Billing Pipeline Verification

### Price Source of Truth
- **Sell Price**: GHS 0.07 per SMS segment (configurable via `CostCalculatorService.defaultSellPricePerSms`)
- **Provider Cost**: Tiered (0.082 / 0.072 / 0.062 GHS per segment based on monthly volume)

### Cost Calculation Flow
```
CostCalculatorService.calculateLiveCost()
    ↓
calculateSegments(message) → segments, encoding, charCount, byteLength
    ↓
avgSegments = segmentResult.segments (non-personalized)
avgSegments = (minSegments + maxSegments) / 2 (personalized)
    ↓
totalSegments = avgSegments × recipientCount
totalChargedToUser = totalSegments × sellPricePerSms
```

### Wallet Deduction Flow
```
NaloSmsService.sendSmsWithFinancialTracking()
    ↓
CostCalculatorService.calculateFinancialBreakdown()
    ↓
WalletService.deductGhsForSms(financialBreakdown)
    ↓
financialBreakdown.totalChargedToUser = avgSegments × recipientsCount × 0.07
```

### Verification Results
- ✅ Cost is calculated as `segments × recipients × GHS 0.07`
- ✅ Invalid recipients and duplicates are removed before final billing
- ✅ Wallet reservation uses `costEstimation.estimatedCost`
- ✅ Actual wallet deduction uses `financialBreakdown.totalChargedToUser`
- ✅ Failed sends trigger `refundWallet()` (no phantom charges)

---

## 6. Frontend vs Backend Validation Matrix

| Validation Rule | Frontend (`send-sms.html`) | Backend (`sms.js`) | Backend (`sms-campaigns.js`) | Consistent? |
|-----------------|---------------------------|-------------------|------------------------------|-------------|
| Max recipients (200) | ✅ `MAX_RECIPIENTS = 200` | ✅ `MAX_SMS_RECIPIENTS` | ✅ `MAX_SMS_RECIPIENTS` | ✅ |
| Max segments (10) | ✅ `MAX_SMS_SEGMENTS = 10` (after fix) | ✅ `MAX_SMS_SEGMENTS` (after fix) | ✅ `MAX_SMS_SEGMENTS` (after fix) | ✅ |
| Message required | ✅ | ✅ | ✅ | ✅ |
| Sender ID required | ✅ | ✅ | ✅ | ✅ |
| 160-char absolute limit | ❌ Not enforced (correct) | ✅ Was enforced (BUG) | ✅ Was enforced in schedule (BUG) | ❌ Was inconsistent |
| Encoding detection | ✅ GSM-7 / Unicode | ✅ GSM-7 / Unicode | ✅ Via CostCalculatorService | ✅ |
| Segment calculation | ✅ 160/153, 70/67 | ✅ Via CostCalculatorService | ✅ Via CostCalculatorService | ✅ |

---

## 7. Defects Found

### DEF-001: Hardcoded 160-Character Absolute Limit (Critical)
- **Location**: `backend/routes/sms.js:54`, `backend/routes/sms.js:417`, `backend/routes/sms-campaigns.js:626`
- **Description**: Three endpoints reject any message with `message.length > 160`, treating 160 as an absolute maximum instead of a single-segment threshold.
- **Impact**: Valid multipart SMS messages (e.g., 221 Unicode characters = 4 segments) are rejected before reaching the provider or cost calculator.
- **Fix Applied**: Replaced with segment-based validation using `CostCalculatorService.calculateSegments()` and configurable `MAX_SMS_SEGMENTS`.

### DEF-002: Misleading Provider Error Message (Medium)
- **Location**: `backend/services/NaloSmsService.js:422`
- **Description**: Error message for Nalo code 1708 states "Maximum 160 characters per SMS segment," which contradicts multipart SMS support.
- **Fix Applied**: Updated to clarify that multipart SMS should be handled by the application.

### DEF-003: Incorrect Multipart Unicode Limit in Campaigns Page (Medium)
- **Location**: `src/pages/dashboard/campaigns.html:571-573`
- **Description**: Uses single-part Unicode limit (70) instead of multipart limit (67) for segment calculation.
- **Fix Applied**: Updated to use 67 for multipart Unicode messages.

### DEF-004: Frontend Lacked Max-Segment Validation (Low)
- **Location**: `src/pages/dashboard/send-sms.html`
- **Description**: Frontend did not validate against maximum segments, allowing users to compose messages that would be rejected by the backend.
- **Fix Applied**: Added `MAX_SMS_SEGMENTS = 10` frontend validation in Send Now, Schedule, and `sendOrScheduleCampaign` handlers.

### DEF-005: Incomplete GSM-7 Character Set (Low)
- **Location**: `backend/services/CostCalculatorService.js:29-34`, `src/utils/messageUtils.js:64-71`
- **Description**: The GSM-7 basic character set is missing common characters such as `ç`, `á`, `â`, `ã`, `ë`, `î`, `ô`, `û`, etc. Messages containing these characters are incorrectly classified as Unicode, triggering higher costs.
- **Status**: Noted for future remediation; not fixed in this audit to avoid unintended side effects.

---

## 8. Why 221 Unicode Characters Should NOT Produce 288 Segments

### Correct Calculation
- **Characters**: 221
- **Encoding**: Unicode (UCS-2)
- **Single-segment limit**: 70 characters
- **Multipart limit**: 67 characters per segment
- **Segments**: `ceil(221 / 67) = 4`
- **Cost**: `4 segments × 1 recipient × GHS 0.07 = GHS 0.28`

### Why 288 Is Incorrect
- `288 segments × GHS 0.07 = GHS 20.16` (matches the reported cost)
- For 221 characters to produce 288 segments, the calculation would need to divide by approximately `0.77` (`221 / 288 = 0.767`), which is not any standard SMS threshold.
- No code path in the current codebase produces 288 segments from 221 characters.
- **Conclusion**: The 288-segment result was either from a previous buggy version, a different message (e.g., with placeholder-expanded personalized text), or a client-side measurement error.

---

## 9. Verification Performed

- ✅ `node -c backend/utils/constants.js` — syntax OK
- ✅ `node -c backend/routes/sms.js` — syntax OK
- ✅ `node -c backend/routes/sms-campaigns.js` — syntax OK
- ✅ `node -c backend/services/NaloSmsService.js` — syntax OK
- ✅ `node -e "require('./backend/routes/sms-uploads.js'); console.log('OK')"` — route loads
- ✅ `CostCalculatorService.calculateSegments('A'.repeat(221))` → 2 segments (GSM-7)
- ✅ `CostCalculatorService.calculateSegments('á'.repeat(221))` → 4 segments (Unicode)
- ✅ Frontend and backend segmentation logic use identical thresholds (160/153, 70/67)

---

## 10. Remaining Risks

1. **Nalo Auto-Concatenation Unknown**: It is not confirmed whether Nalo automatically splits long messages into multipart SMS. If not, the application must implement message splitting before submission.
2. **Emoji Overcounting**: JavaScript `String.length` counts surrogate pairs as 2, causing emojis to be slightly overcounted in segment calculations.
3. **Incomplete GSM-7 Set**: Some common accented characters are missing from the GSM-7 detection set, causing false Unicode classification.
4. **No Message Length Maximum Tested**: While `MAX_SMS_SEGMENTS = 10` is set, the actual provider/application maximum has not been validated against Nalo documentation.
