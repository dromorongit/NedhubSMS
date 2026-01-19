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
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Message', messageSchema);