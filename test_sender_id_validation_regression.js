/**
 * Sender ID Validation Regression Test Suite
 *
 * Tests the validateSenderIdWithProvider method and its integration with routes,
 * focusing on proper classification of permanent Sender ID rejection vs temporary
 * provider errors, and ensuring response bodies are inspected for Nalo error codes.
 */

const assert = require('assert');
const NaloSmsService = require('./backend/services/NaloSmsService');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

function group(name, fn) {
  console.log(`\n${name}`);
  console.log('='.repeat(name.length));
  fn();
}

function test(name, fn) {
  try {
    fn();
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

function assertIncludes(obj, key, expected) {
  if (!obj[key] || !String(obj[key]).includes(expected)) {
    throw new Error(`Expected ${key} to include "${expected}", got "${obj[key]}"`);
  }
}

// ============================================================
// TEST 1: extractNaloStatusCodeFromError helper
// ============================================================
group('TEST 1: extractNaloStatusCodeFromError', () => {
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
});

// ============================================================
// TEST 3: validateSenderIdWithProvider integration (mocked)
// ============================================================
group('TEST 3: validateSenderIdWithProvider integration (mocked)', () => {
  // Save original httpClient
  const originalHttpClient = NaloSmsService.httpClient;
  let mockClient = null;

  function setupMock(responseConfig) {
    mockClient = {
      post: async () => {
        if (responseConfig.thrownError) {
          throw responseConfig.thrownError;
        }
        return responseConfig.response;
      }
    };
    NaloSmsService.httpClient = mockClient;
  }

  function restoreMock() {
    NaloSmsService.httpClient = originalHttpClient;
    mockClient = null;
  }

  test('1707 in response body with HTTP 200 is permanent rejection', async () => {
    setupMock({
      response: {
        data: { status: '1707', error_message: 'Invalid Source(Sender)' },
        status: 200
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('INVALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'permanent_sender_id_error');
    assertEqual(result.errorCode, '1707');
  });

  test('1701 in response body with HTTP 200 is valid', async () => {
    setupMock({
      response: {
        data: { status: '1701', message_id: '12345' },
        status: 200
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, true);
    assertEqual(result.classification, 'valid');
    assertEqual(result.errorCode, null);
  });

  test('HTTP 400 with 1707 in body is permanent rejection', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 400,
          data: { status: '1707', error_message: 'Invalid Source(Sender)' }
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('INVALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'permanent_sender_id_error');
    assertEqual(result.errorCode, '1707');
  });

  test('HTTP 412 without body is permanent rejection', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 412,
          data: null
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('INVALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'permanent_sender_id_error');
    assertEqual(result.errorCode, '1707');
  });

  test('HTTP 400 with 1711 in body is temporary error', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 400,
          data: { status: '1711', error_message: 'Service temporarily unavailable' }
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'temporary_provider_error');
    assertEqual(result.errorCode, '1711');
  });

  test('HTTP 400 with no recognized code is temporary error', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 400,
          data: { error_message: 'Bad request' }
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_400');
  });

  test('HTTP 401 is auth_configuration_error', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 401,
          data: { status: '1703', error_message: 'Authentication failed' }
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'auth_configuration_error');
    assertEqual(result.errorCode, '1703');
  });

  test('HTTP 429 is temporary_provider_error', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 429,
          data: { error_message: 'Rate limit exceeded' }
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_429');
  });

  test('HTTP 500 is temporary_provider_error', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 500,
          data: { error_message: 'Internal server error' }
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_500');
  });

  test('network timeout is temporary_provider_error', async () => {
    setupMock({
      thrownError: {
        message: 'timeout of 15000ms exceeded',
        code: 'ECONNABORTED',
        response: undefined
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'temporary_provider_error');
    assertEqual(result.errorCode, 'NETWORK_ERROR');
  });

  test('malformed response body is handled gracefully', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 400,
          data: '<html>Not Found</html>'
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_400');
  });

  test('empty response body on 400 is temporary error', async () => {
    setupMock({
      thrownError: {
        response: {
          status: 400,
          data: ''
        }
      }
    });
    const result = await NaloSmsService.validateSenderIdWithProvider('VALID_ID');
    restoreMock();
    assertEqual(result.valid, false);
    assertEqual(result.classification, 'temporary_provider_error');
    assertEqual(result.errorCode, 'HTTP_400');
  });

  // Restore original httpClient
  restoreMock();
});

// ============================================================
// TEST 4: Route error classification (static analysis)
// ============================================================
group('TEST 4: Route error classification', () => {
  const smsSource = require('fs').readFileSync('./backend/routes/sms.js', 'utf8');
  const campaignSource = require('fs').readFileSync('./backend/routes/sms-campaigns.js', 'utf8');

  test('sms.js quick-send handles temporary_provider_error', () => {
    assert(smsSource.includes('PROVIDER_TEMPORARY_ERROR'), 'sms.js should handle PROVIDER_TEMPORARY_ERROR');
    assert(smsSource.includes('classification'), 'sms.js should check classification');
  });

  test('sms.js schedule handles temporary_provider_error', () => {
    assert(smsSource.includes('PROVIDER_TEMPORARY_ERROR'), 'sms.js schedule should handle PROVIDER_TEMPORARY_ERROR');
  });

  test('sms-campaigns.js send handles temporary_provider_error', () => {
    assert(campaignSource.includes('PROVIDER_TEMPORARY_ERROR'), 'sms-campaigns.js send should handle PROVIDER_TEMPORARY_ERROR');
  });

  test('sms-campaigns.js schedule handles temporary_provider_error', () => {
    assert(campaignSource.includes('PROVIDER_TEMPORARY_ERROR'), 'sms-campaigns.js schedule should handle PROVIDER_TEMPORARY_ERROR');
  });

  test('sms.js quick-send preflight is before recipient loop', () => {
    const preflightIdx = smsSource.indexOf('validateSenderIdWithProvider');
    const recipientLoopIdx = smsSource.indexOf('for (const chunk of chunks)');
    assert(preflightIdx < recipientLoopIdx, 'Preflight must be before recipient loop');
  });

  test('sms-campaigns.js send preflight is before chunk loop', () => {
    const preflightIdx = campaignSource.indexOf('validateSenderIdWithProvider');
    const chunkLoopIdx = campaignSource.indexOf('for (const chunk of chunks)');
    assert(preflightIdx < chunkLoopIdx, 'Preflight must be before chunk loop');
  });

  test('sms-campaigns.js preflight returns classification in response', () => {
    assert(campaignSource.includes('classification:'), 'Response should include classification');
  });
});

// ============================================================
// TEST 5: Wallet safety verification
// ============================================================
group('TEST 5: Wallet safety verification', () => {
  const smsSource = require('fs').readFileSync('./backend/routes/sms.js', 'utf8');
  const campaignSource = require('fs').readFileSync('./backend/routes/sms-campaigns.js', 'utf8');

  test('sms.js quick-send preflight is before wallet deduction', () => {
    const preflightIdx = smsSource.indexOf('validateSenderIdWithProvider');
    const deductIdx = smsSource.indexOf('deductGhsForSms');
    assert(preflightIdx < deductIdx || deductIdx === -1, 'Preflight must be before wallet deduction');
  });

  test('sms.js quick-send preflight is before Nalo send loop', () => {
    const preflightIdx = smsSource.indexOf('validateSenderIdWithProvider');
    const sendLoopIdx = smsSource.indexOf('Promise.allSettled');
    assert(preflightIdx < sendLoopIdx, 'Preflight must be before send loop');
  });

  test('sms-campaigns.js preflight is before wallet reservation', () => {
    const preflightIdx = campaignSource.indexOf('validateSenderIdWithProvider');
    const reserveIdx = campaignSource.indexOf('reserveFunds');
    assert(preflightIdx < reserveIdx, 'Preflight must be before wallet reservation');
  });
});

// ============================================================
// TEST 6: Frontend error handling
// ============================================================
group('TEST 6: Frontend error handling', () => {
  const frontendSource = require('fs').readFileSync('./src/pages/dashboard/send-sms.html', 'utf8');

  test('frontend checks classification for error messages', () => {
    assert(frontendSource.includes('classification'), 'Frontend should check classification');
  });

  test('frontend handles permanent_sender_id_error', () => {
    assert(frontendSource.includes('permanent_sender_id_error'), 'Frontend should handle permanent rejection');
  });

  test('frontend handles temporary_provider_error', () => {
    assert(frontendSource.includes('temporary_provider_error'), 'Frontend should handle temporary error');
  });

  test('frontend handles auth_configuration_error', () => {
    assert(frontendSource.includes('auth_configuration_error'), 'Frontend should handle auth error');
  });

  test('frontend shows providerMessage when available', () => {
    assert(frontendSource.includes('providerMessage'), 'Frontend should display provider message');
  });
});

// ============================================================
// TEST 7: Circuit breaker behavior
// ============================================================
group('TEST 7: Circuit breaker behavior', () => {
  const resilientSource = require('fs').readFileSync('./backend/utils/ResilientHttpClient.js', 'utf8');
  const naloSource = require('fs').readFileSync('./backend/services/NaloSmsService.js', 'utf8');

  test('ResilientHttpClient has sender_id_error category', () => {
    assert(resilientSource.includes('sender_id_error'), 'Should have sender_id_error category');
  });

  test('1707 does not trip circuit breaker', () => {
    assert(resilientSource.includes("['1707'].includes(errorCode)"), '1707 should be excluded from breaker');
  });

  test('validation errors do not trip global circuit breaker', () => {
    // The validation uses httpClient.post which goes through categorizeError.
    // HTTP 400 without recognized body code returns 'permanent' which does not trip breaker.
    assert(resilientSource.includes("return 'permanent'"), 'Unknown 4xx should be permanent (no breaker trip)');
  });

  test('NaloSmsService classifies 1707 as sender_id_error', () => {
    assert(naloSource.includes("return 'sender_id_error'"), 'NaloSmsService should classify 1707 as sender_id_error');
  });
});

// ============================================================
// TEST 8: Logging and security
// ============================================================
group('TEST 8: Logging and security', () => {
  const naloSource = require('fs').readFileSync('./backend/services/NaloSmsService.js', 'utf8');

  test('API key is hidden in provider payload logs', () => {
    assert(naloSource.includes('***HIDDEN***'), 'API key should be hidden in logs');
  });

  test('preflight logs do not expose raw API key', () => {
    // Extract the validateSenderIdWithProvider method body
    const methodStart = naloSource.indexOf('async validateSenderIdWithProvider');
    const methodEnd = naloSource.indexOf('\n  }', methodStart) + 4;
    const methodBody = naloSource.substring(methodStart, methodEnd);

    // Find all console.log statements in the preflight method
    const consoleLogMatches = methodBody.match(/console\.log\([^)]+\)/g) || [];
    for (const logCall of consoleLogMatches) {
      assert(!logCall.includes('this.apiKey') && !logCall.includes('apiKey'),
        `Preflight log exposes API key: ${logCall.substring(0, 100)}`);
    }
  });

  test('validation classification is logged for forensics', () => {
    assert(naloSource.includes('Sender ID preflight classification'), 'Classification should be logged');
  });
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
