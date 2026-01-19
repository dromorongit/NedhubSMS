const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { 
  getWalletBalance, 
  creditWallet, 
  getTransactionHistory 
} = require('../utils/billing');

// Get wallet balance
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const balance = await getWalletBalance(userId);
    
    res.json({ 
      balance,
      currency: 'credits',
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