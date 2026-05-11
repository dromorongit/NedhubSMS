const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const Template = require('../models/Template');
const SenderId = require('../models/SenderId');
const { calculateSMSCost, deductCredits } = require('../utils/billing');
const { sendSMS } = require('../utils/nalo');
const SmsMessage = require('../models/SmsMessage');

// Create and send campaign
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, senderId, templateId, customMessage, recipients, schedule } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!name || !senderId || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Name, sender ID, and recipients are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Check if Sender ID is approved
    const senderIdDoc = await SenderId.findOne({ userId, senderId });
    if (!senderIdDoc || !senderIdDoc.isApproved()) {
      return res.status(400).json({
        success: false,
        message: 'Sender ID is not approved',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Get message content (from template or custom)
    let messageContent = customMessage;
    if (templateId) {
      const template = await Template.findOne({ _id: templateId, userId });
      if (!template) {
        return res.status(400).json({
          success: false,
          message: 'Template not found',
          error: { code: 'NOT_FOUND' }
        });
      }
      messageContent = template.content;
    } else if (!customMessage) {
      return res.status(400).json({
        success: false,
        message: 'Either template ID or custom message is required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Calculate cost
    const cost = calculateSMSCost(messageContent, recipients.length);

    // Check wallet balance and deduct GHS
    try {
      await deductCredits(userId, cost, `Campaign: ${name}`);
    } catch (error) {
      if (error.message === 'Insufficient balance') {
        return res.status(402).json({
          success: false,
          message: 'Insufficient wallet balance',
          error: { code: 'INSUFFICIENT_BALANCE' }
        });
      }
      if (error.message === 'Daily SMS limit reached') {
        return res.status(429).json({
          success: false,
          message: 'Daily SMS limit reached',
          error: { code: 'DAILY_LIMIT_EXCEEDED' }
        });
      }
      if (error.message === 'Monthly SMS limit reached') {
        return res.status(429).json({
          success: false,
          message: 'Monthly SMS limit reached',
          error: { code: 'MONTHLY_LIMIT_EXCEEDED' }
        });
      }
      throw error;
    }

    // Create campaign
    const campaign = new Campaign({
      userId,
      name,
      senderId,
      templateId: templateId || null,
      customMessage: customMessage || null,
      recipients,
      recipientsCount: recipients.length,
      cost,
      status: schedule ? 'scheduled' : 'sent',
      scheduledAt: schedule ? new Date(schedule) : null,
      sentAt: schedule ? null : new Date()
    });

    await campaign.save();

    // If not scheduled, send immediately
    if (!schedule) {
      try {
        // Send SMS via Nalo API
        const naloResponse = await sendSMS(senderId, recipients, messageContent);

        // Log messages
        for (const recipient of recipients) {
          const segments = Math.ceil(messageContent.length / 160);
          const sellPricePerSms = 0.095;
          const providerCostPerSms = 0.082;
          const totalChargedToUser = sellPricePerSms * segments;
          const totalCostToProvider = providerCostPerSms * segments;
          const profitAmount = totalChargedToUser - totalCostToProvider;
        
          const smsMessage = new SmsMessage({
            userId,
            phoneNumber: recipient,
            senderId,
            message: messageContent,
            status: 'sent',
            sellPricePerSms,
            providerCostPerSms,
            segments,
            recipientsCount: 1,
            totalChargedToUser,
            totalCostToProvider,
            profitAmount
          });
          await smsMessage.save();
        }

        res.json({
          success: true,
          message: 'Campaign sent successfully',
          data: {
            campaignId: campaign._id,
            cost,
            recipientsCount: recipients.length
          }
        });
      } catch (error) {
        // Update campaign status to failed
        campaign.status = 'failed';
        await campaign.save();
        
        console.error('Campaign sending failed:', error);
         res.status(500).json({
           success: false,
           message: 'Failed to send campaign',
           error: {
             code: 'INTERNAL_SERVER_ERROR',
             details: error.message
           },
           data: { campaignId: campaign._id }
         });
      }
    } else {
      res.json({
        success: true,
        message: 'Campaign scheduled successfully',
        data: {
          campaignId: campaign._id,
          scheduledAt: campaign.scheduledAt,
          cost,
          recipientsCount: recipients.length
        }
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get user's campaigns
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const campaigns = await SmsCampaign.findByUserId(userId);

    res.json({
      success: true,
      data: campaigns
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Get specific campaign
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const campaign = await SmsCampaign.findOne({ _id: id, userId });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
        error: { code: 'NOT_FOUND' }
      });
    }

    res.json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

module.exports = router;