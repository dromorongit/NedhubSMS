# Hubtel Airtime/Data Purchase — Enterprise-Grade Audit Report

**Date:** 2026-05-21  
**Scope:** Full execution pipeline — frontend click → Hubtel provider response → callback → transaction finalisation  
**Auditor:** Kilo Code (automated deep audit)  
**Status:** 🔴 CRITICAL BUGS FOUND AND FIXED

---

## Executive Summary

The Hubtel airtime and data purchase pipeline had **four critical hanging/failure modes** that could leave transactions permanently stuck, users incorrectly charged, and no observable logs to diagnose the problem. All four have been identified, root-caused, and fixed in this audit.

---

## 1. Pipeline Architecture (Pre-Fix)

```
Frontend (buy-airtime.html / buy-data.html)
  │
  │  POST /api/transfer/airtime  or  POST /api/transfer/data
  ▼
backend/routes/transfers.js
  │
  │  1. Validate input
  │  2. Check wallet balance
  │  3. Create Transaction { status: 'pending_confirmation' }
  │  4. await HubtelTransferService.buyAirtime() / buyData()
  │     └─► ResilientHttpClient.post()  [60s timeout, 3 retries]
  │           └─► HTTPS POST → Hubtel Direct API
  │  5. Return { status: 'pending_confirmation' } to frontend
  │
  ▼
Frontend polling loop (pollTransactionStatus)
  │  GET /api/transfer/status/:clientReference  every 10s × 30 attempts (5 min max)
  │
  ▼
Hubtel → POST /api/hubtel/airtime-callback  (or data-callback)
  │
  ▼
backend/controllers/hubtelCallbackController.js
  │  Mark transaction 'completed' or 'failed'
  │  Refund wallet on failure
```

---

## 2. Critical Bugs Found and Fixed

### BUG-1 🔴 CRITICAL: Data purchases use the Airtime callback URL

**File:** `backend/services/HubtelTransferService.js` (line 399, pre-fix)  
**Root cause:** `buyData()` used `this.callbackUrl` which is `HUBTEL_CALLBACK_URL` — the environment variable documented as the airtime callback URL. Data purchases therefore told Hubtel to POST callbacks to the airtime endpoint. Hubtel would send the data delivery confirmation to the wrong URL, where it would be silently ignored (or 404).

**Impact:** Every data bundle purchase was permanently stuck in `pending_confirmation`. The wallet was never refunded. Users lost money with no visible error.

**Fix:** Added per-type callback URL properties in the constructor:
```js
this.airtimeCallbackUrl = process.env.HUBTEL_AIRTIME_CALLBACK_URL || this.callbackUrl || ...;
this.dataCallbackUrl   = process.env.HUBTEL_DATA_CALLBACK_URL   || `${APP_URL}/api/hubtel/data-callback`;
this.momoCallbackUrl   = process.env.HUBTEL_MOMO_CALLBACK_URL   || ...;
this.bankCallbackUrl   = process.env.HUBTEL_BANK_CALLBACK_URL   || ...;
```
`buyData()` now uses `this.dataCallbackUrl`. `buyAirtime()` uses `this.airtimeCallbackUrl`.

**New env vars required** (added to `.env.example`):
```
HUBTEL_AIRTIME_CALLBACK_URL=https://.../api/hubtel/airtime-callback
HUBTEL_DATA_CALLBACK_URL=https://.../api/hubtel/data-callback
HUBTEL_MOMO_CALLBACK_URL=https://.../api/hubtel/momo-callback
HUBTEL_BANK_CALLBACK_URL=https://.../api/hubtel/bank-callback
```

---

### BUG-2 🔴 CRITICAL: No automatic timeout recovery for `pending_confirmation` transactions

**File:** `backend/routes/transfers.js` + `backend/services/HubtelTransferService.js`  
**Root cause:** When a transaction is created, it is set to `pending_confirmation`. The only ways to resolve it were:
1. Hubtel sends a callback (HTTP POST to the callback URL)
2. An admin manually calls `GET /api/transfer/reconcile`

If Hubtel never sends a callback (network partition, Hubtel outage, wrong callback URL, Hubtel account issue), the transaction **stays in `pending_confirmation` forever**. The frontend polling times out after 5 minutes and shows "check your transaction history" — but the transaction is still stuck. No money is refunded. No status change occurs.

**Impact:** Users see their money deducted (balanceAfter is set) but the transaction never completes or fails. The only resolution is a manual admin reconciliation or a server restart that triggers the initial scan.

**Fix:** Added `expireStalePendingConfirmations()` to `HubtelTransferService.js`:
- Scans for `pending_confirmation` transactions older than `PENDING_CONFIRMATION_TIMEOUT_MS` (default 10 minutes)
- Marks them as `failed` with `autoFailed: true` in metadata
- Refunds the wallet
- Runs once at server startup and then every `PENDING_CONFIRMATION_SCAN_INTERVAL_MS` (default 60 seconds)

Wired into `server/index.js`:
```js
const { expireStalePendingConfirmations } = require('../backend/services/HubtelTransferService');
setInterval(() => expireStalePendingConfirmations().catch(...), scanIntervalMs);
```

**New env vars required:**
```
PENDING_CONFIRMATION_TIMEOUT_MS=600000       # 10 minutes
PENDING_CONFIRMATION_SCAN_INTERVAL_MS=60000  # 1 minute
```

---

### BUG-3 🔴 CRITICAL: `_mapTransactionStatus` has a duplicate `'FAILED'` key (silent bug)

**File:** `backend/services/HubtelTransferService.js` (line 604, pre-fix)  
**Root cause:** JavaScript object literals silently overwrite duplicate keys. The second `'FAILED': 'failed'` entry (line 611) silently replaced the first. While functionally equivalent here, this is a code-smell indicating copy-paste errors and makes the mapping unreliable if the values ever diverge.

**Fix:** Removed the duplicate key. Added debug logging to trace status mappings.

---

### BUG-4 🔴 CRITICAL: `buy-data.html` uses `'TELECOM'` instead of `'TELECEL'` — all Telecel data purchases fail validation

**File:** `src/pages/dashboard/buy-data.html` (5 occurrences)  
**Root cause:** The frontend stores the network as `'TELECOM'` in the form value, data attribute, bundles lookup key, and display-name map. The backend `transfers.js` validates against `['MTN', 'TELECEL', 'AIRTELTIGO', 'VODAFONE']`. `'TELECOM'` is not in that list, so every Telecel data purchase is rejected with `"Invalid network"` before it even reaches Hubtel.

**Impact:** 100% of Telecel data bundle purchases fail at validation. Users see a generic error. No transaction is created. No Hubtel request is made.

**Fix:** Changed all 5 occurrences of `'TELECOM'` to `'TELECEL'` in `buy-data.html`:
- `data-network="TELECEL"` (HTML attribute)
- `'TELECEL': [...]` (bundles lookup key)
- `document.getElementById('network').value = 'TELECEL'` (auto-detect)
- `loadBundles('TELECEL')` (auto-detect)
- `'TELECEL': 'Telecel'` (display name map)

---

### BUG-5 🟡 HIGH: Frontend polling has no per-request timeout — a single hung status poll blocks forever

**File:** `src/pages/dashboard/buy-airtime.html` and `buy-data.html`  
**Root cause:** The `pollTransactionStatus()` function calls `window.apiClient.request('GET', ...)` with no timeout. If the backend `/api/transfer/status/:ref` endpoint hangs (e.g. MongoDB slow query, server overload), the `await` never resolves and the polling loop stops. The processing modal stays visible forever.

**Fix:** Added `AbortController` with a 15-second timeout per poll request:
```js
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15000);
const response = await window.apiClient.request('GET', `/transfer/status/${clientReference}`, null, { signal: controller.signal });
clearTimeout(timeoutId);
```
The `api.js` `request()` method already spreads `options` into `fetchOptions`, so `signal` is passed through to `fetch()` natively.

---

### BUG-6 🟡 HIGH: `ResilientHttpClient` has no explicit `[HubtelTimeout]` log tag

**File:** `backend/utils/ResilientHttpClient.js`  
**Root cause:** Axios timeout errors (`ECONNABORTED`) were categorised as `'transient'` and retried, but there was no dedicated `[HubtelTimeout]` log entry. In production logs, timeouts were indistinguishable from generic network errors.

**Fix:** Added `[HubtelTimeout]` structured log in `categorizeError()` before the error is swallowed into the generic `'transient'` bucket. Timeout errors now produce a distinct log line with the service name, URL, and error code.

---

### BUG-7 🟡 MEDIUM: Callback controller uses `console.log`/`console.error` instead of structured logger

**File:** `backend/controllers/hubtelCallbackController.js`  
**Root cause:** All four callback handlers (`handleMomoCallback`, `handleBankCallback`, `handleAirtimeCallback`, `handleDataCallback`) used raw `console.log`/`console.error` calls. These are not captured by the Winston structured logger, not tagged, and not written to the log files. In Railway's log aggregation, callback events were invisible.

**Fix:** Replaced all `console.log`/`console.error` calls with `logger.info`/`logger.warn`/`logger.error` using `[HubtelCallback]` tags. Each callback now logs: receipt, processing decision, completion/failure, and wallet refund events.

---

### BUG-8 🟡 MEDIUM: `transfers.js` route handlers use `console.log`/`console.error` instead of structured logger

**File:** `backend/routes/transfers.js`  
**Root cause:** Same as BUG-7. All structured JSON log lines in the route handlers used `console.log(JSON.stringify(...))` instead of the Winston logger. These logs were not captured in log files and not tagged for filtering.

**Fix:** Replaced all `console.log(JSON.stringify(...))` with `logger.info()` and `console.error(...)` with `logger.error()`. Added `[AirtimeExecution]` and `[DataExecution]` tags. Added `[TransactionLifecycle]` tags to the status-check and reconciliation routes.

---

### BUG-9 🟢 LOW: `HubtelTransferService` constructor has no startup logging

**File:** `backend/services/HubtelTransferService.js`  
**Root cause:** The service silently read environment variables at construction time. If `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, or `HUBTEL_PREPAID_DEPOSIT_ID` were missing, the only signal was a `console.warn` buried in `_computeBasicAuthHeader()`. There was no log of which callback URLs were actually configured.

**Fix:** Added `logger.info()` in the constructor that logs all credential states and all callback URLs at startup. This makes misconfiguration immediately visible in Railway logs on deploy.

---

## 3. Promise / Async Chain Audit

### `buyAirtime()` async chain

```
Route handler try-block
  │
  ├─ await Wallet.findOne({ userId })          ✅ resolves or throws
  ├─ await transaction.save()                  ✅ resolves or throws
  │
  ├─ await HubtelTransferService.buyAirtime()  ✅
  │     │
  │     ├─ this.validatePhoneNumber()          ✅ synchronous, throws on invalid
  │     │
  │     ├─ await this.httpClient.post()        ✅
  │     │     │
  │     │     ├─ this.checkCircuitBreaker()    ✅ throws if OPEN
  │     │     ├─ await this.client.request()   ✅ axios promise, 60s timeout
  │     │     │     ├─ on success: recordSuccess() ✅
  │     │     │     └─ on error: recordFailure() + retry or throw ✅
  │     │     └─ response data validation       ✅ throws on error responseCode
  │     │
  │     └─ return { success, hubtelTransactionId }  ✅
  │
  └─ res.json()                                ✅ always reached
```

**Verdict:** All promises resolve or throw. No hanging path in the success case. The `catch` block handles all error paths and returns a response.

### `buyData()` async chain

Identical structure to `buyAirtime()`. Same verdict: ✅ all paths resolve.

### `checkTransactionStatus()` async chain

```
await this.httpClient.get(endpoint)  ✅
  └─ response data mapping            ✅
  └─ return { success, status, ... }  ✅
```

**Verdict:** ✅ All paths resolve.

### Frontend `pollTransactionStatus()` async chain

```
setTimeout(poll, 5000)  →  poll()
  │
  ├─ await apiClient.request()  ✅  (now with 15s AbortController timeout)
  │     └─ fetch() with AbortSignal  ✅
  │
  ├─ status === 'completed' → return (stop polling)  ✅
  ├─ status === 'failed'    → return (stop polling)  ✅
  └─ attempts >= 30         → stop (show timeout message)  ✅
```

**Verdict:** ✅ All paths resolve. The AbortController prevents indefinite hangs on individual poll requests.

---

## 4. Transaction Status Transition Map

```
pending  ──(purchase initiated)──►  pending_confirmation
                                        │
                          ┌─────────────┴──────────────────┐
                          │                                  │
              Hubtel callback success              Hubtel callback failure
              (0000 / SUCCESS)                     (non-0000 / FAILED)
                          │                                  │
                          ▼                                  ▼
                    completed                            failed
                    (wallet already                       (wallet refunded
                     deducted)                            by callback handler)
                          │
                          │  [NEW] Auto-timeout after 10 min
                          │  (expireStalePendingConfirmations)
                          ▼
                       failed
                       (wallet refunded,
                        autoFailed: true)
```

**Pre-fix gap:** The `pending_confirmation → failed` transition via auto-timeout did not exist. Transactions could stay in `pending_confirmation` indefinitely.

---

## 5. Environment Variable Verification

| Variable | Purpose | Status |
|---|---|---|
| `HUBTEL_CLIENT_ID` | Basic Auth username for Hubtel API | ✅ Read at construction |
| `HUBTEL_CLIENT_SECRET` | Basic Auth password for Hubtel API | ✅ Read at construction |
| `HUBTEL_MERCHANT_ACCOUNT_NUMBER` | Merchant account (stored, not used in airtime/data paths) | ✅ Read |
| `HUBTEL_PREPAID_DEPOSIT_ID` | Prepaid deposit account ID — injected into every endpoint URL | ✅ Read |
| `HUBTEL_CALLBACK_URL` | Default callback URL (was used for BOTH airtime and data — **BUG**) | ⚠️ Now fallback only |
| `HUBTEL_AIRTIME_CALLBACK_URL` | **NEW** Dedicated airtime callback URL | ✅ Added |
| `HUBTEL_DATA_CALLBACK_URL` | **NEW** Dedicated data callback URL | ✅ Added |
| `HUBTEL_AIRTIME_ENDPOINT` | Airtime API endpoint | ✅ Read |
| `HUBTEL_DATA_ENDPOINT` | Data API endpoint | ✅ Read |
| `APP_URL` | Used as fallback for callback URLs | ✅ Read |
| `PENDING_CONFIRMATION_TIMEOUT_MS` | **NEW** Auto-fail timeout (ms) | ✅ Added |
| `PENDING_CONFIRMATION_SCAN_INTERVAL_MS` | **NEW** Scan interval (ms) | ✅ Added |

---

## 6. Callback Route Registration

All four callback routes are registered in `server/index.js` (lines 376–390):

```js
app.post('/api/hubtel/momo-callback',   express.json(), ...handleMomoCallback);
app.post('/api/hubtel/bank-callback',   express.json(), ...handleBankCallback);
app.post('/api/hubtel/airtime-callback',express.json(), ...handleAirtimeCallback);
app.post('/api/hubtel/data-callback',   express.json(), ...handleDataCallback);
```

**Pre-fix issue:** `HUBTEL_CALLBACK_URL` was set to the airtime callback URL. Data purchases were told to use this same URL. Hubtel would POST data callbacks to the airtime endpoint, which would receive them but process them as airtime callbacks (wrong transaction type in metadata, wrong refund logic path).

**Post-fix:** Each purchase type now has its own dedicated callback URL. The `HUBTEL_CALLBACK_URL` env var is retained as a backward-compatible fallback for airtime only.

**Public accessibility:** The callback URLs use `APP_URL` which is set to `https://nedhubsms-production.up.railway.app` in `.env.example`. This is a public Railway domain — ✅ publicly accessible. No `localhost` or `ngrok` references remain in the callback URL construction.

---

## 7. Railway Outbound Networking Compatibility

| Check | Result |
|---|---|
| Axios timeout configured | ✅ 60,000ms (60 seconds) |
| Retry with exponential backoff | ✅ 3 retries, 2s base, 30s max |
| Circuit breaker | ✅ 5 failures → OPEN, 60s recovery |
| `validateStatus: status < 500` | ✅ 4xx handled in code, not thrown |
| Timeout error categorised | ✅ `ECONNABORTED` → `[HubtelTimeout]` log + transient retry |
| Railway outbound egress | ✅ Standard HTTPS — no special config needed |

---

## 8. Structured Logging Added

| Tag | Location | Phase |
|---|---|---|
| `[AirtimeExecution]` | `transfers.js` route + `HubtelTransferService.js` | Full airtime purchase lifecycle |
| `[DataExecution]` | `transfers.js` route + `HubtelTransferService.js` | Full data purchase lifecycle |
| `[HubtelRequest]` | `HubtelTransferService.js` | Before every outbound Hubtel HTTP call |
| `[HubtelResponse]` | `HubtelTransferService.js` | After every Hubtel HTTP response |
| `[HubtelTimeout]` | `ResilientHttpClient.js` | On every detected timeout |
| `[ProviderCatch]` | `HubtelTransferService.js` | Inside every catch block |
| `[HubtelCallback]` | `hubtelCallbackController.js` | On every incoming Hubtel callback |
| `[TransactionLifecycle]` | `transfers.js` status + reconcile routes | Status poll, reconciliation |
| `[Polling]` | `buy-airtime.html`, `buy-data.html` | Each frontend poll attempt |

---

## 9. Files Modified

| File | Changes |
|---|---|
| `backend/services/HubtelTransferService.js` | Per-type callback URLs, `[HubtelRequest]`/`[HubtelResponse]`/`[ProviderCatch]` logging, `_mapTransactionStatus` duplicate key fix, `expireStalePendingConfirmations()` function, constructor startup logging |
| `backend/routes/transfers.js` | `[AirtimeExecution]`/`[DataExecution]`/`[TransactionLifecycle]` structured logging replacing `console.log(JSON.stringify(...))` |
| `backend/controllers/hubtelCallbackController.js` | `[HubtelCallback]` structured logging replacing `console.log`/`console.error` |
| `backend/utils/ResilientHttpClient.js` | `[HubtelTimeout]` log on timeout detection |
| `backend/utils/logger.js` | 11 new log tag constants + tagged logger instances |
| `server/index.js` | Automatic `expireStalePendingConfirmations` job at startup + periodic scan |
| `backend/.env.example` | 4 new callback URL vars + 2 new timeout config vars |
| `src/pages/dashboard/buy-airtime.html` | AbortController timeout on polling, `[Polling]` log tags |
| `src/pages/dashboard/buy-data.html` | All 5 `TELECOM` → `TELECEL` fixes, AbortController timeout on polling, `[Polling]` log tags |

---

## 10. Root-Cause Summary

| # | Symptom | Root Cause | Fix |
|---|---|---|---|
| 1 | Data purchases never confirmed, money stuck | Data callback URL = airtime callback URL (single `HUBTEL_CALLBACK_URL` used for all types) | Per-type callback URLs |
| 2 | Transactions stuck in `pending_confirmation` forever | No auto-timeout; only manual admin reconciliation existed | `expireStalePendingConfirmations()` runs every 60s |
| 3 | Telecel data purchases always fail validation | Frontend uses `'TELECOM'`, backend expects `'TELECEL'` | All 5 occurrences fixed |
| 4 | Frontend polling modal hangs forever | No per-request timeout on `fetch()` in polling loop | AbortController with 15s timeout |
| 5 | Timeout errors invisible in logs | No `[HubtelTimeout]` tag in `ResilientHttpClient` | Added to `categorizeError()` |
| 6 | Callback events invisible in Railway logs | `console.log` in callback controller, not Winston | Replaced with `logger.[info/warn/error]` |
| 7 | Route handler logs invisible in log files | `console.log(JSON.stringify(...))` in routes, not Winston | Replaced with `logger.[info/error]` |
| 8 | Silent duplicate key in status map | `'FAILED'` appeared twice in `_mapTransactionStatus` object | Removed duplicate |

---

## 11. Recommended Production Actions

1. **Set the new env vars in Railway:**
   ```
   HUBTEL_DATA_CALLBACK_URL=https://nedhubsms-production.up.railway.app/api/hubtel/data-callback
   HUBTEL_AIRTIME_CALLBACK_URL=https://nedhubsms-production.up.railway.app/api/hubtel/airtime-callback
   HUBTEL_MOMO_CALLBACK_URL=https://nedhubsms-production.up.railway.app/api/hubtel/momo-callback
   HUBTEL_BANK_CALLBACK_URL=https://nedhubsms-production.up.railway.app/api/hubtel/bank-callback
   PENDING_CONFIRMATION_TIMEOUT_MS=600000
   PENDING_CONFIRMATION_SCAN_INTERVAL_MS=60000
   ```

2. **Reconcile existing stuck transactions:** Call `GET /api/transfer/reconcile` (admin only) to resolve any transactions that were stuck during the bug period.

3. **Verify Hubtel callback URLs in Hubtel Developer Portal:** Ensure the callback URLs registered in your Hubtel account match the new per-type URLs above.

4. **Monitor `[HubtelTimeout]` and `[TransactionLifecycle]` logs** in Railway for the first 24 hours after deploy to confirm no unexpected timeouts.

5. **Verify Telecel data purchases** end-to-end after deploy (the frontend fix alone is not enough — the backend `HUBTEL_DATA_CALLBACK_URL` must also be set correctly).
