/**
 * CostCalculatorService
 * Handles all financial calculations for SMS sending including:
 * - Provider cost per SMS based on monthly volume tiers
 * - Sell price per SMS (configurable by admin)
 * - Profit calculation and tracking
 * - Monthly volume aggregation
 */

const SmsMessage = require('../models/SmsMessage');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class CostCalculatorService {
  constructor() {
    // Default pricing configuration (can be overridden by admin)
    this.defaultSellPricePerSms = 0.095; // GHS
    
    // Tiered provider costs based on monthly volume
    this.providerCostTiers = [
      { min: 1, max: 99999, cost: 0.082 },      // Tier 1: 1-99,999 SMS
      { min: 100000, max: 199999, cost: 0.072 }, // Tier 2: 100,000-199,999 SMS
      { min: 200000, max: Infinity, cost: 0.062 } // Tier 3: 200,000+ SMS
    ];
    
    // Currency
    this.currency = 'GHS';
  }

  /**
   * Get the configured sell price per SMS
   * This can be overridden by admin configuration stored in database
   * @returns {number} Sell price per SMS in GHS
   */
  async getSellPricePerSms() {
    // TODO: In future, fetch from admin configuration collection
    // For now, use default
    return this.defaultSellPricePerSms;
  }

  /**
   * Set the sell price per SMS (admin function)
   * @param {number} price - New sell price per SMS
   */
  setSellPricePerSms(price) {
    if (price <= 0) {
      throw new Error('Sell price must be positive');
    }
    this.defaultSellPricePerSms = price;
  }

  /**
   * Get provider cost per SMS based on monthly volume tier
   * @param {number} monthlyVolume - Total SMS sent this month
   * @returns {number} Provider cost per SMS in GHS
   */
  getProviderCostPerSms(monthlyVolume = 0) {
    for (const tier of this.providerCostTiers) {
      if (monthlyVolume >= tier.min && monthlyVolume <= tier.max) {
        return tier.cost;
      }
    }
    // Default to highest tier if volume exceeds all defined tiers
    return this.providerCostTiers[this.providerCostTiers.length - 1].cost;
  }

  /**
   * Get the current monthly volume for a user
   * @param {string} userId - User ID
   * @returns {number} Monthly SMS count
   */
  async getMonthlyVolume(userId) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const count = await SmsMessage.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      status: { $in: ['sent', 'delivered'] },
      createdAt: { $gte: startOfMonth }
    });
    
    return count;
  }

  /**
   * GSM-7 character set (basic characters)
   * @type {Set<string>}
   */
  get gsm7BasicChars() {
    return new Set([
      '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç', 'Ø', 'ø', 'Å', 'å', 'Δ', '_', 'Φ', 'Γ', 'Λ', 'Ω', 'Π', 'Ψ', 'Σ', 'Θ', 'Ξ', 'Æ', 'æ', 'ß', 'É', ' ', '!', '"', '#', '¤', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', '¡', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ñ', 'Ü', '§', '¿', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ä', 'ö', 'ñ', 'ü', 'à'
    ]);
  }

  /**
   * GSM-7 extended characters (take 2 bytes)
   * @type {Set<string>}
   */
  get gsm7ExtendedChars() {
    return new Set([
      '^', '{', '}', '\\', '[', '~', ']', '|', '€'
    ]);
  }

  /**
   * Determine the encoding type for a message
   * @param {string} message - Message to analyze
   * @returns {string} 'gsm7' or 'unicode'
   */
  determineEncoding(message) {
    if (!message) return 'gsm7';

    // Check each character
    for (let i = 0; i < message.length; i++) {
      const char = message[i];
      if (!this.gsm7BasicChars.has(char) && !this.gsm7ExtendedChars.has(char)) {
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
  calculateByteLength(message) {
    if (!message) return 0;

    let byteLength = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message[i];
      if (this.gsm7ExtendedChars.has(char)) {
        byteLength += 2; // Extended chars take 2 bytes
      } else {
        byteLength += 1; // Basic chars take 1 byte
      }
    }

    return byteLength;
  }

  /**
   * Calculate total SMS segments for a message based on encoding
   * @param {string} message - Message body
   * @returns {Object} Segment calculation result
   */
  calculateSegments(message) {
    if (!message || message.length === 0) {
      return {
        segments: 1,
        encoding: 'gsm7',
        charCount: 0,
        byteLength: 0
      };
    }

    const encoding = this.determineEncoding(message);
    const charCount = message.length;

    let segments;
    let byteLength;

    if (encoding === 'gsm7') {
      byteLength = this.calculateByteLength(message);
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
   * Calculate segments for a personalized message (considering placeholders)
   * @param {string} messageTemplate - Message template with placeholders
   * @param {Object} personalizationData - Data for personalization
   * @returns {Object} Segment calculation with range
   */
  calculateSegmentsForPersonalizedMessage(messageTemplate, personalizationData = {}) {
    if (!messageTemplate) {
      return {
        minSegments: 1,
        maxSegments: 1,
        encoding: 'gsm7',
        charCount: { min: 0, max: 0 },
        byteLength: { min: 0, max: 0 }
      };
    }

    // Replace placeholders with sample data to get realistic lengths
    const sampleData = {
      name: 'John Doe', // Typical name length
      salutation: 'Dear',
      customSalutation: 'Hello',
      ...personalizationData
    };

    // Calculate for minimum and maximum possible lengths
    const messages = this.generatePersonalizedMessageSamples(messageTemplate, sampleData);

    if (messages.length === 0) {
      return this.calculateSegments(messageTemplate);
    }

    let minSegments = Infinity;
    let maxSegments = 0;
    let encoding = 'gsm7';
    let minCharCount = Infinity;
    let maxCharCount = 0;
    let minByteLength = Infinity;
    let maxByteLength = 0;

    for (const msg of messages) {
      const result = this.calculateSegments(msg);
      minSegments = Math.min(minSegments, result.segments);
      maxSegments = Math.max(maxSegments, result.segments);
      minCharCount = Math.min(minCharCount, result.charCount);
      maxCharCount = Math.max(maxCharCount, result.charCount);
      minByteLength = Math.min(minByteLength, result.byteLength);
      maxByteLength = Math.max(maxByteLength, result.byteLength);
      if (result.encoding === 'unicode') encoding = 'unicode';
    }

    return {
      minSegments,
      maxSegments,
      encoding,
      charCount: { min: minCharCount, max: maxCharCount },
      byteLength: { min: minByteLength, max: maxByteLength }
    };
  }

  /**
   * Generate sample personalized messages for cost estimation
   * @param {string} template - Message template
   * @param {Object} sampleData - Sample data for placeholders
   * @returns {Array<string>} Array of sample messages
   */
  generatePersonalizedMessageSamples(template, sampleData) {
    const samples = [];

    // Generate combinations of different lengths
    const nameVariations = [
      'John',
      'John Doe',
      'Very Long Name Here',
      sampleData.name || 'John Doe'
    ];

    const salutationVariations = [
      'Dear',
      'Hello',
      'Hi',
      'Esteemed',
      'Honourable',
      sampleData.salutation || 'Dear',
      sampleData.customSalutation || 'Hello'
    ];

    // Create samples with different combinations
    for (const name of nameVariations.slice(0, 2)) {
      for (const salutation of salutationVariations.slice(0, 2)) {
        let message = template
          .replace(/\{\{name\}\}/g, name)
          .replace(/\{\{salutation\}\}/g, salutation)
          .replace(/\{\{customSalutation\}\}/g, salutation);

        samples.push(message);
      }
    }

    // Remove duplicates and limit to reasonable number
    return [...new Set(samples)].slice(0, 4);
  }

  /**
   * Calculate complete financial breakdown for SMS sending
   * @param {string} userId - User ID
   * @param {string} message - Message body
   * @param {number} recipientsCount - Number of recipients
   * @param {Object} personalizationData - Data for personalization
   * @returns {Object} Financial breakdown
   */
  async calculateFinancialBreakdown(userId, message, recipientsCount, personalizationData = null) {
    logger.info('[Cost] Calculating financial breakdown', { userId, recipientsCount, hasPersonalization: !!personalizationData });

    // Get monthly volume for tier selection
    const monthlyVolume = await this.getMonthlyVolume(userId);

    // Get provider cost and sell price
    const providerCostPerSms = this.getProviderCostPerSms(monthlyVolume);
    const sellPricePerSms = await this.getSellPricePerSms();

    // Calculate segments (consider personalization if data provided)
    let segmentResult;
    if (personalizationData) {
      segmentResult = this.calculateSegmentsForPersonalizedMessage(message, personalizationData);
    } else {
      segmentResult = this.calculateSegments(message);
    }

    // For personalized messages, calculate average segments
    const avgSegments = segmentResult.minSegments && segmentResult.maxSegments
      ? (segmentResult.minSegments + segmentResult.maxSegments) / 2
      : segmentResult.segments || 1;

    // Calculate totals
    const totalSegments = avgSegments * recipientsCount;
    const totalChargedToUser = sellPricePerSms * totalSegments;
    const totalCostToProvider = providerCostPerSms * totalSegments;
    const profitAmount = totalChargedToUser - totalCostToProvider;

    return {
      // Pricing
      sellPricePerSms,
      providerCostPerSms,

      // Segmentation
      segments: segmentResult,
      avgSegments,
      recipientsCount,
      totalSegments,

      // Financial totals
      totalChargedToUser: Math.round(totalChargedToUser * 100) / 100,
      totalCostToProvider: Math.round(totalCostToProvider * 100) / 100,
      profitAmount: Math.round(profitAmount * 100) / 100,

      // Tier information
      monthlyVolume,
      currentTier: this.getCurrentTierInfo(monthlyVolume),

      currency: this.currency
    };
  }

  /**
   * Get current tier information
   * @param {number} monthlyVolume - Monthly SMS volume
   * @returns {Object} Tier info
   */
  getCurrentTierInfo(monthlyVolume) {
    for (let i = 0; i < this.providerCostTiers.length; i++) {
      const tier = this.providerCostTiers[i];
      if (monthlyVolume >= tier.min && monthlyVolume <= tier.max) {
        return {
          tierNumber: i + 1,
          min: tier.min,
          max: tier.max === Infinity ? 'unlimited' : tier.max,
          cost: tier.cost
        };
      }
    }
    // Default to highest tier
    const tier = this.providerCostTiers[this.providerCostTiers.length - 1];
    return {
      tierNumber: this.providerCostTiers.length,
      min: tier.min,
      max: 'unlimited',
      cost: tier.cost
    };
  }

  /**
   * Get all provider cost tiers
   * @returns {Array} Array of tier objects
   */
  getProviderCostTiers() {
    return this.providerCostTiers.map((tier, index) => ({
      tierNumber: index + 1,
      min: tier.min,
      max: tier.max === Infinity ? 'unlimited' : tier.max,
      cost: tier.cost
    }));
  }

  /**
   * Update provider cost tier (admin function)
   * @param {number} tierNumber - Tier number (1-based)
   * @param {number} newCost - New cost per SMS
   */
  updateProviderCostTier(tierNumber, newCost) {
    if (newCost <= 0) {
      throw new Error('Provider cost must be positive');
    }
    
    const index = tierNumber - 1;
    if (index < 0 || index >= this.providerCostTiers.length) {
      throw new Error('Invalid tier number');
    }
    
    this.providerCostTiers[index].cost = newCost;
  }

  /**
   * Calculate financial summary for a period
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} userId - Optional user ID filter
   * @returns {Object} Financial summary
   */
  async calculateFinancialSummary(startDate, endDate, userId = null) {
    const matchCondition = {
      status: { $in: ['sent', 'delivered'] },
      createdAt: { $gte: startDate, $lte: endDate }
    };
    
    if (userId) {
      matchCondition.userId = new mongoose.Types.ObjectId(userId);
    }
    
    const aggregation = await SmsMessage.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          totalSmsSent: { $sum: 1 },
          totalRecipients: { $sum: '$recipientsCount' },
          totalSegments: { $sum: '$segments' },
          totalRevenue: { $sum: '$totalChargedToUser' },
          totalProviderCost: { $sum: '$totalCostToProvider' },
          totalProfit: { $sum: '$profitAmount' }
        }
      }
    ]);
    
    if (aggregation.length === 0) {
      return {
        totalSmsSent: 0,
        totalRecipients: 0,
        totalSegments: 0,
        totalRevenue: 0,
        totalProviderCost: 0,
        totalProfit: 0,
        currency: this.currency
      };
    }
    
    const result = aggregation[0];
    return {
      totalSmsSent: result.totalSmsSent || 0,
      totalRecipients: result.totalRecipients || 0,
      totalSegments: result.totalSegments || 0,
      totalRevenue: Math.round((result.totalRevenue || 0) * 100) / 100,
      totalProviderCost: Math.round((result.totalProviderCost || 0) * 100) / 100,
      totalProfit: Math.round((result.totalProfit || 0) * 100) / 100,
      currency: this.currency
    };
  }

  /**
   * Get monthly financial summary
   * @param {number} year - Year
   * @param {number} month - Month (1-12)
   * @param {string} userId - Optional user ID filter
   * @returns {Object} Monthly financial summary
   */
  async getMonthlyFinancialSummary(year, month, userId = null) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59); // Last day of month
    
    return await this.calculateFinancialSummary(startDate, endDate, userId);
  }

  /**
   * Get today's financial summary
   * @param {string} userId - Optional user ID filter
   * @returns {Object} Today's financial summary
   */
  async getTodayFinancialSummary(userId = null) {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    return await this.calculateFinancialSummary(startDate, endDate, userId);
  }

  /**
   * Calculate live cost estimation for SMS composition
   * @param {string} userId - User ID
   * @param {string} message - Message text
   * @param {number} recipientCount - Number of recipients
   * @param {Object} personalizationData - Personalization data
   * @returns {Object} Live cost estimation
   */
  async calculateLiveCost(userId, message, recipientCount, personalizationData = null) {
    // Get monthly volume for tier selection
    const monthlyVolume = await this.getMonthlyVolume(userId);

    // Get pricing
    const providerCostPerSms = this.getProviderCostPerSms(monthlyVolume);
    const sellPricePerSms = await this.getSellPricePerSms();

    // Calculate segments
    let segmentResult;
    if (personalizationData) {
      segmentResult = this.calculateSegmentsForPersonalizedMessage(message, personalizationData);
    } else {
      segmentResult = this.calculateSegments(message);
    }

    // Calculate cost
    const avgSegments = segmentResult.minSegments && segmentResult.maxSegments
      ? (segmentResult.minSegments + segmentResult.maxSegments) / 2
      : segmentResult.segments || 1;

    const totalSegments = avgSegments * recipientCount;
    const estimatedCost = sellPricePerSms * totalSegments;

    // Generate warnings
    const warnings = [];
    if (segmentResult.encoding === 'unicode') {
      warnings.push('Unicode characters detected - may incur higher costs');
    }

    const maxSegments = segmentResult.maxSegments || segmentResult.segments || 1;
    if (maxSegments > 5) {
      warnings.push('Long message - will be split into multiple SMS');
    }

    if (estimatedCost > 100) {
      warnings.push('High estimated cost - consider reducing message length or recipient count');
    }

    return {
      charCount: segmentResult.charCount,
      encoding: segmentResult.encoding,
      segments: segmentResult,
      avgSegments,
      totalSegments: Math.round(totalSegments * 100) / 100,
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      sellPricePerSms,
      providerCostPerSms,
      recipientCount,
      currency: this.currency,
      warnings
    };
  }

  /**
   * Calculate total cost for a message and recipient count (legacy method for compatibility)
   * @param {string} message - Message text
   * @param {number} recipientCount - Number of recipients
   * @param {Object} personalizationData - Personalization data
   * @returns {number} Total estimated cost
   */
  async calculateTotalCost(message, recipientCount, personalizationData = null) {
    const costEstimation = await this.calculateLiveCost('dummy-user-id', message, recipientCount, personalizationData);
    return costEstimation.estimatedCost;
  }
}

// Export singleton instance
module.exports = new CostCalculatorService();
