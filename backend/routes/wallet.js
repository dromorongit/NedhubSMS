const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
  getWalletBalance,
  creditWallet,
  getTransactionHistory
} = require('../utils/billing');
const Message = require('../models/Message');

// Get wallet balance with SMS credits
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const balance = await getWalletBalance(userId);

    // Get message stats
    const messages = await Message.findByUserId(userId);
    const totalSent = messages.length;
    const delivered = messages.filter(m => m.status === 'delivered').length;
    const deliveryRate = totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0;

    res.json({
      balance,
      smsBalance: balance, // SMS credits = wallet balance
      currency: 'credits',
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
    
    await creditWallet(userId, amount, description || 'Manual top-up', adminId);
    
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
    const transactions = await getTransactionHistory(userId);
    
    res.json({ 
      transactions,
      message: 'Transaction history retrieved successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;