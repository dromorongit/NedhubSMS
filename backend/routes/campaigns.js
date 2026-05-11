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
      return res.status(400).json({ error: 'Name, sender ID, and recipients are required' });
    }

    // Check if Sender ID is approved
    const senderIdDoc = await SenderId.findOne({ userId, senderId });
    if (!senderIdDoc || !senderIdDoc.isApproved()) {
      return res.status(400).json({ error: 'Sender ID is not approved' });
    }

    // Get message content (from template or custom)
    let messageContent = customMessage;
    if (templateId) {
      const template = await Template.findOne({ _id: templateId, userId });
      if (!template) {
        return res.status(400).json({ error: 'Template not found' });
      }
      messageContent = template.content;
    } else if (!customMessage) {
      return res.status(400).json({ error: 'Either template ID or custom message is required' });
    }

    // Calculate cost
    const cost = calculateSMSCost(messageContent, recipients.length);

    // Check wallet balance and deduct GHS
    try {
      await deductCredits(userId, cost, `Campaign: ${name}`);
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
          message: 'Campaign sent successfully',
          campaignId: campaign._id,
          cost,
          recipientsCount: recipients.length
        });
      } catch (error) {
        // Update campaign status to failed
        campaign.status = 'failed';
        await campaign.save();
        
        console.error('Campaign sending failed:', error);
        res.status(500).json({ 
          error: 'Failed to send campaign',
          campaignId: campaign._id
        });
      }
    } else {
      res.json({
        message: 'Campaign scheduled successfully',
        campaignId: campaign._id,
        scheduledAt: campaign.scheduledAt,
        cost,
        recipientsCount: recipients.length
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

    res.json(campaigns);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific campaign
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const campaign = await SmsCampaign.findOne({ _id: id, userId });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(campaign);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;