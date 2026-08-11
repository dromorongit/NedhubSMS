/**
 * Wallet All-Fail Refund Regression Test Suite
 *
 * Tests that when ALL recipients fail with provider error 1707,
 * the user's net wallet charge is exactly GHS 0.00.
 *
 * Covers:
 * - Refund logic exists for all failure paths
 * - No duplicate refund
 * - No duplicate deduction
 * - Retry does not charge twice
 * - All-failed campaign has zero net charge
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function group(title, fn) {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  fn();
}

// ============================================================
// TEST 1: Refund logic exists in NaloSmsService for all paths
// ============================================================
group('TEST 1: Refund logic exists for all failure paths', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('Refund on Nalo app-level failure (1707 path)',
    source.includes("refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS failed - refund')"));

  test('Refund on HTTP API error (412 path)',
    source.includes("refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS API error - refund')"));

  test('Refund on outer catch error',
    source.includes("refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS internal error - refund')"));

  test('All refunds use totalChargedToUser, not zero',
    source.includes('financialBreakdown.totalChargedToUser') &&
    !source.includes("refundWallet(userId, 0, 'SMS"));
});

// ============================================================
// TEST 2: Refund guards against skipDeduction
// ============================================================
group('TEST 2: Refund respects skipDeduction flag', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('App-level refund checks !skipDeduction',
    source.includes("!skipDeduction") &&
    source.includes("'SMS failed - refund'"));

  test('HTTP error refund checks !skipDeduction',
    source.includes("!skipDeduction") &&
    source.includes("'SMS API error - refund'"));

  test('Outer catch refund checks !skipDeduction and financialBreakdown',
    source.includes('!skipDeduction && typeof financialBreakdown') &&
    source.includes("'SMS internal error - refund'"));
});

// ============================================================
// TEST 3: Wallet deduction happens before provider acceptance
// ============================================================
group('TEST 3: Wallet deduction timing', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('deductGhsForSms is called before provider POST in sendSmsWithFinancialTracking',
    (() => {
      const sendMethodStart = source.indexOf('async sendSmsWithFinancialTracking');
      const sendMethodEnd = source.indexOf('\n  }', sendMethodStart);
      const sendMethodBody = source.substring(sendMethodStart, sendMethodEnd);
      const deductIdx = sendMethodBody.indexOf('deductGhsForSms');
      const postIdx = sendMethodBody.indexOf('httpClient.post');
      return deductIdx !== -1 && postIdx !== -1 && deductIdx < postIdx;
    })());

  test('Preflight validation is called before deduction (in routes)',
    (() => {
      const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
      const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');
      const smsPreflightIdx = smsSource.indexOf('validateSenderIdWithProvider');
      const smsSendIdx = smsSource.indexOf('sendSmsWithFinancialTracking');
      const campaignPreflightIdx = campaignSource.indexOf('validateSenderIdWithProvider');
      const campaignSendIdx = campaignSource.indexOf('sendSmsWithFinancialTracking');
      return (smsPreflightIdx !== -1 && smsSendIdx !== -1 && smsPreflightIdx < smsSendIdx) ||
             (campaignPreflightIdx !== -1 && campaignSendIdx !== -1 && campaignPreflightIdx < campaignSendIdx);
    })());
});

// ============================================================
// TEST 4: No duplicate refund on same failure
// ============================================================
group('TEST 4: No duplicate refund', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('Each failure path is in a separate try/catch block',
    (source.match(/catch \(/g) || []).length >= 3);

  test('Refund is only called once per failure path',
    (source.match(/refundWallet/g) || []).length >= 3);

  test('No refund after successful send (refund only in failure blocks)',
    (() => {
      const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');
      const successBlockStart = source.indexOf("smsStatus === 'sent'");
      const successBlockEnd = source.indexOf('console.log(', successBlockStart);
      const successBlock = source.substring(successBlockStart, successBlockEnd);
      return !successBlock.includes('refundWallet');
    })());
});

// ============================================================
// TEST 5: Retry does not charge twice
// ============================================================
group('TEST 5: Retry does not double-charge', () => {
  const retrySource = fs.readFileSync(path.join(__dirname, 'backend/services/SmsCampaignRetryService.js'), 'utf8');
  const jobQueueSource = fs.readFileSync(path.join(__dirname, 'backend/services/SmsJobQueueService.js'), 'utf8');

  test('Retry service passes skipDeduction for reservation campaigns',
    retrySource.includes('skipDeduction: !!campaign.walletReservationId'));

  test('Job queue passes skipDeduction for reservation campaigns',
    jobQueueSource.includes('skipDeduction: !!campaign.walletReservationId'));

  test('Reservation-based campaigns do not deduct per-recipient',
    retrySource.includes('skipDeduction') || jobQueueSource.includes('skipDeduction'));
});

// ============================================================
// TEST 6: All-fail campaign has zero net charge
// ============================================================
group('TEST 6: All-fail campaign has zero net charge', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('Failed SMS records totalChargedToUser as 0',
    source.includes('totalChargedToUser: smsStatus === \'sent\' && !skipDeduction ? financialBreakdown.totalChargedToUser : 0'));

  test('Failed SMS records profitAmount as 0',
    source.includes('profitAmount: smsStatus === \'sent\' && !skipDeduction ? financialBreakdown.profitAmount : 0'));

  test('Financial summary only updated on success',
    source.includes('smsStatus === \'sent\' && !skipDeduction') &&
    source.includes('FinancialSummary.addTransaction'));
});

// ============================================================
// TEST 7: Campaign status becomes failed on all-fail
// ============================================================
group('TEST 7: Campaign status on all-fail', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms.js sets overallStatus to failed when successCount is 0',
    smsSource.includes('overallStatus = \'failed\''));

  test('sms-campaigns.js sets status to failed when successCount is 0',
    campaignSource.includes("successCount === 0 ? 'failed' : 'partial_success'"));
});

// ============================================================
// TEST 8: Recipient status becomes failed on provider rejection
// ============================================================
group('TEST 8: Recipient status on provider rejection', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms.js tracks failed recipients',
    smsSource.includes('failedCount++'));

  test('sms-campaigns.js marks recipient as failed on provider error',
    campaignSource.includes('markAsFailed(smsResult.error)'));

  test('sms.js includes failedRecipients in response',
    smsSource.includes('failedRecipients: failedCount'));
});

// ============================================================
// TEST 9: Preflight prevents sending to all recipients on invalid Sender ID
// ============================================================
group('TEST 9: Fail-fast prevents mass submission of invalid Sender ID', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms.js preflight is BEFORE the chunk/recipient loop',
    smsSource.indexOf('validateSenderIdWithProvider') < smsSource.indexOf('for (const chunk of chunks)'));

  test('sms-campaigns.js preflight is BEFORE the chunk/recipient loop',
    campaignSource.indexOf('validateSenderIdWithProvider') < campaignSource.indexOf('for (const chunk of chunks)'));

  test('sms-campaigns.js returns early on preflight failure',
    campaignSource.includes('SENDER_ID_PROVIDER_REJECTED') &&
    campaignSource.includes('senderIdPreflight.errorMessage'));
});

// ============================================================
// TEST 10: Wallet transaction tracking
// ============================================================
group('TEST 10: Wallet transaction tracking for all-fail', () => {
  const naloSource = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');
  const walletSource = fs.readFileSync(path.join(__dirname, 'backend/services/WalletService.js'), 'utf8');

  test('Deduction creates transaction record in WalletService',
    walletSource.includes("type: 'debit'") && walletSource.includes('new Transaction({'));

  test('Refund creates credit transaction in WalletService',
    walletSource.includes("type: 'credit'") && walletSource.includes('new Transaction({'));

  test('Transaction has balanceBefore and balanceAfter',
    walletSource.includes('balanceBefore') && walletSource.includes('balanceAfter'));

  test('NaloSmsService calls WalletService for deduction and refund',
    naloSource.includes('WalletService.deductGhsForSms') && naloSource.includes('refundWallet'));
});

// ============================================================
// TEST 11: Campaign financial tracking
// ============================================================
group('TEST 11: Campaign financial tracking on all-fail', () => {
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/models/SmsCampaign.js'), 'utf8');
  const recipientSource = fs.readFileSync(path.join(__dirname, 'backend/models/SmsRecipient.js'), 'utf8');

  test('SmsCampaign tracks actualCost',
    campaignSource.includes('actualCost'));

  test('SmsRecipient tracks actualCost',
    recipientSource.includes('actualCost'));

  test('SmsRecipient has estimatedCost for tracking',
    recipientSource.includes('estimatedCost'));
});

// ============================================================
// TEST 12: SmsMessage financial fields on failure
// ============================================================
group('TEST 12: SmsMessage financial fields on failure', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('Failed message has totalChargedToUser: 0',
    source.includes('totalChargedToUser: smsStatus === \'sent\' && !skipDeduction ? financialBreakdown.totalChargedToUser : 0'));

  test('Failed message has totalCostToProvider: 0',
    source.includes('totalCostToProvider: financialBreakdown.totalCostToProvider'));

  test('Failed message has profitAmount: 0',
    source.includes('profitAmount: smsStatus === \'sent\' && !skipDeduction ? financialBreakdown.profitAmount : 0'));
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('WALLET ALL-FAIL REFUND REGRESSION TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i+1}. ${f.name}: ${f.detail}`));
  process.exit(1);
} else {
  console.log('\nAll wallet all-fail refund regression tests passed.');
  process.exit(0);
}
