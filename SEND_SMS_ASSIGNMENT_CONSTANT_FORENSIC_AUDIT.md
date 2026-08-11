# Send SMS "Assignment to Constant Variable" Forensic Audit

## Executive Summary

A runtime `TypeError: Assignment to constant variable.` was causing HTTP 500 responses on the Send SMS `/api/sms/send` endpoint. This audit identifies the exact root cause, the runtime path that triggers it, and the minimal fix applied.

## Root Cause

**File:** `backend/routes/sms.js`  
**Line:** 79 (declaration) and 145 (reassignment)  
**Variable:** `availableBalance`

### Exact Code Pattern

```javascript
// Line 79 — declared as const
const availableBalance = await WalletService.getAvailableBalance(userId);

// ... later in the same function scope ...

// Line 145 — reassignment of const throws at runtime
availableBalance = await WalletService.getAvailableBalance(userId);
```

### Why It Throws

JavaScript `const` variables cannot be reassigned after declaration. The `/send` route handler declares `availableBalance` as `const` at line 79, then attempts to reassign it at line 145. This throws a `TypeError` at runtime, which is caught by the route's generic `catch` block and returned to the client as:

```json
{
  "success": false,
  "message": "Failed to send SMS",
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "details": "Assignment to constant variable."
  }
}
```

## Runtime Path to Failure

1. Frontend calls `POST /api/sms/send` with `senderId`, `recipients`, `message`
2. `server/index.js` routes request to `backend/routes/sms.js` `/send` handler
3. Handler validates input, trims message, checks segments, checks provider balance
4. Handler declares `const availableBalance = await WalletService.getAvailableBalance(userId)` at line 79
5. Handler processes recipients via `SmsRecipientService.processRecipientsForCampaign`
6. Handler reaches line 145: `availableBalance = await WalletService.getAvailableBalance(userId)`
7. **RUNTIME ERROR:** `TypeError: Assignment to constant variable.`
8. Caught by `catch (error)` at line 273
9. Returns HTTP 500 with `error.details = error.message`

## Failure Point in Pipeline

| Stage | Status |
|-------|--------|
| Before wallet reservation | ✓ Reached |
| After reservation | ✗ Never reached |
| Before campaign creation | ✗ Never reached |
| After campaign creation | ✗ Never reached |
| Before provider submission | ✗ Never reached |
| After provider submission | ✗ Never reached |

The failure occurs **before any wallet reservation, campaign creation, or provider submission**.

## Side Effects of Failed Request

| Action | Performed? |
|--------|-----------|
| Wallet reservation created | No |
| Wallet amount deducted | No |
| SMS submitted to Nalo | No |
| Campaign record created | No |
| SmsRecipient records created | No |

The failed request is a pure no-op with respect to billing, campaign state, and provider submission.

## Verification Performed

- `node -c backend/routes/sms.js` — syntax passes
- All 21 route modules load successfully
- `node test_forensic_audit.js` — 57/57 tests passed
- `node test_assignment_constant_regression.js` — 10/10 tests passed
- Server startup test confirms `/healthz` endpoint responds

## Fix Applied

**File:** `backend/routes/sms.js`  
**Change:** Line 79 — changed `const availableBalance` to `let availableBalance`

```diff
-    const availableBalance = await WalletService.getAvailableBalance(userId);
+    let availableBalance = await WalletService.getAvailableBalance(userId);
```

This is the minimal correct fix. The variable is intentionally reassigned at line 145 to perform a second balance check against the total cost estimation before sending. Changing it to `let` allows the intended reassignment without altering any business logic.

## What Was NOT Changed

- No billing mathematics
- No segmentation logic
- No recipient processing
- No campaign creation flow
- No provider submission logic
- No error handling architecture
- No frontend code
