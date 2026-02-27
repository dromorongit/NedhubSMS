const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { connectDB } = require('../utils/database');

// Seed admin user - call this once to create admin
router.post('/admin', async (req, res) => {
  try {
    await connectDB();
    
    const adminEmail = 'admin@nedhubgh.com';
    const adminPassword = 'levineplesz';
    const adminName = 'Admin';

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      // Update role to super_admin
      existingAdmin.role = 'super_admin';
      existingAdmin.status = 'active';
      await existingAdmin.save();
      return res.json({ 
        message: 'Admin user already exists and has been updated', 
        email: adminEmail 
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    // Create new admin user
    const adminUser = new User({
      name: adminName,
      email: adminEmail,
      password: hashedPassword,
      role: 'super_admin',
      status: 'active'
    });
    
    await adminUser.save();
    
    res.json({ 
      message: 'Admin user created successfully', 
      email: adminEmail,
      role: 'super_admin'
    });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
