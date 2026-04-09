const mongoose = require('mongoose');

const blacklistedNumberSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  normalizedPhoneNumber: {
    type: String,
    required: true,
    index: true
  },
  reason: {
    type: String,
    required: [true, 'Reason for blacklisting is required'],
    trim: true,
    maxlength: 500
  },
  source: {
    type: String,
    required: [true, 'Source of blacklisting is required'],
    enum: ['user', 'system', 'complaint', 'bounce'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Compound index for efficient queries
blacklistedNumberSchema.index({ userId: 1, normalizedPhoneNumber: 1 }, { unique: true });

// Static method to find blacklisted numbers by user
blacklistedNumberSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Static method to check if phone number is blacklisted for user
blacklistedNumberSchema.statics.isBlacklisted = function(userId, normalizedPhoneNumber) {
  return this.exists({ userId, normalizedPhoneNumber });
};

// Static method to find by normalized phone number across all users (for global blacklist)
blacklistedNumberSchema.statics.findByNormalizedPhone = function(normalizedPhoneNumber) {
  return this.find({ normalizedPhoneNumber });
};

module.exports = mongoose.model('BlacklistedNumber', blacklistedNumberSchema);