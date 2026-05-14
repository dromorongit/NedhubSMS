const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderId: {
    type: String,
    required: [true, 'Please add a sender ID']
  },
  messageBody: {
    type: String,
    required: [true, 'Please add a message body']
  },
  recipients: {
    type: [String],
    required: [true, 'Please add at least one recipient']
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'sent', 'delivered', 'failed', 'scheduled', 'cancelled'],
    default: 'queued'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Static method to find messages by user ID
messageSchema.statics.findByUserId = function(userId) {
  return this.find({ userId: userId }).sort({ createdAt: -1 });
};

// Static method to find message by ID
messageSchema.statics.findById = function(id) {
  return this.findOne({ _id: id });
};

// Static method to update message status
messageSchema.statics.updateStatus = function(id, status) {
  return this.findByIdAndUpdate(id, { status }, { new: true });
};

module.exports = mongoose.model('Message', messageSchema);
