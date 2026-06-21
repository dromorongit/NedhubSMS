/**
 * Hubtel 403 Forensic Audit Script
 * Run this script to perform a comprehensive Hubtel authorization forensic audit
 *
 * Usage: node backend/scripts/run-hubtel-audit.js
 */

require('dotenv').config({ path: '../.env' });
const HubtelAuthAuditService = require('../services/HubtelAuthAuditService');

async function runAudit() {
  console.log('='.repeat(70));
  console.log('[Hubtel403] HUBTEL 403 FORENSIC AUDIT');
  console.log('='.repeat(70));
  console.log('[HubtelAuth] Timestamp:', new Date().toISOString());
  console.log('[HubtelAuth] Environment:', process.env.NODE_ENV || 'development');
  console.log('[ProviderFailure] '.padStart(70, '='));

  const results = await HubtelAuthAuditService.runAuthAudit();

  // Print the formatted diagnostic report
  HubtelAuthAuditService.logAuditReport(results);

  // Print structured logging tags legend
  console.log('\n' + '[HubtelValidation] STRUCTURED LOGGING TAGS USED:');
  console.log('  [Hubtel403] - HTTP 403 authorization failures');
  console.log('  [HubtelAuth] - Authentication and credentials checks');
  console.log('  [HubtelValidation] - Merchant account and service validation');
  console.log('  [ProviderFailure] - Network and provider availability failures');

  // Print failure classification summary (Requirement 7)
  console.log('\n' + '[Hubtel403] FINAL FAILURE CLASSIFICATION:');
  console.log('-'.repeat(50));

  if (results.failures.length === 0) {
    console.log('  Status: No failures detected');
    console.log('  Classification: All checks passed successfully');
  } else {
    const primaryType = results.diagnostics?.summary?.primaryFailureType;
    console.log(`  Primary Failure Type: ${primaryType || 'unknown'}`);
    console.log(`  Root Cause: ${results.diagnostics?.summary?.rootCause || 'Unknown'}`);
    console.log(`  Recommended Action: ${results.diagnostics?.summary?.recommendedAction || 'Review logs'}`);
  }

  // Print all failure types for reference
  console.log('\n[HubtelValidation] FAILURE TYPES DETECTED:');
  const failureTypes = {
    invalid_credentials: 'Invalid credentials',
    merchant_mismatch: 'Merchant account mismatch',
    deposit_id_mismatch: 'Deposit ID mismatch',
    airtime_service_not_enabled: 'Airtime service not enabled',
    insufficient_float: 'Insufficient airtime float',
    environment_mismatch: 'Environment mismatch',
    provider_validation_error: 'Provider validation error',
    network_error: 'Network error'
  };

  const detectedTypes = new Set(results.failures.map(f => f.type));
  if (detectedTypes.size > 0) {
    detectedTypes.forEach(type => {
      console.log(`  [${type}] ${failureTypes[type] || type}`);
    });
  }

  console.log('\nDone.');
  process.exit(results.failures.length > 0 ? 1 : 0);
}

runAudit().catch(err => {
  console.error('[ProviderFailure] Audit failed with error:', err);
  process.exit(1);
});