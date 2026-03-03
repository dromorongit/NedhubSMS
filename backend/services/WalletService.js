const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const SmsMessage = require('../models/SmsMessage');
const CostCalculatorService = require('./CostCalculatorService');

/**
 * WalletService
 * Handles wallet operations for payment processing
 * Note: This service works without MongoDB transactions for compatibility with non-replica-set MongoDB instances
 */
class WalletService {
  /**
   * Credit wallet with a specific reference (for payment processing)
   * @param {string} userId - User ID
   * @param {number} amount - Amount to credit
   * @param {string} description - Transaction description
   * @param {string} reference - Transaction reference
   * @param {Object} session - MongoDB session (deprecated, not used)
   * @returns {Object} - Updated wallet and transaction details
   */
  async creditWalletWithReference(userId, amount, description, reference, session = null) {
    try {
      return await this._performCredit(userId, amount, description, reference);
    } catch (error) {
      console.error('[WalletService] Credit error:', error);
      throw error;
    }
  }

  /**
   * Perform the credit operation without transactions
   * @param {string} userId - User ID
   * @param {number} amount - Amount to credit
   * @param {string} description - Transaction description
   * @param {string} reference - Transaction reference
   */
  async _performCredit(userId, amount, description, reference) {
    // Find or create wallet
    let wallet = await Wallet.findOne({ userId });
    
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
      await wallet.save();
    }
    
    const balanceBefore = wallet.balance;
    
    // Atomic credit using findOneAndUpdate for concurrency safety
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId },
      { 
        $inc: { balance: amount },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );
    
    if (!updatedWallet) {
      throw new Error('Failed to credit wallet');
    }
    
    // Create transaction record
    const transaction = new Transaction({
      userId,
      type: 'credit',
      amount,
      description,
      reference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore + amount
    });
    
    await transaction.save();
    
    console.log(`[WalletService] Wallet credited: ${userId}, amount: ${amount}, new balance: ${balanceBefore + amount}`);
    
    return {
      wallet: updatedWallet,
      transaction,
      newBalance: balanceBefore + amount
    };
  }

  /**
   * Get wallet balance
   * @param {string} userId - User ID
   * @returns {number} - Current balance
   */
  async getBalance(userId) {
    const wallet = await Wallet.findOne({ userId });
    return wallet ? wallet.balance : 0;
  }

  /**
   * Get wallet by user ID
   * @param {string} userId - User ID
   * @returns {Object} - Wallet document
   */
  async getWallet(userId) {
    return await Wallet.findOne({ userId });
  }

  /**
   * Deduct GHS from wallet for SMS sending with financial tracking
   * @param {string} userId - User ID
   * @param {Object} financialBreakdown - Financial breakdown from CostCalculatorService
   * @param {string} description - Transaction description
   * @returns {Object} - Deduct result with updated balance and transaction
   */
  async deductGhsForSms(userId, financialBreakdown, description) {
    const { totalChargedToUser, segments, recipientsCount } = financialBreakdown;
    
    // Get current wallet
    let wallet = await Wallet.findOne({ userId });
    
    if (!wallet) {
      throw new Error('Wallet not found');
    }
    
    // Check balance
    if (wallet.balance < totalChargedToUser) {
      throw new Error('Insufficient balance');
    }
    
    const balanceBefore = wallet.balance;
    
    // Atomic deduction using findOneAndUpdate for concurrency safety
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: totalChargedToUser } },
      { 
        $inc: { balance: -totalChargedToUser },
        $inc: { monthlyUsage: segments },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );
    
    if (!updatedWallet) {
      throw new Error('Insufficient balance or wallet not found');
    }
    
    // Generate unique reference
    const reference = `SMS-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create transaction record
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: totalChargedToUser,
      description,
      reference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore - totalChargedToUser
    });
    
    await transaction.save();
    
    console.log(`[WalletService] SMS GHS deducted: ${userId}, amount: ${totalChargedToUser}, segments: ${segments}, new balance: ${balanceBefore - totalChargedToUser}`);
    
    return {
      success: true,
      wallet: updatedWallet,
      transaction,
      newBalance: balanceBefore - totalChargedToUser,
      amountDeducted: totalChargedToUser
    };
  }

  /**
   * Check if wallet has sufficient balance for SMS sending
   * @param {string} userId - User ID
   * @param {number} amount - Amount to check
   * @returns {boolean} - True if sufficient balance
   */
  async hasSufficientBalance(userId, amount) {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) return false;
    return wallet.balance >= amount;
  }
}

module.exports = new WalletService();
