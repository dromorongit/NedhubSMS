const BlacklistedNumber = require('../models/BlacklistedNumber');

class SmsRecipientService {
  /**
   * Normalize phone number for deduplication
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} Normalized phone number
   */
  static normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';

    // Remove all non-digit characters
    let normalized = phoneNumber.replace(/\D/g, '');

    // Handle Ghanaian numbers
    if (normalized.startsWith('233') && normalized.length === 12) {
      // Already in 233 format
      return normalized;
    } else if (normalized.startsWith('0') && normalized.length === 10) {
      // Convert 0XXXXXXXXX to 233XXXXXXXXX
      // Support 020-059 prefixes
      return '233' + normalized.substring(1);
    } else if (normalized.length === 9) {
      // Assume it's missing the country code, add 233
      // Support 20-59 prefixes
      return '233' + normalized;
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
    console.log('[Deduplicate] Starting deduplication. Input count:', recipients.length);
    const seen = new Map();
    const duplicates = [];
    const uniqueRecipients = [];

    for (const recipient of recipients) {
      const normalizedPhone = this.normalizePhoneNumber(recipient.phoneNumber);

      if (seen.has(normalizedPhone)) {
        const dupInfo = {
          recipientName: recipient.recipientName,
          phoneNumber: recipient.phoneNumber,
          normalizedPhoneNumber: normalizedPhone,
          duplicateOf: seen.get(normalizedPhone).originalIndex
        };
        duplicates.push(dupInfo);
        console.log('[Deduplicate] Duplicate detected:', dupInfo);
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

    console.log('[Deduplicate] Completed. Unique:', uniqueRecipients.length, 'Duplicates:', duplicates.length);
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
    console.log('[Validate] validateRecipients called with:', recipients.length, 'recipients');
    console.log('[Validate] userId:', userId);
    
    const validRecipients = [];
    const invalidRecipients = [];
    const blacklistedRecipients = [];

    // Get blacklisted numbers for this user
    const blacklistedNumbers = await BlacklistedNumber.find({
      $or: [
        { userId: userId },
        { userId: null } // Global blacklisted numbers
      ]
    }).select('phoneNumber');

    console.log('[Validate] Blacklisted numbers found:', blacklistedNumbers.length);

    const blacklistedSet = new Set(
      blacklistedNumbers.map(b => this.normalizePhoneNumber(b.phoneNumber))
    );

    console.log('[Validate] Blacklisted set:', Array.from(blacklistedSet));

    // Regex for valid Ghanaian phone numbers (accepts +233, 233, or 0 prefix)
    const phoneRegex = /^(?:\+233|233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55|59)[0-9]{7}$/;

    for (const recipient of recipients) {
      console.log('[Validate] Processing recipient:', recipient);
      
      const normalizedPhone = this.normalizePhoneNumber(recipient.phoneNumber);
      console.log('[Validate] Normalized phone:', normalizedPhone, 'Original:', recipient.phoneNumber);

      // Check if blacklisted
      if (blacklistedSet.has(normalizedPhone)) {
        console.log('[Validate] Number is blacklisted:', normalizedPhone);
        blacklistedRecipients.push({
          ...recipient,
          normalizedPhoneNumber: normalizedPhone,
          reason: 'Blacklisted number'
        });
        continue;
      }

      // Validate phone number format using normalized number
      const isValid = phoneRegex.test(normalizedPhone);
      console.log('[Validate] Testing normalized phone:', normalizedPhone, 'regex valid:', isValid);
      
      if (!isValid) {
        console.log('[Validate] Invalid phone format for:', recipient.phoneNumber, 'normalized:', normalizedPhone);
        invalidRecipients.push({
          ...recipient,
          normalizedPhoneNumber: normalizedPhone,
          reason: 'Invalid phone number format'
        });
        continue;
      }

      validRecipients.push({
        ...recipient,
        normalizedPhoneNumber: normalizedPhone
      });
    }

    console.log('[Validate] Validation results:');
    console.log('  validRecipients:', validRecipients.length);
    console.log('  invalidRecipients:', invalidRecipients.length);
    console.log('  blacklistedRecipients:', blacklistedRecipients.length);
    if (invalidRecipients.length > 0) {
      console.log('[Validate] Invalid details:', invalidRecipients.map(i => ({ phone: i.phoneNumber, reason: i.reason })));
    }
    if (blacklistedRecipients.length > 0) {
      console.log('[Validate] Blacklisted details:', blacklistedRecipients.map(b => b.phoneNumber));
    }

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
    // First, deduplicate
    const dedupResult = this.deduplicateRecipients(recipients, removeDuplicates);

    // Then validate the unique recipients
    const validationResult = await this.validateRecipients(dedupResult.uniqueRecipients, userId);

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
}

module.exports = SmsRecipientService;
