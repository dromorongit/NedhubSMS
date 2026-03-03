const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { sendSMS, checkBalance } = require('../utils/nalo');
const { calculateSMSCost, deductCredits } = require('../utils/billing');
const Message = require('../models/Message');
const validator = require('validator');

// Send SMS
router.post('/send', authenticate, async (req, res) => {
  try {
    const { senderId, recipients, message } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!senderId || !recipients || !message) {
      return res.status(400).json({ error: 'Sender ID, recipients, and message are required' });
    }

    // Validate recipients format
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Recipients must be a non-empty array' });
    }

    // Calculate SMS cost
    const cost = calculateSMSCost(message, recipients.length);

    // Check wallet balance and deduct GHS
    try {
      await deductCredits(userId, cost, `SMS send: ${recipients.length} recipients`);
    } catch (error) {
      if (error.message === 'Insufficient balance') {
        return res.status(402).json({ error: 'Insufficient wallet balance' });
      }
      if (error.message === 'Daily SMS limit reached') {
        return res.status(429).json({ error: 'Daily SMS limit reached' });
      }
      if (error.message === 'Monthly SMS limit reached') {
        return res.status(429).json({ error: 'Monthly SMS limit reached' });
      }
      throw error;
    }

    // Check Nalo SMS balance
    const naloBalance = await checkBalance();
    if (naloBalance <= 0) {
      return res.status(402).json({ error: 'Insufficient SMS balance with provider' });
    }

    // Send SMS via Nalo API
    const naloResponse = await sendSMS(senderId, recipients, message);

    // Log message in database
    const messageId = await Message.create(
      userId,
      senderId,
      message,
      JSON.stringify(recipients),
      'sent'
    );

    res.json({
      messageId,
      naloResponse,
      cost,
      message: 'SMS sent successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get message history
router.get('/logs', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const messages = await Message.findByUserId(userId);
    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Nalo callback endpoint for delivery reports
router.post('/callback', async (req, res) => {
  try {
    const { messageId, status, recipient } = req.body;

    // Update message status in database
    await Message.updateStatus(messageId, status);

    res.json({ message: 'Callback processed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;