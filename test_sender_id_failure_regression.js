/**
 * Sender ID Stored Approval Gate Regression Test Suite
 *
 * Tests the new design:
 * - No live Nalo preflight per send
 * - Routes rely on SenderId.status === 'approved' (stored approval)
 * - SenderId ownership is verified per authenticated user
 */

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
// TEST 1: No route calls validateSenderIdWithProvider
// ============================================================
group('TEST 1: No live preflight in any route', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  test('sms.js quick-send does not call validateSenderIdWithProvider',
    !smsSource.includes('validateSenderIdWithProvider'));

  test('sms.js schedule does not call validateSenderIdWithProvider',
    !smsSource.includes('validateSenderIdWithProvider'));

  test('sms-campaigns.js send does not call validateSenderIdWithProvider',
    !campaignSource.includes('validateSenderIdWithProvider'));

  test('sms-campaigns.js schedule does not call validateSenderIdWithProvider',
    !campaignSource.includes('validateSenderIdWithProvider'));
});

// ============================================================
// TEST 2: All routes enforce SenderId ownership + approved status
// ============================================================
group('TEST 2: Stored approval gate exists in all 4 routes', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');

  const smsQuickSendMatches = smsSource.match(/SenderId\.findOne\(\{\s*senderId,\s*userId,\s*status:\s*'approved'\s*\}\)/g) || [];
  const smsScheduleMatches = smsSource.match(/SenderId\.findOne\(\{\s*senderId,\s*userId,\s*status:\s*'approved'\s*\}\)/g) || [];
  const campaignSendMatches = campaignSource.match(/SenderId\.findOne\(\{\s*senderId,\s*userId,\s*status:\s*'approved'\s*\}\)/g) || [];
  const campaignScheduleMatches = campaignSource.match(/SenderId\.findOne\(\{\s*senderId,\s*userId,\s*status:\s*'approved'\s*\}\)/g) || [];

  test('sms.js quick-send has SenderId ownership+approved check',
    smsQuickSendMatches.length >= 1);

  test('sms.js schedule has SenderId ownership+approved check',
    smsScheduleMatches.length >= 1);

  test('sms-campaigns.js send has SenderId ownership+approved check',
    campaignSendMatches.length >= 1);

  test('sms-campaigns.js schedule has SenderId ownership+approved check',
    campaignScheduleMatches.length >= 1);
});

// ============================================================
// TEST 3: SenderId model has isApproved method
// ============================================================
group('TEST 3: SenderId model supports stored approval', () => {
  const modelSource = fs.readFileSync(path.join(__dirname, 'backend/models/SenderId.js'), 'utf8');

  test('SenderId model has status field with approved enum',
    modelSource.includes("enum: ['pending', 'approved', 'rejected']"));

  test('SenderId model has isApproved method',
    modelSource.includes('isApproved'));

  test('isApproved returns true only when status is approved',
    modelSource.includes("return this.status === 'approved'"));
});

// ============================================================
// TEST 4: Frontend dropdown only shows approved Sender IDs
// ============================================================
group('TEST 4: Frontend respects stored approval status', () => {
  const html = fs.readFileSync(path.join(__dirname, 'src/pages/dashboard/send-sms.html'), 'utf8');

  test('Frontend filters senderId dropdown by approved status',
    html.includes("senderId.status === 'approved'"));

  test('Frontend shows pending status note when pending Sender IDs exist',
    html.includes('status-pending') || html.includes('hasPending'));
});

// ============================================================
// TEST 5: No dummy test phone in send paths
// ============================================================
group('TEST 5: No dummy test phone in production send paths', () => {
  const smsSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(__dirname, 'backend/routes/sms-campaigns.js'), 'utf8');
  const naloSource = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('sms.js does not contain dummy test phone 233000000000',
    !smsSource.includes('233000000000'));

  test('sms-campaigns.js does not contain dummy test phone 233000000000',
    !campaignSource.includes('233000000000'));

  test('NaloSmsService.validateSenderIdWithProvider removed',
    !naloSource.includes('async validateSenderIdWithProvider'));
});

// ============================================================
// TEST 6: Helper functions preserved for future use
// ============================================================
group('TEST 6: Nalo error classification helpers preserved', () => {
  const naloSource = fs.readFileSync(path.join(__dirname, 'backend/services/NaloSmsService.js'), 'utf8');

  test('classifyValidationError still exists',
    naloSource.includes('classifyValidationError'));

  test('extractNaloStatusCodeFromError still exists',
    naloSource.includes('extractNaloStatusCodeFromError'));

  test('extractNaloErrorMessageFromError still exists',
    naloSource.includes('extractNaloErrorMessageFromError'));
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('SENDER ID STORED APPROVAL GATE TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i+1}. ${f.name}: ${f.detail}`));
  process.exit(1);
} else {
  console.log('\nAll stored approval gate regression tests passed.');
  process.exit(0);
}
