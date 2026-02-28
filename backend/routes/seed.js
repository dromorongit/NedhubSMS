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

    console.log('[SEED] Looking for admin user:', adminEmail);

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log('[SEED] Admin exists, ID:', existingAdmin._id, 'Current role:', existingAdmin.role);
      
      // Update role and password
      const salt = await bcrypt.genSalt(10);
      const newHashedPassword = await bcrypt.hash(adminPassword, salt);
      console.log('[SEED] New password hash:', newHashedPassword);
      
      existingAdmin.password = newHashedPassword;
      existingAdmin.role = 'super_admin';
      existingAdmin.status = 'active';
      await existingAdmin.save();
      console.log('[SEED] Admin updated successfully');
      
      return res.json({ 
        message: 'Admin user already exists and has been updated', 
        email: adminEmail 
      });
    }

    console.log('[SEED] Admin does not exist, creating new user');

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);
    console.log('[SEED] Created password hash:', hashedPassword);

    // Create new admin user
    const adminUser = new User({
      name: adminName,
      email: adminEmail,
      password: hashedPassword,
      role: 'super_admin',
      status: 'active'
    });
    
    await adminUser.save();
    console.log('[SEED] Admin created successfully, ID:', adminUser._id);
    
    res.json({ 
      message: 'Admin user created successfully', 
      email: adminEmail,
      role: 'super_admin'
    });
  } catch (error) {
    console.error('[SEED] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
