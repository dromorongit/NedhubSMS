const mongoose = require('mongoose');

const walletReservationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SmsCampaign',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'released', 'captured', 'expired'],
    default: 'active',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  releasedAt: {
    type: Date
  },
  capturedAt: {
    type: Date
  }
});

// Compound indexes for efficient queries
walletReservationSchema.index({ userId: 1, status: 1 });
walletReservationSchema.index({ campaignId: 1, status: 1 });

// Static method to find reservations by user
walletReservationSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Static method to find reservations by campaign
walletReservationSchema.statics.findByCampaignId = function(campaignId) {
  return this.find({ campaignId }).sort({ createdAt: -1 });
};

// Static method to find active reservations by user
walletReservationSchema.statics.findActiveByUserId = function(userId) {
  return this.find({ userId, status: 'active' }).sort({ createdAt: -1 });
};

// Method to release reservation
walletReservationSchema.methods.release = function() {
  this.status = 'released';
  this.releasedAt = new Date();
  return this.save();
};

// Method to capture reservation
walletReservationSchema.methods.capture = function() {
  this.status = 'captured';
  this.capturedAt = new Date();
  return this.save();
};

// Method to expire reservation
walletReservationSchema.methods.expire = function() {
  this.status = 'expired';
  return this.save();
};

module.exports = mongoose.model('WalletReservation', walletReservationSchema);