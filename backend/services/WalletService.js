const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

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
}

module.exports = WalletService;
