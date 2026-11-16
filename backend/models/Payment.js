const mongoose = require('mongoose');

/**
 * Payment Schema for Hubtel Online Checkout Integration
 * Stores payment transactions initiated through Hubtel
 */
const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  clientReference: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0.01, 'Amount must be at least 0.01']
  },
  currency: {
    type: String,
    default: 'GHS'
  },
  description: {
    type: String,
    required: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded'],
    default: 'pending',
    index: true
  },
  hubtelCheckoutId: {
    type: String,
    sparse: true
  },
  hubtelTransactionId: {
    type: String,
    sparse: true
  },
  paymentMethod: {
    type: String,
    enum: ['mobile_money', 'bank_card', 'hubtel_wallet', 'ghqr', 'unknown'],
    default: 'unknown'
  },
  customerEmail: {
    type: String
  },
  customerPhone: {
    type: String
  },
  callbackVerified: {
    type: Boolean,
    default: false
  },
  callbackReceivedAt: {
    type: Date
  },
  paidAt: {
    type: Date
  },
  failureReason: {
    type: String
  },
  // Financial tracking fields for gateway fees
  gatewayFeeEstimated: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Estimated gateway fee for this transaction'
  },
  netAmountReceived: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Net amount received after gateway fees (credited to wallet)'
  },
  grossAmountPaid: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Gross amount paid by customer before fees'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Compound index for efficient querying
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
// hubtelCheckoutId is sparse and not frequently queried, no index needed

// Static method to find payment by clientReference
paymentSchema.statics.findByClientReference = function(clientReference) {
  return this.findOne({ clientReference });
};

// Static method to find pending payments for status check
paymentSchema.statics.findPendingPayments = function(olderThanMinutes = 5) {
  const cutoffDate = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  return this.find({
    status: 'pending',
    createdAt: { $lt: cutoffDate }
  });
};

// Instance method to mark as paid
paymentSchema.methods.markAsPaid = async function(transactionId, paymentMethod) {
  this.status = 'paid';
  this.hubtelTransactionId = transactionId;
  this.paymentMethod = paymentMethod;
  this.paidAt = new Date();
  return this.save();
};

// Instance method to mark as failed
paymentSchema.methods.markAsFailed = function(reason) {
  this.status = 'failed';
  this.failureReason = reason;
  return this.save();
};

module.exports = mongoose.model('Payment', paymentSchema);
