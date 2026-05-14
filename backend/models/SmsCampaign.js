const mongoose = require('mongoose');

const smsCampaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Campaign title is required'],
    trim: true,
    maxlength: 100
  },
  senderId: {
    type: String,
    required: [true, 'Sender ID is required'],
    maxlength: 11,
    index: true
  },
  messageBody: {
    type: String,
    required: [true, 'Message body is required'],
    maxlength: 160
  },
  salutation: {
    type: String,
    enum: ['Dear', 'Hello', 'Hi', 'Esteemed', 'Honourable', 'Custom'],
    default: 'Dear'
  },
  customSalutation: {
    type: String,
    trim: true,
    maxlength: 50
  },
  isPersonalized: {
    type: Boolean,
    default: true
  },
  sendMode: {
    type: String,
    enum: ['immediate', 'scheduled'],
    default: 'immediate'
  },
  scheduledAt: {
    type: Date,
    index: true
  },
  scheduledTimezone: {
    type: String,
    default: 'UTC'
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'queued', 'processing', 'sent', 'failed', 'cancelled', 'partial_success'],
    default: 'draft',
    index: true
  },
  jobId: {
    type: String,
    index: true
  },
  scheduleStatus: {
    type: String,
    enum: ['queued', 'scheduled', 'processing', 'sent', 'partial_success', 'failed', 'cancelled'],
    default: 'queued',
    index: true
  },
  executedAt: {
    type: Date,
    index: true
  },
  cancelledAt: {
    type: Date,
    index: true
  },
  recipientCount: {
    type: Number,
    default: 0,
    min: 0
  },
  validRecipientCount: {
    type: Number,
    default: 0,
    min: 0
  },
  invalidRecipientCount: {
    type: Number,
    default: 0,
    min: 0
  },
  duplicateCount: {
    type: Number,
    default: 0,
    min: 0
  },
  blacklistedCount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalSegments: {
    type: Number,
    default: 0,
    min: 0
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
  walletChargeMode: {
    type: String,
    enum: ['immediate', 'on_delivery', 'reservation'],
    default: 'immediate'
  },
  walletReservationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletReservation',
    index: true
  },
  sentAt: {
    type: Date,
    index: true
  },
  completedAt: {
    type: Date,
    index: true
  },
  sentCount: {
    type: Number,
    default: 0,
    min: 0
  },
  deliveredCount: {
    type: Number,
    default: 0,
    min: 0
  },
  failedCount: {
    type: Number,
    default: 0,
    min: 0
  },
  queuedCount: {
    type: Number,
    default: 0,
    min: 0
  },
  cancelledCount: {
    type: Number,
    default: 0,
    min: 0
  },
  jobId: {
    type: String,
    index: true
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

// Update updatedAt before saving
smsCampaignSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to check if campaign is scheduled for future
smsCampaignSchema.methods.isScheduled = function() {
  return this.status === 'scheduled' && this.scheduledAt > new Date();
};

// Method to check if campaign can be sent (immediate or scheduled execution)
smsCampaignSchema.methods.canBeSent = function() {
  return ['draft', 'scheduled', 'queued'].includes(this.status);
};

// Method to check if campaign can be cancelled
smsCampaignSchema.methods.canBeCancelled = function() {
  return (this.status === 'scheduled' || this.status === 'queued') && this.scheduledAt > new Date();
};

// Method to check if campaign can be rescheduled
smsCampaignSchema.methods.canBeRescheduled = function() {
  return this.status === 'scheduled' && this.scheduledAt > new Date();
};

// Method to mark campaign as executing
smsCampaignSchema.methods.markAsExecuting = function() {
  this.status = 'processing';
  this.scheduleStatus = 'processing';
  this.executedAt = new Date();
};

// Method to mark campaign as completed (sent)
smsCampaignSchema.methods.markAsCompleted = function() {
  this.status = 'sent';
  this.scheduleStatus = 'sent';
  this.executedAt = this.executedAt || new Date();
};

// Method to mark campaign as failed
smsCampaignSchema.methods.markAsFailed = function() {
  this.status = 'failed';
  this.scheduleStatus = 'failed';
};

// Method to mark campaign as cancelled
smsCampaignSchema.methods.markAsCancelled = function() {
  this.status = 'cancelled';
  this.scheduleStatus = 'cancelled';
  this.cancelledAt = new Date();
};

// Static method to find campaigns by user
smsCampaignSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Static method to find scheduled campaigns ready to send
smsCampaignSchema.statics.findReadyToSend = function() {
  return this.find({
    status: 'scheduled',
    scheduledAt: { $lte: new Date() }
  }).sort({ scheduledAt: 1 });
};

module.exports = mongoose.model('SmsCampaign', smsCampaignSchema);