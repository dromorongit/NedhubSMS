require('dotenv').config({ path: '../backend/.env' });

// Initialize Sentry first
require('../backend/utils/sentry');

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { connectDB } = require('../backend/utils/database');
const logger = require('../backend/utils/logger');
const authRoutes = require('../backend/routes/auth');
const contactRoutes = require('../backend/routes/contacts');
const smsRoutes = require('../backend/routes/sms');
const naloSmsRoutes = require('../backend/routes/naloSms');
const walletRoutes = require('../backend/routes/wallet');
const transferRoutes = require('../backend/routes/transfers');
const senderIdRoutes = require('../backend/routes/senderIds');
const templateRoutes = require('../backend/routes/templates');
const campaignRoutes = require('../backend/routes/campaigns');
const smsCampaignRoutes = require('../backend/routes/sms-campaigns');
const analyticsRoutes = require('../backend/routes/analytics');
const reportsRoutes = require('../backend/routes/reports');
const adminRoutes = require('../backend/routes/admin');
const paymentRoutes = require('../backend/routes/payments');
const utilityRoutes = require('../backend/routes/utility');
const blacklistRoutes = require('../backend/routes/blacklist');
const seedRoutes = require('../backend/routes/seed');
const healthRoutes = require('../backend/routes/health');
const metricsRoutes = require('../backend/routes/metrics');
const hubtelCallbackController = require('../backend/controllers/hubtelCallbackController');
const EmailServiceClass = require('../backend/services/EmailService');
const SmsSchedulerService = require('../backend/services/SmsSchedulerService');
const Sentry = require('../backend/utils/sentry');

// Instantiate email service
const EmailService = new EmailServiceClass();

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

app.get('/auth/verify-email', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/verify-email.html'));
});

app.get('/auth/verify-email.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/verify-email.html'));
});

app.get('/auth/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/reset-password.html'));
});

app.get('/auth/reset-password.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/auth/reset-password.html'));
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

app.get('/analytics.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/analytics.html'));
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

app.get('/buy-airtime.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/buy-airtime.html'));
});

app.get('/buy-data.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/buy-data.html'));
});

app.get('/utility-payments.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/utility-payments.html'));
});

app.get('/transactions.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/transactions.html'));
});

app.get('/blacklist.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/pages/dashboard/blacklist.html'));
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
app.use('/api/sms-campaigns', smsCampaignRoutes); // New SMS campaigns routes
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/utility', utilityRoutes);
app.use('/api/sender-ids', senderIdRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/blacklist', blacklistRoutes);
app.use('/api/seed', seedRoutes);
app.use('/api', healthRoutes); // Health routes (no auth required)
app.use('/api', metricsRoutes); // Metrics routes (no auth required)

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
  Sentry.withScope((scope) => {
    scope.setUser({ id: req.user?.id });
    scope.setTag('url', req.url);
    scope.setTag('method', req.method);
    scope.setContext('request', {
      body: req.body,
      query: req.query,
      params: req.params
    });
    Sentry.captureException(err);
  });

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    userId: req.user?.id
  });

  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const server = app.listen(PORT, async () => {
  logger.info('Server started', { port: PORT });

  // Try to start SMS scheduler service, but don't fail if Redis is unavailable
  try {
    await SmsSchedulerService.start();
    logger.info('SMS Scheduler service started');
  } catch (error) {
    logger.error('Failed to start SMS Scheduler service', { error: error.message });
    logger.warn('Application starting without queue service (Redis may be unavailable)');
  }
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await SmsSchedulerService.stop();
      logger.info('SMS Scheduler service stopped');
      process.exit(0);
    } catch (error) {
      logger.error('Error stopping SMS Scheduler service', { error: error.message });
      process.exit(1);
    }
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await SmsSchedulerService.stop();
      logger.info('SMS Scheduler service stopped');
      process.exit(0);
    } catch (error) {
      logger.error('Error stopping SMS Scheduler service', { error: error.message });
      process.exit(1);
    }
  });
});

module.exports = app;