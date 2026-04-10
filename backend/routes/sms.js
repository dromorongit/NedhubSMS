const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { checkBalance } = require('../utils/nalo');
const Message = require('../models/Message');
const SmsMessage = require('../models/SmsMessage');
const NaloSmsService = require('../services/NaloSmsService');
const validator = require('validator');

// Send SMS (handles both single and multiple recipients)
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

    // NaloSmsService handles wallet deduction internally, so we don't need to deduct here
    // Check Nalo SMS balance
    const naloBalance = await checkBalance();
    if (naloBalance <= 0) {
      return res.status(402).json({ error: 'Insufficient SMS balance with provider' });
    }

    // Send SMS to ALL recipients (not just the first one)
    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      try {
        // Use NaloSmsService for proper tracking and webhook support
        // Note: NaloSmsService handles wallet deduction internally
        const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
          userId,
          msisdn: recipient,
          senderId,
          message,
          recipientsCount: 1
        });
        
        if (smsResult.success) {
          results.push({ recipient, success: true, messageId: smsResult.messageId, jobId: smsResult.jobId });
          successCount++;
        } else {
          results.push({ recipient, success: false, error: smsResult.error });
          failedCount++;
        }
      } catch (error) {
        results.push({ recipient, success: false, error: error.message });
        failedCount++;
      }
    }

    res.json({
      success: failedCount === 0,
      summary: {
        total: recipients.length,
        success: successCount,
        failed: failedCount
      },
      results,
      message: failedCount === 0 ? 'SMS sent successfully' : 'Some SMS failed to send'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get message history - fetch from ALL three models: Message, SmsMessage, and SmsRecipient
router.get('/logs', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const mongoose = require('mongoose');
    const userIdObj = new mongoose.Types.ObjectId(userId);
    
    // Fetch from all three models
    const [legacyMessages, newMessages, recipients] = await Promise.all([
      Message.findByUserId(userId),
      SmsMessage.find({ userId }).sort({ createdAt: -1 }),
      require('../models/SmsRecipient').find({ userId: userIdObj }).sort({ createdAt: -1 })
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
      } else if (source === 'new') {
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
      } else {
        // SmsRecipient
        return {
          _id: msg._id,
          senderId: msg.campaignId ? 'Campaign' : 'N/A',
          recipient: msg.phoneNumber,
          recipientName: msg.recipientName,
          message: msg.personalizedMessage,
          status: msg.status,
          createdAt: msg.createdAt,
          errorCode: msg.errorMessage, // maps errorMessage to errorCode for filtering
          errorMessage: msg.errorMessage,
          source: 'recipient'
        };
      }
    };
    
    // Combine all three sources and sort by date
    const allMessages = [
      ...legacyMessages.map(msg => transformMessage(msg, 'legacy')),
      ...newMessages.map(msg => transformMessage(msg, 'new')),
      ...recipients.map(msg => transformMessage(msg, 'recipient'))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(allMessages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calculate live SMS cost estimation
router.get('/calculate-cost', authenticate, async (req, res) => {
  try {
    const { message, recipients, salutation, customSalutation } = req.query;
    const userId = req.user.userId;

    // Validate input
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const recipientCount = parseInt(recipients) || 1;

    if (recipientCount < 1 || recipientCount > 10000) {
      return res.status(400).json({ error: 'Recipient count must be between 1 and 10000' });
    }

    // Prepare personalization data if provided
    const personalizationData = {};
    if (salutation) personalizationData.salutation = salutation;
    if (customSalutation) personalizationData.customSalutation = customSalutation;

    // Calculate cost
    const costCalculator = require('../services/CostCalculatorService');
    const costEstimation = await costCalculator.calculateLiveCost(
      userId,
      message,
      recipientCount,
      Object.keys(personalizationData).length > 0 ? personalizationData : null
    );

    res.json(costEstimation);
  } catch (error) {
    console.error('Cost calculation error:', error);
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

// Resend a failed message
router.post('/resend', authenticate, async (req, res) => {
  try {
    const { messageId } = req.body;
    const userId = req.user.userId;

    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    // Try to find the message in all three models
    let message = await Message.findByUserId(userId).find(m => m._id.toString() === messageId);
    let messageData = null;
    let source = 'legacy';

    // Check in SmsMessage
    if (!messageData) {
      messageData = await SmsMessage.findOne({ _id: messageId, userId });
      source = 'new';
    }

    // Check in SmsRecipient
    if (!messageData) {
      const mongoose = require('mongoose');
      messageData = await require('../models/SmsRecipient').findOne({ _id: new mongoose.Types.ObjectId(messageId), userId: new mongoose.Types.ObjectId(userId) });
      source = 'recipient';
    }

    if (!messageData) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Extract message details based on source
    let senderId, recipient, messageText;
    
    if (source === 'legacy') {
      senderId = messageData.senderId;
      recipient = Array.isArray(messageData.recipients) ? messageData.recipients[0] : messageData.recipients;
      messageText = messageData.messageBody;
    } else if (source === 'new') {
      senderId = messageData.senderId;
      recipient = messageData.msisdn;
      messageText = messageData.message;
    } else {
      senderId = messageData.senderId || 'Campaign';
      recipient = messageData.phoneNumber;
      messageText = messageData.personalizedMessage;
    }

    if (!senderId || !recipient || !messageText) {
      return res.status(400).json({ error: 'Incomplete message data. Cannot resend.' });
    }

    // Check wallet balance
    const User = require('../models/User');
    const user = await User.findById(userId);
    if (!user || user.walletBalance <= 0) {
      return res.status(402).json({ error: 'Insufficient wallet balance. Please top up your wallet.' });
    }

    // Resend the message using NaloSmsService
    const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
      userId,
      msisdn: recipient,
      senderId,
      message: messageText,
      recipientsCount: 1
    });

    if (smsResult.success) {
      res.json({
        success: true,
        message: 'Message resent successfully',
        newMessageId: smsResult.messageId,
        jobId: smsResult.jobId
      });
    } else {
      res.status(400).json({ error: smsResult.error || 'Failed to resend message' });
    }
  } catch (error) {
    console.error('Resend message error:', error);
    res.status(500).json({ error: error.message || 'Failed to resend message' });
  }
});

module.exports = router;
