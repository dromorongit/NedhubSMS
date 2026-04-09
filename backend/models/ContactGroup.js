const mongoose = require('mongoose');

const contactGroupSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Group name is required'],
    trim: true,
    maxlength: 100,
    index: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  memberCount: {
    type: Number,
    default: 0,
    min: 0
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

// Compound index for efficient queries
contactGroupSchema.index({ userId: 1, name: 1 }, { unique: true });

// Update updatedAt before saving
contactGroupSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to find groups by user
contactGroupSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Static method to find group by user and name
contactGroupSchema.statics.findByUserAndName = function(userId, name) {
  return this.findOne({ userId, name });
};

// Method to update member count
contactGroupSchema.methods.updateMemberCount = async function() {
  const Contact = mongoose.model('Contact');
  const count = await Contact.countDocuments({ userId: this.userId, groupIds: this._id });
  this.memberCount = count;
  this.updatedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('ContactGroup', contactGroupSchema);