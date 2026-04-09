const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const SmsMessage = require('../models/SmsMessage');
const Transaction = require('../models/Transaction');
const WalletService = require('../services/WalletService');
const SmsAnalyticsService = require('../services/SmsAnalyticsService');

// Get wallet balance with SMS balance
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get wallet balance
    let wallet = await Wallet.findByUserId(userId);
    const balance = wallet ? wallet.balance : 0;
    const availableBalance = wallet ? await WalletService.getAvailableBalance(userId) : 0;
    const reservedAmount = balance - availableBalance;
    
    // Get message stats using the analytics service
    const smsStats = await SmsAnalyticsService.getSmsSummary(userId);
    const totalSent = smsStats.totalSent;
    const deliveryRate = smsStats.deliveryRate;

    res.json({
      balance,
      availableBalance,
      smsBalance: availableBalance, // For frontend compatibility
      reservedAmount,
      currency: 'GHS',
      stats: {
        totalSent,
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
