const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

/**
 * WalletService
 * Handles wallet operations for payment processing
 */
class WalletService {
  /**
   * Credit wallet with a specific reference (for payment processing)
   * @param {string} userId - User ID
   * @param {number} amount - Amount to credit
   * @param {string} description - Transaction description
   * @param {string} reference - Transaction reference
   * @param {Object} session - MongoDB session for atomic transaction
   * @returns {Object} - Updated wallet and transaction details
   */
  async creditWalletWithReference(userId, amount, description, reference, session = null) {
    const dbSession = session || await mongoose.startSession();
    
    try {
      if (!session) {
        await dbSession.withTransaction(async () => {
          return await this._performCredit(dbSession, userId, amount, description, reference);
        });
      } else {
        return await this._performCredit(session, userId, amount, description, reference);
      }
      
      return { success: true };
    } catch (error) {
      console.error('[WalletService] Credit error:', error);
      throw error;
    } finally {
      if (!session) {
        dbSession.endSession();
      }
    }
  }

  /**
   * Perform the credit operation
   * @param {Object} session - MongoDB session
   * @param {string} userId - User ID
   * @param {number} amount - Amount to credit
   * @param {string} description - Transaction description
   * @param {string} reference - Transaction reference
   */
  async _performCredit(session, userId, amount, description, reference) {
    // Find or create wallet
    let wallet = await Wallet.findOne({ userId }).session(session);
    
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
      await wallet.save({ session });
    }
    
    const balanceBefore = wallet.balance;
    
    // Atomic credit
    const updateResult = await Wallet.updateOne(
      { userId },
      { 
        $inc: { balance: amount },
        $set: { updatedAt: new Date() }
      }
    ).session(session);
    
    if (updateResult.nModified === 0) {
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
    
    await transaction.save({ session });
    
    console.log(`[WalletService] Wallet credited: ${userId}, amount: ${amount}, new balance: ${balanceBefore + amount}`);
    
    return {
      wallet,
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
