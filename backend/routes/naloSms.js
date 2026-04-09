const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { sendSms, sendBulkSms } = require('../controllers/naloSmsController');
const { handleDeliveryReport } = require('../controllers/naloCallbackController');
const { handleDeliveryStatusWebhook } = require('../controllers/webhookController');

// Send single SMS using Nalo API with financial tracking
router.post('/send', authenticate, sendSms);

// Send bulk SMS with financial tracking
router.post('/send-bulk', authenticate, sendBulkSms);

// Receive Nalo delivery reports
router.post('/callback/nalo', handleDeliveryReport);

// Webhook for delivery status updates
router.post('/webhooks/delivery-status', handleDeliveryStatusWebhook);

module.exports = router;
