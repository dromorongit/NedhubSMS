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
      /^(?:\+233|233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55|59)[0-9]{7}$/,
      'Please add a valid Ghana phone number'
    ],
    index: true
  },
  networkType: {
    type: String,
    enum: ['MTN', 'Telecel', 'AirtelTigo', 'Unknown'],
    default: 'Unknown',
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
  errorCode: {
    type: String,
    index: true
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
    required: true
    // Removed maxlength: 160 to allow multipart SMS messages
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'sent', 'delivered', 'failed', 'scheduled', 'cancelled'],
    default: 'queued',
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
smsRecipientSchema.index({ userId: 1, normalizedPhoneNumber: 1 });
smsRecipientSchema.index({ createdAt: 1 });

// Update updatedAt before saving
smsRecipientSchema.pre('save', function(next) {
  if (this.phoneNumber) {
    let normalized = this.phoneNumber.replace(/\D/g, '');
    if (normalized.startsWith('233') && normalized.length === 12) {
      // already good
    } else if (normalized.startsWith('0') && normalized.length === 10) {
      normalized = '233' + normalized.substring(1);
    } else if (normalized.length === 9) {
      normalized = '233' + normalized;
    } else {
      // Invalid length, but let it through for validation later
    }
    this.normalizedPhoneNumber = normalized;
  }
  this.updatedAt = new Date();
  next();
});

/**
 * Detect Ghana network type from a normalized phone number (233XXXXXXXXX)
 * @param {string} normalizedPhone - Phone number in 233XXXXXXXXX format
 * @returns {string} Network type: 'MTN', 'Telecel', 'AirtelTigo', or 'Unknown'
 */
smsRecipientSchema.statics.detectNetwork = function(normalizedPhone) {
  if (!normalizedPhone || typeof normalizedPhone !== 'string') return 'Unknown';
  const cleaned = normalizedPhone.replace(/\D/g, '');
  if (cleaned.length < 6) return 'Unknown';
  // Extract the prefix after 233 (positions 3-5 in the cleaned string)
  const prefix = cleaned.substring(3, 6);
  // Telecel/Vodafone: 020, 050
  if (prefix === '020' || prefix === '050') return 'Telecel';
  // MTN: 024, 054, 055, 059
  if (prefix === '024' || prefix === '054' || prefix === '055' || prefix === '059') return 'MTN';
  // AirtelTigo: 026, 027, 028, 056, 057
  if (prefix === '026' || prefix === '027' || prefix === '028' || prefix === '056' || prefix === '057') return 'AirtelTigo';
  return 'Unknown';
};

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

  if (status === 'sent') { updateData.providerStatus = 'sent'; }
  else if (status === 'delivered') { updateData.providerStatus = 'delivered'; }
  else if (status === 'failed') { updateData.providerStatus = 'failed'; }
  else if (status === 'processing') { updateData.providerStatus = 'processing'; }
  else if (status === 'cancelled') { updateData.providerStatus = 'cancelled'; }

  if (status === 'sent') updateData.sentAt = new Date();
  if (status === 'delivered') updateData.deliveredAt = new Date();
  if (status === 'failed') updateData.failedAt = new Date();
  if (status === 'processing') updateData.processingAt = new Date();
  if (status === 'cancelled') updateData.cancelledAt = new Date();

  return this.findByIdAndUpdate(id, updateData, { new: true });
};

// Method to mark as sent
smsRecipientSchema.methods.markAsSent = function(providerMessageId = null) {
  const oldStatus = this.status;
  this.status = 'sent';
  this.sentAt = new Date();
  if (providerMessageId) this.providerMessageId = providerMessageId;
  this.updatedAt = new Date();
   const savePromise = this.save();
   // Log recipient status change with [MessageStatus] tag
   console.log('[MessageStatus]', {
     recipientId: this._id,
     campaignId: this.campaignId,
     oldStatus,
     newStatus: 'sent',
     providerMessageId
   });
   return savePromise;
 };

// Method to mark as delivered
smsRecipientSchema.methods.markAsDelivered = function() {
  const oldStatus = this.status;
  this.status = 'delivered';
  this.deliveredAt = new Date();
  this.updatedAt = new Date();
   const savePromise = this.save();
   console.log('[MessageStatus]', {
     recipientId: this._id,
     campaignId: this.campaignId,
     oldStatus,
     newStatus: 'delivered'
   });
   return savePromise;
 };

// Method to mark as failed
smsRecipientSchema.methods.markAsFailed = function(errorMessage, errorCode = null) {
  const oldStatus = this.status;
  this.status = 'failed';
  this.errorMessage = errorMessage;
  if (errorCode) this.errorCode = errorCode;
  this.failedAt = new Date();
  this.updatedAt = new Date();
   const savePromise = this.save();
   console.log('[MessageStatus]', {
     recipientId: this._id,
     campaignId: this.campaignId,
     oldStatus,
     newStatus: 'failed',
     error: errorMessage,
     errorCode
   });
   return savePromise;
 };

// Method to mark as processing
smsRecipientSchema.methods.markAsProcessing = function() {
  const oldStatus = this.status;
  this.status = 'processing';
  this.processingAt = new Date();
  this.updatedAt = new Date();
   const savePromise = this.save();
   console.log('[MessageStatus]', {
     recipientId: this._id,
     campaignId: this.campaignId,
     oldStatus,
     newStatus: 'processing'
   });
   return savePromise;
 };

// Method to mark as cancelled
smsRecipientSchema.methods.markAsCancelled = function() {
  const oldStatus = this.status;
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  this.updatedAt = new Date();
   const savePromise = this.save();
   console.log('[MessageStatus]', {
     recipientId: this._id,
     campaignId: this.campaignId,
     oldStatus,
     newStatus: 'cancelled'
   });
   return savePromise;
 };

module.exports = mongoose.model('SmsRecipient', smsRecipientSchema);