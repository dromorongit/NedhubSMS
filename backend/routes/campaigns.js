const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const SmsRecipientService = require('../services/SmsRecipientService');
const Template = require('../models/Template');
const SenderId = require('../models/SenderId');
const CostCalculatorService = require('../services/CostCalculatorService');
const WalletService = require('../services/WalletService');
const { sendSMS } = require('../utils/nalo');
const SmsMessage = require('../models/SmsMessage');
const { MAX_SMS_RECIPIENTS } = require('../utils/constants');

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

    // Enforce maximum recipient limit
    if (recipients.length > MAX_SMS_RECIPIENTS) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_SMS_RECIPIENTS} recipients allowed per campaign`,
        error: { code: 'VALIDATION_ERROR', limit: MAX_SMS_RECIPIENTS }
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
    const costEstimation = await CostCalculatorService.calculateLiveCost(
      userId,
      messageContent,
      recipients.length
    );
    const cost = costEstimation.estimatedCost;

    const availableBalance = await WalletService.getAvailableBalance(userId);
    if (availableBalance < cost) {
      return res.status(402).json({
        success: false,
        message: 'Insufficient available balance',
        error: { code: 'INSUFFICIENT_BALANCE', required: cost, available: availableBalance }
      });
    }

    const deductionResult = await WalletService.deductGhsForSms(
      userId,
      costEstimation,
      `Campaign: ${name}`
    );

    // Create campaign
    const campaign = new SmsCampaign({
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
        const costEstimation = await CostCalculatorService.calculateLiveCost(
          userId,
          messageContent,
          recipients.length
        );
        const sellPricePerSms = costEstimation.sellPricePerSms;
        const providerCostPerSms = costEstimation.providerCostPerSms;
        const segmentResult = costEstimation.segments.segments || costEstimation.avgSegments || 1;

        const messageDocs = recipients.map((recipient) => {
          const totalChargedToUser = sellPricePerSms * segmentResult;
          const totalCostToProvider = providerCostPerSms * segmentResult;
          const profitAmount = totalChargedToUser - totalCostToProvider;

          return {
            userId,
            phoneNumber: recipient,
            normalizedPhoneNumber: SmsRecipientService.normalizePhoneNumber(recipient),
            senderId,
            message: messageContent,
            status: 'sent',
            sellPricePerSms,
            providerCostPerSms,
            segments: segmentResult,
            recipientsCount: 1,
            totalChargedToUser,
            totalCostToProvider,
            profitAmount
          };
        });

        // Bulk insert in batches so a very large recipient list (unlimited cap)
        // doesn't send one enormous insertMany payload or block the event loop.
        const INSERT_BATCH_SIZE = 1000;
        for (let i = 0; i < messageDocs.length; i += INSERT_BATCH_SIZE) {
          await SmsMessage.insertMany(messageDocs.slice(i, i + INSERT_BATCH_SIZE), { ordered: false });
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