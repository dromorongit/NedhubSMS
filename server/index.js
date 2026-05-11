// Early error logging to file and console (before anything else)
const fs = require('fs');
const path = require('path');
const earlyLogFile = path.join(__dirname, '../backend/logs/early-startup.log');

function earlyLog(message) {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    // Write to file
    try {
      fs.appendFileSync(earlyLogFile, logLine, { flag: 'a' });
    } catch (e) {
      // Ignore file logging errors
    }
    // Also write to stdout for Railway logs
    console.log(message);
  } catch (e) {
    // Ignore all logging errors
  }
}

earlyLog('========== SERVER STARTING ==========');

// Load environment variables - make it optional for Docker/Railway
try {
  require('dotenv').config({ path: '../backend/.env' });
  earlyLog('Environment variables loaded');
} catch (e) {
  earlyLog('dotenv load failed (expected in Docker): ' + e.message);
}

// Initialize Sentry first
let Sentry;
try {
  Sentry = require('../backend/utils/sentry');
  earlyLog('Sentry initialized');
} catch (e) {
  earlyLog('Sentry initialization failed: ' + e.message);
}

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { connectDB } = require('../backend/utils/database');
const logger = require('../backend/utils/logger');
earlyLog('Core modules loaded');

// Load services (must be after routes to avoid circular dependencies)
let EmailServiceClass;
let SmsSchedulerService;
try {
  EmailServiceClass = require('../backend/services/EmailService');
  SmsSchedulerService = require('../backend/services/SmsSchedulerService');
  earlyLog('Services loaded');
} catch (e) {
  earlyLog('Service loading failed: ' + e.message + '\n' + e.stack);
  throw e;
}

// Load routes - declare variables in outer scope for use in app.use()
let authRoutes, contactRoutes, smsRoutes, naloSmsRoutes, walletRoutes, transferRoutes;
let senderIdRoutes, templateRoutes, campaignRoutes, smsCampaignRoutes, analyticsRoutes;
let reportsRoutes, adminRoutes, paymentRoutes, utilityRoutes, blacklistRoutes;
let seedRoutes, healthRoutes, metricsRoutes, hubtelCallbackController;
try {
  authRoutes = require('../backend/routes/auth');
  contactRoutes = require('../backend/routes/contacts');
  smsRoutes = require('../backend/routes/sms');
  naloSmsRoutes = require('../backend/routes/naloSms');
  walletRoutes = require('../backend/routes/wallet');
  transferRoutes = require('../backend/routes/transfers');
  senderIdRoutes = require('../backend/routes/senderIds');
  templateRoutes = require('../backend/routes/templates');
  campaignRoutes = require('../backend/routes/campaigns');
  smsCampaignRoutes = require('../backend/routes/sms-campaigns');
  analyticsRoutes = require('../backend/routes/analytics');
  reportsRoutes = require('../backend/routes/reports');
  adminRoutes = require('../backend/routes/admin');
  paymentRoutes = require('../backend/routes/payments');
  utilityRoutes = require('../backend/routes/utility');
  blacklistRoutes = require('../backend/routes/blacklist');
  seedRoutes = require('../backend/routes/seed');
  healthRoutes = require('../backend/routes/health');
  metricsRoutes = require('../backend/routes/metrics');
  hubtelCallbackController = require('../backend/controllers/hubtelCallbackController');
  earlyLog('Routes loaded');
} catch (e) {
  earlyLog('Route loading failed: ' + e.message + '\n' + e.stack);
  throw e;
}

try {
  // Instantiate email service
  const EmailService = new EmailServiceClass();
  earlyLog('Email service instantiated');
} catch (e) {
  earlyLog('Email service instantiation failed: ' + e.message);
  throw e;
}

const app = express();
const PORT = process.env.PORT || 3000;
earlyLog(`Server will listen on port ${PORT}`);

// Simple health check endpoint for Railway (must be before other middleware)
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Trust proxy - needed for express-rate-limit to work correctly with Railway's reverse proxy
app.set('trust proxy', 1);

// Connect to MongoDB in the background (non-blocking)
try {
  connectDB().catch(err => {
    earlyLog('MongoDB connection failed: ' + err.message);
    logger.warn('MongoDB connection failed, continuing without database', { error: err.message });
  });
  earlyLog('MongoDB connection initiated');
} catch (e) {
  earlyLog('MongoDB connection setup failed: ' + e.message);
}

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
app.use(express.json({ limit: '50mb' }));

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
  },
  handler: (req, res) => {
    const logger = require('./backend/utils/logger');
    logger.ratelimit.warn('Rate limit exceeded', {
      ip: req.ip,
      forwardedFor: req.headers['x-forwarded-for'],
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent')
    });
    
    const resetTime = new Date(Date.now() + (parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000));
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000),
        resetTime: resetTime.toISOString()
      }
    });
  }
});
app.use(limiter);

// Admin rate limiting (stricter)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs for admin routes
  handler: (req, res) => {
    const logger = require('./backend/utils/logger');
    logger.ratelimit.warn('Admin rate limit exceeded', {
      ip: req.ip,
      forwardedFor: req.headers['x-forwarded-for'],
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent')
    });
    
    const resetTime = new Date(Date.now() + (15 * 60 * 1000));
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((15 * 60 * 1000) / 1000),
        resetTime: resetTime.toISOString()
      }
    });
  }
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

  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    }
  });
});

// Start server - listen on all interfaces (0.0.0.0) for Docker/Railway compatibility
try {
  const server = app.listen(PORT, '0.0.0.0', async () => {
    earlyLog(`Server listening on 0.0.0.0:${PORT}`);
    logger.info('Server started', { port: PORT, address: server.address().address });

    // Try to start SMS scheduler service, but don't fail if Redis is unavailable
    try {
      const started = await SmsSchedulerService.start();
      if (started) {
        logger.info('SMS Scheduler service started');
      } else {
        logger.warn('Application starting without queue service (Redis may be unavailable)');
      }
    } catch (error) {
      logger.error('Failed to start SMS Scheduler service', { error: error.message });
      logger.warn('Application starting without queue service (Redis may be unavailable)');
    }
    earlyLog('Server startup complete');
  });

  // Handle server errors
  server.on('error', (err) => {
    earlyLog('Server error: ' + err.message);
    logger.error('Server error', { error: err });
  });
} catch (error) {
  earlyLog('Failed to start server: ' + error.message + '\n' + error.stack);
  console.error('FATAL: Server startup failed:', error);
  process.exit(1);
}

// Global error handlers
process.on('uncaughtException', (error) => {
  earlyLog('UNCAUGHT EXCEPTION: ' + error.message + '\n' + error.stack);
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  earlyLog('UNHANDLED REJECTION at: ' + promise + ' reason: ' + reason);
  console.error('UNHANDLED REJECTION:', reason);
  // Don't exit - let the app continue
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