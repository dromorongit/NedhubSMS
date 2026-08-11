const express = require('express');
const router = express.Router();
const { MAX_SMS_RECIPIENTS, MAX_SMS_SEGMENTS } = require('../utils/constants');
const { authenticate } = require('../middleware/auth');
const { checkBalance } = require('../utils/nalo');
const Message = require('../models/Message');
const SmsMessage = require('../models/SmsMessage');
const NaloSmsService = require('../services/NaloSmsService');
const CostCalculatorService = require('../services/CostCalculatorService');
const validator = require('validator');
const logger = require('../utils/logger');

// Send SMS (handles both single and multiple recipients)
// Supports both string phone numbers and canonical recipient objects {recipientName, phoneNumber}
router.post('/send', authenticate, async (req, res) => {
  try {
    const { senderId, recipients, message, removeDuplicates = true } = req.body;
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

    const trimmedMessage = message.trim();

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

    // Message segment validation (multipart SMS supported)
    const segmentResult = CostCalculatorService.calculateSegments(trimmedMessage);
    if (segmentResult.segments > MAX_SMS_SEGMENTS) {
      return res.status(400).json({
        success: false,
        message: `Message exceeds maximum of ${MAX_SMS_SEGMENTS} SMS segments (${segmentResult.segments} segments calculated for ${segmentResult.charCount} ${segmentResult.encoding} characters)`,
        error: { code: 'VALIDATION_ERROR', segments: segmentResult.segments, maxSegments: MAX_SMS_SEGMENTS }
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

    // Wallet balance check
    const WalletService = require('../services/WalletService');
    let availableBalance = await WalletService.getAvailableBalance(userId);
    if (availableBalance < 0.01) {
      return res.status(402).json({
        success: false,
        message: 'Insufficient wallet balance',
        error: { code: 'INSUFFICIENT_BALANCE' }
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

    // Deduplicate recipients to avoid duplicate SMS sends and charges
    const SmsRecipientService = require('../services/SmsRecipientService');
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      normalizedRecipients,
      userId,
      removeDuplicates !== false
    );

    console.log('[SendSMS] Recipient processing complete', {
      originalCount: processedRecipients.originalCount,
      duplicateCount: processedRecipients.duplicateCount,
      invalidCount: processedRecipients.invalidRecipients.length,
      blacklistedCount: processedRecipients.blacklistedRecipients.length,
      finalCount: processedRecipients.finalCount
    });

    // Use only valid, unique recipients for sending
    const recipientsToSend = processedRecipients.validRecipients;

    if (recipientsToSend.length === 0) {
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

    // Validate total wallet balance before sending to avoid partial sends
    const totalCostEstimation = await CostCalculatorService.calculateLiveCost(
      userId,
      trimmedMessage,
      recipientsToSend.length,
      null
    );
    availableBalance = await WalletService.getAvailableBalance(userId);
    if (availableBalance < totalCostEstimation.estimatedCost) {
      return res.status(402).json({
        success: false,
        message: 'Insufficient available balance for this send',
        error: {
          code: 'INSUFFICIENT_BALANCE',
          required: totalCostEstimation.estimatedCost,
          available: availableBalance
        }
      });
    }

    // Send SMS to ALL recipients with bounded parallelism (CHUNK_SIZE = 10)
    const results = [];
    let successCount = 0;
    let failedCount = 0;

    const CHUNK_SIZE = 10;
    const chunks = [];
    for (let i = 0; i < recipientsToSend.length; i += CHUNK_SIZE) {
      chunks.push(recipientsToSend.slice(i, i + CHUNK_SIZE));
    }

    const circuitBreakerStatus = NaloSmsService.getCircuitBreakerStatus();
    console.log('[SendSMS] Circuit breaker status before send:', circuitBreakerStatus);

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(recipient =>
          NaloSmsService.sendSmsWithFinancialTracking({
            userId,
            phoneNumber: recipient.phoneNumber,
            senderId,
            message: trimmedMessage,
            recipientsCount: 1
          })
        )
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const recipient = chunk[j];
        const chunkResult = chunkResults[j];

        if (chunkResult.status === 'fulfilled') {
          const smsResult = chunkResult.value;
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
              error: smsResult.error,
              errorCode: smsResult.code || 'SMS_SEND_FAILED'
            });
            failedCount++;
          }
        } else {
          results.push({
            recipient: recipient.phoneNumber,
            recipientName: recipient.recipientName,
            success: false,
            error: chunkResult.reason?.message || 'Unknown error',
            errorCode: 'INTERNAL_ERROR'
          });
          failedCount++;
        }
      }
    }

    console.log('[SendSMS] Completed:', { total: recipientsToSend.length, success: successCount, failed: failedCount });

    // Determine overall status: 'sent' if all succeeded, 'partial_success' if some succeeded, 'failed' if none
    let overallStatus;
    if (successCount === recipientsToSend.length) {
      overallStatus = 'sent';
    } else if (successCount > 0) {
      overallStatus = 'partial_success';
    } else {
      overallStatus = 'failed';
    }

    // Aggregate provider errors for forensic diagnostics
    const providerErrorCounts = {};
    let primaryProviderError = null;
    for (const r of results) {
      if (!r.success && r.errorCode) {
        const key = `${r.errorCode}:${r.error || 'Unknown error'}`;
        providerErrorCounts[key] = (providerErrorCounts[key] || 0) + 1;
        if (!primaryProviderError || providerErrorCounts[key] > (providerErrorCounts[`${primaryProviderError.errorCode}:${primaryProviderError.error}`] || 0)) {
          primaryProviderError = { errorCode: r.errorCode, error: r.error, count: providerErrorCounts[key] };
        }
      }
    }

    // Prepare canonical response data with standardized fields
    const responseData = {
      campaignId: null, // Quick send does not create a campaign
      totalRecipients: recipientsToSend.length,
      totalRecipientsBeforeDedup: recipients.length,
      duplicatesRemoved: processedRecipients.duplicateCount,
      invalidRecipients: processedRecipients.invalidRecipients.length,
      blacklistedRecipients: processedRecipients.blacklistedRecipients.length,
      successfulRecipients: successCount,
      failedRecipients: failedCount,
      status: overallStatus,
      summary: {
        total: recipientsToSend.length,
        success: successCount,
        failed: failedCount
      },
      providerErrorSummary: primaryProviderError ? {
        errorCode: primaryProviderError.errorCode,
        error: primaryProviderError.error,
        affectedRecipients: primaryProviderError.count,
        isCommonCause: primaryProviderError.count === failedCount && failedCount > 0
      } : null,
      results
    };

    const responsePayload = {
      success: successCount > 0, // Partial success counts as overall success
      message: successCount > 0 ? 'Campaign sent successfully' : 'Campaign failed to send',
      data: {
        ...responseData,
        circuitBreakerStatus
      }
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
    const { senderId, recipients, message, scheduledAt, timezone, removeDuplicates = true } = req.body;
    const userId = req.user.userId;
    const trimmedMessage = message.trim();

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
      if (scheduledUtc <= new Date(Date.now() + 60000)) {
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

    const SmsRecipientService = require('../services/SmsRecipientService');
    const processedRecipients = await SmsRecipientService.processRecipientsForCampaign(
      normalizedRecipients,
      userId,
      removeDuplicates !== false
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

      // Validate message segments (multipart SMS supported)
      const scheduleSegmentResult = CostCalculatorService.calculateSegments(trimmedMessage);
      if (scheduleSegmentResult.segments > MAX_SMS_SEGMENTS) {
        logger.warn('[Schedule] Message too long', { userId, length: trimmedMessage.length, segments: scheduleSegmentResult.segments });
        return res.status(400).json({
          success: false,
          message: `Message exceeds maximum of ${MAX_SMS_SEGMENTS} SMS segments (${scheduleSegmentResult.segments} segments calculated for ${scheduleSegmentResult.charCount} ${scheduleSegmentResult.encoding} characters)`,
          error: { code: 'VALIDATION_ERROR', segments: scheduleSegmentResult.segments, maxSegments: MAX_SMS_SEGMENTS }
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
      const CostCalculatorService = require('../services/CostCalculatorService');
      const costEstimation = await CostCalculatorService.calculateLiveCost(
        userId,
        trimmedMessage,
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
        messageBody: trimmedMessage,
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
      const segmentResult = CostCalculatorService.calculateSegments(trimmedMessage);

      await SmsRecipient.insertMany(
        processedRecipients.validRecipients.map(r => {
          const recipientEstimatedCost = sellPrice * segmentResult.segments;
          return {
            campaignId: campaign._id,
            userId,
            recipientName: r.recipientName,
            phoneNumber: r.phoneNumber,
            normalizedPhoneNumber: r.normalizedPhoneNumber,
            personalizedMessage: message,
            segments: segmentResult.segments,
            estimatedCost: Math.round(recipientEstimatedCost * 100) / 100
          };
        })
      );

      logger.info('[Schedule] Recipient records created', {
        campaignId: campaign._id,
        count: processedRecipients.finalCount
      });
  
      // Schedule with BullMQ
      const SmsSchedulerService = require('../services/SmsSchedulerService');
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
      SmsMessage.find({ userId: userIdObj }).sort({ createdAt: -1 }),
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
          errorCode: msg.errorCode,
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
    if (req.headers['x-webhook-secret'] !== process.env.NALO_WEBHOOK_SECRET) {
      return res.status(403).json({ success: false, message: 'Unauthorized', error: { code: 'FORBIDDEN' } });
    }

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

module.exports = router;
