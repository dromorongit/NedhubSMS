const logger = require('../utils/logger').messageStatus;
const SmsRecipient = require('../models/SmsRecipient');
const SmsCampaign = require('../models/SmsCampaign');

class SmsRecipientStatusService {
  /**
   * Update recipient status and handle campaign count updates
   */
  async updateRecipientStatus({
    providerMessageId,
    status,
    timestamp,
    providerStatus = null,
    errorMessage = null
  }) {
    try {
      // Find recipient by provider message ID
      const recipient = await SmsRecipient.findOne({ providerMessageId });

      if (!recipient) {
        return {
          success: false,
          error: `Recipient with providerMessageId ${providerMessageId} not found`
        };
      }

      const oldStatus = recipient.status;

      // If status unchanged, treat as idempotent (already updated)
      if (oldStatus === status) {
        logger.info('Recipient status unchanged (idempotent)', {
          recipientId: recipient._id,
          providerMessageId,
          status
        });
        return {
          success: true,
          recipientId: recipient._id,
          oldStatus,
          newStatus: status,
          idempotent: true
        };
      }

      // Status downgrade protection (similar to webhook)
      const statusHierarchy = {
        'queued': 1,
        'processing': 2,
        'sent': 3,
        'delivered': 4
      };
      const currentLevel = statusHierarchy[oldStatus];
      const newLevel = statusHierarchy[status];
      if (currentLevel && newLevel && newLevel < currentLevel) {
        logger.warn('Recipient status downgrade prevented', {
          recipientId: recipient._id,
          oldStatus,
          attemptedStatus: status,
          reason: 'New status is lower in hierarchy'
        });
        // Return success but keep current status
        return {
          success: true,
          recipientId: recipient._id,
          oldStatus,
          newStatus: oldStatus,
          downgradePrevented: true
        };
      }

      // Update recipient status
      const updateData = {
        status,
        updatedAt: new Date()
      };

      if (providerStatus) updateData.providerStatus = providerStatus;
      if (errorMessage) updateData.errorMessage = errorMessage;

      // Set appropriate timestamp
      if (status === 'sent' && !recipient.sentAt) updateData.sentAt = timestamp;
      if (status === 'delivered' && !recipient.deliveredAt) updateData.deliveredAt = timestamp;
      if (status === 'failed' && !recipient.failedAt) updateData.failedAt = timestamp;
      if (status === 'processing' && !recipient.processingAt) updateData.processingAt = timestamp;
      if (status === 'cancelled' && !recipient.cancelledAt) updateData.cancelledAt = timestamp;

      const updatedRecipient = await SmsRecipient.findByIdAndUpdate(
        recipient._id,
        updateData,
        { new: true }
      );

      // Update campaign counts if status changed
      if (oldStatus !== status) {
        await this.updateCampaignCounts(recipient.campaignId, oldStatus, status);
      }

      // Log recipient status change with [RecipientStatus] tag
      console.log('[RecipientStatus]', {
        recipientId: recipient._id,
        campaignId: recipient.campaignId,
        oldStatus,
        newStatus: status,
        providerMessageId,
        providerStatus
      });

      return {
        success: true,
        recipientId: recipient._id,
        oldStatus,
        newStatus: status
      };

    } catch (error) {
      logger.error('Error updating recipient status', {
        providerMessageId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update campaign delivery counts
   */
  async updateCampaignCounts(campaignId, oldStatus, newStatus) {
    try {
      // Verify campaign exists
      const campaign = await SmsCampaign.findById(campaignId);
      if (!campaign) {
        console.warn(`[SmsRecipientStatusService] Campaign ${campaignId} not found`);
        return;
      }

      const incUpdate = {};

      // Decrement old status count (if different from new and field exists)
      if (oldStatus && oldStatus !== newStatus && campaign[`${oldStatus}Count`] !== undefined) {
        incUpdate[`${oldStatus}Count`] = -1;
      }

      // Increment new status count
      if (newStatus && campaign[`${newStatus}Count`] !== undefined) {
        incUpdate[`${newStatus}Count`] = 1;
      }

      if (Object.keys(incUpdate).length > 0) {
        await SmsCampaign.findByIdAndUpdate(campaignId, {
          $inc: incUpdate,
          updatedAt: new Date()
        });

        // Log campaign count update with [CampaignStatus] tag
        console.log('[CampaignStatus]', {
          campaignId,
          increments: incUpdate,
          oldStatus,
          newStatus
        });
      }

    } catch (error) {
      console.error('[SmsRecipientStatusService] Error updating campaign counts:', error);
    }
  }

  /**
   * Bulk update recipients for a campaign
   */
  async bulkUpdateRecipients(campaignId, updates) {
    try {
      const results = [];

      for (const update of updates) {
        const result = await this.updateRecipientStatus({
          providerMessageId: update.providerMessageId,
          status: update.status,
          timestamp: update.timestamp,
          providerStatus: update.providerStatus,
          errorMessage: update.errorMessage
        });

        results.push(result);
      }

      return {
        success: true,
        results
      };

    } catch (error) {
      console.error('[SmsRecipientStatusService] Error in bulk update:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get delivery statistics for a campaign
   */
  async getCampaignStats(campaignId) {
    try {
      const campaign = await SmsCampaign.findById(campaignId);
      if (!campaign) {
        return null;
      }

      // Get actual counts from recipients
      const stats = await SmsRecipient.aggregate([
        { $match: { campaignId: campaign._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const statusCounts = {};
      stats.forEach(stat => {
        statusCounts[stat._id] = stat.count;
      });

      return {
        campaignId,
        totalRecipients: campaign.recipientCount || 0,
        statusCounts: {
          queued: statusCounts.queued || 0,
          processing: statusCounts.processing || 0,
          sent: statusCounts.sent || 0,
          delivered: statusCounts.delivered || 0,
          failed: statusCounts.failed || 0,
          cancelled: statusCounts.cancelled || 0
        },
        deliveryRate: campaign.recipientCount > 0 ?
          ((statusCounts.delivered || 0) / campaign.recipientCount * 100).toFixed(2) : 0,
        failureRate: campaign.recipientCount > 0 ?
          ((statusCounts.failed || 0) / campaign.recipientCount * 100).toFixed(2) : 0
      };

    } catch (error) {
      console.error('[SmsRecipientStatusService] Error getting campaign stats:', error);
      return null;
    }
  }

  /**
   * Handle retry for failed recipients
   */
  async retryFailedRecipients(campaignId, maxRetries = 3) {
    try {
      const failedRecipients = await SmsRecipient.find({
        campaignId,
        status: 'failed',
        retryCount: { $lt: maxRetries }
      });

      const results = [];

      for (const recipient of failedRecipients) {
        // Increment retry count and reset status to queued for retry
        await SmsRecipient.findByIdAndUpdate(recipient._id, {
          $inc: { retryCount: 1 },
          status: 'queued',
          updatedAt: new Date()
        });

        results.push({
          recipientId: recipient._id,
          retryCount: recipient.retryCount + 1
        });
      }

      return {
        success: true,
        retryCount: results.length,
        recipients: results
      };

    } catch (error) {
      console.error('[SmsRecipientStatusService] Error retrying failed recipients:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new SmsRecipientStatusService();