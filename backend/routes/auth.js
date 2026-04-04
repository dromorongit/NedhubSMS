const express = require('express');
const router = express.Router();
const { generateToken, verifyToken } = require('../utils/auth');
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');
const OTP = require('../models/OTP');
const EmailService = require('../services/EmailService');
const validator = require('validator');

// User registration
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create user as 'pending' - user cannot login until they verify email
    const user = await User.create({ 
      name, 
      email, 
      password,
      status: 'pending',
      isEmailVerified: false
    });

    // Generate OTP for email verification
    const otp = OTP.generateOTP();
    await OTP.create({
      email,
      otp,
      purpose: 'email_verification'
    });

    // Send verification email in background
    EmailService.sendVerificationOTP(email, name, otp)
      .then(() => console.log('[AUTH] Verification email sent successfully'))
      .catch(err => console.error('[AUTH] Failed to send verification email:', err.message));

    res.status(201).json({ 
      success: true,
      message: 'Verification code sent to your email. Please verify to activate your account.',
      email: email
    });
  } catch (error) {
    console.error('[AUTH] Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('[AUTH] Login attempt for email:', email);

    // Validate input
    if (!email || !password) {
      console.log('[AUTH] Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      console.log('[AUTH] User not found:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user account is pending (not verified yet)
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Please verify your email first. Check your inbox for the verification code.' });
    }

    // Check if user account is suspended
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
    }

    console.log('[AUTH] User found:', user._id, 'Role:', user.role);
    
    // Compare passwords
    const isMatch = await user.matchPassword(password);
    console.log('[AUTH] Password match result:', isMatch);
    
    if (!isMatch) {
      console.log('[AUTH] Password mismatch for user:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = generateToken(user._id, user.role);
    console.log('[AUTH] Login successful for:', email, 'Role:', user.role);

    res.json({ 
      token, 
      userId: user._id, 
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify email with OTP
router.post('/verify-email', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Find and verify OTP
    const result = await OTP.findAndVerifyOTP(email, otp, 'email_verification');

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    // Update user email verification status and activate account
    const user = await User.findOneAndUpdate(
      { email },
      { isEmailVerified: true, emailVerifiedAt: new Date(), status: 'active' },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate JWT token
    const token = generateToken(user._id, user.role);

    res.json({ 
      success: true,
      message: 'Email verified successfully',
      token,
      user
    });
  } catch (error) {
    console.error('[AUTH] Email verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Request password reset OTP
router.post('/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({ 
        success: true,
        message: 'If an account exists with this email, you will receive a password reset code'
      });
    }

    // Delete any existing OTPs for this email and purpose
    await OTP.deleteMany({ email, purpose: 'password_reset' });

    // Generate and send OTP
    const otp = OTP.generateOTP();
    await OTP.create({
      email,
      otp,
      purpose: 'password_reset'
    });

    // Send password reset email
    await EmailService.sendPasswordResetOTP(email, user.name, otp);

    res.json({ 
      success: true,
      message: 'If an account exists with this email, you will receive a password reset code'
    });
  } catch (error) {
    console.error('[AUTH] Password reset request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate input
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Find and verify OTP
    const result = await OTP.findAndVerifyOTP(email, otp, 'password_reset');

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    // Find user and update password
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;
    await user.save();

    res.json({ 
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('[AUTH] Password reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { email, purpose } = req.body;

    // Validate input
    if (!email || !purpose) {
      return res.status(400).json({ error: 'Email and purpose are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!['email_verification', 'password_reset'].includes(purpose)) {
      return res.status(400).json({ error: 'Invalid purpose' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete any existing OTPs for this email and purpose
    await OTP.deleteMany({ email, purpose });

    // Generate and send OTP
    const otp = OTP.generateOTP();
    await OTP.create({
      email,
      otp,
      purpose
    });

    // Send email based on purpose
    if (purpose === 'email_verification') {
      await EmailService.sendVerificationOTP(email, user.name, otp);
    } else {
      await EmailService.sendPasswordResetOTP(email, user.name, otp);
    }

    res.json({ 
      success: true,
      message: 'OTP sent successfully'
    });
  } catch (error) {
    console.error('[AUTH] Resend OTP error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token
router.get('/verify', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
