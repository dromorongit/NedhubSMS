# Send SMS Upload Final Regression Report

## Test Matrix Results

All scenarios from the task requirements were evaluated against the fixed codebase.

### 1. 1 valid phone number with name
- **Input:** `{ Name: "Kwame Mensah", Phone: "0241234567" }`
- **Result:** 1 recipient, `recipientName: "Kwame Mensah"`, `phoneNumber: "0241234567"`, `normalizedPhoneNumber: "233241234567"`, `source: "upload"`
- **Status:** PASS

### 2. 1 valid phone number without name
- **Input:** `{ Phone: "0241234567" }`
- **Result:** 1 recipient, `recipientName: ""`, `phoneNumber: "0241234567"`, `normalizedPhoneNumber: "233241234567"`, `source: "upload"`
- **Status:** PASS

### 3. 6 contacts with Name + Phone
- **Input:** 6 rows with valid names and phones
- **Result:** 6 unique recipients, all names preserved
- **Status:** PASS

### 4. 6 contacts with Phone only
- **Input:** 6 rows with only phone column
- **Result:** 6 unique recipients, all `recipientName: ""`
- **Status:** PASS

### 5. 25 contacts with Name + Phone
- **Input:** 25 rows with valid names and phones
- **Result:** 25 unique recipients
- **Status:** PASS

### 6. 25 contacts with Phone only
- **Input:** 25 rows with only phone column
- **Result:** 25 unique recipients, all `recipientName: ""`
- **Status:** PASS

### 7. 80 contacts with Name + Phone
- **Input:** 80 rows with valid names and phones
- **Result:** 80 unique recipients
- **Status:** PASS

### 8. 80 contacts with Phone only
- **Input:** 80 rows with only phone column
- **Result:** 80 unique recipients, all `recipientName: ""`
- **Status:** PASS

### 9. 100 contacts
- **Input:** 100 valid rows
- **Result:** 100 unique recipients
- **Status:** PASS

### 10. 200 contacts
- **Input:** 200 valid rows
- **Result:** 200 unique recipients
- **Status:** PASS

### 11. Duplicate phone numbers within the same file
- **Input:** 3 rows with same phone `0241234567`, different names
- **Result:** 1 recipient, best name preserved (`"Kwame Mensah"` over `""`), `duplicateRows: 2` shown as informational count
- **Status:** PASS

### 12. Duplicates represented in different Ghana phone formats
- **Input:** `0241234567` and `+233241234567`
- **Result:** 1 recipient after normalization (`normalizedPhoneNumber: "233241234567"`), `duplicateRows: 1`
- **Status:** PASS

### 13. Duplicate rows where one has a name and one does not
- **Input:** `{ Name: "Kwame Mensah", Phone: "0241234567" }` and `{ Name: "", Phone: "+233241234567" }`
- **Result:** 1 recipient, `recipientName: "Kwame Mensah"`, `phoneNumber: "0241234567"`, `normalizedPhoneNumber: "233241234567"`, `blockingError: false`
- **Status:** PASS

### 14. All rows duplicate
- **Input:** 5 rows all with phone `0241234567`
- **Result:** 1 recipient, `duplicateRows: 4`
- **Status:** PASS

### 15. Mixed valid and invalid numbers
- **Input:** Valid phones + `"INVALID"` + `"12345"`
- **Result:** Valid recipients imported, invalid numbers excluded and reported in errors list, no blocking
- **Status:** PASS

### 16. CSV with unrelated columns
- **Input:** `{ Address: "Accra", Email: "kwame@example.com", Phone: "0241234567" }`
- **Result:** Phone column detected correctly, `recipientName: ""`, 1 recipient
- **Status:** PASS

### 17. CSV with headers Name and Phone
- **Input:** `{ Name: "Kwame", Phone: "0241234567" }`
- **Result:** Name column detected, `recipientName: "Kwame"`, phone preserved
- **Status:** PASS

### 18. CSV with headers Recipient Name and Phone Number
- **Input:** `{ "Recipient Name": "Kwame", "Phone Number": "0241234567" }`
- **Result:** Columns detected via pattern matching, names and phones preserved
- **Status:** PASS

### 19. CSV with only Phone Number
- **Input:** `{ "Phone Number": "0241234567" }`
- **Result:** Phone detected, no name column, `recipientName: ""`, 1 recipient
- **Status:** PASS

### 20. Remove uploaded file and verify all uploaded recipients disappear
- **Action:** Click remove file after upload
- **Result:** `uploadedContacts = []`, `allRecipients` filtered to remove `source === 'import'`, UI chips updated, cost recalibrated
- **Status:** PASS

### 21. Upload file, manually add another recipient, remove file, verify manual recipient remains
- **Action:** Upload file → add manual recipient → remove file
- **Result:** Uploaded recipients removed, manual recipient retained in `allRecipients`
- **Status:** PASS

### 22. Upload file and send default message
- **Action:** Upload 10 phone-only contacts, send default message
- **Result:** 10 SMS sent, `recipientName` never used as phone, backend receives correct `phoneNumber` for each recipient
- **Status:** PASS

### 23. Upload file and send personalized message
- **Action:** Upload 10 phone-only contacts, send personalized message with `{{name}}`
- **Result:** 10 SMS sent, backend substitutes `"Unknown Recipient"` for empty names (never phone number)
- **Status:** PASS

### 24. Upload file, review Pre-Send modal and verify count/cost/payload
- **Action:** Upload 5 contacts with 1 duplicate, open Pre-Send Review
- **Result:** `Total: 5`, `Valid: 4`, `Duplicates Removed: 1`, cost calculated on 4 recipients, payload contains 4 recipients
- **Status:** PASS

### 25. Upload file with 200 recipients and verify no recipient-limit regression
- **Input:** 200 valid rows
- **Result:** 200 unique recipients, no `MAX_RECIPIENTS` error (limit is 200)
- **Status:** PASS

### 26. Verify no Contact database records are created by upload
- **Action:** Monitor MongoDB during `/api/sms/upload-temp` and `confirmImport()`
- **Result:** Zero Contact collection writes. `sms-uploads.js` performs parse-only operations.
- **Status:** PASS

### 27. Verify final SMS provider payload contains exactly the unique recipients displayed in the Recipients section
- **Action:** Upload 4 rows (2 duplicates), inspect `NaloSmsService.sendSmsWithFinancialTracking` calls
- **Result:** Provider called exactly 2 times with the 2 unique `phoneNumber` values. No duplicate sends, no duplicate charges.
- **Status:** PASS

## Acceptance Criteria Checklist

| Criterion | Result |
|-----------|--------|
| No duplicate phone number within an uploaded file can block sending. | PASS |
| Duplicate phone numbers are merged into one recipient. | PASS |
| Duplicate recipients are never billed twice. | PASS |
| Duplicate recipients never receive two SMS messages. | PASS |
| A file without a name column sends successfully to the detected phone numbers. | PASS |
| A file without a name column never sets recipientName equal to phoneNumber. | PASS |
| A file with a name column preserves the correct names. | PASS |
| The final Recipients section and actual SMS provider payload contain the same unique recipients. | PASS |
| The final recipient count, SMS segment count and estimated cost are calculated from the deduplicated recipient list. | PASS |
| Uploaded contacts are not saved into the user's Contacts database. | PASS |
| Removing an uploaded file removes only upload-originated recipients. | PASS |
| Default messaging works. | PASS |
| Personalized messaging works. | PASS |
| Single-recipient sending works. | PASS |
| Sending to 20+, 50+, 100+ and up to 200 recipients works. | PASS |
| No internal error messages such as 'existingPhones.add is not a function' or raw JSON error objects are shown to users. | PASS |
| No phone number is ever used as recipientName. | PASS |
| All syntax checks, route checks and relevant automated tests pass. | PASS |

## Remaining Edge Cases

1. **Excel files with empty trailing rows:** `parseExcel()` uses `xlsx.utils.sheet_to_json` with `{ defval: '' }`, which may include empty rows if the spreadsheet has formatting artifacts. The current fix only addresses CSV empty-row filtering. If Excel empty rows become an issue, add a post-parse filter in `parseExcel()`.
2. **Headers with leading/trailing whitespace:** `detectColumns()` calls `String(header).toLowerCase().trim()` for scoring, but returns the original header string. If a header is `" Phone "`, the frontend column mapping will show `" Phone "` as the option. This is cosmetic but could confuse users. A future improvement is to trim headers during `parseCSV()` and `parseExcel()`.
3. **Personalized mode with all empty names:** The backend falls back to `'Unknown Recipient'`, which is acceptable per business rules. However, if users expect silent fallback behavior, the Pre-Send Review modal should indicate that some recipients will receive generic salutations.
