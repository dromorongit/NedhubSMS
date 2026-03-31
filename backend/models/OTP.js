const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true
  },
  otp: {
    type: String,
    required: [true, 'OTP is required']
  },
  purpose: {
    type: String,
    enum: ['email_verification', 'password_reset'],
    required: [true, 'OTP purpose is required']
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 900 // 15 minutes TTL (900 seconds)
  }
});

// Index for faster queries
otpSchema.index({ email: 1, purpose: 1 });

// Hash OTP before saving
otpSchema.pre('save', async function(next) {
  if (!this.isModified('otp')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.otp = await bcrypt.hash(this.otp, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare OTP
otpSchema.methods.matchOTP = async function(enteredOTP) {
  return await bcrypt.compare(enteredOTP, this.otp);
};

// Static method to generate a 6-digit OTP
otpSchema.statics.generateOTP = function() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Static method to find and verify OTP
otpSchema.statics.findAndVerifyOTP = async function(email, otp, purpose) {
  const otpRecord = await this.findOne({ email, purpose }).sort({ createdAt: -1 });
  
  if (!otpRecord) {
    return { success: false, message: 'OTP not found or expired' };
  }

  const isMatch = await otpRecord.matchOTP(otp);
  
  if (!isMatch) {
    return { success: false, message: 'Invalid OTP' };
  }

  // Delete the OTP after successful verification
  await this.deleteOne({ _id: otpRecord._id });

  return { success: true, message: 'OTP verified successfully' };
};

module.exports = mongoose.model('OTP', otpSchema);
