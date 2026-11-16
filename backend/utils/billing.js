const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const CostCalculatorService = require('../services/CostCalculatorService');

// SMS cost per segment (in GHS) - authoritative source
const COST_PER_SMS_SEGMENT = 0.07;

// Calculate SMS segments based on encoding - delegates to authoritative CostCalculatorService
const calculateSMSSegments = async (message) => {
  const result = CostCalculatorService.calculateSegments(message);
  return result.segments;
};

// Calculate SMS segments synchronously using the same logic as CostCalculatorService
const calculateSMSSegmentsSync = (message) => {
  if (!message || message.length === 0) {
    return 1;
  }

  const encoding = CostCalculatorService.determineEncoding(message);
  const charCount = message.length;

  if (encoding === 'gsm7') {
    const byteLength = CostCalculatorService.calculateByteLength(message);
    const singleSegmentLimit = 160;
    const multiSegmentLimit = 153;
    if (byteLength <= singleSegmentLimit) {
      return 1;
    }
    return Math.ceil(byteLength / multiSegmentLimit);
  } else {
    const singleSegmentLimit = 70;
    const multiSegmentLimit = 67;
    if (charCount <= singleSegmentLimit) {
      return 1;
    }
    return Math.ceil(charCount / multiSegmentLimit);
  }
};

// Calculate total cost for SMS send
const calculateSMSCost = async (message, recipientCount) => {
  const segments = await calculateSMSSegments(message);
  return segments * recipientCount * COST_PER_SMS_SEGMENT;
};

// Calculate total cost for SMS send (synchronous)
const calculateSMSCostSync = (message, recipientCount) => {
  const segments = calculateSMSSegmentsSync(message);
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
