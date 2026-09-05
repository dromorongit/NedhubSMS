// Shared message calculation and validation utilities

/**
 * Calculate SMS segments for a message based on encoding
 * @param {string} message - Message body
 * @returns {Object} Segment calculation result
 */
function calculateSmsSegments(message) {
  if (!message || message.length === 0) {
    return {
      segments: 1,
      encoding: 'gsm7',
      charCount: 0,
      byteLength: 0
    };
  }

  const encoding = determineEncoding(message);
  const charCount = message.length;

  let segments;
  let byteLength;

  if (encoding === 'gsm7') {
    byteLength = calculateByteLength(message);
    const singleSegmentLimit = 160; // 160 bytes for GSM-7
    const multiSegmentLimit = 153; // 153 bytes for multi-part GSM-7

    if (byteLength <= singleSegmentLimit) {
      segments = 1;
    } else {
      segments = Math.ceil(byteLength / multiSegmentLimit);
    }
  } else {
    // Unicode (UCS-2)
    const singleSegmentLimit = 70; // 70 characters for Unicode
    const multiSegmentLimit = 67; // 67 characters for multi-part Unicode

    if (charCount <= singleSegmentLimit) {
      segments = 1;
    } else {
      segments = Math.ceil(charCount / multiSegmentLimit);
    }
    byteLength = charCount * 2; // Each Unicode char is 2 bytes
  }

  return {
    segments,
    encoding,
    charCount,
    byteLength
  };
}

/**
 * Determine the encoding type for a message
 * @param {string} message - Message to analyze
 * @returns {string} 'gsm7' or 'unicode'
 */
function determineEncoding(message) {
  if (!message) return 'gsm7';

  // GSM-7 character set (basic characters)
  const gsm7BasicChars = new Set([
    '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç', '\n', 'Ø', 'ø', '\r', 'Å', 'å', 'Δ', '_', 'Φ', 'Γ', 'Λ', 'Ω', 'Π', 'Ψ', 'Σ', 'Θ', 'Ξ', 'Æ', 'æ', 'ß', 'É', ' ', '!', '"', '#', '¤', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', '¡', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ñ', 'Ü', '§', '¿', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ä', 'ö', 'ñ', 'ü', 'à'
  ]);

  // GSM-7 extended characters (take 2 bytes)
  const gsm7ExtendedChars = new Set([
    '^', '{', '}', '\\', '[', '~', ']', '|', '€'
  ]);

  // Check each character
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (!gsm7BasicChars.has(char) && !gsm7ExtendedChars.has(char)) {
      return 'unicode';
    }
  }

  return 'gsm7';
}

/**
 * Calculate the actual byte length considering GSM-7 extended characters
 * @param {string} message - Message to calculate
 * @returns {number} Byte length
 */
function calculateByteLength(message) {
  if (!message) return 0;

  // GSM-7 extended characters
  const gsm7ExtendedChars = new Set([
    '^', '{', '}', '\\', '[', '~', ']', '|', '€'
  ]);

  let byteLength = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (gsm7ExtendedChars.has(char)) {
      byteLength += 2; // Extended chars take 2 bytes
    } else {
      byteLength += 1; // Basic chars take 1 byte
    }
  }

  return byteLength;
}

/**
 * Detect Unicode/special characters in a message
 * @param {string} message - Message to analyze
 * @returns {Array} Array of detected special characters
 */
function detectUnicodeCharacters(message) {
  if (!message) return [];

  const gsm7BasicChars = new Set([
    '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç', '\n', 'Ø', 'ø', '\r', 'Å', 'å', 'Δ', '_', 'Φ', 'Γ', 'Λ', 'Ω', 'Π', 'Ψ', 'Σ', 'Θ', 'Ξ', 'Æ', 'æ', 'ß', 'É', ' ', '!', '"', '#', '¤', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', '¡', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ñ', 'Ü', '§', '¿', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ä', 'ö', 'ñ', 'ü', 'à'
  ]);

  const gsm7ExtendedChars = new Set([
    '^', '{', '}', '\\', '[', '~', ']', '|', '€'
  ]);

  const specialChars = [];
  const seen = new Set();

  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (!gsm7BasicChars.has(char) && !gsm7ExtendedChars.has(char) && !seen.has(char)) {
      specialChars.push(char);
      seen.add(char);
    }
  }

  return specialChars;
}

/**
 * Convert Unicode/special characters to GSM-compatible equivalents
 * @param {string} message - Message to convert
 * @returns {string} Converted message
 */
function convertToGsmCompatible(message) {
  if (!message) return message;

  const replacements = {
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"',
    '–': '-',
    '—': '-',
    '…': '...',
    '€': 'EUR',
    '©': '(c)',
    '®': '(r)',
    '™': '(tm)',
    '°': ' degrees',
    '±': '+/-',
    '÷': '/',
    '×': 'x',
    '½': '1/2',
    '¼': '1/4',
    '¾': '3/4',
    'à': 'a',
    'á': 'a',
    'â': 'a',
    'ã': 'a',
    'ä': 'ae',
    'å': 'a',
    'è': 'e',
    'é': 'e',
    'ê': 'e',
    'ë': 'e',
    'ì': 'i',
    'í': 'i',
    'î': 'i',
    'ï': 'i',
    'ò': 'o',
    'ó': 'o',
    'ô': 'o',
    'õ': 'o',
    'ö': 'oe',
    'ù': 'u',
    'ú': 'u',
    'û': 'u',
    'ü': 'ue',
    'ý': 'y',
    'ÿ': 'y',
    'ñ': 'n',
    'ç': 'c',
    'ß': 'ss',
    'Æ': 'Ae',
    'æ': 'ae',
    'Œ': 'Oe',
    'œ': 'oe',
    'Ø': 'O',
    'ø': 'o',
    'Å': 'A',
    'å': 'a',
    'Ä': 'Ae',
    'Ö': 'Oe',
    'Ü': 'Ue',
    'Ñ': 'N',
    '¡': '!',
    '¿': '?',
    '«': '"',
    '»': '"',
    '•': '-',
    '·': '.',
    '…': '...',
    '★': '*',
    '☆': '*',
    '❤': '<3',
    '♥': '<3',
    '✓': 'OK',
    '✗': 'NO',
    '✓': 'OK',
    '✘': 'NO'
  };

  // Replace emojis and other special characters
  let result = '';
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    // Check if it's an emoji or symbol outside basic ranges
    const code = message.charCodeAt(i);
    if ((code >= 0x1F600 && code <= 0x1F64F) || // Emoticons
        (code >= 0x1F300 && code <= 0x1F5FF) || // Misc Symbols and Pictographs
        (code >= 0x1F680 && code <= 0x1F6FF) || // Transport and Map
        (code >= 0x2600 && code <= 0x26FF) ||   // Misc symbols
        (code >= 0x2700 && code <= 0x27BF)) {   // Dingbats
      result += '[emoji]';
    } else if (replacements[char]) {
      result += replacements[char];
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Format a personalized message with salutation and name
 * @param {string} messageBody - The message body
 * @param {string} salutation - The salutation
 * @param {string} recipientName - The recipient name
 * @returns {string} Formatted message
 */
function formatPersonalizedMessage(messageBody, salutation, recipientName) {
  if (!messageBody) return '';
  
  const finalSalutation = salutation || 'Dear';
  const finalName = recipientName || 'Unknown Recipient';
  
  // If message already contains placeholders, replace them
  let formatted = messageBody;
  formatted = formatted.replace(/\{\{salutation\}\}/g, finalSalutation);
  formatted = formatted.replace(/\{\{name\}\}/g, finalName);
  
  return formatted;
}

/**
 * Validate phone number format (Ghanaian numbers)
 * @param {string} phoneNumber - Phone number to validate
 * @returns {Object} Validation result with isValid, normalizedNumber, and error
 */
function validatePhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return { isValid: false, normalizedNumber: null, error: 'Phone number is required' };
  }

  let cleaned = String(phoneNumber).replace(/[\s\-()+]/g, '');
  cleaned = cleaned.replace(/\D/g, '');

  // Handle Ghanaian numbers
  if (cleaned.startsWith('233')) {
    if (cleaned.length === 12) {
      return { isValid: true, normalizedNumber: cleaned, error: null };
    }
  } else if (cleaned.startsWith('0')) {
    if (cleaned.length === 10) {
      const international = '233' + cleaned.substring(1);
      return { isValid: true, normalizedNumber: international, error: null };
    }
  } else if (cleaned.length === 9) {
    const international = '233' + cleaned;
    return { isValid: true, normalizedNumber: international, error: null };
  }

  const ghanaRegex = /^233[0-9]{9}$/;
  if (ghanaRegex.test(cleaned)) {
    return { isValid: true, normalizedNumber: cleaned, error: null };
  }

  return {
    isValid: false,
    normalizedNumber: null,
    error: `Invalid phone number format: ${phoneNumber}`
  };
}

/**
 * Normalize phone number for deduplication
 * @param {string} phoneNumber - Raw phone number
 * @returns {string} Normalized phone number
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';

  let normalized = String(phoneNumber).replace(/\D/g, '');

  if (normalized.startsWith('233') && normalized.length === 12) {
    return normalized;
  } else if (normalized.startsWith('0') && normalized.length === 10) {
    return '233' + normalized.substring(1);
  } else if (normalized.length === 9) {
    return '233' + normalized;
  }

  return normalized;
}

// Attach to window for global access
window.calculateSmsSegments = calculateSmsSegments;
window.determineEncoding = determineEncoding;
window.calculateByteLength = calculateByteLength;
window.detectUnicodeCharacters = detectUnicodeCharacters;
window.convertToGsmCompatible = convertToGsmCompatible;
window.formatPersonalizedMessage = formatPersonalizedMessage;
window.validatePhoneNumber = validatePhoneNumber;
window.normalizePhoneNumber = normalizePhoneNumber;
