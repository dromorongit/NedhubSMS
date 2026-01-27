const mongoose = require('mongoose');

const smsMessageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  msisdn: {
    type: String,
    required: true
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

// Update the updatedAt field on save
smsMessageSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('SmsMessage', smsMessageSchema);