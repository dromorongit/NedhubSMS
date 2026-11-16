require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nedhub_bulk_messaging';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin', 'super_admin'], default: 'user' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

const User = mongoose.model('User', userSchema);

async function seedAdmin() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const adminEmail = 'admin@nedhubgh.com';
    const adminPassword = 'levineplesz';
    const adminName = 'Admin';

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log('Admin user already exists. Updating role...');
      existingAdmin.role = 'super_admin';
      existingAdmin.status = 'active';
      await existingAdmin.save();
      console.log('Admin user updated successfully!');
    } else {
      // Create new admin user
      const adminUser = new User({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: 'super_admin',
        status: 'active'
      });
      
      await adminUser.save();
      console.log('Admin user created successfully!');
    }

    console.log('\nAdmin Login Credentials:');
    console.log('Email: admin@nedhubgh.com');
    console.log('Password: levineplesz');
    console.log('Role: super_admin');

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

seedAdmin();
