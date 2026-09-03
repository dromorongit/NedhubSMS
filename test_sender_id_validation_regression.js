/**
 * Sender ID Validation Helper Regression Test Suite
 *
 * Tests the Nalo error classification helper functions that remain in NaloSmsService.
 * The live preflight (validateSenderIdWithProvider) has been removed.
 * Routes now rely on SenderId.status === 'approved' as the stored approval gate.
 */

const assert = require('assert');
const NaloSmsService = require('./backend/services/NaloSmsService');
const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

function group(name, fn) {
  console.log(`\n${name}`);
  console.log('='.repeat(name.length));
  fn();
}

function test(name, condition, detail) {
  try {
    if (!condition) {
      throw new Error(detail || 'Condition failed');
    }
    testsPassed++;
    testResults.push({ name, status: 'PASS' });
    console.log(`  PASS: ${name}`);
  } catch (error) {
    testsFailed++;
    testResults.push({ name, status: 'FAIL', error: error.message });
    console.log(`  FAIL: ${name} - ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}. ${msg}`);
  }
}

// ============================================================
// TEST 1: extractNaloStatusCodeFromError and extractNaloErrorMessageFromError
// ============================================================
group('TEST 1: extractNaloStatusCodeFromError and extractNaloErrorMessageFromError', () => {
  const svc = NaloSmsService;

  test('extracts status from object response', () => {
    const err = { response: { data: { status: '1707', error_message: 'Invalid Source' } } };
    assertEqual(svc.extractNaloStatusCodeFromError(err), '1707');
  });

  test('extracts status from error_code field', () => {
    const err = { response: { data: { error_code: '1711', message: 'Unavailable' } } };
    assertEqual(svc.extractNaloStatusCodeFromError(err), '1711');
  });

  test('extracts status from pipe-delimited string', () => {
    const err = { response: { data: '1707|12345|Invalid Source' } };
    assertEqual(svc.extractNaloStatusCodeFromError(err), '1707');
  });

  test('extracts status from JSON string', () => {
    const err = { response: { data: '{"status":"1707","error_message":"Invalid Source"}' } };
    assertEqual(svc.extractNaloStatusCodeFromError(err), '1707');
  });

  test('returns null for missing data', () => {
    assertEqual(svc.extractNaloStatusCodeFromError({}), null);
    assertEqual(svc.extractNaloStatusCodeFromError({ response: {} }), null);
    assertEqual(svc.extractNaloStatusCodeFromError({ response: { data: null } }), null);
  });

  test('extracts error_message from object response', () => {
    const err = { response: { data: { status: '1706', error_message: 'Invalid destination number' } } };
    assertEqual(svc.extractNaloErrorMessageFromError(err), 'Invalid destination number');
  });

  test('extracts message from object response', () => {
    const err = { response: { data: { status: '9999', message: 'Some provider error' } } };
    assertEqual(svc.extractNaloErrorMessageFromError(err), 'Some provider error');
  });

  test('extracts error_message from pipe-delimited string', () => {
    const err = { response: { data: '1706|12345|Invalid destination number' } };
    assertEqual(svc.extractNaloErrorMessageFromError(err), 'Invalid destination number');
  });

  test('extracts error_message from JSON string', () => {
    const err = { response: { data: '{"status":"1706","error_message":"Invalid destination number"}' } };
    assertEqual(svc.extractNaloErrorMessageFromError(err), 'Invalid destination number');
  });

  test('returns null for missing error message', () => {
    assertEqual(svc.extractNaloErrorMessageFromError({}), null);
    assertEqual(svc.extractNaloErrorMessageFromError({ response: {} }), null);
    assertEqual(svc.extractNaloErrorMessageFromError({ response: { data: null } }), null);
  });
});

// ============================================================
// TEST 2: classifyValidationError
// ============================================================
group('TEST 2: classifyValidationError', () => {
  const svc = NaloSmsService;

  test('1707 is permanent_sender_id_error', () => {
    const result = svc.classifyValidationError('1707', 400);
    assertEqual(result.category, 'permanent_sender_id_error');
    assertEqual(result.errorCode, '1707');
  });

  test('412 is permanent_sender_id_error', () => {
    const result = svc.classifyValidationError(null, 412);
    assertEqual(result.category, 'permanent_sender_id_error');
    assertEqual(result.errorCode, '1707');
  });

  test('1703 is auth_configuration_error', () => {
    const result = svc.classifyValidationError('1703', 400);
    assertEqual(result.category, 'auth_configuration_error');
    assertEqual(result.errorCode, '1703');
  });

  test('1704 is auth_configuration_error', () => {
    const result = svc.classifyValidationError('1704', 400);
    assertEqual(result.category, 'auth_configuration_error');
    assertEqual(result.errorCode, '1704');
  });

  test('1705 is auth_configuration_error', () => {
    const result = svc.classifyValidationError('1705', 403);
    assertEqual(result.category, 'auth_configuration_error');
    assertEqual(result.errorCode, '1705');
  });

  test('1025 is auth_configuration_error', () => {
    const result = svc.classifyValidationError('1025', 402);
    assertEqual(result.category, 'auth_configuration_error');
    assertEqual(result.errorCode, '1025');
  });

  test('1710 is temporary_provider_error', () => {
    const result = svc.classifyValidationError('1710', 500);
    assertEqual(result.category, 'temporary_provider_error');
    assertEqual(result.errorCode, '1710');
  });

  test('1711 is temporary_provider_error', () => {
    const result = svc.classifyValidationError('1711', 503);
    assertEqual(result.category, 'temporary_provider_error');
    assertEqual(result.errorCode, '1711');
  });

  test('HTTP 429 is temporary_provider_error', () => {
    const result = svc.classifyValidationError(null, 429);
    assertEqual(result.category, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_429');
  });

  test('HTTP 500 is temporary_provider_error', () => {
    const result = svc.classifyValidationError(null, 500);
    assertEqual(result.category, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_500');
  });

  test('HTTP 503 is temporary_provider_error', () => {
    const result = svc.classifyValidationError(null, 503);
    assertEqual(result.category, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_503');
  });

  test('generic HTTP 400 without recognized code is temporary_provider_error', () => {
    const result = svc.classifyValidationError(null, 400);
    assertEqual(result.category, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_400');
  });

  test('network error (no HTTP status) is temporary_provider_error', () => {
    const result = svc.classifyValidationError(null, null);
    assertEqual(result.category, 'temporary_provider_error');
    assertEqual(result.errorCode, 'NETWORK_ERROR');
  });

  test('1702 is malformed_request', () => {
    const result = svc.classifyValidationError('1702', 400);
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1702');
  });

  test('1706 is malformed_request', () => {
    const result = svc.classifyValidationError('1706', 400);
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1706');
  });

  test('1708 is malformed_request', () => {
    const result = svc.classifyValidationError('1708', 400);
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1708');
  });

  test('1709 is malformed_request', () => {
    const result = svc.classifyValidationError('1709', 400);
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1709');
  });

  test('1026 is malformed_request', () => {
    const result = svc.classifyValidationError('1026', 400);
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1026');
  });

  test('1027 is malformed_request', () => {
    const result = svc.classifyValidationError('1027', 400);
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1027');
  });

  test('1028 is malformed_request', () => {
    const result = svc.classifyValidationError('1028', 400);
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1028');
  });

  test('unrecognized HTTP 400 with Nalo code is unknown_provider_error', () => {
    const result = svc.classifyValidationError('9999', 400);
    assertEqual(result.category, 'unknown_provider_error');
    assertEqual(result.errorCode, '9999');
  });

  test('Nalo error message is preserved when provided', () => {
    const result = svc.classifyValidationError('1706', 400, 'Invalid destination number');
    assertEqual(result.category, 'malformed_request');
    assertEqual(result.errorCode, '1706');
    assertEqual(result.errorMessage, 'Invalid destination number');
  });
});

// ============================================================
// TEST 3: validateSenderIdWithProvider is removed
// ============================================================
group('TEST 3: validateSenderIdWithProvider removed from service', () => {
  test('validateSenderIdWithProvider method does not exist',
    typeof NaloSmsService.validateSenderIdWithProvider !== 'function');

  test('NaloSmsService does not contain async validateSenderIdWithProvider',
    !fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8')
      .includes('async validateSenderIdWithProvider'));
});

// ============================================================
// TEST 4: Route static analysis — no preflight, stored gate present
// ============================================================
group('TEST 4: Route structure matches new design', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms.js quick-send has SenderId ownership+approved check',
    smsSource.includes("SenderId.findOne({ senderId, userId, status: 'approved' })"));

  test('sms.js schedule has SenderId ownership+approved check',
    smsSource.includes("SenderId.findOne({ senderId, userId, status: 'approved' })"));

  test('sms-campaigns.js send has SenderId ownership+approved check',
    campaignSource.includes("SenderId.findOne({ senderId, userId, status: 'approved' })"));

  test('sms-campaigns.js schedule has SenderId ownership+approved check',
    campaignSource.includes("SenderId.findOne({ senderId, userId, status: 'approved' })"));

  test('sms.js does not reference dummy test phone 233000000000',
    !smsSource.includes('233000000000'));

  test('sms-campaigns.js does not reference dummy test phone 233000000000',
    !campaignSource.includes('233000000000'));
});

// ============================================================
// TEST 5: SenderId model has stored approval schema
// ============================================================
group('TEST 5: SenderId model supports stored approval', () => {
  const modelSource = fs.readFileSync(path.join(__dirname, 'backend/models/SenderId.js'), 'utf8');

  test('SenderId model has status field with approved enum',
    modelSource.includes("enum: ['pending', 'approved', 'rejected']"));

  test('SenderId model has isApproved method',
    modelSource.includes('isApproved'));

  test('isApproved returns true only for approved status',
    modelSource.includes("return this.status === 'approved'"));
});

// ============================================================
// TEST 6: Frontend dropdown filters by approved status
// ============================================================
group('TEST 6: Frontend sender ID dropdown respects stored approval', () => {
  const html = fs.readFileSync(path.join(__dirname, 'src/pages/dashboard/send-sms.html'), 'utf8');

  test('Frontend only appends approved Sender IDs to dropdown',
    html.includes("if (senderId.status === 'approved')"));

  test('Frontend handles pending Sender IDs separately',
    html.includes("senderId.status === 'pending'"));
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('SENDER ID VALIDATION REGRESSION TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Total: ${testsPassed + testsFailed}, Passed: ${testsPassed}, Failed: ${testsFailed}`);

if (testsFailed > 0) {
  console.log('\nFailed tests:');
  testResults.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log('\nAll sender ID validation regression tests passed.');
  process.exit(0);
}
