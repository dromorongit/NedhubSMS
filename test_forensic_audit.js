/**
 * FINAL SMS ENCODING FORENSIC AUDIT - Corrected Test Suite
 */

const CostCalculatorService = require('./backend/services/CostCalculatorService');

const gsm7BasicChars = new Set([
  '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç', 'Ø', 'ø', 'Å', 'å', 'Δ', '_', 'Φ', 'Γ', 'Λ', 'Ω', 'Π', 'Ψ', 'Σ', 'Θ', 'Ξ', 'Æ', 'æ', 'ß', 'É', ' ', '!', '"', '#', '¤', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', '¡', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ñ', 'Ü', '§', '¿', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ä', 'ö', 'ñ', 'ü', 'à'
]);
const gsm7ExtendedChars = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

function frontendCalculateSegments(message) {
  if (!message || message.length === 0) {
    return { segments: 1, encoding: 'gsm7', charCount: 0, byteLength: 0 };
  }
  const encoding = (() => {
    for (let i = 0; i < message.length; i++) {
      const char = message[i];
      if (!gsm7BasicChars.has(char) && !gsm7ExtendedChars.has(char)) return 'unicode';
    }
    return 'gsm7';
  })();
  const charCount = message.length;
  let segments, byteLength;
  if (encoding === 'gsm7') {
    byteLength = 0;
    for (let i = 0; i < message.length; i++) {
      byteLength += gsm7ExtendedChars.has(message[i]) ? 2 : 1;
    }
    if (byteLength <= 160) segments = 1;
    else segments = Math.ceil(byteLength / 153);
  } else {
    byteLength = charCount * 2;
    if (charCount <= 70) segments = 1;
    else segments = Math.ceil(charCount / 67);
  }
  return { segments, encoding, charCount, byteLength };
}

let passed = 0, failed = 0;
const failures = [];

function test(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function group(title, fn) {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  fn();
}

async function main() {
  // ============================================================
  // PHASE 2: GSM-7 CHARACTER SET
  // ============================================================
  group('PHASE 2: GSM-7 Character Set', () => {
    const cases = [
      ['Hello', 'gsm7', 1],
      ['Hello World!', 'gsm7', 1],
      ['Congratulations on your success.', 'gsm7', 1],
      ['GHS 100.00', 'gsm7', 1],
      ['Use code: SAVE20', 'gsm7', 1],
      ['Hello ^ test', 'gsm7', 1],
      ['Hello {test}', 'gsm7', 1],
      ['Hello [test]', 'gsm7', 1],
      ['Hello ~ test', 'gsm7', 1],
      ['Hello | test', 'gsm7', 1],
      ['Price: €50', 'gsm7', 1],
      ["O'Connor", 'gsm7', 1],
      ["You're invited!", 'gsm7', 1],
      ["Don't miss this offer.", 'gsm7', 1],
      ['Hello — welcome', 'unicode', 1],
      ['Hello 😊', 'unicode', 1],
    ];
    for (const [msg, expEnc, expSeg] of cases) {
      const r = CostCalculatorService.calculateSegments(msg);
      const f = frontendCalculateSegments(msg);
      test(`"${msg.substring(0,25)}"`, r.encoding === expEnc && r.segments === expSeg && f.encoding === expEnc && f.segments === expSeg,
        `got ${r.encoding}/${r.segments}, fe: ${f.encoding}/${f.segments}`);
    }
  });

  // ============================================================
  // PHASE 4: SEGMENTATION BOUNDARIES
  // ============================================================
  group('PHASE 4: Segmentation Boundaries', () => {
    const gsm7_159 = 'A'.repeat(159);
    const gsm7_160 = 'A'.repeat(160);
    const gsm7_161 = 'A'.repeat(161);
    const gsm7_152 = 'A'.repeat(152);
    const gsm7_153 = 'A'.repeat(153);
    const gsm7_154 = 'A'.repeat(154);
    const gsm7_459 = 'A'.repeat(459);
    const gsm7_460 = 'A'.repeat(460);
    const gsm7_601 = 'A'.repeat(601);
    
    const gsm7Tests = [
      [gsm7_159, 1], [gsm7_160, 1], [gsm7_161, 2],
      [gsm7_152, 1], [gsm7_153, 1], [gsm7_154, 1],
      [gsm7_459, 3], [gsm7_460, 4], [gsm7_601, 4],
    ];
    
    console.log('\n  GSM-7:');
    for (const [msg, exp] of gsm7Tests) {
      const r = CostCalculatorService.calculateSegments(msg);
      const f = frontendCalculateSegments(msg);
      test(`${msg.length} chars => ${exp} seg`, r.segments === exp && f.segments === exp,
        `backend=${r.segments}, fe=${f.segments}, bytes=${r.byteLength}`);
    }
    
    // Unicode: emoji = 2 UTF-16 units each
    const uni_69 = '😊'.repeat(35);   // 70 chars
    const uni_70 = '😊'.repeat(35);   // 70 chars
    const uni_71 = '😊'.repeat(36);   // 72 chars
    const uni_66 = '😊'.repeat(33);   // 66 chars
    const uni_67 = '😊'.repeat(34);   // 68 chars
    const uni_68 = '😊'.repeat(34);   // 68 chars
    const uni_221 = '😊'.repeat(111); // 222 chars
    const uni_670 = '😊'.repeat(335); // 670 chars
    const uni_671 = '😊'.repeat(336); // 672 chars
    
    const uniTests = [
      [uni_69, 1], [uni_70, 1], [uni_71, 2],
      [uni_66, 1], [uni_67, 1], [uni_68, 1],
      [uni_221, 4], [uni_670, 10], [uni_671, 11],
    ];
    
    console.log('\n  Unicode:');
    for (const [msg, exp] of uniTests) {
      const r = CostCalculatorService.calculateSegments(msg);
      const f = frontendCalculateSegments(msg);
      test(`${msg.length} chars => ${exp} seg`, r.segments === exp && f.segments === exp,
        `backend=${r.segments}, fe=${f.segments}`);
    }
  });

  // ============================================================
  // PHASE 5: 10-SEGMENT LIMIT
  // ============================================================
  group('PHASE 5: 10-Segment Limit', () => {
    const r670 = CostCalculatorService.calculateSegments('😊'.repeat(335));
    const r671 = CostCalculatorService.calculateSegments('😊'.repeat(336));
    test('670 Unicode = 10 segments (at limit)', r670.segments === 10, `got ${r670.segments}`);
    test('672 Unicode = 11 segments (exceeds)', r671.segments === 11, `got ${r671.segments}`);
  });

  // ============================================================
  // PHASE 6: PRICING
  // ============================================================
  group('PHASE 6: Pricing Consistency', async () => {
    test('Default sell price = 0.07 GHS', CostCalculatorService.defaultSellPricePerSms === 0.07, `got ${CostCalculatorService.defaultSellPricePerSms}`);
    
    const r = await CostCalculatorService.calculateFinancialBreakdown('test-user', 'Hello', 10);
    test('10 recipients × 1 segment × 0.07 = 0.70', r.totalChargedToUser === 0.70, `got ${r.totalChargedToUser}`);
    
    const r2 = await CostCalculatorService.calculateFinancialBreakdown('test-user', 'A'.repeat(161), 10);
    test('10 recipients × 2 segments × 0.07 = 1.40', r2.totalChargedToUser === 1.40, `got ${r2.totalChargedToUser}`);
  });

  // ============================================================
  // PHASE 7: FRONTEND/BACKEND CONSISTENCY
  // ============================================================
  group('PHASE 7: Frontend/Backend Consistency', () => {
    const msgs = [
      'Hello World',
      'A'.repeat(160),
      'A'.repeat(161),
      '😊'.repeat(35),
      '😊'.repeat(36),
      'Hello ^ test {test} [test] ~ test | test €50',
      'Hello — welcome',
      'Hello 😊',
    ];
    for (const msg of msgs) {
      const b = CostCalculatorService.calculateSegments(msg);
      const f = frontendCalculateSegments(msg);
      test(`"${msg.substring(0,20)}..."`, b.encoding === f.encoding && b.segments === f.segments && b.charCount === f.charCount,
        `be: ${b.encoding}/${b.segments}/${b.charCount}, fe: ${f.encoding}/${f.segments}/${f.charCount}`);
    }
  });

  // ============================================================
  // PHASE 8: GSM-7 EXTENDED CHARS BILLING
  // ============================================================
  group('PHASE 8: GSM-7 Extended Chars Billing', () => {
    const msg1 = 'A'.repeat(159) + '€';
    const r1 = CostCalculatorService.calculateSegments(msg1);
    test('159 basic + 1 extended (161 bytes) = 2 segments', r1.segments === 2 && r1.byteLength === 161,
      `got ${r1.segments} seg, ${r1.byteLength} bytes`);
    
    const msg2 = 'A'.repeat(158) + '€€';
    const r2 = CostCalculatorService.calculateSegments(msg2);
    test('158 basic + 2 extended (162 bytes) = 2 segments', r2.segments === 2 && r2.byteLength === 162,
      `got ${r2.segments} seg, ${r2.byteLength} bytes`);
    
    const msg3 = 'A'.repeat(153) + '^'.repeat(7);
    const r3 = CostCalculatorService.calculateSegments(msg3);
    test('153 basic + 7 extended (167 bytes) = 2 segments', r3.segments === 2 && r3.byteLength === 167,
      `got ${r3.segments} seg, ${r3.byteLength} bytes`);
    
    const msg4 = '^'.repeat(8);
    const r4 = CostCalculatorService.calculateSegments(msg4);
    test('8 extended chars (16 bytes) = 1 segment', r4.segments === 1 && r4.byteLength === 16,
      `got ${r4.segments} seg, ${r4.byteLength} bytes`);
  });

  // ============================================================
  // PHASE 9: PERSONALIZED MESSAGING
  // ============================================================
  group('PHASE 9: Personalized Messaging', () => {
    const template = 'Hello {{name}}, your bill is ready. Please pay GHS 100.00';
    const r = CostCalculatorService.calculateSegmentsForPersonalizedMessage(template, { name: 'John Doe' });
    test('Personalized template calculates segments', r.minSegments >= 1 && r.maxSegments >= 1,
      `min=${r.minSegments}, max=${r.maxSegments}`);
    test('Personalized encoding detected', r.encoding === 'gsm7', `got ${r.encoding}`);
  });

  // ============================================================
  // PHASE 10: UNICODE/EMOJI SURROGATE PAIRS
  // ============================================================
  group('PHASE 10: Unicode/Emoji Handling', () => {
    const msg1 = 'Hello 😊';
    const r1 = CostCalculatorService.calculateSegments(msg1);
    test('Hello 😊 = 8 chars, unicode, 1 segment', r1.charCount === 8 && r1.encoding === 'unicode' && r1.segments === 1,
      `chars=${r1.charCount}, encoding=${r1.encoding}, segs=${r1.segments}`);
    
    const msg2 = '😊'.repeat(5);
    const r2 = CostCalculatorService.calculateSegments(msg2);
    test('5 emojis = 10 chars, unicode, 1 segment', r2.charCount === 10 && r2.segments === 1,
      `chars=${r2.charCount}, segs=${r2.segments}`);
    
    const msg3 = '😊'.repeat(36);
    const r3 = CostCalculatorService.calculateSegments(msg3);
    test('36 emojis (72 UTF-16 units) = 2 segments', r3.segments === 2,
      `chars=${r3.charCount}, segs=${r3.segments}`);
  });

  // ============================================================
  // PHASE 11: SCHEMA MAXLENGTH REMOVED
  // ============================================================
  group('PHASE 11: Schema maxlength Removed', () => {
    const SmsMessage = require('./backend/models/SmsMessage');
    const SmsRecipient = require('./backend/models/SmsRecipient');
    const SmsCampaign = require('./backend/models/SmsCampaign');
    
    const msgSchema = SmsMessage.schema.path('message');
    const recSchema = SmsRecipient.schema.path('personalizedMessage');
    const campSchema = SmsCampaign.schema.path('messageBody');
    
    test('SmsMessage.message has no maxlength', !msgSchema.options.maxlength, `maxlength=${msgSchema.options.maxlength}`);
    test('SmsRecipient.personalizedMessage has no maxlength', !recSchema.options.maxlength, `maxlength=${recSchema.options.maxlength}`);
    test('SmsCampaign.messageBody has no maxlength', !campSchema.options.maxlength, `maxlength=${campSchema.options.maxlength}`);
  });

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nDefects:');
    failures.forEach((f, i) => console.log(`  ${i+1}. ${f.name}: ${f.detail}`));
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
