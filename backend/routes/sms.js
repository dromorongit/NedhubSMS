const express = require('express');
const router = express.Router();
const { MAX_SMS_RECIPIENTS } = require('../utils/constants');
const { authenticate } = require('../middleware/auth');
const { checkBalance } = require('../utils/nalo');
const Message = require('../models/Message');
const SmsMessage = require('../models/SmsMessage');
const NaloSmsService = require('../services/NaloSmsService');
const validator = require('validator');
const logger = require('../utils/logger');

// Send SMS (handles both single and multiple recipients)
// Supports both string phone numbers and canonical recipient objects {recipientName, phoneNumber}
router.post('/send', authenticate, async (req, res) => {
  try {
    const { senderId, recipients, message } = req.body;
    const userId = req.user.userId;

    console.log('[SmsSend]', {
      userId,
      senderId,
      recipientCount: recipients?.length || 0,
      hasMessage: !!message
    });

    // Validate input
    if (!senderId || !recipients || !message) {
      return res.status(400).json({
        success: false,
        message: 'Sender ID, recipients, and message are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Validate recipients format
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Recipients must be a non-empty array',
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

    // NaloSmsService handles wallet deduction internally, so we don't need to deduct here
    // Check Nalo SMS balance
    const naloBalance = await checkBalance();
    if (naloBalance <= 0) {
      return res.status(402).json({
        success: false,
        message: 'Insufficient SMS balance with provider',
        error: { code: 'INSUFFICIENT_PROVIDER_BALANCE' }
      });
    }

    // Normalize recipients to canonical schema
    const normalizedRecipients = recipients.map(r => {
      if (typeof r === 'string') {
        return { phoneNumber: r, recipientName: '' };
      }
      return {
        id: r.id,
        recipientName: r.recipientName ?? '',
        phoneNumber: r.phoneNumber || String(r),
        normalizedPhoneNumber: r.normalizedPhoneNumber || '',
        source: r.source || ''
      };
    });

    console.log('[SendSMS] Normalized recipients (sample):', normalizedRecipients.slice(0, 3));

    // Send SMS to ALL recipients (not just the first one)
    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const recipient of normalizedRecipients) {
      try {
        // Use NaloSmsService for proper tracking and webhook support
        // Note: NaloSmsService handles wallet deduction internally
        const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
          userId,
          phoneNumber: recipient.phoneNumber,
          senderId,
          message,
          recipientsCount: normalizedRecipients.length
        });
        
        if (smsResult.success) {
          results.push({ 
            recipient: recipient.phoneNumber, 
            recipientName: recipient.recipientName,
            success: true, 
            messageId: smsResult.messageId, 
            jobId: smsResult.jobId 
          });
          successCount++;
        } else {
          results.push({ 
            recipient: recipient.phoneNumber,
            recipientName: recipient.recipientName, 
            success: false, 
            error: smsResult.error 
          });
          failedCount++;
        }
      } catch (error) {
        results.push({ 
          recipient: recipient.phoneNumber,
          recipientName: recipient.recipientName,
          success: false, 
          error: error.message 
        });
        failedCount++;
      }
    }

    console.log('[SendSMS] Completed:', { total: recipients.length, success: successCount, failed: failedCount });

    // Determine overall status: 'sent' if all succeeded, 'partial_success' if some succeeded, 'failed' if none
    let overallStatus;
    if (successCount === recipients.length) {
      overallStatus = 'sent';
    } else if (successCount > 0) {
      overallStatus = 'partial_success';
    } else {
      overallStatus = 'failed';
    }

    // Prepare canonical response data with standardized fields
    const responseData = {
      campaignId: null, // Quick send does not create a campaign
      totalRecipients: recipients.length,
      successfulRecipients: successCount,
      failedRecipients: failedCount,
      status: overallStatus,
      summary: {
        total: recipients.length,
        success: successCount,
        failed: failedCount
      },
      results
    };

    const responsePayload = {
      success: successCount > 0, // Partial success counts as overall success
      message: successCount > 0 ? 'Campaign sent successfully' : 'Campaign failed to send',
      data: responseData
    };
    
    // Structured logging with [SendResult] tag
    console.log('[SendResult]', {
      totalRecipients: responseData.totalRecipients,
      successfulRecipients: responseData.successfulRecipients,
      failedRecipients: responseData.failedRecipients,
      status: overallStatus,
      httpStatus: 200
    });
    
    console.log('[SmsSend] Response:', {
      httpStatus: 200,
      success: responsePayload.success,
      message: responsePayload.message
    });
    
    res.json(responsePayload);
    } catch (error) {
        console.error('[SendSMS] Error:', error);
        
        const errorResponse = {
          success: false,
          message: 'Failed to send SMS',
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            details: error.message
          }
        };
        
        console.log('[SendSMS] Error response:', {
          status: 500,
          success: false,
          message: 'Failed to send SMS',
          contentType: 'application/json'
        });
        
        res.status(500).json(errorResponse);
    }
});
  
  // Schedule default SMS for future sending
  router.post('/schedule', authenticate, async (req, res) => {
    let reservation = null;
    let campaign = null;

    try {
      const { senderId, recipients, message, scheduledAt, timezone } = req.body;
      const userId = req.user.userId;

      logger.info('[Schedule] Received default schedule request', {
        userId,
        senderId,
        recipientCount: recipients?.length || 0,
        scheduledAt,
        timezone
      });

      // Validate required fields
      if (!senderId || !recipients || !message || !scheduledAt) {
        logger.warn('[Schedule] Validation failed: missing required fields', {
          userId,
          hasSenderId: !!senderId,
          hasRecipients: !!recipients,
          hasMessage: !!message,
          hasScheduledAt: !!scheduledAt
        });
        return res.status(400).json({
          success: false,
          message: 'Sender ID, recipients, message, and schedule time are required',
          error: { code: 'VALIDATION_ERROR' }
        });
      }
  
      // Validate recipients format
      if (!Array.isArray(recipients) || recipients.length === 0) {
        logger.warn('[Schedule] Invalid recipients format', { userId, recipientsType: typeof recipients });
        return res.status(400).json({
          success: false,
          message: 'Recipients must be a non-empty array',
          error: { code: 'VALIDATION_ERROR' }
        });
      }

      // Enforce maximum recipient limit for safety
      if (recipients.length > MAX_SMS_RECIPIENTS) {
        logger.warn('[Schedule] Recipient limit exceeded', { userId, count: recipients.length, limit: MAX_SMS_RECIPIENTS });
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_SMS_RECIPIENTS} recipients allowed per campaign`,
          error: { code: 'VALIDATION_ERROR', limit: MAX_SMS_RECIPIENTS }
        });
      }

      // Validate scheduled time and convert to UTC
      const scheduledUtc = new Date(scheduledAt);
      if (isNaN(scheduledUtc.getTime())) {
        logger.warn('[Schedule] Invalid scheduled time format', { userId, scheduledAt });
        return res.status(400).json({
          success: false,
          message: 'Invalid scheduled time format',
          error: { code: 'VALIDATION_ERROR' }
        });
      }
   
      // Ensure scheduled time is in the future (using UTC)
      if (scheduledUtc <= new Date()) {
        logger.warn('[Schedule] Scheduled time must be in the future', {
          userId,
          scheduledAt: scheduledUtc.toISOString(),
          now: new Date().toISOString()
        });
        return res.status(400).json({
          success: false,
          message: 'Scheduled time must be in the future',
          error: { code: 'VALIDATION_ERROR' }
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

      // Normalize recipients from various formats to canonical schema
    const normalizedRecipients = recipients.map(r => {
      if (typeof r === 'string') {
        return { phoneNumber: r, recipientName: '' };
      }
      return {
        id: r.id,
        recipientName: r.recipientName ?? '',
        phoneNumber: r.phoneNumber || String(r),
        normalizedPhoneNumber: r.normalizedPhoneNumber || '',
        source: r.source || ''
      };
    });

    // Process recipients (deduplication, validation, blacklist check)
    const SmsRecipientService = require('../services/SmsRecipientService');
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      normalizedRecipients,
      userId,
      true
    );

      logger.info('[Schedule] Recipient processing complete', {
        userId,
        originalCount: processedRecipients.originalCount,
        finalCount: processedRecipients.finalCount,
        duplicateCount: processedRecipients.duplicateCount,
        invalidCount: processedRecipients.invalidRecipients.length,
        blacklistedCount: processedRecipients.blacklistedRecipients.length
      });

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
          success: false,
          message: 'No valid recipients found after processing',
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

      // Validate message length (max 160 characters)
      if (message.length > 160) {
        logger.warn('[Schedule] Message too long', { userId, length: message.length });
        return res.status(400).json({
          success: false,
          message: 'Message exceeds maximum length of 160 characters',
          error: { code: 'VALIDATION_ERROR' }
        });
      }

      // Check Nalo SMS balance
      const { checkBalance } = require('../utils/nalo');
      const naloBalance = await checkBalance();
      if (naloBalance <= 0) {
        logger.warn('[Schedule] Insufficient Nalo SMS balance', { userId });
        return res.status(402).json({
          success: false,
          message: 'Insufficient SMS balance with provider',
          error: { code: 'INSUFFICIENT_PROVIDER_BALANCE' }
        });
      }

      // Calculate cost estimation based on valid recipients
      const CostCalculatorService = require('./CostCalculatorService');
      const costEstimation = await CostCalculatorService.calculateLiveCost(
        userId,
        message,
        processedRecipients.finalCount,
        null
      );

      logger.info('[Schedule] Cost calculated', {
        userId,
        recipientCount: processedRecipients.finalCount,
        estimatedCost: costEstimation.estimatedCost,
        totalSegments: costEstimation.totalSegments
      });

      // Check wallet balance
      const WalletService = require('../services/WalletService');
      const availableBalance = await WalletService.getAvailableBalance(userId);
      if (availableBalance < costEstimation.estimatedCost) {
        logger.warn('[Schedule] Insufficient wallet balance', {
          userId,
          required: costEstimation.estimatedCost,
          available: availableBalance
        });
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
        amount: costEstimation.estimatedCost
      });
      reservation = await WalletService.reserveFunds(userId, costEstimation.estimatedCost, null);

      // Create campaign
      const SmsCampaign = require('../models/SmsCampaign');
      campaign = new SmsCampaign({
        userId,
        title: `Bulk SMS ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        senderId,
        messageBody: message,
        isPersonalized: false,
        sendMode: 'scheduled',
        scheduledAt: scheduledUtc,
        scheduledTimezone: timezone || 'UTC',
        timezone: timezone || 'UTC',
        status: 'scheduled',
        scheduleStatus: 'scheduled',
        jobId: null,
        recipientCount: processedRecipients.finalCount,
        validRecipientCount: processedRecipients.finalCount,
        invalidRecipientCount: processedRecipients.invalidRecipients.length,
        blacklistedCount: processedRecipients.blacklistedRecipients.length,
        duplicateCount: processedRecipients.duplicateCount,
        queuedCount: processedRecipients.finalCount,
        totalSegments: costEstimation.totalSegments,
        estimatedCost: costEstimation.estimatedCost,
        walletChargeMode: 'reservation',
        walletReservationId: reservation._id
      });

      await campaign.save();

      logger.info('[Schedule] Campaign created and saved', {
        campaignId: campaign._id,
        userId,
        recipientCount: processedRecipients.finalCount,
        estimatedCost: costEstimation.estimatedCost,
        scheduledAt: scheduledUtc.toISOString()
      });

      // Create recipient records for valid recipients
      const SmsRecipient = require('../models/SmsRecipient');
      const sellPrice = await CostCalculatorService.getSellPricePerSms();
      const segmentResult = CostCalculatorService.calculateSegments(message);

      for (const recipient of processedRecipients.validRecipients) {
        const recipientEstimatedCost = sellPrice * segmentResult.segments;
        const smsRecipient = new SmsRecipient({
          campaignId: campaign._id,
          userId,
          recipientName: recipient.recipientName,
          phoneNumber: recipient.phoneNumber,
          normalizedPhoneNumber: recipient.normalizedPhoneNumber,
          personalizedMessage: message,
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
      const SmsSchedulerService = require('./SmsSchedulerService');
      logger.info('[Schedule] Scheduling campaign with BullMQ', {
        campaignId: campaign._id,
        scheduledAt: scheduledUtc.toISOString()
      });
      const job = await SmsSchedulerService.scheduleCampaign(campaign._id, scheduledUtc);
      campaign.jobId = job.id;
      await campaign.save();

      logger.info('[Schedule] Campaign scheduled successfully', {
        campaignId: campaign._id,
        jobId: job.id,
        scheduledAt: scheduledUtc.toISOString()
      });

      const responsePayload = {
        success: true,
        message: 'Campaign scheduled successfully',
        data: {
          campaignId: campaign._id,
          scheduledAt: scheduledUtc.toISOString(),
          timezone: timezone || 'UTC',
          jobId: job.id,
          estimatedCost: costEstimation.estimatedCost,
          recipientCount: processedRecipients.originalCount,
          validRecipientCount: processedRecipients.finalCount,
          totalRecipients: processedRecipients.finalCount,
          invalidRecipientCount: processedRecipients.invalidRecipients.length,
          blacklistedCount: processedRecipients.blacklistedRecipients.length,
          duplicateCount: processedRecipients.duplicateCount,
          reservationId: reservation._id
        }
      };
      
      // Log send response with canonical counts
      console.log('[SendResponse]', {
        campaignId: campaign._id,
        totalRecipients: processedRecipients.finalCount,
        status: 'scheduled'
      });
      
      console.log('[Schedule] Response:', {
        status: 201,
        success: responsePayload.success,
        message: responsePayload.message,
        contentType: 'application/json'
      });
      
      res.status(201).json(responsePayload);
  
    } catch (error) {
      // Release reservation if it was made
      if (reservation) {
        try {
          const WalletService = require('../services/WalletService');
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
          const SmsCampaign = require('../models/SmsCampaign');
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

      logger.error('[Schedule] Error scheduling SMS', {
        userId: req.user?.userId,
        error: error.message,
        stack: error.stack
      });
      
      const errorResponse = {
        success: false,
        message: 'Failed to schedule SMS',
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          details: error.message
        }
      };
      
      console.log('[Schedule] Error response:', {
        status: 500,
        success: false,
        message: 'Failed to schedule SMS',
        contentType: 'application/json'
      });
      
      res.status(500).json(errorResponse);
    }
  });

// Get message history - fetch from ALL three models: Message, SmsMessage, and SmsRecipient
router.get('/logs', authenticate, async (req, res) => {
  const logger = require('../utils/logger');
  const startTime = Date.now();
  
  try {
    const userId = req.user.userId;
    const mongoose = require('mongoose');
    const userIdObj = new mongoose.Types.ObjectId(userId);
    
    logger.info('[MessageHistory] Fetching message history', { userId });
    
    // Fetch from all three models
    const [legacyMessages, newMessages, recipients] = await Promise.all([
      Message.findByUserId(userId),
      SmsMessage.find({ userId }).sort({ createdAt: -1 }),
      require('../models/SmsRecipient').find({ userId: userIdObj }).sort({ createdAt: -1 })
    ]);
    
    logger.info('[MessageHistory] Data fetched', {
      userId,
      legacyCount: legacyMessages.length,
      newCount: newMessages.length,
      recipientCount: recipients.length
    });
    
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
          recipient: msg.phoneNumber,
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
          errorCode: msg.errorMessage,
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
    
    // Calculate summary using canonical statuses
    const summary = {
      total: allMessages.length,
      sent: allMessages.filter(m => m.status === 'sent').length,
      delivered: allMessages.filter(m => m.status === 'delivered').length,
      failed: allMessages.filter(m => m.status === 'failed').length,
      scheduled: allMessages.filter(m => m.status === 'scheduled').length,
      queued: allMessages.filter(m => m.status === 'queued').length
    };
    
    logger.info('[MessageHistory] History retrieved', {
      userId,
      total: summary.total,
      sent: summary.sent,
      delivered: summary.delivered,
      failed: summary.failed,
      scheduled: summary.scheduled,
      durationMs: Date.now() - startTime
    });
    
    res.json({
      success: true,
      message: 'Messages fetched successfully',
      data: {
        messages: allMessages,
        summary
      }
    });
  } catch (error) {
    logger.error('[MessageHistory] Error fetching history', {
      userId: req.user?.userId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve message logs',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Calculate live SMS cost estimation
router.get('/calculate-cost', authenticate, async (req, res) => {
  try {
    const { message, recipients, salutation, customSalutation } = req.query;
    const userId = req.user.userId;

    // Validate input
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    const recipientCount = parseInt(recipients) || 1;

    if (recipientCount < 1 || recipientCount > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Recipient count must be between 1 and 10000',
        error: { code: 'VALIDATION_ERROR' }
      });
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

    res.json({
      success: true,
      message: 'Cost calculated successfully',
      data: costEstimation
    });
  } catch (error) {
    console.error('Cost calculation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate cost',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
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
  const logger = require('../utils/logger').createTaggedLogger('[ResendLogic]');
  const startTime = Date.now();
  
  try {
    const { messageId } = req.body;
    const userId = req.user.userId;

    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Message ID is required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Try to find the message in all three models
    let messageData = null;
    let source = null;

    // Check in SmsMessage (new model)
    messageData = await SmsMessage.findOne({ _id: messageId, userId });
    if (messageData) source = 'new';

    // Check in SmsRecipient
    if (!messageData) {
      const mongoose = require('mongoose');
      messageData = await require('../models/SmsRecipient').findOne({
        _id: new mongoose.Types.ObjectId(messageId),
        userId: new mongoose.Types.ObjectId(userId)
      });
      if (messageData) source = 'recipient';
    }

    // Check in legacy Message
    if (!messageData) {
      const legacy = await Message.findByUserId(userId);
      const found = legacy.find(m => m._id.toString() === messageId);
      if (found) {
        messageData = found;
        source = 'legacy';
      }
    }

    if (!messageData) {
      return res.status(404).json({
        success: false,
        message: 'Message not found',
        error: { code: 'NOT_FOUND' }
      });
    }

    // CRITICAL: Only allow resending FAILED messages
    if (messageData.status !== 'failed') {
      logger.warn('Resend attempted on non-failed message', {
        messageId,
        source,
        currentStatus: messageData.status,
        userId
      });
      return res.status(400).json({
        success: false,
        message: `Only failed messages can be resent. Current status: ${messageData.status}`,
        error: { code: 'INVALID_STATUS_FOR_RESEND' }
      });
    }

    // Extract message details based on source
    let senderId, recipient, messageText;
    
    if (source === 'legacy') {
      senderId = messageData.senderId;
      recipient = Array.isArray(messageData.recipients) ? messageData.recipients[0] : messageData.recipients;
      messageText = messageData.messageBody;
    } else if (source === 'new') {
      senderId = messageData.senderId;
      recipient = messageData.phoneNumber;
      messageText = messageData.message;
    } else {
      senderId = messageData.senderId || 'Campaign';
      recipient = messageData.phoneNumber;
      messageText = messageData.personalizedMessage;
    }

    if (!senderId || !recipient || !messageText) {
      return res.status(400).json({
        success: false,
        message: 'Incomplete message data. Cannot resend.',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Check wallet balance
    const User = require('../models/User');
    const user = await User.findById(userId);
    if (!user || user.walletBalance <= 0) {
      return res.status(402).json({
        success: false,
        message: 'Insufficient wallet balance. Please top up your wallet.',
        error: { code: 'INSUFFICIENT_BALANCE' }
      });
    }

    logger.info('Resending failed message', {
      messageId,
      source,
      userId,
      recipient,
      senderId
    });

    // Resend the message using NaloSmsService
    const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
      userId,
      phoneNumber: recipient,
      senderId,
      message: messageText,
      recipientsCount: 1
    });

    if (smsResult.success) {
      logger.info('Resend successful', {
        messageId,
        newMessageId: smsResult.messageId,
        jobId: smsResult.jobId,
        durationMs: Date.now() - startTime
      });
      res.json({
        success: true,
        message: 'Message resent successfully',
        data: {
          newMessageId: smsResult.messageId,
          jobId: smsResult.jobId
        }
      });
    } else {
      logger.error('Resend failed', {
        messageId,
        error: smsResult.error,
        userId
      });
      res.status(400).json({
        success: false,
        message: smsResult.error || 'Failed to resend message',
        error: { code: 'SMS_SEND_FAILED' }
      });
    }
  } catch (error) {
    logger.error('Resend exception', {
      messageId: req.body?.messageId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Failed to resend message',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Schedule default SMS campaign (bulk messaging)
router.post('/schedule', authenticate, async (req, res) => {
  try {
    const { senderId, recipients, message, scheduledAt, timezone = 'UTC' } = req.body;
    const userId = req.user.userId;

     // Validate required fields
     if (!senderId || !recipients || !message || !scheduledAt) {
       return res.status(400).json({
         success: false,
         message: 'Sender ID, recipients, message, and schedule time are required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

// Validate recipients format
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Recipients must be a non-empty array',
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

      // Validate scheduled time
     const scheduleDate = new Date(scheduledAt);
     if (isNaN(scheduleDate.getTime())) {
       return res.status(400).json({
         success: false,
         message: 'Invalid scheduled time format',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
     if (scheduleDate <= new Date()) {
       return res.status(400).json({
         success: false,
         message: 'Scheduled time must be in the future',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Validate sender ID
     const SenderId = require('../models/SenderId');
     const validSender = await SenderId.findOne({ senderId, userId, status: 'approved' });
     if (!validSender) {
       return res.status(400).json({
         success: false,
         message: 'Invalid or unapproved Sender ID',
         error: { code: 'INVALID_SENDER_ID' }
       });
     }

    // Normalize and validate recipients using canonical schema
    const naloSmsService = new (require('../services/NaloSmsService'))();
    const validRecipients = [];
    const invalidRecipients = [];

    logger.info('[Schedule] Validating and normalizing recipients:', {
      userId,
      totalRecipients: recipients.length
    });

    for (const recipient of recipients) {
      // Extract name and phone from various input formats
      let recipientName = '';
      let phoneNumber;

      if (typeof recipient === 'string') {
        recipientName = '';
        phoneNumber = recipient;
      } else {
        recipientName = recipient.recipientName ?? '';
        phoneNumber = recipient.phoneNumber || String(recipient);
      }

      // Normalize phone number to canonical 233XXXXXXXXX format
      let normalizedPhone = String(phoneNumber).replace(/\D/g, '');
      if (normalizedPhone.startsWith('233') && normalizedPhone.length === 12) {
        // Already in international format
      } else if (normalizedPhone.startsWith('0') && normalizedPhone.length === 10) {
        normalizedPhone = '233' + normalizedPhone.substring(1);
      } else if (normalizedPhone.length === 9) {
        normalizedPhone = '233' + normalizedPhone;
      }

      if (naloSmsService.validateMsisdn(normalizedPhone)) {
        validRecipients.push({
          recipientName,
          phoneNumber: normalizedPhone,
          normalizedPhoneNumber: normalizedPhone
        });
      } else {
        invalidRecipients.push(recipient);
      }
    }

    logger.info('[Schedule] Recipient validation complete:', {
      validCount: validRecipients.length,
      invalidCount: invalidRecipients.length
    });

    if (validRecipients.length === 0) {
      return res.status(400).json({
        error: 'No valid phone numbers found',
        invalidCount: invalidRecipients.length
      });
    }

    // Calculate cost estimation
    const CostCalculatorService = require('../services/CostCalculatorService');
    const costEstimation = await CostCalculatorService.calculateLiveCost(
      userId,
      message,
      validRecipients.length,
      null
    );

    // Check wallet balance
    const WalletService = require('../services/WalletService');
    const availableBalance = await WalletService.getAvailableBalance(userId);
    if (availableBalance < costEstimation.estimatedCost) {
      return res.status(402).json({
        error: 'Insufficient available balance',
        required: costEstimation.estimatedCost,
        available: availableBalance
      });
    }

    // Reserve funds
    const reservation = await WalletService.reserveFunds(userId, costEstimation.estimatedCost, null);

    // Create campaign
    const SmsCampaign = require('../models/SmsCampaign');
    const campaign = new SmsCampaign({
      userId,
      title: `Bulk SMS - ${new Date().toLocaleString()}`,
      senderId,
      messageBody: message,
      isPersonalized: false,
      sendMode: 'scheduled',
      scheduledAt: scheduleDate,
      scheduledTimezone: timezone,
      timezone: timezone,
      status: 'scheduled',
      scheduleStatus: 'scheduled',
      recipientCount: validRecipients.length,
      validRecipientCount: validRecipients.length,
      invalidRecipientCount: invalidRecipients.length,
      queuedCount: validRecipients.length,
      totalSegments: costEstimation.totalSegments,
      estimatedCost: costEstimation.estimatedCost,
      walletChargeMode: 'reservation',
      walletReservationId: reservation._id
    });

    await campaign.save();

    // Create recipient records with canonical schema
    const SmsRecipient = require('../models/SmsRecipient');
    const sellPrice = await CostCalculatorService.getSellPricePerSms();
    for (const recipient of validRecipients) {
      const segmentResult = CostCalculatorService.calculateSegments(message);
      const recipientEstimatedCost = sellPrice * segmentResult.segments;

      const smsRecipient = new SmsRecipient({
        campaignId: campaign._id,
        userId,
        recipientName: recipient.recipientName ?? '',
        phoneNumber: recipient.phoneNumber,
        normalizedPhoneNumber: recipient.normalizedPhoneNumber,
        personalizedMessage: message,
        segments: segmentResult.segments,
        estimatedCost: Math.round(recipientEstimatedCost * 100) / 100
      });

      await smsRecipient.save();
    }

    // Schedule with BullMQ
    const SmsSchedulerService = require('../services/SmsSchedulerService');
    await SmsSchedulerService.scheduleCampaign(campaign._id, scheduleDate);

    res.json({
      success: true,
      campaignId: campaign._id,
      message: 'Campaign scheduled successfully',
      scheduledAt: scheduleDate,
      timezone,
      jobId: job.id,
      estimatedCost: costEstimation.estimatedCost,
      recipientCount: validRecipients.length,
      validRecipientCount: validRecipients.length,
      invalidRecipientCount: invalidRecipients.length,
      processingSummary: {
        originalCount: recipients.length,
        invalidRemoved: invalidRecipients.length,
        finalCount: validRecipients.length
      }
    });

  } catch (error) {
    console.error('Schedule SMS error:', error);
    res.status(500).json({ error: 'Failed to schedule campaign: ' + error.message });
  }
});

module.exports = router;
