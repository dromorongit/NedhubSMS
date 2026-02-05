const express = require('express');
const router = express.Router();
const { generateToken, verifyToken } = require('../utils/auth');
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');
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

    // Create user (password will be hashed by Mongoose pre-save hook)
    const user = await User.create({ name, email, password });

    // Generate JWT token
    const token = generateToken(user._id, 'user');

    res.status(201).json({ token, userId: user._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare passwords
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = generateToken(user._id, user.role);

    res.json({ token, userId: user._id, role: user.role });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token
router.get('/verify', authenticate, async (req, res) => {
 try {
   const user = await User.findById(req.user.id).select('-password');
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