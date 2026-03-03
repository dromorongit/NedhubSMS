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
   * Calculate total SMS segments for a message
   * Standard GSM-03.38 encoding: 160 chars for single segment, 153 per segment for multi
   * @param {string} message - Message body
   * @returns {number} Number of segments
   */
  calculateSegments(message) {
    if (!message || message.length === 0) return 1;
    
    const singleSegmentLimit = 160;
    const multiSegmentLimit = 153;
    
    if (message.length <= singleSegmentLimit) {
      return 1;
    }
    
    return Math.ceil(message.length / multiSegmentLimit);
  }

  /**
   * Calculate complete financial breakdown for SMS sending
   * @param {string} userId - User ID
   * @param {string} message - Message body
   * @param {number} recipientsCount - Number of recipients
   * @returns {Object} Financial breakdown
   */
  async calculateFinancialBreakdown(userId, message, recipientsCount) {
    // Get monthly volume for tier selection
    const monthlyVolume = await this.getMonthlyVolume(userId);
    
    // Get provider cost and sell price
    const providerCostPerSms = this.getProviderCostPerSms(monthlyVolume);
    const sellPricePerSms = await this.getSellPricePerSms();
    
    // Calculate segments
    const segments = this.calculateSegments(message);
    
    // Calculate totals
    const totalSegments = segments * recipientsCount;
    const totalChargedToUser = sellPricePerSms * totalSegments;
    const totalCostToProvider = providerCostPerSms * totalSegments;
    const profitAmount = totalChargedToUser - totalCostToProvider;
    
    return {
      // Pricing
      sellPricePerSms,
      providerCostPerSms,
      
      // Segmentation
      segments,
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
}

// Export singleton instance
module.exports = new CostCalculatorService();
