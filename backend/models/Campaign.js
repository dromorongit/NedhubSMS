const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true
  },
  senderId: {
    type: String,
    required: [true, 'Sender ID is required']
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Template'
  },
  customMessage: {
    type: String,
    default: ''
  },
  recipients: {
    type: [String],
    required: [true, 'At least one recipient is required']
  },
  recipientsCount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sent', 'failed'],
    default: 'draft'
  },
  scheduledAt: {
    type: Date
  },
  sentAt: {
    type: Date
  },
  cost: {
    type: Number,
    required: true,
    min: [0, 'Cost cannot be negative']
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
campaignSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to check if campaign is scheduled
campaignSchema.methods.isScheduled = function() {
  return this.status === 'scheduled' && this.scheduledAt > new Date();
};

// Method to check if campaign can be sent
campaignSchema.methods.canBeSent = function() {
  return this.status === 'draft' || this.status === 'scheduled';
};

module.exports = mongoose.model('Campaign', campaignSchema);