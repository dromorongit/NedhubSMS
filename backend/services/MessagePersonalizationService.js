class MessagePersonalizationService {
  constructor() {
    this.defaultSalutations = {
      'Dear': 'Dear',
      'Hello': 'Hello',
      'Hi': 'Hi',
      'Esteemed': 'Esteemed',
      'Honourable': 'Honourable'
    };

    this.defaultFallbackName = 'Unknown Recipient';
  }

  /**
   * Personalize a message for a specific recipient
   * @param {string} messageBody - The base message template
   * @param {string} salutation - The salutation type
   * @param {string} customSalutation - Custom salutation if type is 'Custom'
   * @param {string} recipientName - The recipient's name
   * @param {string} fallbackName - Fallback name if recipientName is empty
   * @returns {string} - The personalized message
   */
  personalizeMessage(messageBody, salutation, customSalutation, recipientName, fallbackName = null) {
    if (!messageBody) {
      throw new Error('Message body is required');
    }

    const finalSalutation = this.getFinalSalutation(salutation, customSalutation);
    const finalName = this.getFinalName(recipientName, fallbackName);

    // Replace placeholders in the message body
    let personalizedMessage = messageBody;

    // Replace {{salutation}} placeholder
    personalizedMessage = personalizedMessage.replace(/\{\{salutation\}\}/g, finalSalutation);

    // Replace {{name}} placeholder
    personalizedMessage = personalizedMessage.replace(/\{\{name\}\}/g, finalName);

    // Replace {{messageBody}} placeholder (for structured messages)
    personalizedMessage = personalizedMessage.replace(/\{\{messageBody\}\}/g, messageBody);

    return personalizedMessage.trim();
  }

  /**
   * Get the final salutation based on type and custom value
   * @param {string} salutation - The salutation type
   * @param {string} customSalutation - Custom salutation
   * @returns {string} - The final salutation
   */
  getFinalSalutation(salutation, customSalutation) {
    if (salutation === 'Custom') {
      return customSalutation && customSalutation.trim() ? customSalutation.trim() : 'Dear';
    }

    return this.defaultSalutations[salutation] || 'Dear';
  }

  /**
   * Get the final name, with fallback
   * @param {string} recipientName - The recipient's name
   * @param {string} fallbackName - Fallback name
   * @returns {string} - The final name
   */
  getFinalName(recipientName, fallbackName = null) {
    const name = recipientName && recipientName.trim() ? recipientName.trim() : null;

    if (name) {
      return name;
    }

    return fallbackName || this.defaultFallbackName;
  }

  /**
   * Generate preview messages for sample recipients
   * @param {string} messageBody - The base message template
   * @param {string} salutation - The salutation type
   * @param {string} customSalutation - Custom salutation
   * @param {Array} sampleRecipients - Array of {recipientName, phoneNumber} objects
   * @param {string} fallbackName - Fallback name
   * @returns {Array} - Array of personalized messages
   */
  generatePreviewMessages(messageBody, salutation, customSalutation, sampleRecipients, fallbackName = null) {
    if (!Array.isArray(sampleRecipients)) {
      throw new Error('Sample recipients must be an array');
    }

    return sampleRecipients.map(recipient => {
      const personalizedMessage = this.personalizeMessage(
        messageBody,
        salutation,
        customSalutation,
        recipient.recipientName,
        fallbackName
      );

      return {
        id: recipient.id,
        recipientName: recipient.recipientName,
        phoneNumber: recipient.phoneNumber,
        normalizedPhoneNumber: recipient.normalizedPhoneNumber,
        source: recipient.source,
        personalizedMessage
      };
    });
  }

  /**
   * Validate that a message template has required placeholders for personalization
   * @param {string} messageTemplate - The message template
   * @param {boolean} isPersonalized - Whether personalization is enabled
   * @returns {Object} - Validation result with isValid and errors array
   */
  validateMessageTemplate(messageTemplate, isPersonalized = true) {
    const errors = [];

    if (!messageTemplate || messageTemplate.trim().length === 0) {
      errors.push('Message template cannot be empty');
    }

    if (isPersonalized) {
      // Check if message has at least one placeholder for personalization
      const hasNamePlaceholder = messageTemplate.includes('{{name}}');
      const hasSalutationPlaceholder = messageTemplate.includes('{{salutation}}');
      
      // If no placeholders at all, warn but don't block - simple messages are allowed
      if (!hasNamePlaceholder && !hasSalutationPlaceholder) {
        // Not an error - simple messages without personalization are allowed
      } else {
        // If placeholders are used, validate they are complete
        if (hasNamePlaceholder && !hasSalutationPlaceholder) {
          // Only name used - that's fine
        }
        if (hasSalutationPlaceholder && !hasNamePlaceholder) {
          // Only salutation used - that's fine
        }
      }
    }

    // Check for unclosed placeholders
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const placeholders = messageTemplate.match(placeholderRegex) || [];
    const validPlaceholders = ['{{name}}', '{{salutation}}', '{{messageBody}}'];
    const invalidPlaceholders = placeholders.filter(p => !validPlaceholders.includes(p));

    if (invalidPlaceholders.length > 0) {
      errors.push(`Invalid placeholders found: ${invalidPlaceholders.join(', ')}. Valid placeholders are: {{name}}, {{salutation}}, {{messageBody}}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Extract unique placeholders from a message template
   * @param {string} messageTemplate - The message template
   * @returns {Array} - Array of unique placeholders found
   */
  extractPlaceholders(messageTemplate) {
    if (!messageTemplate) return [];

    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const matches = messageTemplate.match(placeholderRegex) || [];
    const placeholders = matches.map(match => match.slice(2, -2)); // Remove {{ and }}

    return [...new Set(placeholders)]; // Return unique placeholders
  }

  /**
   * Create a structured message from salutation and body
   * @param {string} salutation - The salutation
   * @param {string} messageBody - The message body
   * @returns {string} - Structured message
   */
  createStructuredMessage(salutation, messageBody) {
    return `${salutation} {{name}}, ${messageBody}`;
  }

  /**
   * Estimate SMS segments for a personalized message
   * @param {string} messageTemplate - The message template
   * @param {string} salutation - The salutation
   * @param {string} customSalutation - Custom salutation
   * @param {string} recipientName - The recipient's name
   * @param {string} fallbackName - Fallback name
   * @returns {number} - Number of SMS segments
   */
  estimateSegments(messageTemplate, salutation, customSalutation, recipientName, fallbackName = null) {
    const personalizedMessage = this.personalizeMessage(
      messageTemplate,
      salutation,
      customSalutation,
      recipientName,
      fallbackName
    );

    return this.calculateSmsSegments(personalizedMessage);
  }

  /**
   * Calculate SMS segments based on message length
   * @param {string} message - The message
   * @returns {number} - Number of segments
   */
  calculateSmsSegments(message) {
    if (!message || message.length === 0) return 1;

    const costCalculator = require('./CostCalculatorService');

    let totalSeptets = 0;
    let isUnicode = false;

    for (let i = 0; i < message.length; i++) {
      const char = message[i];
      if (costCalculator.gsm7BasicChars.has(char)) {
        totalSeptets += 1;
      } else if (costCalculator.gsm7ExtendedChars.has(char)) {
        totalSeptets += 2;
      } else {
        isUnicode = true;
      }
    }

    if (isUnicode) {
      const charCount = message.length;
      if (charCount <= 70) return 1;
      return Math.ceil(charCount / 67);
    }

    if (totalSeptets <= 160) return 1;
    return Math.ceil(totalSeptets / 153);
  }
}

module.exports = new MessagePersonalizationService();