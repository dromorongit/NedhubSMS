const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const Contact = require('../models/Contact');
const MessagePersonalizationService = require('../services/MessagePersonalizationService');
const NaloSmsService = require('../services/NaloSmsService');
const WalletService = require('../services/WalletService');
const CostCalculatorService = require('../services/CostCalculatorService');
const SmsRecipientService = require('../services/SmsRecipientService');
const SmsSchedulerService = require('../services/SmsSchedulerService');
const SmsCampaignRetryService = require('../services/SmsCampaignRetryService');

// Preview personalized messages
router.post('/preview-personalized', authenticate, async (req, res) => {
  try {
    const {
      messageBody,
      salutation,
      customSalutation,
      sampleRecipients,
      fallbackName
    } = req.body;

    // Validate required fields
    if (!messageBody || !Array.isArray(sampleRecipients) || sampleRecipients.length === 0) {
      return res.status(400).json({
        error: 'Message body and sample recipients are required'
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid message template',
        details: validation.errors
      });
    }

    // Generate preview messages
    const previewMessages = MessagePersonalizationService.generatePreviewMessages(
      messageBody,
      salutation,
      customSalutation,
      sampleRecipients,
      fallbackName
    );

    res.json({
      success: true,
      previewMessages
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Failed to generate preview: ' + error.message });
  }
});

// Preview campaign with duplicate detection
router.post('/preview-campaign', authenticate, async (req, res) => {
  try {
    const {
      title,
      messageBody,
      salutation,
      customSalutation,
      recipients, // Array of {recipientName, phoneNumber}
      senderId,
      removeDuplicates = true
    } = req.body;

    const userId = req.user.userId;

    // Validate required fields
    if (!title || !messageBody || !Array.isArray(recipients) || recipients.length === 0 || !senderId) {
      return res.status(400).json({
        error: 'Title, message body, recipients, and sender ID are required'
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid message template',
        details: validation.errors
      });
    }

    // Process recipients for deduplication and validation
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      recipients,
      userId,
      removeDuplicates
    );

    // Calculate cost estimation based on final valid recipients
    let costEstimation = { totalSegments: 0, estimatedCost: 0 };
    if (processedRecipients.finalCount > 0) {
      costEstimation = await CostCalculatorService.calculateLiveCost(
        userId,
        messageBody,
        processedRecipients.finalCount,
        { salutation, customSalutation }
      );
    }

    // Generate preview messages for first few recipients
    const sampleRecipients = processedRecipients.validRecipients.slice(0, 3);
    const previewMessages = sampleRecipients.length > 0 ?
      MessagePersonalizationService.generatePreviewMessages(
        messageBody,
        salutation,
        customSalutation,
        sampleRecipients,
        ''
      ) : [];

    res.json({
      success: true,
      campaignPreview: {
        title,
        senderId,
        messageBody,
        salutation,
        customSalutation,
        isPersonalized: true,
        sendMode: 'immediate'
      },
      recipientAnalysis: {
        originalCount: processedRecipients.originalCount,
        duplicateCount: processedRecipients.duplicateCount,
        invalidCount: processedRecipients.invalidRecipients.length,
        blacklistedCount: processedRecipients.blacklistedRecipients.length,
        finalValidCount: processedRecipients.finalCount,
        duplicates: processedRecipients.duplicates.slice(0, 10), // Show first 10 duplicates
        invalidRecipients: processedRecipients.invalidRecipients.slice(0, 10), // Show first 10 invalid
        blacklistedRecipients: processedRecipients.blacklistedRecipients.slice(0, 10) // Show first 10 blacklisted
      },
      costEstimation,
      previewMessages,
      canProceed: processedRecipients.finalCount > 0
    });
  } catch (error) {
    console.error('Campaign preview error:', error);
    res.status(500).json({ error: 'Failed to generate campaign preview: ' + error.message });
  }
});

// Send immediate personalized SMS
router.post('/send', authenticate, async (req, res) => {
  try {
    const {
      title,
      messageBody,
      salutation,
      customSalutation,
      recipients, // Array of {recipientName, phoneNumber}
      senderId,
      removeDuplicates = true
    } = req.body;

    const userId = req.user.userId;

    // Validate required fields
    if (!title || !messageBody || !Array.isArray(recipients) || recipients.length === 0 || !senderId) {
      return res.status(400).json({
        error: 'Title, message body, recipients, and sender ID are required'
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid message template',
        details: validation.errors
      });
    }

    // Process recipients for deduplication and validation
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      recipients,
      userId,
      removeDuplicates
    );

    // Check if we have any valid recipients after processing
    if (processedRecipients.finalCount === 0) {
      return res.status(400).json({
        error: 'No valid recipients found after processing. All recipients were either duplicates, invalid, or blacklisted.',
        details: {
          duplicateCount: processedRecipients.duplicateCount,
          invalidCount: processedRecipients.invalidRecipients.length,
          blacklistedCount: processedRecipients.blacklistedRecipients.length
        }
      });
    }

    // Calculate segments and cost based on final valid recipients
    const costEstimation = await CostCalculatorService.calculateLiveCost(
      userId,
      messageBody,
      processedRecipients.finalCount,
      { salutation, customSalutation }
    );

    // Create campaign
    const campaign = new SmsCampaign({
      userId,
      title,
      senderId,
      messageBody,
      salutation,
      customSalutation,
      isPersonalized: true,
      sendMode: 'immediate',
      status: 'processing',
      recipientCount: processedRecipients.finalCount,
      validRecipientCount: processedRecipients.finalCount,
      invalidRecipientCount: processedRecipients.invalidRecipients.length,
      blacklistedCount: processedRecipients.blacklistedRecipients.length,
      duplicateCount: processedRecipients.duplicateCount,
      pendingCount: processedRecipients.finalCount,  // All start as pending
      totalSegments: costEstimation.totalSegments,
      estimatedCost: costEstimation.estimatedCost
    });

    const reservation = await WalletService.reserveFunds(userId, costEstimation.estimatedCost, campaign._id);
    campaign.walletChargeMode = 'reservation';
    campaign.walletReservationId = reservation._id;

    await campaign.save();

    // Process recipients and send messages
    const results = [];
    let successCount = 0;
    let totalCost = 0;

    for (const recipient of processedRecipients.validRecipients) {
      try {
        // Personalize message for this recipient
        const personalizedMessage = MessagePersonalizationService.personalizeMessage(
          messageBody,
          salutation,
          customSalutation,
          recipient.recipientName
        );

        // Calculate segments for this specific personalized message
        const segmentResult = CostCalculatorService.calculateSegments(personalizedMessage);
        const sellPrice = await CostCalculatorService.getSellPricePerSms();
        const recipientEstimatedCost = sellPrice * segmentResult.segments;

        // Create recipient record
        const smsRecipient = new SmsRecipient({
          campaignId: campaign._id,
          userId,
          recipientName: recipient.recipientName,
          phoneNumber: recipient.phoneNumber,
          normalizedPhoneNumber: recipient.normalizedPhoneNumber,
          personalizedMessage,
          segments: segmentResult.segments,
          estimatedCost: Math.round(recipientEstimatedCost * 100) / 100
        });

        await smsRecipient.save();

        // Send SMS
        const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
          userId,
          msisdn: recipient.phoneNumber,
          senderId,
          message: personalizedMessage,
          recipientsCount: 1
        });

        if (smsResult.success) {
          // Mark as sent and store provider message ID for webhook tracking
          await smsRecipient.markAsSent(smsResult.jobId);
          successCount++;
          totalCost += smsResult.financial?.charged || 0;

          results.push({
            recipient: recipient.recipientName,
            phoneNumber: recipient.phoneNumber,
            success: true,
            messageId: smsResult.messageId,
            providerMessageId: smsResult.jobId
          });
        } else {
          await smsRecipient.markAsFailed(smsResult.error);

          results.push({
            recipient: recipient.recipientName,
            phoneNumber: recipient.phoneNumber,
            success: false,
            error: smsResult.error
          });
        }

      } catch (error) {
        console.error('Error sending to recipient:', error);

        results.push({
          recipient: recipient.recipientName,
          phoneNumber: recipient.phoneNumber,
          success: false,
          error: error.message
        });
      }
    }

    // Update campaign status and counts
    const failedCount = processedRecipients.finalCount - successCount;
    campaign.status = successCount === processedRecipients.finalCount ? 'sent' :
                      successCount === 0 ? 'failed' : 'sent'; // Partial success still marked as sent
    campaign.sentCount = successCount;
    campaign.failedCount = failedCount;
    campaign.pendingCount = 0; // All processed
    await campaign.save();

    res.json({
      success: successCount > 0,
      campaignId: campaign._id,
      summary: {
        total: processedRecipients.finalCount,
        success: successCount,
        failed: processedRecipients.finalCount - successCount,
        duplicatesRemoved: processedRecipients.duplicateCount,
        invalidRemoved: processedRecipients.invalidRecipients.length,
        blacklistedRemoved: processedRecipients.blacklistedRecipients.length
      },
      totalCost,
      results
    });

  } catch (error) {
    console.error('Send campaign error:', error);
    res.status(500).json({ error: 'Failed to send campaign: ' + error.message });
  }
});

// Schedule personalized SMS campaign
router.post('/schedule', authenticate, async (req, res) => {
  try {
    const {
      title,
      messageBody,
      salutation,
      customSalutation,
      recipients,
      senderId,
      scheduledAt,
      timezone,
      removeDuplicates = true
    } = req.body;

    const userId = req.user.userId;

    // Validate required fields
    if (!title || !messageBody || !Array.isArray(recipients) || recipients.length === 0 || !senderId || !scheduledAt) {
      return res.status(400).json({
        error: 'Title, message body, recipients, sender ID, and schedule time are required'
      });
    }

    // Validate scheduled time
    const scheduleDate = new Date(scheduledAt);
    if (scheduleDate <= new Date()) {
      return res.status(400).json({
        error: 'Scheduled time must be in the future'
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid message template',
        details: validation.errors
      });
    }

    // Process recipients for deduplication and validation
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      recipients,
      userId,
      removeDuplicates
    );

    // Check if we have any valid recipients after processing
    if (processedRecipients.finalCount === 0) {
      return res.status(400).json({
        error: 'No valid recipients found after processing. All recipients were either duplicates, invalid, or blacklisted.',
        details: {
          duplicateCount: processedRecipients.duplicateCount,
          invalidCount: processedRecipients.invalidRecipients.length,
          blacklistedCount: processedRecipients.blacklistedRecipients.length
        }
      });
    }

    // Calculate segments and cost based on final valid recipients
    const costEstimation = await CostCalculatorService.calculateLiveCost(
      userId,
      messageBody,
      processedRecipients.finalCount,
      { salutation, customSalutation }
    );

    const availableBalance = await WalletService.getAvailableBalance(userId);
    if (availableBalance < costEstimation.estimatedCost) {
      return res.status(402).json({
        error: 'Insufficient available balance',
        required: costEstimation.estimatedCost
      });
    }

    // Create campaign
    const campaign = new SmsCampaign({
      userId,
      title,
      senderId,
      messageBody,
      salutation,
      customSalutation,
      isPersonalized: true,
      sendMode: 'scheduled',
      scheduledAt: scheduleDate,
      timezone: timezone || 'UTC',
      status: 'scheduled',
      recipientCount: processedRecipients.finalCount,
      validRecipientCount: processedRecipients.finalCount,
      invalidRecipientCount: processedRecipients.invalidRecipients.length,
      blacklistedCount: processedRecipients.blacklistedRecipients.length,
      duplicateCount: processedRecipients.duplicateCount,
      pendingCount: processedRecipients.finalCount,  // All start as pending
      totalSegments: costEstimation.totalSegments,
      estimatedCost: costEstimation.estimatedCost
    });

    await campaign.save();

    await SmsSchedulerService.scheduleCampaign(campaign._id, scheduleDate);

    // Create recipient records
    const sellPrice = await CostCalculatorService.getSellPricePerSms();
    for (const recipient of processedRecipients.validRecipients) {
      const personalizedMessage = MessagePersonalizationService.personalizeMessage(
        messageBody,
        salutation,
        customSalutation,
        recipient.recipientName
      );

      // Calculate segments for this specific personalized message
      const segmentResult = CostCalculatorService.calculateSegments(personalizedMessage);
      const recipientEstimatedCost = sellPrice * segmentResult.segments;

      const smsRecipient = new SmsRecipient({
        campaignId: campaign._id,
        userId,
        recipientName: recipient.recipientName,
        phoneNumber: recipient.phoneNumber,
        normalizedPhoneNumber: recipient.normalizedPhoneNumber,
        personalizedMessage,
        segments: segmentResult.segments,
        estimatedCost: Math.round(recipientEstimatedCost * 100) / 100
      });

      await smsRecipient.save();
    }

    res.json({
      success: true,
      campaignId: campaign._id,
      message: 'Campaign scheduled successfully',
      scheduledAt: scheduleDate,
      recipientCount: processedRecipients.finalCount,
      estimatedCost: costEstimation.estimatedCost,
      processingSummary: {
        originalCount: processedRecipients.originalCount,
        duplicatesRemoved: processedRecipients.duplicateCount,
        invalidRemoved: processedRecipients.invalidRecipients.length,
        blacklistedRemoved: processedRecipients.blacklistedRecipients.length,
        finalCount: processedRecipients.finalCount
      }
    });

  } catch (error) {
    console.error('Schedule campaign error:', error);
    res.status(500).json({ error: 'Failed to schedule campaign: ' + error.message });
  }
});

// Get scheduled campaigns
router.get('/scheduled', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const campaigns = await SmsCampaign.findByUserId(userId);
    const scheduledCampaigns = campaigns.filter(c => c.status === 'scheduled' || c.scheduledAt > new Date());

    res.json(scheduledCampaigns);
  } catch (error) {
    console.error('Get scheduled campaigns error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled campaigns' });
  }
});

// Update scheduled campaign
router.patch('/scheduled/:id', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;
    const updates = req.body;

    const campaign = await SmsCampaign.findOne({ _id: campaignId, userId });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (!campaign.canBeCancelled()) {
      return res.status(400).json({ error: 'Campaign cannot be modified' });
    }

    // Validate new schedule time if provided
    if (updates.scheduledAt) {
      const newScheduleDate = new Date(updates.scheduledAt);
      if (newScheduleDate <= new Date()) {
        return res.status(400).json({ error: 'New scheduled time must be in the future' });
      }
      updates.scheduledAt = newScheduleDate;
    }

    // Update campaign
    Object.assign(campaign, updates);
    await campaign.save();

    if (updates.scheduledAt) {
      await SmsSchedulerService.rescheduleCampaign(campaign._id, campaign.scheduledAt);
    }

    res.json({
      success: true,
      campaign
    });

  } catch (error) {
    console.error('Update scheduled campaign error:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// Cancel scheduled campaign
router.delete('/scheduled/:id', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;

    const campaign = await SmsCampaign.findOne({ _id: campaignId, userId });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (!campaign.canBeCancelled()) {
      return res.status(400).json({ error: 'Campaign cannot be cancelled' });
    }

    await SmsSchedulerService.cancelScheduledCampaign(campaignId);

    if (campaign.walletReservationId) {
      await WalletService.releaseReservation(campaign.walletReservationId);
    }

    // Mark all recipients as cancelled (you might want to add a cancelled status)
    await SmsRecipient.updateMany(
      { campaignId },
      { status: 'cancelled' }
    );

    res.json({
      success: true,
      message: 'Campaign cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel campaign error:', error);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
});

// Retry failed recipients from a campaign
router.post('/:id/retry-failed', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;

    const result = await SmsCampaignRetryService.retryFailedRecipients(campaignId, userId);

    res.json(result);
  } catch (error) {
    console.error('Retry failed recipients error:', error);
    res.status(500).json({ error: error.message || 'Failed to retry failed recipients' });
  }
});

// Duplicate campaign with failed recipients
router.post('/:id/duplicate', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;

    const result = await SmsCampaignRetryService.duplicateCampaignWithFailed(campaignId, userId);

    res.json(result);
  } catch (error) {
    console.error('Duplicate campaign error:', error);
    res.status(500).json({ error: error.message || 'Failed to duplicate campaign with failed recipients' });
  }
});

module.exports = router;