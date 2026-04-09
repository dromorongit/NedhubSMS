const mongoose = require('mongoose');

const smsRecipientSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SmsCampaign',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  recipientName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  phoneNumber: {
    type: String,
    required: true,
    match: [
      /^(?:\+233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55)[0-9]{7}$/,
      'Please add a valid Ghana phone number'
    ],
    index: true
  },
  groupIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactGroup',
    index: true
  }],
  normalizedPhoneNumber: {
    type: String,
    required: true,
    index: true
  },
  providerStatus: {
    type: String,
    enum: ['queued', 'sent', 'delivered', 'failed', 'undelivered', 'expired'],
    default: 'queued'
  },
  segments: {
    type: Number,
    default: 1,
    min: 1
  },
  estimatedCost: {
    type: Number,
    default: 0,
    min: 0
  },
  actualCost: {
    type: Number,
    default: 0,
    min: 0
  },
  retryCount: {
    type: Number,
    default: 0,
    min: 0
  },
  queuedAt: {
    type: Date,
    index: true
  },
  personalizedMessage: {
    type: String,
    required: true,
    maxlength: 160
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'sent', 'delivered', 'failed', 'pending', 'cancelled'],
    default: 'pending',
    index: true
  },
  providerMessageId: {
    type: String,
    index: true
  },
  errorMessage: {
    type: String,
    maxlength: 500
  },
  sentAt: {
    type: Date
  },
  deliveredAt: {
    type: Date
  },
  failedAt: {
    type: Date,
    index: true
  },
  processingAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for efficient queries
smsRecipientSchema.index({ campaignId: 1, status: 1 });
smsRecipientSchema.index({ userId: 1, status: 1 });

// Update updatedAt before saving
smsRecipientSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to find recipients by campaign
smsRecipientSchema.statics.findByCampaignId = function(campaignId) {
  return this.find({ campaignId }).sort({ createdAt: 1 });
};

// Static method to find recipients by user and campaign
smsRecipientSchema.statics.findByUserAndCampaign = function(userId, campaignId) {
  return this.find({ userId, campaignId }).sort({ createdAt: 1 });
};

// Static method to update recipient status
smsRecipientSchema.statics.updateStatus = async function(id, status, providerMessageId = null, errorMessage = null) {
  const updateData = {
    status,
    updatedAt: new Date()
  };

  if (providerMessageId) updateData.providerMessageId = providerMessageId;
  if (errorMessage) updateData.errorMessage = errorMessage;

  if (status === 'sent') updateData.sentAt = new Date();
  if (status === 'delivered') updateData.deliveredAt = new Date();
  if (status === 'failed') updateData.failedAt = new Date();
  if (status === 'processing') updateData.processingAt = new Date();
  if (status === 'cancelled') updateData.cancelledAt = new Date();

  return this.findByIdAndUpdate(id, updateData, { new: true });
};

// Method to mark as sent
smsRecipientSchema.methods.markAsSent = function(providerMessageId = null) {
  this.status = 'sent';
  this.sentAt = new Date();
  if (providerMessageId) this.providerMessageId = providerMessageId;
  this.updatedAt = new Date();
  return this.save();
};

// Method to mark as delivered
smsRecipientSchema.methods.markAsDelivered = function() {
  this.status = 'delivered';
  this.deliveredAt = new Date();
  this.updatedAt = new Date();
  return this.save();
};

// Method to mark as failed
smsRecipientSchema.methods.markAsFailed = function(errorMessage) {
  this.status = 'failed';
  this.errorMessage = errorMessage;
  this.failedAt = new Date();
  this.updatedAt = new Date();
  return this.save();
};

// Method to mark as processing
smsRecipientSchema.methods.markAsProcessing = function() {
  this.status = 'processing';
  this.processingAt = new Date();
  this.updatedAt = new Date();
  return this.save();
};

// Method to mark as cancelled
smsRecipientSchema.methods.markAsCancelled = function() {
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  this.updatedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('SmsRecipient', smsRecipientSchema);