const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');

// SMS cost per segment (in GHS)
const COST_PER_SMS_SEGMENT = 0.07;

// Calculate SMS segments based on encoding
const calculateSMSSegments = (message) => {
  // GSM encoding: 160 characters per segment (153 for multi-part)
  // Unicode encoding: 70 characters per segment (67 for multi-part)
  
  const isGSM = /^[ -~]*$/.test(message);
  const segmentSize = isGSM ? 160 : 70;
  
  if (message.length <= segmentSize) {
    return 1;
  }
  
  // For multi-part messages, use reduced segment size
  const multiSegmentSize = isGSM ? 153 : 67;
  return Math.ceil(message.length / multiSegmentSize);
};

// Calculate total cost for SMS send
const calculateSMSCost = (message, recipientCount) => {
  const segments = calculateSMSSegments(message);
  return segments * recipientCount * COST_PER_SMS_SEGMENT;
};

// Deduct credits from wallet atomically (without MongoDB transactions)
const deductCredits = async (userId, amount, description) => {
  try {
    // Get wallet and check balance
    const wallet = await Wallet.findOne({ userId });
    
    if (!wallet) {
      throw new Error('Wallet not found');
    }
    
    if (wallet.balance < amount) {
      throw new Error('Insufficient balance');
    }
    
    // Check daily limit
    if (!wallet.checkDailyLimit()) {
      throw new Error('Daily SMS limit reached');
    }
    
    // Check monthly limit
    if (!wallet.checkMonthlyLimit()) {
      throw new Error('Monthly SMS limit reached');
    }
    
    // Get recipient count from description if available
    const recipientCount = description.match(/(\d+)\s*recipient/)?.[1] || 1;
    
    // Atomic deduction using findOneAndUpdate for concurrency safety
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: amount } },
      { 
        $inc: { 
          balance: -amount,
          dailyUsage: recipientCount,
          monthlyUsage: recipientCount
        },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );
    
    if (!updatedWallet) {
      throw new Error('Insufficient balance or wallet not found');
    }
    
    // Create transaction record
    const balanceBefore = wallet.balance;
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount,
      description,
      reference: `SMS-${Date.now()}`,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore - amount
    });
    
    await transaction.save();
    
    return true;
  } catch (error) {
    console.error('[Billing] deductCredits error:', error);
    throw error;
  }
};

// Credit wallet (for top-ups) - without transactions
const creditWallet = async (userId, amount, description, adminId = null) => {
  try {
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
      reference: `TOPUP-${Date.now()}`,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore + amount
    });
    
    await transaction.save();
    
    return {
      success: true,
      newBalance: balanceBefore + amount
    };
  } catch (error) {
    console.error('[Billing] creditWallet error:', error);
    throw error;
  }
};

// Get wallet balance
const getWalletBalance = async (userId) => {
  const wallet = await Wallet.findOne({ userId });
  return wallet ? wallet.balance : 0;
};

// Get transaction history
const getTransactionHistory = async (userId, limit = 50) => {
  return await Transaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

module.exports = {
  calculateSMSSegments,
  calculateSMSCost,
  deductCredits,
  creditWallet,
  getWalletBalance,
  getTransactionHistory
};
