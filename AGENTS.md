# Agent Instructions

## Current Session: Send SMS Upload Isolation Refactor

### Goal
Refactor the Send SMS recipient upload workflow to be completely independent from the Contacts module. No uploaded contacts should be saved to MongoDB, compared against Contacts DB, or show "already exists in contacts" messaging. Only visible recipients should be sent.

### Verification Commands
- **Backend syntax check**: `node -c server/index.js` (after adding route registration)
- **Backend route check**: `node -e "require('./backend/routes/sms-uploads.js'); console.log('OK')"` (run from project root)

### Key Files Modified
- `backend/routes/sms-uploads.js` (NEW) — parse-only upload endpoint for Send SMS
- `server/index.js` — route registration
- `src/utils/api.js` — added `parseTempFile()` method
- `src/pages/dashboard/send-sms.html` — rewrote upload flow to be client-side/local processing

### Constraints
- Do NOT save uploaded contacts to MongoDB (no Contact.create/insertMany/save/update/bulkWrite)
- Do NOT compare uploaded contacts against Contacts database
- Do NOT display "already exists in contacts" during Send SMS upload
- Preserve all validation, cost calc, deduplication, confirmation modal, scheduling
- Backend errors must never surface in frontend UI; only friendly validation messages
