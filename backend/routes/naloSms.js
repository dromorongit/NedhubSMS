const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { sendSms, sendBulkSms } = require('../controllers/naloSmsController');
const { handleDeliveryReport } = require('../controllers/naloCallbackController');
const { handleDeliveryStatusWebhook } = require('../controllers/webhookController');
const { naloWebhookSecret } = require('../utils/callbackAuth');

// Send single SMS using Nalo API with financial tracking
router.post('/send', authenticate, sendSms);

// Send bulk SMS with financial tracking
router.post('/send-bulk', authenticate, sendBulkSms);

// Receive Nalo delivery reports.
// Secret verification is enforced by naloWebhookSecret when
// NALO_WEBHOOK_SECRET is configured (missing/wrong secret -> 200, not processed).
router.post('/callback/nalo', naloWebhookSecret, handleDeliveryReport);

// Webhook for delivery status updates.
router.post('/webhooks/delivery-status', naloWebhookSecret, handleDeliveryStatusWebhook);

module.exports = router;
