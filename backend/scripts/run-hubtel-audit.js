/**
 * Hubtel Authorization Audit Script
 * Run this script to perform a comprehensive Hubtel authorization audit
 * 
 * Usage: node backend/scripts/run-hubtel-audit.js
 */

require('dotenv').config({ path: '../.env' });
const HubtelAuthAuditService = require('../services/HubtelAuthAuditService');

async function runAudit() {
  console.log('='.repeat(60));
  console.log('HUBTEL AUTHORIZATION AUDIT');
  console.log('='.repeat(60));
  console.log('Timestamp:', new Date().toISOString());
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log(''.padStart(60, '='));

  const results = await HubtelAuthAuditService.runAuthAudit();
  
  // Print the formatted report
  HubtelAuthAuditService.logAuditReport(results);

  // Print summary
  console.log('\nSUMMARY BY FAILURE TYPE:');
  console.log('-'.repeat(40));
  
  const failureTypes = {
    invalid_credentials: 'Invalid credentials',
    merchant_mismatch: 'Merchant account mismatch',
    deposit_id_mismatch: 'Deposit ID mismatch',
    airtime_service_not_enabled: 'Airtime service not enabled',
    account_authorization_issue: 'Account authorization issue',
    environment_mismatch: 'Environment mismatch',
    provider_validation_error: 'Provider validation error',
    provider_unavailable: 'Provider unavailable',
    network_error: 'Network error'
  };

  results.failures.forEach(failure => {
    const type = failure.type;
    const message = failureTypes[type] || type;
    console.log(`  [${type}] ${message}`);
    if (failure.fullErrorPayload) {
      console.log(`    Details: ${JSON.stringify(failure.fullErrorPayload)}`);
    }
  });

  if (results.failures.length === 0) {
    console.log('  No failures detected - authorization checks passed!');
  }

  console.log('\nDone.');
  process.exit(results.failures.length > 0 ? 1 : 0);
}

runAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});