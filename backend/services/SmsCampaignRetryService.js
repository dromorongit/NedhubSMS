const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const WalletService = require('./WalletService');
const CostCalculatorService = require('./CostCalculatorService');
const NaloSmsService = require('./NaloSmsService');
const MessagePersonalizationService = require('./MessagePersonalizationService');
const BatchProcessorService = require('./BatchProcessorService');

/**
 * SmsCampaignRetryService
 * Handles retry logic for failed SMS campaign recipients
 */
class SmsCampaignRetryService {

  /**
   * Retry failed recipients from a campaign using batch processing
   * @param {string} campaignId - Campaign ID
   * @param {string} userId - User ID for validation
   * @returns {Object} - Retry results
   */
  async retryFailedRecipients(campaignId, userId) {
    try {
      // Find the original campaign
      const campaign = await SmsCampaign.findOne({ _id: campaignId, userId });
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // Allow retry for campaigns that are 'sent' (fully) or 'partial_success' (partially sent)
      if (!['sent', 'partial_success'].includes(campaign.status)) {
        throw new Error('Campaign must be completed (sent or partial_success) to retry failed recipients');
      }

      // Check if there are failed recipients available for retry
      const failedCount = await SmsRecipient.countDocuments({
        campaignId,
        status: 'failed',
        retryCount: { $lt: 3 } // Max 3 retries
      });

      if (failedCount === 0) {
        throw new Error('No failed recipients available for retry');
      }

      // Calculate total cost for retries (estimate based on count)
      const costEstimation = await CostCalculatorService.calculateLiveCost(
        userId,
        campaign.messageBody,
        failedCount,
        { salutation: campaign.salutation, customSalutation: campaign.customSalutation }
      );

      // Check wallet balance
      const hasBalance = await WalletService.hasSufficientBalance(userId, costEstimation.estimatedCost);
      if (!hasBalance) {
        throw new Error('Insufficient wallet balance for retry');
      }

      // Define retry processor function
      const retryProcessor = async (recipient) => {
        try {
          // Increment retry count
          recipient.retryCount += 1;
          await recipient.save();

          // Send retry SMS
          const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
            userId,
            phoneNumber: recipient.phoneNumber,
            senderId: campaign.senderId,
            message: recipient.personalizedMessage,
            recipientsCount: 1
          });

          if (smsResult.success) {
            await recipient.markAsSent(smsResult.jobId);
            return { success: true, messageId: smsResult.messageId, retryCount: recipient.retryCount };
          } else {
            await recipient.markAsFailed(smsResult.error);
            return { success: false, error: smsResult.error, retryCount: recipient.retryCount };
          }

        } catch (error) {
          console.error('Error retrying recipient:', error);
          await recipient.markAsFailed(error.message);
          return { success: false, error: error.message, retryCount: recipient.retryCount };
        }
      };

      // Process retries in batches
      const batchResult = await BatchProcessorService.processRecipientsInBatches(
        campaignId,
        retryProcessor,
        {
          query: { campaignId, status: 'failed', retryCount: { $lt: 3 } },
          batchSize: BatchProcessorService.getBatchConfig().DEFAULT_SIZE
        }
      );

      if (batchResult.success) {
        // Get final progress
        const finalProgress = await BatchProcessorService.getProgress(campaignId);

        // Update campaign counts
        const updatedCampaign = await SmsCampaign.findById(campaignId);
        const recipientStats = await SmsRecipient.aggregate([
          { $match: { campaignId: updatedCampaign._id } },
          {
            $group: {
              _id: null,
              sentCount: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
              deliveredCount: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
              failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
              queuedCount: { $sum: { $cond: [{ $eq: ['$status', 'queued'] }, 1, 0] } }
            }
          }
        ]);

        if (recipientStats.length > 0) {
          const stats = recipientStats[0];
          updatedCampaign.sentCount = stats.sentCount;
          updatedCampaign.deliveredCount = stats.deliveredCount;
          updatedCampaign.failedCount = stats.failedCount;
          updatedCampaign.queuedCount = stats.queuedCount;
          await updatedCampaign.save();
        }

        // Note: totalCost calculation would require tracking costs per recipient
        // For simplicity, return counts
        return {
          success: true,
          retriedCount: finalProgress.totalRecipients,
          successCount: finalProgress.successfulRecipients,
          failedCount: finalProgress.failedRecipients,
          totalCost: 0, // Would need to sum from individual results
          results: [] // Batch processing doesn't return individual results for memory reasons
        };
      } else {
        throw new Error('Batch retry processing failed');
      }

    } catch (error) {
      console.error('Retry failed recipients error:', error);
      throw error;
    }
  }

  /**
   * Create a new campaign duplicating settings but only with failed recipients
   * @param {string} campaignId - Original campaign ID
   * @param {string} userId - User ID for validation
   * @returns {Object} - New campaign details
   */
  async duplicateCampaignWithFailed(campaignId, userId) {
    try {
      // Find the original campaign
      const originalCampaign = await SmsCampaign.findOne({ _id: campaignId, userId });
      if (!originalCampaign) {
        throw new Error('Campaign not found');
      }

      if (originalCampaign.status !== 'sent' && originalCampaign.status !== 'partial_success') {
        throw new Error('Campaign must be completed (sent or partial_success) to duplicate failed recipients');
      }

      // Find failed recipients that haven't exceeded retry limit
      const failedRecipients = await SmsRecipient.find({
        campaignId,
        status: 'failed',
        retryCount: { $lt: 3 }
      });

      if (failedRecipients.length === 0) {
        throw new Error('No failed recipients available for duplication');
      }

      // Calculate cost for new campaign
      const costEstimation = await CostCalculatorService.calculateLiveCost(
        userId,
        originalCampaign.messageBody,
        failedRecipients.length,
        { salutation: originalCampaign.salutation, customSalutation: originalCampaign.customSalutation }
      );

      // Check wallet balance
      const hasBalance = await WalletService.hasSufficientBalance(userId, costEstimation.estimatedCost);
      if (!hasBalance) {
        throw new Error('Insufficient wallet balance for duplicate campaign');
      }

      // Create new campaign
      const newCampaign = new SmsCampaign({
        userId,
        title: `${originalCampaign.title} (Retry - ${new Date().toISOString().split('T')[0]})`,
        senderId: originalCampaign.senderId,
        messageBody: originalCampaign.messageBody,
        salutation: originalCampaign.salutation,
        customSalutation: originalCampaign.customSalutation,
        isPersonalized: originalCampaign.isPersonalized,
        sendMode: 'immediate',
        status: 'processing',
        recipientCount: failedRecipients.length,
        validRecipientCount: failedRecipients.length,
        queuedCount: failedRecipients.length,
        totalSegments: costEstimation.totalSegments,
        estimatedCost: costEstimation.estimatedCost
      });

      // Reserve funds
      const reservation = await WalletService.reserveFunds(userId, costEstimation.estimatedCost, newCampaign._id);
      newCampaign.walletChargeMode = 'reservation';
      newCampaign.walletReservationId = reservation._id;

      await newCampaign.save();

      // Create new recipient records for failed ones in batches to avoid memory issues
      const batchSize = 50; // Smaller batch for creation
      const newRecipients = [];
      for (let i = 0; i < failedRecipients.length; i += batchSize) {
        const batch = failedRecipients.slice(i, i + batchSize);
        for (const failedRecipient of batch) {
          const networkType = SmsRecipient.detectNetwork(failedRecipient.normalizedPhoneNumber || failedRecipient.phoneNumber);
          const newRecipient = new SmsRecipient({
            campaignId: newCampaign._id,
            userId,
            recipientName: failedRecipient.recipientName,
            phoneNumber: failedRecipient.phoneNumber,
            normalizedPhoneNumber: failedRecipient.normalizedPhoneNumber,
            networkType: networkType,
            groupIds: failedRecipient.groupIds,
            personalizedMessage: failedRecipient.personalizedMessage,
            segments: failedRecipient.segments,
            estimatedCost: failedRecipient.estimatedCost,
            retryCount: failedRecipient.retryCount + 1 // Increment retry count
          });

          await newRecipient.save();
          newRecipients.push(newRecipient);
        }
        // Memory cleanup
        if (global.gc) global.gc();
      }

      // Process the new campaign using batch processing
      const sendProcessor = async (recipient) => {
        try {
          const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
            userId,
            phoneNumber: recipient.phoneNumber,
            senderId: newCampaign.senderId,
            message: recipient.personalizedMessage,
            recipientsCount: 1
          });

          if (smsResult.success) {
            await recipient.markAsSent(smsResult.jobId);
            return { success: true, messageId: smsResult.messageId };
          } else {
            await recipient.markAsFailed(smsResult.error);
            return { success: false, error: smsResult.error };
          }

        } catch (error) {
          console.error('Error sending to new recipient:', error);
          await recipient.markAsFailed(error.message);
          return { success: false, error: error.message };
        }
      };

      // Send SMS in batches
      const batchResult = await BatchProcessorService.processRecipientsInBatches(
        newCampaign._id,
        sendProcessor,
        { batchSize: BatchProcessorService.getBatchConfig().DEFAULT_SIZE }
      );

      if (batchResult.success) {
        // Get final progress
        const finalProgress = await BatchProcessorService.getProgress(newCampaign._id);
        const successCount = finalProgress.successfulRecipients;
        const failedCount = finalProgress.failedRecipients;

        // Update new campaign status
        newCampaign.status = successCount === newRecipients.length ? 'sent' :
                             successCount === 0 ? 'failed' : 'sent';
        newCampaign.sentCount = successCount;
        newCampaign.failedCount = failedCount;
        newCampaign.queuedCount = 0;
        await newCampaign.save();

        return {
          success: true,
          newCampaignId: newCampaign._id,
          recipientCount: newRecipients.length,
          successCount,
          failedCount,
          totalCost: 0, // Would need to track individually
          results: [] // Not returning individual results for memory reasons
        };
      } else {
        throw new Error('Batch processing for duplicate campaign failed');
      }

      // Update new campaign status
      const finalFailedCount = newRecipients.length - successCount;
      newCampaign.status = successCount === newRecipients.length ? 'sent' :
                          successCount === 0 ? 'failed' : 'sent';
      newCampaign.sentCount = successCount;
      newCampaign.failedCount = finalFailedCount;
      newCampaign.queuedCount = 0;
      await newCampaign.save();

      return {
        success: true,
        newCampaignId: newCampaign._id,
        recipientCount: newRecipients.length,
        successCount,
        failedCount: finalFailedCount,
        totalCost,
        results
      };

    } catch (error) {
      console.error('Duplicate campaign with failed error:', error);
      throw error;
    }
  }

  /**
   * Check if a campaign has retryable failed recipients
   * @param {string} campaignId - Campaign ID
   * @param {string} userId - User ID
   * @returns {boolean} - True if retryable recipients exist
   */
  async hasRetryableRecipients(campaignId, userId) {
    try {
      const count = await SmsRecipient.countDocuments({
        campaignId,
        userId,
        status: 'failed',
        retryCount: { $lt: 3 }
      });
      return count > 0;
    } catch (error) {
      console.error('Check retryable recipients error:', error);
      return false;
    }
  }
}

module.exports = new SmsCampaignRetryService();