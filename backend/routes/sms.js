const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { sendSMS, checkBalance } = require('../utils/nalo');
const { calculateSMSCost, deductCredits } = require('../utils/billing');
const Message = require('../models/Message');
const SmsMessage = require('../models/SmsMessage');
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

    // Log message in database (legacy Message model)
    const messageId = await Message.create({
      userId,
      senderId,
      messageBody: message,
      recipients,
      status: 'sent'
    });

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

// Get message history - fetch from BOTH Message and SmsMessage models
router.get('/logs', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Fetch from both models
    const [legacyMessages, newMessages] = await Promise.all([
      Message.findByUserId(userId),
      SmsMessage.find({ userId }).sort({ createdAt: -1 })
    ]);
    
    // Transform messages to have consistent format
    const transformMessage = (msg, source) => {
      if (source === 'legacy') {
        return {
          _id: msg._id,
          senderId: msg.senderId,
          recipient: Array.isArray(msg.recipients) ? msg.recipients[0] : msg.recipients,
          recipients: msg.recipients,
          message: msg.messageBody,
          status: msg.status,
          createdAt: msg.createdAt,
          source: 'legacy'
        };
      } else {
        return {
          _id: msg._id,
          senderId: msg.senderId,
          recipient: msg.msisdn,
          recipients: msg.recipientsCount,
          message: msg.message,
          status: msg.status,
          createdAt: msg.createdAt,
          jobId: msg.jobId,
          errorCode: msg.errorCode,
          errorMessage: msg.errorMessage,
          totalChargedToUser: msg.totalChargedToUser,
          source: 'new'
        };
      }
    };
    
    // Combine and sort by date
    const allMessages = [
      ...legacyMessages.map(msg => transformMessage(msg, 'legacy')),
      ...newMessages.map(msg => transformMessage(msg, 'new'))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(allMessages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Nalo callback endpoint for delivery reports
router.post('/callback', async (req, res) => {
  try {
    const { messageId, status, recipient } = req.body;

    // Update message status in database (legacy)
    await Message.updateStatus(messageId, status);

    // Also try to update in new model if needed
    if (messageId) {
      await SmsMessage.findOneAndUpdate(
        { jobId: messageId },
        { status: status }
      );
    }

    res.json({ message: 'Callback processed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
