# Hubtel Authorization Audit - Implementation Report

## Overview
This audit implements comprehensive Hubtel Direct API authorization validation with detailed logging and failure classification.

## Files Modified/Created

### 1. `backend/services/HubtelAuthAuditService.js` (NEW)
Comprehensive authorization audit service that:
- Verifies Hubtel credentials configuration
- Validates merchant account number format
- Detects environment mismatch (sandbox vs production)
- Tests API connectivity with merchant account
- Verifies prepaid deposit ID belongs to merchant account (check #4)
- Checks if airtime disbursement is enabled on Hubtel account (check #5)
- Produces detailed failure classification reports

### 2. `backend/services/HubtelTransferService.js` (MODIFIED)
Enhanced with:
- Added `LogTags` constants for structured logging
- Added `_maskClientId()` method for secure credential masking
- Added `_logNon2xxResponse()` method to capture full response bodies for non-2xx responses
- **CRITICAL**: Added explicit 403 response handling as failures in all methods
- Enhanced `sendMobileMoney()`, `sendToBank()`, `buyAirtime()`, and `buyData()` with:
  - Auth context logging (merchant account, deposit ID, endpoint URL, masked client ID, callback URL)
  - Full error payload capture in logs
  - 403-specific logging with `[Hubtel403]` tag

### 3. `backend/routes/transfers.js` (MODIFIED)
Enhanced with:
- Added LogTags for structured logging
- **CRITICAL**: Added wallet reservation release on 4xx/5xx errors for airtime and data purchases
- Enhanced error handling with HTTP status detection
- Full error payload capture in transaction metadata

### 4. `backend/routes/admin.js` (MODIFIED)
Added:
- Admin endpoint: `GET /api/admin/hubtel/auth-audit` (admin/super_admin only)
- Returns comprehensive audit results with failure classification

### 5. `backend/utils/logger.js` (MODIFIED)
Added new log tags:
- `[HubtelAuth]` - Authorization-related logging
- `[Hubtel403]` - Explicit 403 error logging
- `[HubtelValidation]` - Validation failures logging
- `[ProviderFailure]` - Provider-level failures logging

### 6. `server/index.js` (MODIFIED)
Added:
- Startup Hubtel authorization audit on server initialization

### 7. `backend/scripts/run-hubtel-audit.js` (NEW)
CLI script to run the audit manually:
```bash
node backend/scripts/run-hubtel-audit.js
```

## Audit Checks Performed

| # | Check | Description | Failure Type | Requirements Addressed |
|---|-------|-------------|--------------|------------------------|
| 1 | Credentials Configured | HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET presence | `invalid_credentials` | #1, #2 (partial) |
| 2 | Merchant Account Format | Validates merchant account format | `invalid_format` (warning) | #8 |
| 3 | Environment Check | Detects sandbox in production or vice versa | `environment_mismatch` | #11 |
| 4 | Prepaid Deposit Accessibility | Verifies deposit ID belongs to merchant account | `deposit_id_mismatch` | #9 |
| 5 | API Connectivity | Tests connection to Hubtel API with merchant account | `merchant_mismatch`, `account_authorization_issue` | #7 |
| 6 | Airtime Service Enabled | Checks if airtime disbursement is enabled | `airtime_service_not_enabled` | #9 |

## Structured Logging Tags

| Tag | Purpose | Requirements Addressed |
|-----|---------|------------------------|
| `[HubtelAuth]` | General authorization context and full response bodies | #1, #6 |
| `[Hubtel403]` | Explicit 403 Forbidden responses with full error payload | #2, #6, #10 |
| `[HubtelValidation]` | Validation failures and merchant/deposit verification | #6, #8, #9 |
| `[ProviderFailure]` | Provider-level failures (4xx/5xx responses) | #4, #5, #11 |

## Log Fields Captured for Non-2xx Responses

- `merchantAccountNumber` - The configured merchant account
- `prepaidDepositId` - The configured prepaid deposit ID
- `endpointUrl` - Full URL of the Hubtel endpoint
- `clientIdHash` - Masked client ID (first 4 + last 4 chars)
- `callbackUrl` - The configured callback URL
- `fullResponseBody` / `fullErrorPayload` - Complete Hubtel error response
- `httpStatus` - HTTP status code
- `responseHeaders` - Response headers for debugging
- `is4xx`, `is5xx` - Boolean flags for error categorization

## API Endpoint

```
GET /api/admin/hubtel/auth-audit
Authorization: Bearer <admin_token>
```

Response:
```json
{
  "success": true,
  "overallStatus": "success|warning|failed",
  "checks": { ... },
  "failures": [
    {
      "check": "string",
      "type": "failure_type",
      "message": "Human readable message",
      "severity": "critical|error|warning",
      "fullErrorPayload": { ... }
    }
  ],
  "warnings": [ ... ],
  "summary": {
    "totalChecks": number,
    "failureCount": number,
    "warningCount": number
  }
}
```

## Failure Classification Types

| Type | Description |
|------|-------------|
| `invalid_credentials` | HUBTEL_CLIENT_ID or HUBTEL_CLIENT_SECRET not configured or invalid (401) |
| `merchant_mismatch` | Merchant account number mismatch (403) |
| `deposit_id_mismatch` | Prepaid deposit ID does not belong to the configured merchant account (403) |
| `airtime_service_not_enabled` | Airtime disbursement service is not enabled on Hubtel account (403) |
| `account_authorization_issue` | General account authorization problem (403) |
| `environment_mismatch` | Sandbox endpoint in production or vice versa |
| `provider_validation_error` | Hubtel returned client error (4xx) |
| `provider_unavailable` | Hubtel returned server error (5xx) |
| `network_error` | No response received from Hubtel |

## Key Implementation Details

### Requirement 1-2: Full Response Body Logging
Every non-2xx response logs the complete body plus:
- Merchant account number
- Prepaid deposit ID  
- Endpoint URL
- Client ID hash (masked)
- Callback URL

### Requirement 3: HTTP 403 as Failures
All methods (`sendMobileMoney`, `sendToBank`, `buyAirtime`, `buyData`) now check `response.status === 403` explicitly and throw errors rather than proceeding.

### Requirement 4-5: Immediate Transaction Failure & Wallet Release
In `backend/routes/transfers.js`:
```javascript
if (is4xx || is5xx) {
  // Release wallet reservation
  await Wallet.findOneAndUpdate({ userId }, { $inc: { balance: amount } });
}
// Mark transaction as failed
transaction.status = 'failed';
```

### Requirement 6: Structured Log Tags
Added `[HubtelAuth]`, `[Hubtel403]`, `[HubtelValidation]`, `[ProviderFailure]` tags used throughout.

### Requirement 7-9: Merchant/Deposit/Airtime Verification
`_checkApiConnectivity()` tests the merchant endpoint
`_checkPrepaidDeposit()` verifies deposit belongs to merchant
`_checkAirtimeService()` tests airtime disbursement enablement

### Requirement 10: Complete 403 Error Payload
403 responses log with `[Hubtel403]` tag including the full error payload:
```javascript
logger.error(LogTags.HUBTEL_403 + ' Authorization denied by Hubtel', {
  fullErrorPayload: JSON.stringify(data),
  // ... other fields
});
```

### Requirement 11: Failure Classification Report
The audit returns a `failures` array with specific failure types that classify the root cause.