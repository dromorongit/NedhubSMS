const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please add a name']
  },
  phoneNumber: {
    type: String,
    required: [true, 'Please add a phone number'],
    match: [
      /^(?:\+233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55)[0-9]{7}$/,
      'Please add a valid Ghana phone number'
    ]
  },
  groupName: {
    type: String,
    default: 'General'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Contact', contactSchema);