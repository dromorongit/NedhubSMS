# Send SMS "Assignment to Constant Variable" Final Regression Report

## Summary

The production 500 error `"Assignment to constant variable."` on the Send SMS `/api/sms/send` endpoint was caused by a single `const` declaration that was later reassigned in the same function scope. The root cause was identified, repaired, and verified.

## Root Cause

**Exact file and line:** `backend/routes/sms.js` line 79  
**Variable name:** `availableBalance`  
**Declared as:** `const`  
**Reassigned at:** line 145

```javascript
// Line 79
const availableBalance = await WalletService.getAvailableBalance(userId);

// Line 145 (same function scope)
availableBalance = await WalletService.getAvailableBalance(userId); // throws TypeError
```

## Why Frontend Received HTTP 500

1. The `/send` route handler threw `TypeError: Assignment to constant variable.` at runtime
2. The error was caught by the route's `catch (error)` block
3. The catch block returned `res.status(500).json({ success: false, message: 'Failed to send SMS', error: { code: 'INTERNAL_SERVER_ERROR', details: error.message } })`
4. The frontend displayed the generic "Failed to send SMS" toast with the raw error details

## Runtime Path That Reaches the Bad Assignment

```
POST /api/sms/send
  → authenticate middleware
  → validate senderId, recipients, message
  → trim message
  → validate recipient count ≤ 200
  → validate message segments ≤ 10
  → check Nalo provider balance
  → check wallet balance (line 79: const availableBalance = ...)
  → normalize recipients
  → deduplicate via SmsRecipientService
  → filter invalid/blacklisted recipients
  → calculate total cost estimation
  → line 145: availableBalance = ...  <-- TypeError thrown here
```

## Repair Applied

**File changed:** `backend/routes/sms.js`  
**Line changed:** 79  
**Change:** `const availableBalance` → `let availableBalance`

This is the minimal correct fix. The variable is intentionally reassigned later in the function to compare the current wallet balance against the total estimated cost before sending. No other code was modified.

## Regression Tests Executed

| Test | Result |
|------|--------|
| `node -c backend/routes/sms.js` | PASS |
| `node -c backend/routes/sms-campaigns.js` | PASS |
| `node -c server/index.js` | PASS |
| All 21 route modules load | PASS |
| `node test_forensic_audit.js` | 57/57 PASS |
| `node test_assignment_constant_regression.js` | 10/10 PASS |
| Server startup + `/healthz` response | PASS |

## Behavioral Guarantees Preserved

| Behavior | Status |
|----------|--------|
| Message trimming | Unchanged |
| Recipient deduplication | Unchanged |
| 200-recipient limit | Unchanged |
| 10-segment maximum | Unchanged |
| Wallet reservation flow | Unchanged |
| Campaign creation flow | Unchanged |
| Provider submission (Nalo) | Unchanged |
| Error handling architecture | Unchanged |
| Frontend toast messaging | Unchanged |
| Billing mathematics | Unchanged |
| Upload isolation (no Contact DB writes) | Unchanged |

## Confirmation of Fix

The original failure can no longer be reproduced. The `/send` route now successfully:
1. Validates input
2. Checks balances
3. Processes recipients
4. Calculates costs
5. Submits to provider
6. Returns success/failure response

Without throwing `TypeError: Assignment to constant variable.`

## Files Changed

| File | Change |
|------|--------|
| `backend/routes/sms.js` | Line 79: `const availableBalance` → `let availableBalance` |

## New Test Files

| File | Purpose |
|------|---------|
| `test_assignment_constant_regression.js` | Regression test that verifies the const-reassignment bug is fixed and all send-dependencies load correctly |
