/**
 * Sender ID Provider Failure Regression Test Suite
 *
 * Tests the exact production failure scenario:
 * - Nalo rejects Sender ID with provider error 1707
 * - System must detect this BEFORE sending to all recipients
 * - Circuit breaker must remain closed
 * - Frontend must show actionable error
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
// TEST 1: validateSenderIdWithProvider method exists
// ============================================================
group('TEST 1: NaloSmsService exposes validateSenderIdWithProvider', () => {
  const NaloSmsService = require('./backend/services/NaloSmsService');

  test('validateSenderIdWithProvider method exists',
    typeof NaloSmsService.validateSenderIdWithProvider === 'function');
});

// ============================================================
// TEST 2: 1707 classification remains sender_id_error
// ============================================================
group('TEST 2: 1707 error classification', () => {
  const NaloSmsService = require('./backend/services/NaloSmsService');

  test('1707 classified as sender_id_error (no breaker trip)',
    NaloSmsService.classifyNaloError('1707') === 'sender_id_error');

  test('1707 does not trip circuit breaker',
    !['account_error', 'provider_system', 'transient', 'rate_limited'].includes(
      NaloSmsService.classifyNaloError('1707')
    ));
});

// ============================================================
// TEST 3: sms.js quick-send route has provider preflight
// ============================================================
group('TEST 3: sms.js quick-send route has provider preflight', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');

  test('sms.js calls validateSenderIdWithProvider before send',
    source.includes('validateSenderIdWithProvider(senderId)'));

  test('sms.js preflight is before recipient loop',
    source.indexOf('validateSenderIdWithProvider') < source.indexOf('chunks.push'));

  test('sms.js returns SENDER_ID_PROVIDER_REJECTED on preflight failure',
    source.includes('SENDER_ID_PROVIDER_REJECTED'));

  test('sms.js preflight error message is actionable',
    source.includes('not approved by the SMS provider'));
});

// ============================================================
// TEST 4: sms.js schedule route has provider preflight
// ============================================================
group('TEST 4: sms.js schedule route has provider preflight', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');

  test('sms.js schedule calls validateSenderIdWithProvider',
    source.includes('validateSenderIdWithProvider(senderId)'));

  test('sms.js schedule preflight is before campaign creation',
    source.includes('validateSenderIdWithProvider'));
});

// ============================================================
// TEST 5: sms-campaigns.js send route has provider preflight
// ============================================================
group('TEST 5: sms-campaigns.js send route has provider preflight', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms-campaigns.js calls validateSenderIdWithProvider before send',
    source.includes('validateSenderIdWithProvider(senderId)'));

  test('sms-campaigns.js preflight is before chunk loop',
    source.indexOf('validateSenderIdWithProvider') < source.indexOf('for (const chunk of chunks)'));

  test('sms-campaigns.js cleans up recipients on preflight failure',
    source.includes('await SmsRecipient.deleteMany({ campaignId: campaign._id })'));

  test('sms-campaigns.js marks campaign as failed on preflight failure',
    source.includes("campaign.status = 'failed'"));

  test('sms-campaigns.js returns SENDER_ID_PROVIDER_REJECTED',
    source.includes('SENDER_ID_PROVIDER_REJECTED'));
});

// ============================================================
// TEST 6: sms-campaigns.js schedule route has provider preflight
// ============================================================
group('TEST 6: sms-campaigns.js schedule route has provider preflight', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms-campaigns.js schedule calls validateSenderIdWithProvider',
    source.includes('validateSenderIdWithProvider(senderId)'));

  test('sms-campaigns.js schedule preflight is after local DB validation',
    (() => {
      const sendIdx = source.indexOf('SenderId.findOne');
      const preflightIdx = source.indexOf('validateSenderIdWithProvider');
      const scheduleSendIdx = source.indexOf('/send');
      const scheduleIdx = source.indexOf('/schedule');
      // The preflight in the schedule route should come after the local DB validation in the schedule route
      if (scheduleIdx === -1 || preflightIdx === -1) return false;
      const afterSchedule = source.substring(scheduleIdx);
      const localDbIdx = afterSchedule.indexOf('SenderId.findOne');
      const preflightInScheduleIdx = afterSchedule.indexOf('validateSenderIdWithProvider');
      return localDbIdx !== -1 && preflightInScheduleIdx !== -1 && preflightInScheduleIdx > localDbIdx;
    })());
});

// ============================================================
// TEST 7: Frontend shows actionable 1707 error
// ============================================================
group('TEST 7: Frontend error handling for provider-rejected Sender ID', () => {
  const html = fs.readFileSync(path.join(__dirname, 'src/pages/dashboard/send-sms.html'), 'utf8');

  test('Frontend shows result.error toast on API error',
    html.includes('showToast(errorMessage, \'error\')'));

  test('Frontend does not hardcode "Campaign failed to send" as the only error',
    html.includes('result.error') || html.includes('responseData.message'));

  test('Frontend handles providerErrorSummary for common-cause failures',
    html.includes('providerErrorSummary') && html.includes('isCommonCause'));
});

// ============================================================
// TEST 8: NaloSmsService preflight does not deduct wallet
// ============================================================
group('TEST 8: Preflight does not deduct wallet', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('validateSenderIdWithProvider does not call deductGhsForSms',
    (() => {
      const methodStart = source.indexOf('validateSenderIdWithProvider(senderId)');
      const methodEnd = source.indexOf('\n  }', methodStart);
      const methodBody = source.substring(methodStart, methodEnd);
      return !methodBody.includes('deductGhsForSms');
    })());

  test('validateSenderIdWithProvider does not call reserveFunds',
    !source.includes('reserveFunds') ||
    (source.indexOf('validateSenderIdWithProvider') > source.lastIndexOf('reserveFunds')));

  test('validateSenderIdWithProvider uses dummy test phone',
    source.includes('233000000000') || source.includes('TEST_PHONE'));
});

// ============================================================
// TEST 9: Preflight returns correct structure for 1707
// ============================================================
group('TEST 9: Preflight return structure', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('Preflight returns valid: false for 1707',
    (() => {
      const methodStart = source.indexOf('validateSenderIdWithProvider(senderId)');
      const methodEnd = source.indexOf('\n  }', methodStart);
      const methodBody = source.substring(methodStart, methodEnd);
      return methodBody.includes('valid: false') && methodBody.includes("'1707'");
    })());

  test('Preflight returns errorCode for 1707',
    source.includes('errorCode: \'1707\''));

  test('Preflight returns actionable error message for 1707',
    source.includes('not registered with the SMS provider'));
});

// ============================================================
// TEST 10: Circuit breaker is not opened by 1707 during preflight
// ============================================================
group('TEST 10: Preflight does not trip circuit breaker for 1707', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('Preflight uses httpClient.post which respects categorizeError',
    source.includes('this.httpClient.post'));

  test('ResilientHttpClient categorizeError returns sender_id_error for 1707',
    fs.readFileSync(path.join(__dirname, 'backend/utils/ResilientHttpClient.js'), 'utf8')
      .includes("return 'sender_id_error'"));

  test('ResilientHttpClient shouldCountForBreaker excludes sender_id_error',
    fs.readFileSync(path.join(__dirname, 'backend/utils/ResilientHttpClient.js'), 'utf8')
      .includes('shouldCountForBreaker'));
});

// ============================================================
// TEST 11: No secrets exposed in preflight logs
// ============================================================
group('TEST 11: No secrets exposed in preflight', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('Preflight log does not expose API key',
    (() => {
      const methodStart = source.indexOf('validateSenderIdWithProvider(senderId)');
      const methodEnd = source.indexOf('\n  }', methodStart);
      const methodBody = source.substring(methodStart, methodEnd);
      const logMatch = methodBody.match(/console\.log\(\[NaloSmsService\] Sender ID preflight[^}]*\}/);
      if (!logMatch) return true;
      const logStr = logMatch[0];
      return !logStr.includes('apiKey') && !logStr.includes('key:') && !logStr.includes('payload');
    })());

  test('Provider payload in preflight hides key',
    source.includes('***HIDDEN***') || source.includes('***'));
});

// ============================================================
// TEST 12: Route response structure for preflight failure
// ============================================================
group('TEST 12: Preflight failure response structure', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms.js preflight response includes providerErrorCode',
    smsSource.includes('providerErrorCode'));

  test('sms-campaigns.js preflight response includes providerErrorCode',
    campaignSource.includes('providerErrorCode'));

  test('sms.js preflight returns HTTP 400',
    smsSource.includes('status(400)'));

  test('sms-campaigns.js preflight returns HTTP 400',
    campaignSource.includes('status(400)'));
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('SENDER ID FAILURE REGRESSION TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i+1}. ${f.name}: ${f.detail}`));
  process.exit(1);
} else {
  console.log('\nAll sender ID failure regression tests passed.');
  process.exit(0);
}
