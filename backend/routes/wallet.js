const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const Message = require('../models/Message');

// Get wallet balance with SMS credits
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get wallet balance
    let wallet = await Wallet.findByUserId(userId);
    const balance = wallet ? wallet.balance : 0;
    
    // Get message stats
    const messages = await Message.findByUserId(userId);
    const totalSent = messages.length;
    const delivered = messages.filter(m => m.status === 'delivered').length;
    const deliveryRate = totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0;

    res.json({
      balance,
      smsBalance: balance,
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

// Get transaction history (placeholder - implement with Transaction model if needed)
router.get('/transactions', authenticate, async (req, res) => {
  try {
    // Return empty transactions for now
    res.json({ 
      transactions: [],
      message: 'Transaction history retrieved successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
