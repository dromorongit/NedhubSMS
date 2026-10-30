const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '../src/pages/dashboard/send-sms.html');

function readHtml() {
  return fs.readFileSync(HTML_PATH, 'utf8');
}

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'send-sms.html must contain an inline <script> block');
  return match[1];
}

function makeMockDom(getSmsCostImpl, getBlacklistImpl, recipientCount) {
  const elements = {};
  function getElementById(id) {
    if (!elements[id]) {
      elements[id] = {
        textContent: '',
        style: { display: '' },
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        value: '',
        checked: false,
        options: [],
        addEventListener: () => {},
        remove: () => {},
        appendChild: () => {},
        innerHTML: '',
        setAttribute: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
        click: () => {},
        focus: () => {},
        parentNode: null,
        parentElement: null,
        children: [],
        offsetWidth: 0,
        offsetHeight: 0,
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
      };
    }
    return elements[id];
  }

  const document = {
    getElementById,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { style: { overflow: '' }, addEventListener: () => {} },
    createElement: () => ({
      textContent: '',
      style: {},
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
    }),
    createDocumentFragment: () => ({ appendChild: () => {} }),
  };

  const window = {
    document,
    apiClient: {
      getSmsCost: getSmsCostImpl,
      getBlacklist: getBlacklistImpl || (async () => ({ data: [] })),
      getContacts: async () => ({ data: { contacts: [] } }),
      getSenderIds: async () => ({ data: { senderIds: [] } }),
      getWalletBalance: async () => ({ data: { balance: 100 } }),
      getUserProfile: async () => ({ data: { user: { name: 'Test User' } } }),
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getStorage: () => ({ getItem: () => null }),
    addEventListener: () => {},
    location: { href: '', pathname: '/src/pages/dashboard/send-sms.html' },
    dispatchEvent: () => {},
    openConfirmationModal: async () => {},
    // Shared utilities from messageUtils.js
    calculateSmsSegments: (message) => {
      if (!message || message.length === 0) return { segments: 1, encoding: 'gsm7', charCount: 0, byteLength: 0 };
      const hasUnicode = /[^\x00-\x7F]/.test(message);
      const charCount = message.length;
      if (hasUnicode) {
        return { segments: Math.ceil(charCount / 67) || 1, encoding: 'unicode', charCount, byteLength: charCount * 2 };
      }
      return { segments: Math.ceil(charCount / 160) || 1, encoding: 'gsm7', charCount, byteLength: charCount };
    },
    validatePhoneNumber: (phone) => {
      if (!phone) return { isValid: false, normalizedNumber: null, error: 'required' };
      const cleaned = String(phone).replace(/\D/g, '');
      if (/^233[0-9]{9}$/.test(cleaned)) return { isValid: true, normalizedNumber: cleaned, error: null };
      if (cleaned.startsWith('0') && cleaned.length === 10) return { isValid: true, normalizedNumber: '233' + cleaned.substring(1), error: null };
      return { isValid: false, normalizedNumber: null, error: 'invalid' };
    },
    normalizePhoneNumber: (phone) => {
      if (!phone) return '';
      const cleaned = String(phone).replace(/\D/g, '');
      if (/^233[0-9]{9}$/.test(cleaned)) return cleaned;
      if (cleaned.startsWith('0') && cleaned.length === 10) return '233' + cleaned.substring(1);
      if (cleaned.length === 9) return '233' + cleaned;
      return cleaned;
    },
    escapeHtml: (text) => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
    showToast: () => {},
  };

  // Override getRecipientCount to return a fixed value
  const getRecipientCount = () => recipientCount;

  return { window, document, getElementById, elements, getRecipientCount };
}

async function runCostFlow(window, document, getRecipientCount, rate) {
  // Mock getSmsCost to return cost based on rate
  window.apiClient.getSmsCost = async (params) => {
    const segments = Number(params.get('recipients')) || 1;
    return {
      data: {
        estimatedCost: rate * segments,
        segments: { minSegments: segments, maxSegments: segments },
        encoding: 'gsm7',
        totalSegments: segments,
        avgSegments: segments,
        warnings: [],
      },
    };
  };

  // Mock getRecipientCount globally so the inline script's function returns our value
  window.getRecipientCount = getRecipientCount;

  // Evaluate the inline script so its functions are defined on window
  const html = readHtml();
  const script = extractInlineScript(html);

  // Wrap script evaluation: replace references to undeclared globals with window.xxx
  // The script uses `window.apiClient`, `document.getElementById`, etc. directly.
  // Override getRecipientCount in the script text to return our fixed recipient count
  const rc = getRecipientCount();
  const modifiedScript = script.replace(
    /function getRecipientCount\(\) \{[\s\S]*?return allRecipients\.length;[\s\S]*?\n        \}/,
    `function getRecipientCount() { return ${rc}; }`
  );

  const globalObj = window;
  const fn = new Function(
    'window',
    'document',
    'calculateSmsSegments',
    'validatePhoneNumber',
    'normalizePhoneNumber',
    'escapeHtml',
    modifiedScript + '\nreturn { updateCostEstimation, updatePreviewSummary, populateConfirmationModal, calculateSmsSegments, renderLivePreview };'
  );
  const result = fn(
    globalObj,
    document,
    window.calculateSmsSegments,
    window.validatePhoneNumber,
    window.normalizePhoneNumber,
    window.escapeHtml
  );

  // Set up message body
  const msgEl = document.getElementById('messageBody');
  msgEl.value = 'Hello {{name}}, this is a test message';

  // Run cost estimation (this populates #estimatedCost)
  await result.updateCostEstimation();

  // Read estimated cost from main UI
  const estimatedCostEl = document.getElementById('estimatedCost');
  const mainCost = estimatedCostEl ? estimatedCostEl.textContent : 'GHS 0.00';

  // Run updatePreviewSummary (populates #previewEstimatedCost in live preview)
  const previewStats = result.updatePreviewSummary();
  const previewCostEl = document.getElementById('previewEstimatedCost');
  const previewCost = previewCostEl ? previewCostEl.textContent : '—';

  // Run populateConfirmationModal (populates #reviewEstimatedCost in review modal)
  const recipients = [{ id: '1', recipientName: 'Test', phoneNumber: '0241234567', normalizedPhoneNumber: '233241234567', source: 'manual' }];
  await result.populateConfirmationModal(recipients, 'immediate', null, 'manual', {
    senderId: 'TESTID',
    messageBody: 'Hello {{name}}, this is a test message',
    isPersonalizedMode: false,
    salutation: null,
    customSalutation: null,
    analysis: { total: 1, valid: 1, invalid: 0, duplicates: 0, duplicatesRemoved: 0, blacklisted: 0, toSend: 1 },
  });
  const reviewCostEl = document.getElementById('reviewEstimatedCost');
  const reviewCost = reviewCostEl ? reviewCostEl.textContent : '—';

  return { mainCost, previewCost, reviewCost };
}

test('preview and review modal cost sync at rate 0.05', async (t) => {
  const { window, document, getRecipientCount } = makeMockDom(null, null, 3);
  const { mainCost, previewCost, reviewCost } = await runCostFlow(window, document, getRecipientCount, 0.05);

  assert.strictEqual(mainCost, 'GHS 0.15', `main estimatedCost should be GHS 0.15 (3 * 0.05), got ${mainCost}`);
  assert.strictEqual(previewCost, 'GHS 0.15', `preview cost should match main, got ${previewCost}`);
  assert.strictEqual(reviewCost, 'GHS 0.15', `review modal cost should match main, got ${reviewCost}`);
});

test('preview and review modal cost sync at rate 0.08', async (t) => {
  const { window, document, getRecipientCount } = makeMockDom(null, null, 3);
  const { mainCost, previewCost, reviewCost } = await runCostFlow(window, document, getRecipientCount, 0.08);

  assert.strictEqual(mainCost, 'GHS 0.24', `main estimatedCost should be GHS 0.24 (3 * 0.08), got ${mainCost}`);
  assert.strictEqual(previewCost, 'GHS 0.24', `preview cost should match main, got ${previewCost}`);
  assert.strictEqual(reviewCost, 'GHS 0.24', `review modal cost should match main, got ${reviewCost}`);
});

test('preview and review modal change together when rate changes', async (t) => {
  const { window, document, getRecipientCount } = makeMockDom(null, null, 2);

  const { mainCost: cost005, previewCost: prev005, reviewCost: rev005 } = await runCostFlow(window, document, getRecipientCount, 0.05);
  assert.strictEqual(cost005, 'GHS 0.10');
  assert.strictEqual(prev005, 'GHS 0.10');
  assert.strictEqual(rev005, 'GHS 0.10');

  const { mainCost: cost008, previewCost: prev008, reviewCost: rev008 } = await runCostFlow(window, document, getRecipientCount, 0.08);
  assert.strictEqual(cost008, 'GHS 0.16');
  assert.strictEqual(prev008, 'GHS 0.16');
  assert.strictEqual(rev008, 'GHS 0.16');

  // Verify both changed together
  assert.notStrictEqual(cost005, cost008, 'cost should change when rate changes');
  assert.strictEqual(prev008, rev008, 'preview and review should stay in sync at new rate');
});
