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
      /^[a-zA-Z0-9\s\-_.]{1,11}$/,
      'Sender ID must be 1-11 characters and can contain letters, numbers, spaces, hyphens, periods and underscores'
    ]
  },
  documentType: {
    type: String,
    enum: ['ghana_card', 'business_registration', 'passport'],
    required: [true, 'Document type is required']
  },
  documentUrl: {
    type: String,
    required: [true, 'Document upload is required']
  },
  documentName: {
    type: String,
    required: [true, 'Document name is required']
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
