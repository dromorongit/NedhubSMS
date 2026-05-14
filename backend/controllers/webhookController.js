const SmsRecipient = require('../models/SmsRecipient');
const SmsCampaign = require('../models/SmsCampaign');
const SmsMessage = require('../models/SmsMessage');
const SmsRecipientStatusService = require('../services/SmsRecipientStatusService');

/**
 * Handle delivery status webhook from SMS provider (Nalo)
 * POST /api/sms/webhooks/delivery-status
 */
const handleDeliveryStatusWebhook = async (req, res) => {
  const logger = require('../utils/logger');
  const startTime = Date.now();
  
  try {
    const webhookData = req.body;

    // Structured log: webhook received
    logger.info('[DeliveryWebhook] Received delivery status update', {
      messageId: webhookData?.message_id,
      providerStatus: webhookData?.status,
      recipient: webhookData?.recipient,
      timestamp: webhookData?.timestamp
    });

    // Validate webhook payload structure
    if (!webhookData || typeof webhookData !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook payload',
        error: { code: 'INVALID_WEBHOOK_PAYLOAD' }
      });
    }

    const { message_id, status, recipient, timestamp, error_code, error_message } = webhookData;

    if (!message_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: message_id and status',
        error: { code: 'MISSING_REQUIRED_FIELDS' }
      });
    }

    // Normalize status to our internal canonical statuses
    const normalizedStatus = normalizeProviderStatus(status);
    
    if (!normalizedStatus) {
      logger.warn('[StatusMapping] Unknown provider status received', {
        providerStatus: status,
        messageId: message_id
      });
      return res.status(200).json({
        success: true,
        message: 'Unknown status ignored'
      });
    }

    logger.info('[StatusMapping] Mapped provider status to internal', {
      messageId: message_id,
      providerStatus: status,
      internalStatus: normalizedStatus
    });

    // Find the recipient by provider message ID for idempotency check
    const existingRecipient = await SmsRecipient.findOne({ providerMessageId: message_id });
    
    if (existingRecipient) {
      // IDEMPOTENCY CHECK: If status already matches, skip update
      if (existingRecipient.status === normalizedStatus) {
        logger.info('[DeliveryWebhook] Idempotent update - status unchanged', {
          messageId: message_id,
          recipientId: existingRecipient._id,
          currentStatus: existingRecipient.status,
          newStatus: normalizedStatus
        });
        return res.status(200).json({
          success: true,
          message: 'Status already up to date',
          data: { recipientId: existingRecipient._id, status: normalizedStatus }
        });
      }
      
      // STATUS DOWNGRADE PROTECTION: Prevent status regression
      const statusHierarchy = {
        'queued': 1,
        'processing': 2,
        'sent': 3,
        'delivered': 4
        // Note: 'failed', 'scheduled', 'cancelled' are terminal states
      };
      
      const currentLevel = statusHierarchy[existingRecipient.status];
      const newLevel = statusHierarchy[normalizedStatus];
      
      if (currentLevel && newLevel && newLevel < currentLevel) {
        logger.warn('[DeliveryWebhook] Status downgrade prevented', {
          messageId: message_id,
          recipientId: existingRecipient._id,
          oldStatus: existingRecipient.status,
          attemptedStatus: normalizedStatus,
          reason: 'New status is lower in hierarchy than current status'
        });
        // Return success but don't apply downgrade
        return res.status(200).json({
          success: true,
          message: 'Status upgrade ignored - current status is higher',
          data: {
            recipientId: existingRecipient._id,
            status: existingRecipient.status
          }
        });
      }
    }

    // Find and update the recipient
    const result = await SmsRecipientStatusService.updateRecipientStatus({
      providerMessageId: message_id,
      status: normalizedStatus,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      providerStatus: status,
      errorMessage: error_message || (error_code ? `Error ${error_code}` : null)
    });

    if (!result.success) {
      logger.error('[DeliveryWebhook] Failed to update recipient status', {
        messageId: message_id,
        error: result.error
      });
    }

    // Also update the SmsMessage if it exists (for message history sync)
    if (message_id) {
      try {
        const updateData = { status: normalizedStatus };
        if (normalizedStatus === 'delivered') {
          updateData.deliveredAt = timestamp ? new Date(timestamp) : new Date();
        }
        if (normalizedStatus === 'sent') {
          updateData.sentAt = timestamp ? new Date(timestamp) : new Date();
        }
        
        const smsResult = await SmsMessage.findOneAndUpdate(
          { jobId: message_id },
          updateData,
          { new: true }
        );
        
        if (smsResult) {
          logger.info('[DeliveryWebhook] Updated SmsMessage status', {
            messageId: message_id,
            smsMessageId: smsResult._id,
            newStatus: normalizedStatus
          });
        }
      } catch (smsError) {
        logger.error('[DeliveryWebhook] Error updating SmsMessage', {
          messageId: message_id,
          error: smsError.message
        });
      }
    }

    if (!result.success) {
      // If only recipient update failed but SmsMessage update succeeded, still return success
      if (message_id) {
        return res.status(200).json({
          success: true,
          message: 'Delivery status updated (via SmsMessage)'
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to process delivery status update',
        error: { code: 'WEBHOOK_PROCESSING_FAILED' }
      });
    }

    logger.info('[DeliveryWebhook] Successfully updated recipient', {
      messageId: message_id,
      recipientId: result.recipientId,
      oldStatus: result.oldStatus,
      newStatus: result.newStatus,
      durationMs: Date.now() - startTime
    });

    res.status(200).json({
      success: true,
      message: 'Delivery status updated successfully',
      data: {
        recipientId: result.recipientId,
        status: normalizedStatus
      }
    });

  } catch (error) {
    logger.error('[DeliveryWebhook] Unexpected error processing webhook', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: { code: 'INTERNAL_SERVER_ERROR', details: error.message }
    });
  }
};

/**
 * Normalize provider status to internal status
 */
function normalizeProviderStatus(providerStatus) {
  const statusMap = {
    // Nalo statuses - mapped to canonical internal statuses
    'DELIVERED': 'delivered',
    'delivered': 'delivered',
    'SENT': 'sent',
    'sent': 'sent',
    'FAILED': 'failed',
    'failed': 'failed',
    'UNDELIVERED': 'failed',
    'undelivered': 'failed',
    'EXPIRED': 'failed',
    'expired': 'failed',
    'REJECTED': 'failed',
    'rejected': 'failed',
    'PENDING': 'queued',      // Canonical: queued (not pending)
    'pending': 'queued',      // Canonical: queued
    'QUEUED': 'queued',
    'queued': 'queued',
    'PROCESSING': 'processing',
    'processing': 'processing',
    'SCHEDULED': 'scheduled',
    'scheduled': 'scheduled',
    'CANCELLED': 'cancelled',
    'cancelled': 'cancelled',
    'CANCELED': 'cancelled'   // US spelling variant
  };

  const normalized = statusMap[providerStatus];
  if (!normalized) {
    console.warn('[StatusMapping] Unknown provider status:', providerStatus);
  }
  
  return normalized || null;
}

module.exports = {
  handleDeliveryStatusWebhook
};