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
const logger = require('../utils/logger');

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
    console.log('[DEBUG] Processing recipients, count:', recipients.length);
    console.log('[DEBUG] First few recipients:', JSON.stringify(recipients.slice(0, 3)));
    console.log('[DEBUG] userId:', userId);
    console.log('[DEBUG] removeDuplicates:', removeDuplicates);
    
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      recipients,
      userId,
      removeDuplicates
    );

    console.log('[DEBUG] Processed recipients result:');
    console.log('  originalCount:', processedRecipients.originalCount);
    console.log('  duplicateCount:', processedRecipients.duplicateCount);
    console.log('  finalCount:', processedRecipients.finalCount);
    console.log('  validRecipients count:', processedRecipients.validRecipients.length);
    console.log('  invalidRecipients count:', processedRecipients.invalidRecipients.length);
    console.log('  blacklistedRecipients count:', processedRecipients.blacklistedRecipients.length);
    if (processedRecipients.invalidRecipients.length > 0) {
      console.log('  invalidRecipients:', JSON.stringify(processedRecipients.invalidRecipients));
    }
    if (processedRecipients.blacklistedRecipients.length > 0) {
      console.log('  blacklistedRecipients:', JSON.stringify(processedRecipients.blacklistedRecipients));
    }

    // Check if we have any valid recipients after processing
    if (processedRecipients.finalCount === 0) {
      console.log('[DEBUG] No valid recipients found - returning 400 error');
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
  let reservation = null;
  let campaign = null;

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

    logger.info('[Schedule] Received personalized schedule request', {
      userId,
      senderId,
      recipientCount: recipients?.length || 0,
      scheduledAt,
      timezone
    });

    // Validate required fields
    if (!title || !messageBody || !Array.isArray(recipients) || recipients.length === 0 || !senderId || !scheduledAt) {
      logger.warn('[Schedule] Validation failed: missing required fields', {
        userId,
        hasTitle: !!title,
        hasMessageBody: !!messageBody,
        hasRecipients: Array.isArray(recipients) && recipients.length > 0,
        hasSenderId: !!senderId,
        hasScheduledAt: !!scheduledAt
      });
      return res.status(400).json({
        error: 'Title, message body, recipients, sender ID, and schedule time are required'
      });
    }

    // Validate sender ID exists and is approved
    const SenderId = require('../models/SenderId');
    const sender = await SenderId.findOne({ senderId, userId, status: 'approved' });
    if (!sender) {
      logger.warn('[Schedule] Sender ID validation failed', { userId, senderId });
      return res.status(400).json({
        error: 'Sender ID not found or not approved. Please use an approved Sender ID.'
      });
    }

    // Validate message body length (max 160 characters)
    if (messageBody.length > 160) {
      logger.warn('[Schedule] Message too long', { userId, length: messageBody.length });
      return res.status(400).json({ error: 'Message exceeds maximum length of 160 characters' });
    }

    // Validate scheduled time
    const scheduleDate = new Date(scheduledAt);
    if (isNaN(scheduleDate.getTime())) {
      logger.warn('[Schedule] Invalid scheduled time format', { userId, scheduledAt });
      return res.status(400).json({
        error: 'Invalid scheduled time format'
      });
    }
    if (scheduleDate <= new Date()) {
      logger.warn('[Schedule] Scheduled time must be in the future', {
        userId,
        scheduledAt,
        now: new Date().toISOString()
      });
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
      logger.warn('[Schedule] No valid recipients after processing', {
        userId,
        originalCount: processedRecipients.originalCount,
        duplicateCount: processedRecipients.duplicateCount,
        invalidCount: processedRecipients.invalidRecipients.length,
        blacklistedCount: processedRecipients.blacklistedRecipients.length
      });
      return res.status(400).json({
        error: 'No valid recipients found after processing. All recipients were either duplicates, invalid, or blacklisted.',
        details: {
          duplicateCount: processedRecipients.duplicateCount,
          invalidCount: processedRecipients.invalidRecipients.length,
          blacklistedCount: processedRecipients.blacklistedRecipients.length
        }
      });
    }

    logger.info('[Schedule] Recipient processing complete', {
      userId,
      originalCount: processedRecipients.originalCount,
      finalCount: processedRecipients.finalCount,
      duplicateCount: processedRecipients.duplicateCount,
      invalidCount: processedRecipients.invalidRecipients.length,
      blacklistedCount: processedRecipients.blacklistedRecipients.length
    });

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

    // Reserve funds immediately
    logger.info('[Schedule] Reserving wallet funds', {
      userId,
      amount: costEstimation.estimatedCost,
      campaignTitle: title
    });
    let reservation = await WalletService.reserveFunds(userId, costEstimation.estimatedCost, null);

    // Create campaign
    campaign = new SmsCampaign({
      userId,
      title,
      senderId,
      messageBody,
      salutation,
      customSalutation,
      isPersonalized: true,
      sendMode: 'scheduled',
      scheduledAt: scheduleDate,
      scheduledTimezone: timezone || 'UTC',
      timezone: timezone || 'UTC',
      status: 'scheduled',
      scheduleStatus: 'scheduled',
      jobId: null, // will be set by scheduler
      recipientCount: processedRecipients.finalCount,
      validRecipientCount: processedRecipients.finalCount,
      invalidRecipientCount: processedRecipients.invalidRecipients.length,
      blacklistedCount: processedRecipients.blacklistedRecipients.length,
      duplicateCount: processedRecipients.duplicateCount,
      pendingCount: processedRecipients.finalCount,  // All start as pending
      totalSegments: costEstimation.totalSegments,
      estimatedCost: costEstimation.estimatedCost,
      walletChargeMode: 'reservation',
      walletReservationId: reservation._id
    });

    await campaign.save();

    logger.info('[Schedule] Campaign created and saved', {
      campaignId: campaign._id,
      userId,
      title,
      recipientCount: processedRecipients.finalCount,
      estimatedCost: costEstimation.estimatedCost,
      scheduledAt: scheduleDate.toISOString()
    });

    // Create recipient records
    const SmsRecipient = require('../models/SmsRecipient');
    const sellPrice = await CostCalculatorService.getSellPricePerSms();
    for (const recipient of processedRecipients.validRecipients) {
      const personalizedMessage = MessagePersonalizationService.personalizeMessage(
        messageBody,
        salutation,
        customSalutation,
        recipient.recipientName
      );

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

    logger.info('[Schedule] Recipient records created', {
      campaignId: campaign._id,
      count: processedRecipients.finalCount
    });

    // Schedule with BullMQ
    logger.info('[Schedule] Scheduling campaign with BullMQ', {
      campaignId: campaign._id,
      scheduledAt: scheduleDate.toISOString()
    });
    const job = await SmsSchedulerService.scheduleCampaign(campaign._id, scheduleDate);
    campaign.jobId = job.id;
    await campaign.save();

    logger.info('[Schedule] Campaign scheduled successfully', {
      campaignId: campaign._id,
      jobId: job.id,
      scheduledAt: scheduleDate.toISOString()
    });

    res.status(201).json({
      success: true,
      campaignId: campaign._id,
      message: 'Campaign scheduled successfully',
      scheduledAt: scheduleDate.toISOString(),
      timezone: timezone || 'UTC',
      jobId: job.id,
      estimatedCost: costEstimation.estimatedCost,
      recipientCount: processedRecipients.originalCount,
      validRecipientCount: processedRecipients.finalCount,
      invalidRecipientCount: processedRecipients.invalidRecipients.length,
      blacklistedCount: processedRecipients.blacklistedRecipients.length,
      duplicateCount: processedRecipients.duplicateCount,
      reservationId: reservation._id,
      processingSummary: {
        originalCount: processedRecipients.originalCount,
        duplicatesRemoved: processedRecipients.duplicateCount,
        invalidRemoved: processedRecipients.invalidRecipients.length,
        blacklistedRemoved: processedRecipients.blacklistedRecipients.length,
        finalCount: processedRecipients.finalCount
      }
    });

  } catch (error) {
    // Release reservation if it was made
    if (reservation) {
      try {
        await WalletService.releaseReservation(reservation._id);
        logger.info('[Schedule] Reservation released due to error', {
          reservationId: reservation._id,
          userId: req.user?.userId
        });
      } catch (releaseError) {
        logger.error('[Schedule] Failed to release reservation', {
          reservationId: reservation._id,
          error: releaseError.message
        });
      }
    }

    // If campaign was already created, mark it as failed
    if (campaign && campaign._id) {
      try {
        const campaignToUpdate = await SmsCampaign.findById(campaign._id);
        if (campaignToUpdate) {
          campaignToUpdate.status = 'failed';
          campaignToUpdate.scheduleStatus = 'failed';
          campaignToUpdate.errorMessage = error.message;
          await campaignToUpdate.save();
          logger.info('[Schedule] Campaign marked as failed', {
            campaignId: campaign._id,
            error: error.message
          });
        }
      } catch (updateError) {
        logger.error('[Schedule] Failed to update campaign status', {
          campaignId: campaign._id,
          error: updateError.message
        });
      }
    }

    logger.error('[Schedule] Error scheduling campaign', {
      userId: req.user?.userId,
      error: error.message,
      stack: error.stack
    });
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