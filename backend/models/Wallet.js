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
    min: [0, 'Balance cannot be negative']
  },
  frozen: {
    type: Boolean,
    default: false
  },
  dailyLimit: {
    type: Number,
    default: 1000,
    min: [0, 'Daily limit cannot be negative']
  },
  monthlyLimit: {
    type: Number,
    default: 10000,
    min: [0, 'Monthly limit cannot be negative']
  },
  dailyUsage: {
    type: Number,
    default: 0,
    min: [0, 'Daily usage cannot be negative']
  },
  monthlyUsage: {
    type: Number,
    default: 0,
    min: [0, 'Monthly usage cannot be negative']
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

// Update updatedAt before saving
walletSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

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