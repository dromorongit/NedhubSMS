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
provider status response body (statusData = response.data.data || response.data):

- Field read, gross mode (default, current behaviour):
    statusData.amount, falling back to statusData.totalAmount
- Field read, net mode (HUBTEL_AMOUNT_MODE=net):
    statusData.netAmount, then statusData.net_amount, then
    statusData.amountAfterFee, then the gross fields above
- Exact comparison (callbackVerificationService.assessPayment):
    providerAmount >= payment.amount
  where payment.amount is the amount stored on OUR payment record. Amounts
  from the callback body and from the provider are never used to credit more
  than the stored amount.

Config flag `HUBTEL_AMOUNT_MODE` (set in backend/.env, default `gross`):

- gross (default): providerAmount = statusData.amount || statusData.totalAmount
- net: providerAmount = statusData.netAmount || statusData.net_amount ||
  statusData.amountAfterFee || statusData.amount || statusData.totalAmount

The assumed status words and field names above MUST be verified against a real
Hubtel response captured with `scripts/inspect-hubtel-status.js NH-REF payment`
(redact the output) before switching to net mode or relying on the mapping in
production. No code change is required to switch modes.

## Capture a real provider response

Run (on Railway, never against a local machine with real credentials unless
intended):

    node scripts/inspect-hubtel-status.js <clientReference> payment

The script makes ONE GET to the provider status endpoint, prints the HTTP
status, the response keys (nested to 2 levels), the value of every field whose
name contains status/code/amount/charge/fee, and the mapper decision. It
redacts values longer than 40 characters and never prints names, phone
numbers, emails or secrets. Drop a redacted response into
tests/fixtures/hubtel/ and re-run the callback status tests to validate the
mapping against reality.
