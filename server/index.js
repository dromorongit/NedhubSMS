require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { connectDB } = require('../backend/utils/database');
const authRoutes = require('../backend/routes/auth');
const contactRoutes = require('../backend/routes/contacts');
const smsRoutes = require('../backend/routes/sms');
const naloSmsRoutes = require('../backend/routes/naloSms');
const walletRoutes = require('../backend/routes/wallet');
const senderIdRoutes = require('../backend/routes/senderIds');
const templateRoutes = require('../backend/routes/templates');
const campaignRoutes = require('../backend/routes/campaigns');
const adminRoutes = require('../backend/routes/admin');
const paymentRoutes = require('../backend/routes/payments');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// CORS configuration - allow requests from frontend
app.use(cors({
  origin: ['http://localhost:3000', 'https://app.nedhubgh.com', 'http://app.nedhubgh.com'],
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100
});
app.use(limiter);

// Admin rate limiting (stricter)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50 // limit each IP to 50 requests per windowMs for admin routes
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/sms', naloSmsRoutes); // Nalo SMS routes
app.use('/api/wallet', walletRoutes);
app.use('/api/sender-ids', senderIdRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/payments', paymentRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;