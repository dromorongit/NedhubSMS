const mongoose = require('mongoose');

const smsMessageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  normalizedPhoneNumber: {
    type: String,
    required: true,
    index: true
  },
  senderId: {
    type: String,
    required: true,
    maxlength: 11
  },
  message: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    required: true,
    default: 'nalo'
  },
  jobId: {
    type: String,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending',
    index: true
  },
  errorCode: {
    type: String
  },
  errorMessage: {
    type: String
  },
  // Financial tracking fields
  sellPricePerSms: {
    type: Number,
    default: 0.095,
    min: 0
  },
  providerCostPerSms: {
    type: Number,
    default: 0.082,
    min: 0
  },
  segments: {
    type: Number,
    default: 1,
    min: 1
  },
  recipientsCount: {
    type: Number,
    default: 1,
    min: 1
  },
  totalChargedToUser: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCostToProvider: {
    type: Number,
    default: 0,
    min: 0
  },
  profitAmount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  deliveredAt: {
    type: Date
  }
});

// Auto-normalize phone number before save
smsMessageSchema.pre('save', function(next) {
  if (this.phoneNumber) {
    let normalized = this.phoneNumber.replace(/\D/g, '');
    if (normalized.startsWith('233') && normalized.length === 12) {
      // already good
    } else if (normalized.startsWith('0') && normalized.length === 10) {
      normalized = '233' + normalized.substring(1);
    } else if (normalized.length === 9) {
      normalized = '233' + normalized;
    }
    this.normalizedPhoneNumber = normalized;
  }
  this.updatedAt = new Date();
  next();
});

// Update the updatedAt field on save
smsMessageSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('SmsMessage', smsMessageSchema);