const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const SmsMessage = require('../models/SmsMessage');
const Transaction = require('../models/Transaction');
const WalletService = require('../services/WalletService');

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
    
    // Aggregate from Message collection
    const messageStats = await Message.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Aggregate from SmsMessage collection
    const smsMessageStats = await SmsMessage.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
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
          totalDelivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Combine all sources - take max values to avoid double counting
    const messageData = messageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    const smsMessageData = smsMessageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    const recipientData = recipientStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    
    const totalSent = Math.max(messageData.totalSent, smsMessageData.totalSent, recipientData.totalSent);
    const totalDelivered = Math.max(messageData.totalDelivered, smsMessageData.totalDelivered, recipientData.totalDelivered);
    const totalFailed = Math.max(messageData.totalFailed, smsMessageData.totalFailed, recipientData.totalFailed);
    
    // Calculate delivery rate
    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

    res.json({
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
      },
      message: 'Wallet balance retrieved successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Credit wallet (Admin only)
router.post('/topup', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    const adminId = req.user.userId;
    
    // Validate input
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'User ID and positive amount are required' });
    }
    
    await Wallet.credit(userId, amount, description || 'Manual top-up', adminId);
    
    res.json({ 
      message: 'Wallet credited successfully',
      amount,
      userId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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
      },
      message: 'Transaction history retrieved successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
