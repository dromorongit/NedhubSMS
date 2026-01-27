const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { sendSms } = require('../controllers/naloSmsController');
const { handleDeliveryReport } = require('../controllers/naloCallbackController');

// Send SMS using Nalo API Key
router.post('/send', authenticate, sendSms);

// Receive Nalo delivery reports
router.post('/callback/nalo', handleDeliveryReport);

module.exports = router;