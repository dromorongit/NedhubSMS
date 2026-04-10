const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const WalletReservation = require('../models/WalletReservation');

/**
 * WalletService
 * Simplified wallet operations that work without MongoDB transactions
 * Suitable for Railway's free tier MongoDB
 */
class WalletService {
  /**
   * Credit wallet with a specific reference (for payment processing)
   * @param {string} userId - User ID
   * @param {number} amount - Amount to credit
   * @param {string} description - Transaction description
   * @param {string} reference - Transaction reference
   * @returns {Object} - Updated wallet and transaction details
   */
  async creditWalletWithReference(userId, amount, description, reference) {
    try {
      // Find or create wallet
      let wallet = await Wallet.findOne({ userId });

      if (!wallet) {
        wallet = new Wallet({ 
          userId, 
          balance: 0,
          smsBalance: 0,
          reservedAmount: 0
        });
        await wallet.save();
      }

      const balanceBefore = wallet.balance;

      // Atomic credit using findOneAndUpdate
      const updatedWallet = await Wallet.findOneAndUpdate(
        { userId },
        {
          $inc: { balance: amount, smsBalance: amount },
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
        balanceBefore,
        balanceAfter: balanceBefore + amount
      });

      await transaction.save();

      console.log(`[WalletService] Wallet credited: ${userId}, amount: ${amount}, new balance: ${balanceBefore + amount}`);

      return {
        wallet: updatedWallet,
        transaction,
        newBalance: balanceBefore + amount
      };
    } catch (error) {
      console.error('[WalletService] Credit error:', error);
      throw error;
    }
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
   * Get available balance (balance minus active reservations)
   * @param {string} userId - User ID
   * @returns {number} - Available balance
   */
  async getAvailableBalance(userId) {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) return 0;

    // Get total active reservations
    const activeReservations = await WalletReservation.find({
      userId,
      status: 'active'
    });

    const totalReserved = activeReservations.reduce((sum, res) => sum + res.amount, 0);

    return Math.max(0, wallet.balance - totalReserved);
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
    const totalChargedToUser = financialBreakdown.totalChargedToUser;
    // Get numeric segments value - handle both object and number formats
    const segments = financialBreakdown.avgSegments || 
                    (financialBreakdown.segments?.segments) || 
                    financialBreakdown.segments || 1;

    try {
      // Get current wallet
      const wallet = await Wallet.findOne({ userId });

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // Check balance
      if (wallet.balance < totalChargedToUser) {
        throw new Error('Insufficient balance');
      }

      const balanceBefore = wallet.balance;

      // Atomic deduction
      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          userId,
          balance: { $gte: totalChargedToUser }
        },
        {
          $inc: { balance: -totalChargedToUser, monthlyUsage: segments },
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
        balanceBefore,
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
    } catch (error) {
      console.error('[WalletService] Debit operation failed:', error);
      throw error;
    }
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

  /**
   * Reserve funds for a campaign
   * @param {string} userId - User ID
   * @param {number} amount - Amount to reserve
   * @param {string} campaignId - Campaign ID
   * @returns {Object} - Reservation object
   */
  async reserveFunds(userId, amount, campaignId) {
    try {
      // Check wallet balance
      const wallet = await Wallet.findOne({ userId });
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (wallet.balance < amount) {
        throw new Error('Insufficient balance for reservation');
      }

      // Create reservation record
      const reservation = new WalletReservation({
        userId,
        campaignId,
        amount,
        status: 'active'
      });

      await reservation.save();

      console.log(`[WalletService] Reserved ${amount} GHS for campaign ${campaignId}, user ${userId}`);

      return reservation;
    } catch (error) {
      console.error('[WalletService] Reservation failed:', error);
      throw error;
    }
  }

  /**
   * Capture a reservation (convert to actual debit)
   * @param {string} reservationId - Reservation ID
   * @returns {Object} - Capture result with transaction
   */
  async captureReservation(reservationId) {
    try {
      // Find the reservation
      const reservation = await WalletReservation.findById(reservationId);
      if (!reservation) {
        throw new Error('Reservation not found');
      }

      if (reservation.status !== 'active') {
        throw new Error(`Reservation is not active (status: ${reservation.status})`);
      }

      // Check wallet balance again (in case it changed)
      const wallet = await Wallet.findOne({ userId: reservation.userId });
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (wallet.balance < reservation.amount) {
        throw new Error('Insufficient balance to capture reservation');
      }

      // Get balance before debit
      const balanceBefore = wallet.balance;

      // Atomic debit
      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          userId: reservation.userId,
          balance: { $gte: reservation.amount }
        },
        {
          $inc: { balance: -reservation.amount },
          $set: { updatedAt: new Date() }
        },
        { new: true }
      );

      if (!updatedWallet) {
        throw new Error('Failed to debit wallet - insufficient balance');
      }

      // Update reservation status
      reservation.status = 'captured';
      reservation.capturedAt = new Date();
      await reservation.save();

      // Create transaction record
      const reference = `RESERVATION-${reservationId}`;
      const transaction = new Transaction({
        userId: reservation.userId,
        type: 'debit',
        amount: reservation.amount,
        description: `Campaign reservation capture`,
        reference,
        balanceBefore,
        balanceAfter: balanceBefore - reservation.amount
      });

      await transaction.save();

      console.log(`[WalletService] Captured reservation ${reservationId}, debited ${reservation.amount} GHS`);

      return {
        reservation,
        transaction,
        wallet: updatedWallet,
        amountDeducted: reservation.amount
      };
    } catch (error) {
      console.error('[WalletService] Capture reservation failed:', error);
      throw error;
    }
  }

  /**
   * Release a reservation (return funds to wallet)
   * @param {string} reservationId - Reservation ID
   * @returns {Object} - Released reservation
   */
  async releaseReservation(reservationId) {
    try {
      // Find the reservation
      const reservation = await WalletReservation.findById(reservationId);
      if (!reservation) {
        throw new Error('Reservation not found');
      }

      if (reservation.status !== 'active') {
        throw new Error(`Reservation is not active (status: ${reservation.status})`);
      }

      // Update reservation status
      reservation.status = 'released';
      reservation.releasedAt = new Date();
      await reservation.save();

      // Note: We're not crediting the wallet because we never debited it during reservation
      // The funds were just "reserved" through balance checking

      console.log(`[WalletService] Released reservation ${reservationId}`);

      return reservation;
    } catch (error) {
      console.error('[WalletService] Release reservation failed:', error);
      throw error;
    }
  }
}

module.exports = new WalletService();
