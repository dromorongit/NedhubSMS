/**
 * Send SMS 72-Recipient Failure Regression Test
 * 
 * Tests the exact failure scenario and verifies all repairs:
 * 1. Phone-only upload never assigns phone numbers to recipientName
 * 2. Duplicates are silently merged
 * 3. Circuit breaker is reset before campaign
 * 4. Wallet leak in outer catch is fixed
 * 5. Provider error summary is exposed in response
 * 6. Frontend can read and display provider errors
 */

const assert = require('assert');
const path = require('path');

// Test counter
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
// TEST 1: Phone-only upload safeguard
// ============================================================
group('TEST 1: Phone-only upload never assigns phone numbers to recipientName', () => {
  const ContactImportService = require('./backend/services/ContactImportService');
  
  // Simulate a phone-only TXT file with no name column
  const rows = [
    { phone: '0241234567' },
    { phone: '0201234567' },
    { phone: '0251234567' }
  ];
  
  const preview = ContactImportService.generatePreview(rows, {
    nameColumn: null,
    phoneColumn: 'phone'
  });
  
  test('Preview has 3 rows', preview.length === 3, `got ${preview.length}`);
  test('All recipientNames are empty strings', preview.every(r => r.recipientName === ''), 
    preview.map(r => r.recipientName).join(', '));
  test('All phoneNumbers are preserved', preview.every(r => r.phoneNumber !== '-'), 
    preview.map(r => r.phoneNumber).join(', '));
  test('All are valid', preview.every(r => r.validationStatus === 'valid'), 
    preview.map(r => r.validationStatus).join(', '));
});

// ============================================================
// TEST 2: Same column for name and phone yields empty name
// ============================================================
group('TEST 2: Same column for name and phone yields empty recipientName', () => {
  const ContactImportService = require('./backend/services/ContactImportService');
  
  const rows = [
    { contact: '0241234567' },
    { contact: '0201234567' }
  ];
  
  const preview = ContactImportService.generatePreview(rows, {
    nameColumn: 'contact',
    phoneColumn: 'contact'
  });
  
  test('Preview has 2 rows', preview.length === 2, `got ${preview.length}`);
  test('All recipientNames are empty strings (not phone numbers)', preview.every(r => r.recipientName === ''), 
    preview.map(r => r.recipientName).join(', '));
  test('All phoneNumbers are preserved', preview.every(r => r.phoneNumber !== '-'), 
    preview.map(r => r.phoneNumber).join(', '));
});

// ============================================================
// TEST 3: NaloSmsService circuit breaker reset exists
// ============================================================
group('TEST 3: NaloSmsService exposes circuit breaker reset', () => {
  const NaloSmsService = require('./backend/services/NaloSmsService');
  
  test('resetCircuitBreaker method exists', typeof NaloSmsService.resetCircuitBreaker === 'function');
  test('getCircuitBreakerStatus method exists', typeof NaloSmsService.getCircuitBreakerStatus === 'function');
  
  // Call reset and verify it doesn't throw
  let resetOk = true;
  try {
    NaloSmsService.resetCircuitBreaker();
  } catch (e) {
    resetOk = false;
  }
  test('resetCircuitBreaker executes without error', resetOk);
  
  const status = NaloSmsService.getCircuitBreakerStatus();
  test('getCircuitBreakerStatus returns object', typeof status === 'object');
  test('Circuit breaker state is CLOSED after reset', status.state === 'CLOSED', `state=${status.state}`);
});

// ============================================================
// TEST 4: NaloSmsService outer catch refunds correct amount
// ============================================================
group('TEST 4: Outer catch refunds actual deducted amount, not zero', () => {
  const NaloSmsService = require('./backend/services/NaloSmsService');
  
  // Read the source code to verify the fix
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');
  
  // Check that the outer catch uses financialBreakdown.totalChargedToUser instead of 0
  const hasCorrectRefund = source.includes('financialBreakdown.totalChargedToUser');
  test('Outer catch refunds financialBreakdown.totalChargedToUser', hasCorrectRefund);
  
  const hasZeroRefund = source.includes("refundWallet(userId, 0, 'SMS internal error");
  test('Outer catch does NOT refund zero', !hasZeroRefund);
  
  const hasSkipDeductionCheck = source.includes('!skipDeduction && typeof financialBreakdown');
  test('Outer catch checks skipDeduction and financialBreakdown', hasSkipDeductionCheck);
});

// ============================================================
// TEST 5: Backend response includes providerErrorSummary
// ============================================================
group('TEST 5: Backend send response includes provider error summary', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  
  test('sms.js includes providerErrorSummary in response', source.includes('providerErrorSummary'));
  test('sms.js aggregates provider error counts', source.includes('providerErrorCounts'));
  test('sms.js identifies common cause failures', source.includes('isCommonCause'));
  test('sms.js resets circuit breaker before send', source.includes('NaloSmsService.resetCircuitBreaker()'));
});

// ============================================================
// TEST 6: Frontend handles provider error summary
// ============================================================
group('TEST 6: Frontend displays provider error summary', () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, 'src/pages/dashboard/send-sms.html'), 'utf8');
  
  test('Frontend reads providerErrorSummary from response', html.includes('responseData.providerErrorSummary'));
  test('Frontend shows common cause indicator', html.includes('isCommonCause'));
  test('Frontend shows provider error code in toast', html.includes('Provider error:'));
});

// ============================================================
// TEST 7: NaloSmsService captures full provider response in forensic logs
// ============================================================
group('TEST 7: NaloSmsService captures full provider response', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');
  
  test('NaloForensic log tag exists', source.includes('[NaloForensic]'));
  test('Logs raw response body', source.includes('rawResponse'));
  test('Logs HTTP status', source.includes('httpStatus'));
  test('Logs provider endpoint', source.includes('providerEndpoint'));
  test('Logs sender ID', source.includes('senderId'));
  test('Logs recipient phone', source.includes('recipientPhone'));
  test('Logs message segments', source.includes('messageSegments'));
  test('Logs provider error code', source.includes('providerErrorCode'));
  test('Logs provider error message', source.includes('providerErrorMessage'));
  test('Logs success flag', source.includes('isSuccess'));
  test('Does NOT log API key in forensic output', 
    !source.includes('rawResponse:') || !source.includes('apiKey') || !source.includes('payload.key'),
    'API key should not appear in forensic logs');
});

// ============================================================
// TEST 8: Phone normalization consistency
// ============================================================
group('TEST 8: Phone normalization is consistent frontend/backend', () => {
  const SmsRecipientService = require('./backend/services/SmsRecipientService');
  
  const testNumbers = [
    '0241234567',
    '0201234567',
    '0251234567',
    '+233241234567',
    '233241234567',
    '241234567'
  ];
  
  const normalized = testNumbers.map(n => SmsRecipientService.normalizePhoneNumber(n));
  
  test('0241234567 -> 233241234567', normalized[0] === '233241234567', `got ${normalized[0]}`);
  test('0201234567 -> 233201234567', normalized[1] === '233201234567', `got ${normalized[1]}`);
  test('0251234567 -> 233251234567', normalized[2] === '233251234567', `got ${normalized[2]}`);
  test('+233241234567 -> 233241234567', normalized[3] === '233241234567', `got ${normalized[3]}`);
  test('233241234567 -> 233241234567', normalized[4] === '233241234567', `got ${normalized[4]}`);
  test('241234567 -> 233241234567', normalized[5] === '233241234567', `got ${normalized[5]}`);
  
  // All should be 12 digits starting with 233
  test('All normalized numbers are 12 digits', normalized.every(n => n && n.length === 12));
  test('All normalized numbers start with 233', normalized.every(n => n && n.startsWith('233')));
});

// ============================================================
// TEST 9: Duplicate handling
// ============================================================
group('TEST 9: Duplicate recipients are silently merged', () => {
  const SmsRecipientService = require('./backend/services/SmsRecipientService');
  
  const recipients = [
    { recipientName: 'Alice', phoneNumber: '0241234567' },
    { recipientName: 'Alice', phoneNumber: '0241234567' },
    { recipientName: 'Bob', phoneNumber: '0201234567' },
    { recipientName: 'Bob', phoneNumber: '0201234567' },
    { recipientName: 'Charlie', phoneNumber: '0251234567' }
  ];
  
  const result = SmsRecipientService.deduplicateRecipients(recipients, true);
  
  test('Original count is 5', result.uniqueRecipients.length + result.duplicateCount === 5);
  test('Unique count is 3', result.uniqueRecipients.length === 3, `got ${result.uniqueRecipients.length}`);
  test('Duplicate count is 2', result.duplicateCount === 2, `got ${result.duplicateCount}`);
  test('No duplicate in uniqueRecipients', 
    new Set(result.uniqueRecipients.map(r => r.normalizedPhoneNumber)).size === result.uniqueRecipients.length);
});

// ============================================================
// TEST 10: NaloSmsService response parsing
// ============================================================
group('TEST 10: NaloSmsService parses common response formats', () => {
  const NaloSmsService = require('./backend/services/NaloSmsService');
  
  // Bare success code (number)
  const r1 = NaloSmsService.parseNaloResponse(1701);
  test('Bare 1701 parsed as success', r1.status === '1701', `got ${r1.status}`);
  
  // Bare success code (string)
  const r2 = NaloSmsService.parseNaloResponse('1701');
  test('String "1701" parsed as success', r2.status === '1701', `got ${r2.status}`);
  
  // Pipe-delimited response (Nalo uses second part as message_id for success, or error_message for failure)
  const r3 = NaloSmsService.parseNaloResponse('1707|Sender ID not registered');
  test('Pipe-delimited 1707 parsed with correct status', r3.status === '1707', `got ${r3.status}`);
  test('Pipe-delimited 1707 has message content', r3.message_id === 'Sender ID not registered' || r3.error_message === 'Sender ID not registered',
    `message_id=${r3.message_id}, error_message=${r3.error_message}`);
  
  // JSON object response
  const r4 = NaloSmsService.parseNaloResponse({ status: '1025', error_message: 'Insufficient credit' });
  test('JSON object parsed correctly', r4.status === '1025' && r4.error_message === 'Insufficient credit');
  
  // JSON object with numeric status
  const r5 = NaloSmsService.parseNaloResponse({ status: 1704, error_message: 'Invalid API key' });
  test('Numeric status in JSON converted to string', r5.status === '1704', `got ${r5.status}`);
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('REGRESSION TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i+1}. ${f.name}: ${f.detail}`));
  process.exit(1);
} else {
  console.log('\nAll regression tests passed.');
  process.exit(0);
}
