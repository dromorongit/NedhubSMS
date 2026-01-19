const mongoose = require('mongoose');

const senderIdSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderId: {
    type: String,
    required: [true, 'Sender ID is required'],
    unique: true,
    match: [
      /^[a-zA-Z0-9]{1,11}$/,
      'Sender ID must be alphanumeric and 1-11 characters'
    ]
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  remarks: {
    type: String,
    default: ''
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
senderIdSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to check if Sender ID is approved
senderIdSchema.methods.isApproved = function() {
  return this.status === 'approved';
};

module.exports = mongoose.model('SenderId', senderIdSchema);