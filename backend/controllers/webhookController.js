const SmsRecipient = require('../models/SmsRecipient');
const SmsCampaign = require('../models/SmsCampaign');
const SmsMessage = require('../models/SmsMessage');
const SmsRecipientStatusService = require('../services/SmsRecipientStatusService');

/**
 * Handle delivery status webhook from SMS provider (Nalo)
 * POST /api/sms/webhooks/delivery-status
 */
const handleDeliveryStatusWebhook = async (req, res) => {
  try {
    const webhookData = req.body;

    // Log webhook data for debugging
    console.log('[Webhook] Received delivery status update:', JSON.stringify(webhookData, null, 2));

    // Validate webhook payload structure
    if (!webhookData || typeof webhookData !== 'object') {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Handle different possible payload formats from Nalo
    // Expected format: { message_id, status, recipient?, timestamp?, error_code?, error_message? }
    const {
      message_id,
      status,
      recipient,
      timestamp,
      error_code,
      error_message
    } = webhookData;

    if (!message_id || !status) {
      return res.status(400).json({
        error: 'Missing required fields: message_id and status'
      });
    }

    // Normalize status to our internal statuses
    const normalizedStatus = normalizeProviderStatus(status);

    if (!normalizedStatus) {
      console.warn(`[Webhook] Unknown status received: ${status}`);
      return res.status(200).json({ message: 'Unknown status ignored' });
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
      console.error('[Webhook] Failed to update recipient status:', result.error);
      // Continue to try updating SmsMessage even if recipient not found
    }

    // Also update the SmsMessage if it exists (for message history sync)
    if (message_id) {
      try {
        const updateData = { status: normalizedStatus };
        if (normalizedStatus === 'delivered') {
          updateData.deliveredAt = timestamp ? new Date(timestamp) : new Date();
        }
        await SmsMessage.findOneAndUpdate(
          { jobId: message_id },
          updateData,
          { new: true }
        );
        console.log(`[Webhook] Updated SmsMessage status to ${normalizedStatus}`);
      } catch (smsError) {
        console.error('[Webhook] Error updating SmsMessage:', smsError.message);
      }
    }

    if (!result.success) {
      // If only recipient update failed but SmsMessage update succeeded, still return success
      if (message_id) {
        return res.status(200).json({ message: 'Delivery status updated (via SmsMessage)' });
      }
      return res.status(500).json({ error: 'Failed to process delivery status update' });
    }

    console.log(`[Webhook] Successfully updated recipient ${result.recipientId} to status ${normalizedStatus}`);

    res.status(200).json({
      message: 'Delivery status updated successfully',
      recipientId: result.recipientId,
      status: normalizedStatus
    });

  } catch (error) {
    console.error('[Webhook] Error processing delivery status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Normalize provider status to internal status
 */
function normalizeProviderStatus(providerStatus) {
  const statusMap = {
    // Nalo statuses
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
    'PENDING': 'pending',
    'pending': 'pending',
    'QUEUED': 'queued',
    'queued': 'queued',
    'PROCESSING': 'processing',
    'processing': 'processing'
  };

  return statusMap[providerStatus] || null;
}

module.exports = {
  handleDeliveryStatusWebhook
};