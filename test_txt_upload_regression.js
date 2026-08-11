/**
 * TXT Phone-Only Upload Regression Tests
 * 
 * Tests the exact failure scenario from production logs:
 * - Plain TXT file with one phone number per line
 * - Should NOT be treated as CSV with first line as header
 * - Should detect 'phone' column automatically
 * - All valid Ghana numbers should be valid in preview
 * - Frontend and backend recipient counts should agree
 */

const assert = require('assert');
const ContactImportService = require('./backend/services/ContactImportService');

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

async function main() {
  // ============================================================
  // TEST 1: Plain TXT with 1 phone number
  // ============================================================
  group('TEST 1: Plain TXT with 1 phone number', async () => {
    const buffer = Buffer.from('0241234567', 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.txt');
    
    test('Parses 1 row', rows.length === 1, `got ${rows.length}`);
    test('Row has phone column', rows[0].hasOwnProperty('phone'), JSON.stringify(rows[0]));
    test('Phone value is preserved', rows[0].phone === '0241234567', `got ${rows[0].phone}`);
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    test('Detected phone column is phone', detected.detectedPhoneColumn === 'phone', JSON.stringify(detected));
    
    const preview = ContactImportService.generatePreview(rows, detected);
    test('Preview has 1 row', preview.length === 1);
    test('Preview is valid', preview[0].validationStatus === 'valid', preview[0].validationMessage);
    test('Recipient name is empty (not phone number)', preview[0].recipientName === '', `got "${preview[0].recipientName}"`);
    test('Phone number is preserved', preview[0].phoneNumber === '0241234567', `got ${preview[0].phoneNumber}`);
  });

  // ============================================================
  // TEST 2: Plain TXT with 6 phone numbers
  // ============================================================
  group('TEST 2: Plain TXT with 6 phone numbers', async () => {
    const numbers = ['0241234567', '0209876543', '0267654321', '0241234567', '0251111111', '0272222222'];
    const buffer = Buffer.from(numbers.join('\n'), 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.txt');
    
    test('Parses 6 rows', rows.length === 6, `got ${rows.length}`);
    test('All rows have phone column', rows.every(r => r.phone), 'missing phone column');
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    test('Detected phone column is phone', detected.detectedPhoneColumn === 'phone', JSON.stringify(detected));
    
    const preview = ContactImportService.generatePreview(rows, detected);
    test('Preview has 6 rows', preview.length === 6);
    test('All preview rows are valid', preview.every(r => r.validationStatus === 'valid'), 
      preview.map(r => r.validationStatus).join(', '));
    test('All recipient names are empty', preview.every(r => r.recipientName === ''),
      preview.map(r => r.recipientName).join(', '));
  });

  // ============================================================
  // TEST 3: Plain TXT with 72 phone numbers (production scale)
  // ============================================================
  group('TEST 3: Plain TXT with 72 phone numbers', async () => {
    const numbers = Array.from({ length: 72 }, (_, i) => {
      const prefixes = ['024', '020', '026', '025', '027', '050', '054', '055', '056', '057'];
      const prefix = prefixes[i % prefixes.length];
      const suffix = String(1000000 + (i * 11111) % 10000000).padStart(7, '0');
      return prefix + suffix;
    });
    const buffer = Buffer.from(numbers.join('\n'), 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.txt');
    
    test('Parses 72 rows', rows.length === 72, `got ${rows.length}`);
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    test('Detected phone column is phone', detected.detectedPhoneColumn === 'phone', JSON.stringify(detected));
    
    const preview = ContactImportService.generatePreview(rows, detected);
    test('Preview has 72 rows', preview.length === 72);
    test('All 72 preview rows are valid', preview.every(r => r.validationStatus === 'valid'));
    test('No phone number used as recipient name', preview.every(r => r.recipientName === ''));
  });

  // ============================================================
  // TEST 4: Plain TXT with 81 phone numbers and duplicates
  // ============================================================
  group('TEST 4: Plain TXT with 81 phone numbers (9 duplicates)', async () => {
    const numbers = [];
    for (let i = 0; i < 72; i++) {
      const prefixes = ['024', '020', '026', '025', '027'];
      const prefix = prefixes[i % prefixes.length];
      const suffix = String(1000000 + (i * 11111) % 10000000).padStart(7, '0');
      numbers.push(prefix + suffix);
    }
    // Add 9 duplicates
    for (let i = 0; i < 9; i++) {
      numbers.push(numbers[i]);
    }
    
    const buffer = Buffer.from(numbers.join('\n'), 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.txt');
    
    test('Parses 81 rows', rows.length === 81, `got ${rows.length}`);
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    test('Detected phone column is phone', detected.detectedPhoneColumn === 'phone', JSON.stringify(detected));
    
    const preview = ContactImportService.generatePreview(rows, detected);
    test('Preview has 81 rows', preview.length === 81);
    test('All 81 preview rows are valid', preview.every(r => r.validationStatus === 'valid'));
    
    // Simulate frontend deduplication
    const seen = new Map();
    let duplicates = 0;
    for (const row of preview) {
      if (seen.has(row.normalizedPhoneNumber)) {
        duplicates++;
      } else {
        seen.set(row.normalizedPhoneNumber, true);
      }
    }
    test('9 duplicates detected by normalized phone', duplicates === 9, `got ${duplicates}`);
    test('72 unique valid recipients', seen.size === 72, `got ${seen.size}`);
  });

  // ============================================================
  // TEST 5: Plain TXT with blank lines
  // ============================================================
  group('TEST 5: Plain TXT with blank lines', async () => {
    const content = '0241234567\n\n0209876543\n\n\n0267654321';
    const buffer = Buffer.from(content, 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.txt');
    
    test('Blank lines are ignored', rows.length === 3, `got ${rows.length}`);
    test('All rows have phone column', rows.every(r => r.phone), 'missing phone column');
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    test('Detected phone column is phone', detected.detectedPhoneColumn === 'phone', JSON.stringify(detected));
    
    const preview = ContactImportService.generatePreview(rows, detected);
    test('All 3 rows are valid', preview.every(r => r.validationStatus === 'valid'));
  });

  // ============================================================
  // TEST 6: TXT with invalid phone numbers
  // ============================================================
  group('TEST 6: TXT with invalid phone numbers', async () => {
    const numbers = ['0241234567', 'invalid', '0209876543', '12345', '0267654321'];
    const buffer = Buffer.from(numbers.join('\n'), 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.txt');
    
    test('Parses 5 rows', rows.length === 5, `got ${rows.length}`);
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    const preview = ContactImportService.generatePreview(rows, detected);
    
    test('3 valid rows', preview.filter(r => r.validationStatus === 'valid').length === 3);
    test('2 invalid rows', preview.filter(r => r.validationStatus === 'invalid').length === 2);
    test('Valid phones are preserved', 
      preview.filter(r => r.validationStatus === 'valid').every(r => r.phoneNumber !== '-'));
  });

  // ============================================================
  // TEST 7: CSV phone-only file still works
  // ============================================================
  group('TEST 7: CSV phone-only file still works', async () => {
    const content = 'phone\n0241234567\n0209876543\n0267654321';
    const buffer = Buffer.from(content, 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.csv');
    
    test('Parses 3 rows', rows.length === 3, `got ${rows.length}`);
    test('Rows have phone column', rows[0].phone === '0241234567');
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    test('Detected phone column is phone', detected.detectedPhoneColumn === 'phone', JSON.stringify(detected));
    
    const preview = ContactImportService.generatePreview(rows, detected);
    test('All 3 rows are valid', preview.every(r => r.validationStatus === 'valid'));
  });

  // ============================================================
  // TEST 8: CSV name+phone file still works
  // ============================================================
  group('TEST 8: CSV name+phone file still works', async () => {
    const content = 'name,phone\nJohn Doe,0241234567\nJane Smith,0209876543';
    const buffer = Buffer.from(content, 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.csv');
    
    test('Parses 2 rows', rows.length === 2, `got ${rows.length}`);
    test('Detects name column', rows[0].hasOwnProperty('name'));
    test('Detects phone column', rows[0].hasOwnProperty('phone'));
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    test('Detected name column is name', detected.detectedNameColumn === 'name', JSON.stringify(detected));
    test('Detected phone column is phone', detected.detectedPhoneColumn === 'phone', JSON.stringify(detected));
    
    const preview = ContactImportService.generatePreview(rows, {
      nameColumn: detected.detectedNameColumn,
      phoneColumn: detected.detectedPhoneColumn
    });
    test('All 2 rows are valid', preview.every(r => r.validationStatus === 'valid'));
    test('Names are preserved', preview[0].recipientName === 'John Doe', `got "${preview[0].recipientName}"`);
    test('Second name is preserved', preview[1].recipientName === 'Jane Smith', `got "${preview[1].recipientName}"`);
  });

  // ============================================================
  // TEST 9: Phone number is NEVER used as recipient name
  // ============================================================
  group('TEST 9: Phone number is NEVER used as recipient name', async () => {
    // Even if nameColumn === phoneColumn, recipientName must be empty
    const rows = [{ contact: '0241234567' }, { contact: '0209876543' }];
    const preview = ContactImportService.generatePreview(rows, {
      nameColumn: 'contact',
      phoneColumn: 'contact'
    });
    
    test('Preview has 2 rows', preview.length === 2);
    test('Recipient names are empty (not phone numbers)', preview.every(r => r.recipientName === ''),
      preview.map(r => r.recipientName).join(', '));
    test('Phone numbers are preserved', preview.every(r => r.phoneNumber !== '-'));
  });

  // ============================================================
  // TEST 10: 200 recipients (MAX limit)
  // ============================================================
  group('TEST 10: 200 recipients (MAX limit)', async () => {
    const numbers = Array.from({ length: 200 }, (_, i) => {
      const prefixes = ['024', '020', '026', '025', '027'];
      const prefix = prefixes[i % prefixes.length];
      const suffix = String(1000000 + (i * 11111) % 10000000).padStart(7, '0');
      return prefix + suffix;
    });
    const buffer = Buffer.from(numbers.join('\n'), 'utf-8');
    const rows = await ContactImportService.parseFile(buffer, 'test.txt');
    
    test('Parses 200 rows', rows.length === 200, `got ${rows.length}`);
    
    const headers = Object.keys(rows[0]);
    const detected = ContactImportService.detectColumns(headers);
    const preview = ContactImportService.generatePreview(rows, detected);
    
    test('Preview has 200 rows', preview.length === 200);
    test('All 200 rows are valid', preview.every(r => r.validationStatus === 'valid'));
  });

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(50));
  console.log('TXU UPLOAD REGRESSION TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFAILURES:');
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    });
    process.exit(1);
  } else {
    console.log('\n✓ All TXT upload regression tests passed.');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
