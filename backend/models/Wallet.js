const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Balance cannot be negative'],
    description: 'Wallet balance in GHS'
  },
  currency: {
    type: String,
    default: 'GHS',
    enum: ['GHS'],
    description: 'Currency code - Ghana Cedis'
  },
  frozen: {
    type: Boolean,
    default: false
  },
  version: {
    type: Number,
    default: 0,
    description: 'Version field for optimistic locking'
  },
  migrationFlag: {
    type: Boolean,
    default: false,
    description: 'Indicates wallet has been migrated from credits to GHS'
  },
  dailyLimit: {
    type: Number,
    default: 1000,
    min: [0, 'Daily limit cannot be negative'],
    description: 'Daily SMS limit (number of SMS)'
  },
  monthlyLimit: {
    type: Number,
    default: 10000,
    min: [0, 'Monthly limit cannot be negative'],
    description: 'Monthly SMS limit (number of SMS)'
  },
  dailyUsage: {
    type: Number,
    default: 0,
    min: [0, 'Daily usage cannot be negative'],
    description: 'SMS sent today'
  },
  monthlyUsage: {
    type: Number,
    default: 0,
    min: [0, 'Monthly usage cannot be negative'],
    description: 'SMS sent this month'
  },
  lastReset: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update updatedAt and version before saving
walletSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  this.version += 1;
  next();
});

// Static method to find wallet by user ID
walletSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId: userId });
};

// Static method to get balance
walletSchema.statics.getBalance = async function(userId) {
  const wallet = await this.findOne({ userId: userId });
  return wallet ? wallet.balance : 0;
};

// Static method to credit wallet
walletSchema.statics.credit = async function(userId, amount, description, adminId) {
  const updatedWallet = await this.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount, smsBalance: amount } },
    { new: true, upsert: true }
  );
  return updatedWallet;
};

// Static method to debit wallet
walletSchema.statics.debit = async function(userId, amount, description) {
  const updatedWallet = await this.findOneAndUpdate(
    { userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (!updatedWallet) throw new Error('Insufficient balance or wallet not found');
  return updatedWallet;
};

// Method to check if daily limit is reached
walletSchema.methods.checkDailyLimit = function() {
  const now = new Date();
  const lastReset = new Date(this.lastReset);
  
  // Reset daily usage if it's a new day
  if (now.getDate() !== lastReset.getDate() || 
      now.getMonth() !== lastReset.getMonth() ||
      now.getFullYear() !== lastReset.getFullYear()) {
    this.dailyUsage = 0;
    this.lastReset = now;
  }
  
  return this.dailyUsage < this.dailyLimit;
};

// Method to check if monthly limit is reached
walletSchema.methods.checkMonthlyLimit = function() {
  const now = new Date();
  const lastReset = new Date(this.lastReset);
  
  // Reset monthly usage if it's a new month
  if (now.getMonth() !== lastReset.getMonth() ||
      now.getFullYear() !== lastReset.getFullYear()) {
    this.monthlyUsage = 0;
    this.lastReset = now;
  }
  
  return this.monthlyUsage < this.monthlyLimit;
};

module.exports = mongoose.model('Wallet', walletSchema);
