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

      return {
        success: true,
        recipientId: recipient._id,
        oldStatus,
        newStatus: status
      };

    } catch (error) {
      console.error('[SmsRecipientStatusService] Error updating status:', error);
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
      const campaign = await SmsCampaign.findById(campaignId);
      if (!campaign) {
        console.warn(`[SmsRecipientStatusService] Campaign ${campaignId} not found`);
        return;
      }

      const updates = {};

      // Decrement old status count
      if (oldStatus && campaign[`${oldStatus}Count`] !== undefined) {
        updates[`${oldStatus}Count`] = Math.max(0, campaign[`${oldStatus}Count`] - 1);
      }

      // Increment new status count
      if (newStatus && campaign[`${newStatus}Count`] !== undefined) {
        updates[`${newStatus}Count`] = campaign[`${newStatus}Count`] + 1;
      }

      if (Object.keys(updates).length > 0) {
        await SmsCampaign.findByIdAndUpdate(campaignId, {
          ...updates,
          updatedAt: new Date()
        });

        console.log(`[SmsRecipientStatusService] Updated campaign ${campaignId} counts:`, updates);
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
          pending: statusCounts.pending || 0,
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
        // Increment retry count and reset status to pending
        await SmsRecipient.findByIdAndUpdate(recipient._id, {
          $inc: { retryCount: 1 },
          status: 'pending',
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