const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  recipientName: {
    type: String,
    required: [true, 'Please add a recipient name'],
    trim: true
  },
  phoneNumber: {
    type: String,
    required: [true, 'Please add a phone number'],
    match: [
      /^(?:\+233|233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55|59)[0-9]{7}$/,
      'Please add a valid Ghana phone number'
    ],
    index: true
  },
  normalizedPhoneNumber: {
    type: String,
    required: true,
    index: true
  },
  groupIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactGroup',
    index: true
  }],
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

// Static method to find contacts by user ID
contactSchema.statics.findByUserId = function(userId) {
  return this.find({ userId: userId }).sort({ createdAt: -1 });
};

// Static method to find contact by ID
contactSchema.statics.findById = function(id) {
  return this.findOne({ _id: id });
};

// Static method to create contact
contactSchema.statics.create = async function(userId, recipientName, phoneNumber, groupName) {
  const contact = new this({
    userId,
    recipientName,
    phoneNumber,
    groupName: groupName || 'General'
  });
  await contact.save();
  return contact._id;
};

// Static method to update contact
contactSchema.statics.update = async function(id, recipientName, phoneNumber, groupName) {
  return this.findByIdAndUpdate(id, {
    recipientName,
    phoneNumber,
    groupName: groupName || 'General',
    updatedAt: new Date()
  }, { new: true });
};

// Auto-normalize phone number before validation (so required field is set)
contactSchema.pre('validate', function(next) {
  if (this.phoneNumber) {
    let normalized = this.phoneNumber.replace(/\D/g, '');
    
    if (normalized.startsWith('233') && normalized.length === 12) {
      // Already in 233 format
    } else if (normalized.startsWith('0') && normalized.length === 10) {
      // Convert 0XXXXXXXXX to 233XXXXXXXXX
      normalized = '233' + normalized.substring(1);
    } else if (normalized.length === 9) {
      // Add country code
      normalized = '233' + normalized;
    }
    
    this.normalizedPhoneNumber = normalized;
  }
  next();
});

// Update the updatedAt field on save
contactSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to delete contact
contactSchema.statics.delete = function(id) {
  return this.findByIdAndDelete(id);
};

module.exports = mongoose.model('Contact', contactSchema);
