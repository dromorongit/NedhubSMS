// Shared recipient validation and normalization utilities

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
 * Parse manual recipient input (supports "Name Phone" or "Phone" formats)
 * @param {string} input - Raw input string
 * @returns {Object} Parsed recipient with name and phoneNumber
 */
function parseManualRecipientInput(input) {
  if (!input || !input.trim()) {
    return { recipientName: '', phoneNumber: '', isValid: false, error: 'Input is required' };
  }

  const trimmed = input.trim();
  
  // Try to extract phone number (9-15 digits)
  const phoneMatches = trimmed.match(/(\d{9,15})/g);
  
  if (!phoneMatches) {
    return { recipientName: '', phoneNumber: '', isValid: false, error: 'No valid phone number found' };
  }

  const phoneNumber = phoneMatches[0];
  const phoneValidation = validatePhoneNumber(phoneNumber);
  
  if (!phoneValidation.isValid) {
    return { recipientName: '', phoneNumber: '', isValid: false, error: phoneValidation.error };
  }

  // Extract name (everything before the phone number)
  const phoneIndex = trimmed.indexOf(phoneNumber);
  let recipientName = trimmed.substring(0, phoneIndex).trim();
  
  // If no name provided, use fallback
  if (!recipientName) {
    recipientName = 'User';
  }

  return {
    recipientName,
    phoneNumber: phoneValidation.normalizedNumber,
    isValid: true,
    error: null
  };
}

/**
 * Deduplicate recipients by normalized phone number
 * @param {Array} recipients - Array of recipient objects {recipientName, phoneNumber}
 * @param {boolean} removeDuplicates - Whether to remove duplicates automatically
 * @returns {Object} {uniqueRecipients: Array, duplicates: Array, duplicateCount: number}
 */
function deduplicateRecipients(recipients, removeDuplicates = true) {
  const seen = new Map();
  const duplicates = [];
  const uniqueRecipients = [];

  for (const recipient of recipients) {
    const normalizedPhone = normalizePhoneNumber(recipient.phoneNumber);

    if (seen.has(normalizedPhone)) {
      duplicates.push({
        recipientName: recipient.recipientName,
        phoneNumber: recipient.phoneNumber,
        normalizedPhoneNumber: normalizedPhone,
        duplicateOf: seen.get(normalizedPhone).originalIndex
      });
    } else {
      seen.set(normalizedPhone, {
        recipientName: recipient.recipientName,
        phoneNumber: recipient.phoneNumber,
        normalizedPhoneNumber: normalizedPhone,
        originalIndex: uniqueRecipients.length
      });
      uniqueRecipients.push({
        ...recipient,
        normalizedPhoneNumber: normalizedPhone
      });
    }
  }

  // If removeDuplicates is false, include duplicates in the result
  if (!removeDuplicates) {
    uniqueRecipients.push(...duplicates.map(d => ({
      recipientName: d.recipientName,
      phoneNumber: d.phoneNumber,
      normalizedPhoneNumber: d.normalizedPhoneNumber
    })));
  }

  return {
    uniqueRecipients,
    duplicates,
    duplicateCount: duplicates.length
  };
}

/**
 * Validate recipients and check for blacklisted numbers
 * @param {Array} recipients - Array of recipient objects
 * @param {Set} blacklistedSet - Set of blacklisted phone numbers
 * @returns {Object} {validRecipients: Array, invalidRecipients: Array, blacklistedRecipients: Array}
 */
function validateRecipients(recipients, blacklistedSet = new Set()) {
  const validRecipients = [];
  const invalidRecipients = [];
  const blacklistedRecipients = [];

  for (const recipient of recipients) {
    const normalizedPhone = normalizePhoneNumber(recipient.phoneNumber);

    // Check if blacklisted
    if (blacklistedSet.has(normalizedPhone)) {
      blacklistedRecipients.push({
        ...recipient,
        normalizedPhoneNumber: normalizedPhone,
        reason: 'Blacklisted number'
      });
      continue;
    }

    // Validate phone number format
    const phoneValidation = validatePhoneNumber(recipient.phoneNumber);
    
    if (!phoneValidation.isValid) {
      invalidRecipients.push({
        ...recipient,
        normalizedPhoneNumber: normalizedPhone,
        reason: phoneValidation.error
      });
      continue;
    }

    validRecipients.push({
      ...recipient,
      normalizedPhoneNumber: normalizedPhone
    });
  }

  return {
    validRecipients,
    invalidRecipients,
    blacklistedRecipients
  };
}

/**
 * Process recipients for campaign (deduplication + validation)
 * @param {Array} recipients - Array of recipient objects
 * @param {Set} blacklistedSet - Set of blacklisted phone numbers
 * @param {boolean} removeDuplicates - Whether to remove duplicates
 * @returns {Object} Processing results
 */
function processRecipientsForCampaign(recipients, blacklistedSet = new Set(), removeDuplicates = true) {
  // First, deduplicate
  const dedupResult = deduplicateRecipients(recipients, removeDuplicates);

  // Then validate the unique recipients
  const validationResult = validateRecipients(dedupResult.uniqueRecipients, blacklistedSet);

  return {
    originalCount: recipients.length,
    duplicateCount: dedupResult.duplicateCount,
    validRecipients: validationResult.validRecipients,
    invalidRecipients: validationResult.invalidRecipients,
    blacklistedRecipients: validationResult.blacklistedRecipients,
    duplicates: dedupResult.duplicates,
    finalCount: validationResult.validRecipients.length
  };
}

// Attach to window for global access
window.normalizePhoneNumber = normalizePhoneNumber;
window.validatePhoneNumber = validatePhoneNumber;
window.parseManualRecipientInput = parseManualRecipientInput;
window.deduplicateRecipients = deduplicateRecipients;
window.validateRecipients = validateRecipients;
window.processRecipientsForCampaign = processRecipientsForCampaign;
