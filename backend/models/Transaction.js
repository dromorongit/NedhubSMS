const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative']
  },
  description: {
    type: String,
    required: true
  },
  reference: {
    type: String,
    required: true,
    unique: true
  },
  balanceBefore: {
    type: Number,
    required: true,
    min: [0, 'Balance cannot be negative']
  },
  balanceAfter: {
    type: Number,
    required: true,
    min: [0, 'Balance cannot be negative']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for better query performance
transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);