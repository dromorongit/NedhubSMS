# Callback / Webhook Reconcile Runbook

**Do not commit this file.** It is an operational reference for the repository owner.

## Purpose

The Send SMS / payment / transfer / purchase callback handlers verify every
callback server-to-server with the provider and only answer `200`. If a callback
arrives while the provider is unreachable, or while the transaction is still
pending, the transaction is intentionally left in a waiting state. The
reconcile script (`scripts/reconcile-pending.js`) re-checks those waiting
transactions against the provider and applies the same idempotent rules the
callback uses.

Nothing in the application schedules `reconcile-pending.js` automatically. It
must be scheduled by the operator (e.g. cron) or run manually.

## Schedule as a dry run every 15 minutes (Railway cron)

Do not use system cron. Schedule the dry run with Railway's cron schedule
setting (Railway dashboard -> Cron jobs, or `railway.toml`). Example:

```toml
[cron]
  name = "reconcile-pending-dry-run"
  schedule = "*/15 * * * *"
  command = "node scripts/reconcile-pending.js --env-check --apply=false --minutes 10"
```

Confirm the exact `railway.toml` cron schema against Railway's documentation;
the important part is the `schedule` field and the command below.

Flags:
- `--env-check` — required by the script; prints the database host and refuses
  to run without it (safety guard).
- `--apply=false` — dry run. Prints what WOULD change without writing anything.
- `--minutes 10` — only reconcile records older than 10 minutes (avoids racing
  a fresh callback that is still in flight).

Run first as a dry run for at least 24–48 hours and review the log before
switching to `--apply=true`.

## What to do with the output

Read the cron job's output in the Railway dashboard (Deployments -> Cron jobs ->
reconcile-pending-dry-run -> View logs). Each dry-run line looks like:

```
PAYMENT reference=NH-... ourAmount=50 providerStatus=paid providerAmount=50 -> would credit
TRANSACTION reference=TXN-... type=AIRTIME_PURCHASE ourAmount=5 providerStatus=success -> would complete
```

Review the log:
- `would credit` / `would complete` / `would refund` — these are pending
  records the provider has confirmed. Safe to apply once you have verified the
  log matches your expectations.
- `providerStatus=unavailable` / `leave waiting` — provider could not be
  reached; leave alone, it will be retried on the next run.
- `would not credit` / `no change` — provider does not confirm payment; no
  action.

When you are confident the dry-run output is correct, switch to
`--apply=true` (still `--env-check`) so the script actually credits/debits and
marks records terminal. Continue monitoring the log.

## Safety notes

- Never run `--apply=true` against a production database without first running
  the dry run and inspecting the output.
- The script is read-only in dry-run mode (`--apply=false`). It never writes.
- The script connects to `MONGODB_URI`. Ensure the host it prints matches your
  intended database before allowing it to apply changes.
- If the provider returns an unexpected status, the transaction stays pending
  (never failed or paid) and is retried on the next reconcile run.

## Conservative provider status mapping

Only explicit success/failure words are trusted:

- HubtelPaymentService._mapHubtelStatus (backend/services/HubtelPaymentService.js):
  - paid: SUCCESS, SUCCESSFUL, Paid, PAID
  - failed: FAILED
  - pending: pending, PENDING, Unpaid, Refunded, 1002, CANCELLED, cancelled,
    and anything else not explicitly listed above
- HubtelTransferService._mapTransactionStatus and
  HubtelCommissionService._mapTransactionStatus:
  - success: SUCCESS, SUCCESSFUL, Paid, PAID
  - failed: FAILED
  - pending: pending, PENDING, Unpaid, Refunded, CANCELLED, cancelled,
    and anything else not explicitly listed above

'Unpaid', 'Refunded' and '1002' no longer map to failed. A refunded payment
never credits and is not marked failed; it stays pending and is listed by
`scripts/reconcile-pending.js` for manual review. Every callback/assess path
treats only provider.status === 'failed' as a failure; everything else leaves
the record waiting.

## Amount handling

The amount the code reads for a Hubtel payment status check comes from the
provider status response body. `statusData = response.data` (HubtelPaymentService
reads `response.data` directly; the inner status is extracted by
`_extractStatus()` from the top level or one level down under `data`, under the
field names `status` and `transactionStatus`).

- Field read, gross mode (default, current behaviour):
    statusData.amount, falling back to statusData.totalAmount
- Field read, net mode (HUBTEL_AMOUNT_MODE=net):
    statusData.netAmount, then statusData.net_amount, then
    statusData.amountAfterFee. In net mode there is NO gross fallback: if no
    net field is present the amount is unknown (null), the payment stays
    pending, and one warning is logged (`[HubtelPaymentService] HUBTEL_AMOUNT_MODE=net
    but no net amount field present ... amount unknown, payment will stay pending`).
- Exact comparison (callbackVerificationService.assessPayment), whole pesewas:
    Math.round(providerAmount*100) >= Math.round(payment.amount*100)
  where payment.amount is the amount stored on OUR payment record. Amounts from
  the callback body and from the provider are never used to credit more than the
  stored amount. If providerAmount is null (unknown) the payment stays pending.

Config flag `HUBTEL_AMOUNT_MODE` (set in backend/.env, default `gross`):

- gross (default): providerAmount = statusData.amount || statusData.totalAmount
- net: providerAmount = statusData.netAmount || statusData.net_amount ||
  statusData.amountAfterFee; if all are absent, providerAmount = null (unknown)

## Startup config check

Each Hubtel service constructor logs ONE warning at startup when a required
status-check setting is missing (HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET, which
build the Basic Auth header used by all three status-check endpoints). The
services log `Hubtel credentials not configured` / `[HubtelAuth] Hubtel
credentials not configured` and `basicAuthHeader` is null, so every subsequent
status check fails fast and the payment/transaction stays pending.

## Provider status-check URLs (do not change; verify against Hubtel's docs)

All three status methods make ONE GET to a provider status endpoint and stay
pending on 401/403/404 (they log one clear message with the HTTP status and
return `{ ok: false }`, so assess functions leave the record waiting).

1. Payment — backend/services/HubtelPaymentService.js
   - URL built: `${this.statusEndpoint}/${clientReference}/status`
     where `this.statusEndpoint = process.env.HUBTEL_STATUS_ENDPOINT ||
     'https://api-txnstatus.hubtel.com/transactions'` (line ~221).
     Example: `https://api-txnstatus.hubtel.com/transactions/NH-xyz/status`
   - Config values (names only): HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET (Basic
     Auth), HUBTEL_STATUS_ENDPOINT.
   - On 401/403/404: the HTTP client rejects, `checkTransactionStatus` throws,
     `checkProviderStatus` returns `{ ok: false, error }`, and
     `assessPayment` returns `provider_unavailable` / `leave_pending` — the
     payment stays pending with a clear message logged including the HTTP status.

2. Transfer (airtime/data/MoMo/bank) — backend/services/HubtelTransferService.js
   - URL built: `${this.momoEndpoint}/transactions/${clientReference}/status`
     where `this.momoEndpoint = process.env.HUBTEL_MOMO_ENDPOINT ||
     'https://smp.hubtel.com/api/merchants'` (line ~837).
     Example: `https://smp.hubtel.com/api/merchants/transactions/NH-xyz/status`
   - Config values (names only): HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET (Basic
     Auth), HUBTEL_MOMO_ENDPOINT.
   - On 401/403/404: same as payment — stays pending, logs one clear message
     with the HTTP status.

3. Commission (TV/utility) — backend/services/HubtelCommissionService.js
   - URL built: `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/transactions/${clientReference}/status`
     where `this.baseURL = process.env.HUBTEL_COMMISSION_BASE_URL ||
     'https://cs.hubtel.com/commissionservices'` (line ~696).
     Example: `https://cs.hubtel.com/commissionservices/api/merchants/<ACCOUNT>/transactions/NH-xyz/status`
   - Config values (names only): HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET (Basic
     Auth), HUBTEL_MERCHANT_ACCOUNT_NUMBER, HUBTEL_COMMISSION_BASE_URL.
   - On 401/403/404: same as payment — stays pending, logs one clear message
     with the HTTP status.

## Provider response-shape extraction

Each service extracts the inner transaction status with `_extractStatus(body)`:
it looks at the TOP LEVEL of the response body and ONE LEVEL DOWN under a
`data` object, under the field names `status` and `transactionStatus`, returning
the first non-empty value found. The top-level `responseCode` (e.g. '0000'
meaning the API call itself succeeded) is never used by itself to mark a
transaction paid or failed.

Shapes all recognised (fixtures in tests/fixtures/hubtel/, marked assumed):
- `{ status: 'Paid' }` (top level)
- `{ transactionStatus: 'Paid' }` (top level)
- `{ data: { status: 'Paid' } }` (one level down)
- `{ data: { transactionStatus: 'Paid' } }` (one level down)

## Cancelled handling

- Airtime / data / TV / utility purchases (wallet debited at purchase time):
  an explicit provider `Cancelled` or `Canceled` is treated as a failure that
  triggers the single idempotent refund (assessPurchase, normalized rawStatus).
- Top-up payments: `Cancelled` stays pending (no money moved) — assessPayment
  leaves it pending.
- `Cancelled`/`Canceled` are NOT in the mapper's paid/failed lists, so the
  mappers map them to pending; assess functions add the service-specific refund
  logic for purchases.

## Reconcile: NEEDS MANUAL REVIEW

`scripts/reconcile-pending.js` now prints a `NEEDS MANUAL REVIEW` section listing
every waiting purchase older than 24 hours with its reference, our amount and
the provider status (no personal data).

## Frontend: payment status polling on return from Hubtel

The payment return pages (`src/pages/dashboard/payment-success.html` and
`payment-error.html`) previously called `GET /api/payments/status/:clientReference`
ONCE with no retries and no pending-confirmation message. They now use
`window.apiClient.checkPaymentStatusWithRetries(reference)` (src/utils/api.js):
3 attempts, 5 seconds apart. While the provider reports `pending`, the page
shows a clear "Payment pending, we are confirming it..." message and hides it
once the status resolves. Files changed:
- src/utils/api.js (added checkPaymentStatusWithRetries)
- src/pages/dashboard/payment-success.html
- src/pages/dashboard/payment-error.html
