require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { connectDB } = require('../backend/utils/database');
const authRoutes = require('../backend/routes/auth');
const contactRoutes = require('../backend/routes/contacts');
const smsRoutes = require('../backend/routes/sms');
const naloSmsRoutes = require('../backend/routes/naloSms');
const walletRoutes = require('../backend/routes/wallet');
const transferRoutes = require('../backend/routes/transfers');
const senderIdRoutes = require('../backend/routes/senderIds');
const templateRoutes = require('../backend/routes/templates');
const campaignRoutes = require('../backend/routes/campaigns');
const adminRoutes = require('../backend/routes/admin');
const paymentRoutes = require('../backend/routes/payments');
const seedRoutes = require('../backend/routes/seed');
const hubtelCallbackController = require('../backend/controllers/hubtelCallbackController');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - needed for express-rate-limit to work correctly with Railway's reverse proxy
app.set('trust proxy', 1);

// Connect to MongoDB
connectDB();

// CORS configuration - allow requests from frontend
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests, or same-origin requests)
    // In production, you should list your allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://app.nedhubgh.com',
      'http://app.nedhubgh.com',
      'https://nedhubsms-production.up.railway.app'
    ];
    
    // Allow requests with no origin (same-origin requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // For development, still allow - in production you might want to block
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight OPTIONS requests
app.options('*', cors(corsOptions));
app.use(express.json());

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../backend/uploads')));

// Serve static files from root assets directory
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Serve static files from src directory
app.use(express.static(path.join(__dirname, '../src')));

// Payment page routes (for Hubtel return URLs)
app.get('/payment/success', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/payment-success.html'));
});

app.get('/payment/cancelled', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/payment-cancelled.html'));
});

app.get('/payment/error', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/payment-error.html'));
});

// Hubtel payment return handler (no /api prefix)
app.get('/payment/return', async (req, res) => {
    const paymentController = require('../backend/controllers/paymentController');
    await paymentController.handlePaymentReturn(req, res);
});

// Auth page routes
app.get('/auth/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/login.html'));
});

app.get('/auth/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/login.html'));
});

app.get('/auth/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/register.html'));
});

app.get('/auth/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/register.html'));
});

app.get('/auth/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/forgot-password.html'));
});

app.get('/auth/forgot-password.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/forgot-password.html'));
});

// Dashboard page routes
app.get('/overview.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/overview.html'));
});

app.get('/campaigns.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/campaigns.html'));
});

app.get('/contacts.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/contacts.html'));
});

app.get('/history.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/history.html'));
});

app.get('/reports.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/reports.html'));
});

app.get('/send-sms.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/send-sms.html'));
});

app.get('/settings.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/settings.html'));
});

app.get('/templates.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/templates.html'));
});

app.get('/send-money.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/send-money.html'));
});

app.get('/withdraw-bank.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/withdraw-bank.html'));
});

app.get('/buy-airtime.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/buy-airtime.html'));
});

app.get('/buy-data.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/buy-data.html'));
});

app.get('/transactions.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/transactions.html'));
});

app.get('/admin/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/admin/admin.html'));
});

app.get('/admin/admin.js', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/admin/admin.js'));
});

// Rate limiting with trust proxy for X-Forwarded-For header
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  trustProxy: true,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip;
  }
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
app.use('/api/transfer', transferRoutes);
app.use('/api/sender-ids', senderIdRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/seed', seedRoutes);

// Hubtel callback endpoints (no authentication - called by Hubtel)
app.post('/api/hubtel/momo-callback', express.json(), async (req, res) => {
  await hubtelCallbackController.handleMomoCallback(req, res);
});

app.post('/api/hubtel/bank-callback', express.json(), async (req, res) => {
  await hubtelCallbackController.handleBankCallback(req, res);
});

app.post('/api/hubtel/airtime-callback', express.json(), async (req, res) => {
  await hubtelCallbackController.handleAirtimeCallback(req, res);
});

app.post('/api/hubtel/data-callback', express.json(), async (req, res) => {
  await hubtelCallbackController.handleDataCallback(req, res);
});

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