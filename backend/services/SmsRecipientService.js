const BlacklistedNumber = require('../models/BlacklistedNumber');

class SmsRecipientService {
  /**
   * Normalize phone number for deduplication
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} Normalized phone number
   */
  static normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;

    // Remove all non-digit characters
    let normalized = phoneNumber.replace(/\D/g, '');

    // Handle Ghanaian numbers
    if (normalized.startsWith('233') && normalized.length === 12) {
      return normalized;
    } else if (normalized.startsWith('0') && normalized.length === 10) {
      return '233' + normalized.substring(1);
    } else if (normalized.length === 9) {
      return '233' + normalized;
    }

    if (normalized.length !== 12 || !normalized.startsWith('233')) {
      return null;
    }
    return normalized;
  }

  /**
   * Deduplicate recipients by normalized phone number
   * @param {Array} recipients - Array of recipient objects {recipientName, phoneNumber}
   * @param {boolean} removeDuplicates - Whether to remove duplicates automatically
   * @returns {Object} {uniqueRecipients: Array, duplicates: Array, duplicateCount: number}
   */
  static deduplicateRecipients(recipients, removeDuplicates = true) {
    console.log('[Recipients] Starting deduplication', { 
      totalRecipients: recipients.length,
      removeDuplicates 
    });
    const seen = new Map();
    const duplicates = [];
    const uniqueRecipients = [];

    for (const recipient of recipients) {
      const normalizedPhone = this.normalizePhoneNumber(recipient.phoneNumber);
      if (normalizedPhone === null) {
        uniqueRecipients.push({
          ...recipient,
          normalizedPhoneNumber: normalizedPhone
        });
        continue;
      }

      if (seen.has(normalizedPhone)) {
        const dupInfo = {
          recipientName: recipient.recipientName,
          phoneNumber: recipient.phoneNumber,
          normalizedPhoneNumber: normalizedPhone,
          duplicateOf: seen.get(normalizedPhone).originalIndex
        };
        duplicates.push(dupInfo);
        console.log('[Recipients] Duplicate detected', dupInfo);
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

    console.log('[Deduplicate] Completed', { 
      unique: uniqueRecipients.length, 
      duplicates: duplicates.length 
    });
    return {
      uniqueRecipients,
      duplicates,
      duplicateCount: duplicates.length
    };
  }

  /**
   * Validate recipients and check for blacklisted numbers
   * @param {Array} recipients - Array of recipient objects
   * @param {string} userId - User ID for blacklisted number check
   * @returns {Object} {validRecipients: Array, invalidRecipients: Array, blacklistedRecipients: Array}
   */
  static async validateRecipients(recipients, userId) {
    console.log('[Validation] Starting recipient validation', { 
      recipientsCount: recipients.length, 
      userId 
    });
    
    const validRecipients = [];
    const invalidRecipients = [];
    const blacklistedRecipients = [];

    // Get blacklisted numbers for this user
    console.log('[Validation] Loading blacklisted numbers', { userId });
    const blacklistedNumbers = await BlacklistedNumber.find({
      $or: [
        { userId: userId },
        { userId: null } // Global blacklisted numbers
      ]
    }).select('phoneNumber');

    console.log('[Validation] Blacklisted numbers loaded', { count: blacklistedNumbers.length });

    const blacklistedSet = new Set(
      blacklistedNumbers.map(b => this.normalizePhoneNumber(b.phoneNumber)).filter(p => p !== null)
    );

    // Regex for valid Ghanaian phone numbers (accepts +233, 233, or 0 prefix)
    const phoneRegex = /^(?:\+233|233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55|59)[0-9]{7}$/;

    for (const recipient of recipients) {
      const normalizedPhone = this.normalizePhoneNumber(recipient.phoneNumber);

      if (normalizedPhone === null) {
        invalidRecipients.push({
          ...recipient,
          normalizedPhoneNumber: normalizedPhone,
          reason: 'Invalid phone number format'
        });
        continue;
      }

      // Check if blacklisted
      if (blacklistedSet.has(normalizedPhone)) {
        blacklistedRecipients.push({
          ...recipient,
          normalizedPhoneNumber: normalizedPhone,
          reason: 'Blacklisted number'
        });
        console.log('[Validation] Blacklisted number', { 
          phone: recipient.phoneNumber, 
          normalized: normalizedPhone,
          name: recipient.recipientName 
        });
        continue;
      }

      // Validate phone number format using normalized number
      const isValid = phoneRegex.test(normalizedPhone);
      
      if (!isValid) {
        invalidRecipients.push({
          ...recipient,
          normalizedPhoneNumber: normalizedPhone,
          reason: 'Invalid phone number format'
        });
        console.log('[Validation] Invalid format', { 
          phone: recipient.phoneNumber, 
          normalized: normalizedPhone,
          name: recipient.recipientName 
        });
        continue;
      }

      validRecipients.push({
        ...recipient,
        normalizedPhoneNumber: normalizedPhone
      });
    }

    console.log('[Validation] Results', {
      total: recipients.length,
      valid: validRecipients.length,
      invalid: invalidRecipients.length,
      blacklisted: blacklistedRecipients.length
    });
    
    return {
      validRecipients,
      invalidRecipients,
      blacklistedRecipients
    };
  }

  /**
   * Process recipients for campaign creation (deduplication + validation)
   * @param {Array} recipients - Array of recipient objects
   * @param {string} userId - User ID
   * @param {boolean} removeDuplicates - Whether to remove duplicates
   * @returns {Object} Processing results
   */
  static async processRecipientsForCampaign(recipients, userId, removeDuplicates = true) {
    console.log('[Recipients] Processing for campaign', { 
      totalRecipients: recipients.length, 
      removeDuplicates,
      userId 
    });

    // First, deduplicate
    const dedupResult = this.deduplicateRecipients(recipients, removeDuplicates);
    console.log('[Recipients] Deduplication complete', {
      original: recipients.length,
      unique: dedupResult.uniqueRecipients.length,
      duplicates: dedupResult.duplicateCount
    });

    // Then validate the unique recipients
    const validationResult = await this.validateRecipients(dedupResult.uniqueRecipients, userId);

    const result = {
      originalCount: recipients.length,
      duplicateCount: dedupResult.duplicateCount,
      validRecipients: validationResult.validRecipients,
      invalidRecipients: validationResult.invalidRecipients,
      blacklistedRecipients: validationResult.blacklistedRecipients,
      duplicates: dedupResult.duplicates,
      finalCount: validationResult.validRecipients.length
    };

    console.log('[Recipients] Processing complete', {
      original: result.originalCount,
      duplicates: result.duplicateCount,
      valid: result.finalCount,
      invalid: result.invalidRecipients.length,
      blacklisted: result.blacklistedRecipients.length
    });

    return result;
  }
}

module.exports = SmsRecipientService;
