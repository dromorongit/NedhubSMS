const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  initiatePayment,
  handleHubtelCallback,
  checkPaymentStatus,
  getPaymentHistory,
  handlePaymentReturn,
  handlePaymentCancelled
} = require('../controllers/paymentController');

/**
 * Payment Routes for Hubtel Online Checkout Integration
 * 
 * All API endpoints require authentication except:
 * - POST /api/payments/hubtel/callback (Hubtel webhook)
 * - GET /api/payments/return (User redirect from Hubtel)
 * - GET /api/payments/cancelled (User cancelled payment)
 */

// Initiate a payment (authenticated)
router.post('/initiate', authenticate, initiatePayment);

// Get payment history (authenticated)
router.get('/history', authenticate, getPaymentHistory);

// Check payment status (authenticated)
router.get('/status/:clientReference', authenticate, checkPaymentStatus);

// Hubtel callback webhook (NO authentication - called by Hubtel)
router.post('/hubtel/callback', handleHubtelCallback);

// Payment return URL (user redirected back after payment)
router.get('/return', handlePaymentReturn);

// Payment cancellation URL (user cancelled payment)
router.get('/cancelled', handlePaymentCancelled);

module.exports = router;
