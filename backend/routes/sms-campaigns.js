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
        success: false,
        message: 'Message body and sample recipients are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message template',
        error: {
          code: 'VALIDATION_ERROR',
          details: validation.errors
        }
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
    res.status(500).json({
      success: false,
      message: 'Failed to generate preview',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
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

    console.log('[Campaign] Preview requested:', {
      userId,
      title,
      recipientsCount: recipients?.length,
      senderId
    });

    // Validate required fields
    if (!title || !messageBody || !Array.isArray(recipients) || recipients.length === 0 || !senderId) {
      return res.status(400).json({
        success: false,
        message: 'Title, message body, recipients, and sender ID are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message template',
        error: {
          code: 'VALIDATION_ERROR',
          details: validation.errors
        }
      });
    }

    // Process recipients for deduplication and validation
    console.log('[Campaign] Processing recipients...');
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
      console.log('[Campaign] Cost estimation:', costEstimation);
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

    console.log('[Campaign] Preview ready:', {
      original: processedRecipients.originalCount,
      valid: processedRecipients.finalCount,
      duplicates: processedRecipients.duplicateCount,
      blacklisted: processedRecipients.blacklistedRecipients.length,
      invalid: processedRecipients.invalidRecipients.length
    });

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
        duplicates: processedRecipients.duplicates.slice(0, 10),
        invalidRecipients: processedRecipients.invalidRecipients.slice(0, 10),
        blacklistedRecipients: processedRecipients.blacklistedRecipients.slice(0, 10)
      },
      costEstimation,
      previewMessages,
      canProceed: processedRecipients.finalCount > 0
    });
  } catch (error) {
    console.error('[Campaign] Preview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate campaign preview',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
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

    console.log('[SmsSend]', {
      userId,
      title,
      recipientsCount: recipients?.length,
      senderId,
      removeDuplicates
    });

    // Validate required fields
    if (!title || !messageBody || !Array.isArray(recipients) || recipients.length === 0 || !senderId) {
      return res.status(400).json({
        success: false,
        message: 'Title, message body, recipients, and sender ID are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message template',
        error: {
          code: 'VALIDATION_ERROR',
          details: validation.errors
        }
      });
    }

    // Process recipients for deduplication and validation
    console.log('[Campaign] Processing recipients...');
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      recipients,
      userId,
      removeDuplicates
    );

    console.log('[Campaign] Recipient processing complete:', {
      original: processedRecipients.originalCount,
      duplicates: processedRecipients.duplicateCount,
      valid: processedRecipients.finalCount,
      invalid: processedRecipients.invalidRecipients.length,
      blacklisted: processedRecipients.blacklistedRecipients.length
    });
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
        success: false,
        message: 'No valid recipients found after processing. All recipients were either duplicates, invalid, or blacklisted.',
        error: {
          code: 'NO_VALID_RECIPIENTS',
          details: {
            duplicateCount: processedRecipients.duplicateCount,
            invalidCount: processedRecipients.invalidRecipients.length,
            blacklistedCount: processedRecipients.blacklistedRecipients.length
          }
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
      queuedCount: processedRecipients.finalCount,  // All start as queued
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
        const SmsRecipient = require('../models/SmsRecipient');
        const networkType = SmsRecipient.detectNetwork(recipient.normalizedPhoneNumber || recipient.phoneNumber);
        const smsRecipient = new SmsRecipient({
          campaignId: campaign._id,
          userId,
          recipientName: recipient.recipientName,
          phoneNumber: recipient.phoneNumber,
          normalizedPhoneNumber: recipient.normalizedPhoneNumber,
          networkType: networkType,
          personalizedMessage,
          segments: segmentResult.segments,
          estimatedCost: Math.round(recipientEstimatedCost * 100) / 100
        });

        await smsRecipient.save();

        // Send SMS
        const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
          userId,
          phoneNumber: recipient.phoneNumber,
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
    // Determine status: all success -> 'sent', all fail -> 'failed', partial -> 'partial_success'
    const newStatus = successCount === processedRecipients.finalCount ? 'sent' :
                      successCount === 0 ? 'failed' : 'partial_success';
    campaign.status = newStatus;
    campaign.sentCount = successCount;
    campaign.failedCount = failedCount;
    campaign.queuedCount = 0; // All processed
    await campaign.save();
    
    // Log campaign status change with [CampaignStatus] tag
    console.log('[CampaignStatus]', {
      campaignId: campaign._id,
      status: campaign.status,
      sentCount: successCount,
      failedCount,
      total: processedRecipients.finalCount
    });

    // Prepare canonical response data with standardized fields
    const responseData = {
      campaignId: campaign._id,
      totalRecipients: processedRecipients.finalCount,
      successfulRecipients: successCount,
      failedRecipients: failedCount,
      status: campaign.status,
      summary: {
        total: processedRecipients.finalCount,
        success: successCount,
        failed: failedCount,
        duplicatesRemoved: processedRecipients.duplicateCount,
        invalidRemoved: processedRecipients.invalidRecipients.length,
        blacklistedRemoved: processedRecipients.blacklistedRecipients.length
      },
      totalCost,
      results
    };

    const responsePayload = {
      success: successCount > 0,
      message: successCount > 0 ? 'Campaign sent successfully' : 'Campaign failed to send',
      data: responseData
    };
    
    // Structured logging with [SendResult] tag
    console.log('[SendResult]', {
      campaignId: campaign._id,
      totalRecipients: responseData.totalRecipients,
      successfulRecipients: responseData.successfulRecipients,
      failedRecipients: responseData.failedRecipients,
      status: campaign.status
    });
    
    console.log('[SmsSend] Response:', {
      httpStatus: 200,
      success: responsePayload.success,
      message: responsePayload.message
    });
    
    res.json(responsePayload);

   } catch (error) {
     console.error('Send campaign error:', error);
     res.status(500).json({
       success: false,
       message: 'Failed to send campaign',
       error: {
         code: 'INTERNAL_SERVER_ERROR',
         details: error.message
       }
     });
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
        success: false,
        message: 'Sender ID not found or not approved. Please use an approved Sender ID.',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Validate message body length (max 160 characters)
    if (messageBody.length > 160) {
      logger.warn('[Schedule] Message too long', { userId, length: messageBody.length });
      return res.status(400).json({
        success: false,
        message: 'Message exceeds maximum length of 160 characters',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Validate scheduled time
    const scheduleDate = new Date(scheduledAt);
    if (isNaN(scheduleDate.getTime())) {
      logger.warn('[Schedule] Invalid scheduled time format', { userId, scheduledAt });
      return res.status(400).json({
        success: false,
        message: 'Invalid scheduled time format',
        error: { code: 'VALIDATION_ERROR' }
      });
    }
    if (scheduleDate <= new Date()) {
      logger.warn('[Schedule] Scheduled time must be in the future', {
        userId,
        scheduledAt,
        now: new Date().toISOString()
      });
      return res.status(400).json({
        success: false,
        message: 'Scheduled time must be in the future',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Validate message template
    const validation = MessagePersonalizationService.validateMessageTemplate(messageBody);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message template',
        error: {
          code: 'VALIDATION_ERROR',
          details: validation.errors
        }
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
        success: false,
        message: 'Insufficient available balance',
        error: {
          code: 'INSUFFICIENT_BALANCE',
          required: costEstimation.estimatedCost,
          available: availableBalance
        }
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
      queuedCount: processedRecipients.finalCount,  // All start as queued
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

      const networkType = SmsRecipient.detectNetwork(recipient.normalizedPhoneNumber || recipient.phoneNumber);
      const smsRecipient = new SmsRecipient({
        campaignId: campaign._id,
        userId,
        recipientName: recipient.recipientName,
        phoneNumber: recipient.phoneNumber,
        normalizedPhoneNumber: recipient.normalizedPhoneNumber,
        networkType: networkType,
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

    const responsePayload = {
      success: true,
      message: 'Campaign scheduled successfully',
      data: {
        campaignId: campaign._id,
        scheduledAt: scheduleDate.toISOString(),
        timezone: timezone || 'UTC',
        jobId: job.id,
        estimatedCost: costEstimation.estimatedCost,
        recipientCount: processedRecipients.originalCount,
        validRecipientCount: processedRecipients.finalCount,
        totalRecipients: processedRecipients.finalCount,
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
      }
    };
    
    // Log send response with canonical counts
    console.log('[SendResponse]', {
      campaignId: campaign._id,
      totalRecipients: processedRecipients.finalCount,
      status: 'scheduled'
    });
    
    console.log('[Schedule] Response:', {
      campaignId: campaign._id,
      status: 201,
      success: true,
      message: 'Campaign scheduled successfully',
      contentType: 'application/json'
    });
    
    res.status(201).json(responsePayload);

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
    
    const errorResponse = {
      success: false,
      message: 'Failed to schedule campaign',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    };
    
    console.log('[Schedule] Error response:', {
      status: 500,
      success: false,
      message: 'Failed to schedule campaign',
      contentType: 'application/json'
    });
    
    res.status(500).json(errorResponse);
  }
});

// Get scheduled campaigns
router.get('/scheduled', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const campaigns = await SmsCampaign.findByUserId(userId);
    const scheduledCampaigns = campaigns.filter(c => c.status === 'scheduled' || c.scheduledAt > new Date());

    res.json({
      success: true,
      data: scheduledCampaigns
    });
   } catch (error) {
     console.error('Get scheduled campaigns error:', error);
     res.status(500).json({
       success: false,
       message: 'Failed to fetch scheduled campaigns',
       error: {
         code: 'INTERNAL_SERVER_ERROR',
         details: error.message
       }
     });
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
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
        error: { code: 'NOT_FOUND' }
      });
    }

    if (!campaign.canBeCancelled()) {
      return res.status(400).json({
        success: false,
        message: 'Campaign cannot be modified',
        error: { code: 'INVALID_STATE' }
      });
    }

    // Validate new schedule time if provided
    if (updates.scheduledAt) {
      const newScheduleDate = new Date(updates.scheduledAt);
      if (newScheduleDate <= new Date()) {
        return res.status(400).json({
          success: false,
          message: 'New scheduled time must be in the future',
          error: { code: 'VALIDATION_ERROR' }
        });
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
      message: 'Campaign updated successfully',
      data: { campaign }
    });

   } catch (error) {
     console.error('Update scheduled campaign error:', error);
     res.status(500).json({
       success: false,
       message: 'Failed to update campaign',
       error: {
         code: 'INTERNAL_SERVER_ERROR',
         details: error.message
       }
     });
   }
});

// Cancel scheduled campaign
router.delete('/scheduled/:id', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;

    const campaign = await SmsCampaign.findOne({ _id: campaignId, userId });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
        error: { code: 'NOT_FOUND' }
      });
    }

    if (!campaign.canBeCancelled()) {
      return res.status(400).json({
        success: false,
        message: 'Campaign cannot be cancelled',
        error: { code: 'INVALID_STATE' }
      });
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
      message: 'Campaign cancelled successfully',
      data: { campaignId: campaignId }
    });

   } catch (error) {
     console.error('Cancel campaign error:', error);
     res.status(500).json({
       success: false,
       message: 'Failed to cancel campaign',
       error: {
         code: 'INTERNAL_SERVER_ERROR',
         details: error.message
       }
     });
   }
});

// Retry failed recipients from a campaign
router.post('/:id/retry-failed', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;

    const result = await SmsCampaignRetryService.retryFailedRecipients(campaignId, userId);

    res.json({
      success: true,
      message: 'Retry operation completed',
      data: result
    });
   } catch (error) {
     console.error('Retry failed recipients error:', error);
     res.status(500).json({
       success: false,
       message: 'Failed to retry failed recipients',
       error: {
         code: 'INTERNAL_SERVER_ERROR',
         details: error.message
       }
     });
   }
});

// Duplicate campaign with failed recipients
router.post('/:id/duplicate', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;

    const result = await SmsCampaignRetryService.duplicateCampaignWithFailed(campaignId, userId);

    res.json({
      success: true,
      message: 'Campaign duplicated successfully',
      data: result
    });
  } catch (error) {
    console.error('Duplicate campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate campaign with failed recipients',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

module.exports = router;