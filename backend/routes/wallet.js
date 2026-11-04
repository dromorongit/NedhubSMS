const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const Payment = require('../models/Payment');
const SmsMessage = require('../models/SmsMessage');
const Transaction = require('../models/Transaction');
const WalletService = require('../services/WalletService');
const CallbackVerificationService = require('../services/callbackVerificationService');
const logger = require('../utils/logger');

/**
 * Read the TOPUP_ENABLED kill switch. Defaults to enabled (true). The values
 * false, 0 and off (case-insensitive) disable top-ups.
 */
function isTopupEnabled() {
  const raw = process.env.TOPUP_ENABLED;
  if (raw === undefined || raw === null) return true;
  const v = String(raw).trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

// Get wallet top-up status (kill switch) - authenticated
router.get('/topup-status', authenticate, (req, res) => {
  res.json({ enabled: isTopupEnabled() });
});

// Get wallet balance with SMS balance
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get wallet balance
    let wallet = await Wallet.findByUserId(userId);
    const balance = wallet ? wallet.balance : 0;
    const availableBalance = wallet ? await WalletService.getAvailableBalance(userId) : 0;
    const reservedAmount = balance - availableBalance;
    
    // Get message stats directly from all message collections for accurate counts
    const Message = require('../models/Message');
    const SmsMessage = require('../models/SmsMessage');
    const SmsRecipient = require('../models/SmsRecipient');
    const mongoose = require('mongoose');
    
    // Ensure userId is a proper ObjectId for MongoDB matching
    const userIdObj = new mongoose.Types.ObjectId(userId);
    
    // Aggregate from Message collection - count 'sent' OR 'delivered' as total sent (like history page)
    const messageStats = await Message.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Aggregate from SmsMessage collection - count 'sent' OR 'delivered' as total sent
    const smsMessageStats = await SmsMessage.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Aggregate from SmsRecipient collection
    const recipientStats = await SmsRecipient.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Debug: Log the raw aggregation results
    console.log('[Wallet] Message stats:', messageStats);
    console.log('[Wallet] SmsMessage stats:', smsMessageStats);
    console.log('[Wallet] Recipient stats:', recipientStats);
    
    // Combine all sources - sum all values (messages may be in different collections)
    const messageData = messageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    const smsMessageData = smsMessageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    const recipientData = recipientStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    
    console.log('[Wallet] Combined data:', { messageData, smsMessageData, recipientData });
    
    // Sum all sources to get total messages
    const totalSent = messageData.totalSent + smsMessageData.totalSent + recipientData.totalSent;
    const totalDelivered = messageData.totalDelivered + smsMessageData.totalDelivered + recipientData.totalDelivered;
    const totalFailed = messageData.totalFailed + smsMessageData.totalFailed + recipientData.totalFailed;
    
    // Calculate delivery rate
    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

    res.json({
      success: true,
      message: 'Wallet balance retrieved successfully',
      data: {
        balance,
        availableBalance,
        smsBalance: availableBalance,
        reservedAmount,
        currency: 'GHS',
        stats: {
          totalSent,
          totalDelivered,
          totalFailed,
          deliveryRate
        }
      }
    });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve wallet balance',
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          details: error.message
        }
      });
    }
});

// Credit wallet (Admin only)
router.post('/topup', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    const adminId = req.user.userId;
    
    // Validate input
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'User ID and positive amount are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }
    
    await Wallet.credit(userId, amount, description || 'Manual top-up', adminId);
    
    res.json({
      success: true,
      message: 'Wallet credited successfully',
      data: {
        amount,
        userId
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Get transaction history
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Transaction.countDocuments({ userId });

    res.json({
      success: true,
      message: 'Transaction history retrieved successfully',
      data: {
        transactions: transactions.map(tx => ({
          id: tx._id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description,
          reference: tx.reference,
          balanceBefore: tx.balanceBefore,
          balanceAfter: tx.balanceAfter,
          createdAt: tx.createdAt
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve wallet balance',
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          details: error.message
        }
      });
    }
});

// Reconcile pending top-up payments for the calling user (last 24h, max 10)
router.post('/reconcile', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const verificationService = new CallbackVerificationService();

    const pendingPayments = await Payment.find({
      userId,
      status: { $in: ['pending', 'processing'] },
      createdAt: { $gte: cutoff }
    })
      .sort({ createdAt: -1 })
      .limit(10);

    let credited = 0;
    for (const payment of pendingPayments) {
      try {
        const result = await verificationService.processPaymentCallback(payment.clientReference);
        if (result && result.action === 'credit' && result.applied) {
          credited += 1;
        }
      } catch (err) {
        logger.warn('[Wallet] Reconcile payment failed', { clientReference: payment.clientReference, error: err.message });
      }
    }

    res.json({
      success: true,
      data: {
        checked: pendingPayments.length,
        credited
      }
    });
  } catch (error) {
    logger.error('[Wallet] Reconcile error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to reconcile payments' });
  }
});

module.exports = router;
