const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const SmsJobQueueService = require('./SmsJobQueueService');
const RateLimiterService = require('./RateLimiterService');

class SmsSchedulerService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the scheduler (initialize queue service)
   */
  async start() {
    if (this.isRunning) {
      console.log('[SmsSchedulerService] Scheduler is already running');
      return;
    }

    try {
      await SmsJobQueueService.initialize();
      this.isRunning = true;
      console.log('[SmsSchedulerService] Scheduler started - BullMQ queue initialized');
    } catch (error) {
      console.error('[SmsSchedulerService] Failed to start scheduler:', error);
      throw error;
    }
  }

  /**
   * Stop the scheduler
   */
  async stop() {
    if (this.isRunning) {
      await SmsJobQueueService.shutdown();
      this.isRunning = false;
      console.log('[SmsSchedulerService] Scheduler stopped');
    }
  }

  /**
   * Schedule a campaign for future sending
   * @param {string} campaignId - The campaign ID to schedule
   * @param {Date} scheduledTime - When to send the campaign
   */
  async scheduleCampaign(campaignId, scheduledTime) {
    try {
      const campaign = await SmsCampaign.findById(campaignId);

      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      if (!campaign.canBeSent()) {
        throw new Error(`Campaign ${campaignId} cannot be scheduled`);
      }

      // Cancel existing job if any
      if (campaign.jobId) {
        await SmsJobQueueService.cancelJob(campaign.jobId);
      }

      // Add scheduled job
      const job = await SmsJobQueueService.addScheduledJob(campaignId, scheduledTime);

      // Update campaign
      campaign.status = 'scheduled';
      campaign.scheduleStatus = 'scheduled';
      campaign.scheduledAt = scheduledTime;
      campaign.jobId = job.id;
      await campaign.save();

      console.log(`[SmsSchedulerService] Scheduled campaign ${campaignId} for ${scheduledTime.toISOString()}`);
      return { success: true, jobId: job.id };

    } catch (error) {
      console.error(`[SmsSchedulerService] Error scheduling campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Send a campaign immediately
   * @param {string} campaignId - The campaign ID to send
   */
  async sendCampaignImmediately(campaignId) {
    try {
      const campaign = await SmsCampaign.findById(campaignId);

      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      if (!campaign.canBeSent()) {
        throw new Error(`Campaign ${campaignId} cannot be sent`);
      }

      // Cancel existing job if any
      if (campaign.jobId) {
        await SmsJobQueueService.cancelJob(campaign.jobId);
      }

      // Add immediate job
      const job = await SmsJobQueueService.addImmediateJob(campaignId);

      // Update campaign
      campaign.status = 'scheduled'; // Will be processed immediately
      campaign.jobId = job.id;
      await campaign.save();

      console.log(`[SmsSchedulerService] Queued campaign ${campaignId} for immediate sending`);
      return { success: true, jobId: job.id };

    } catch (error) {
      console.error(`[SmsSchedulerService] Error queuing campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled campaign
   * @param {string} campaignId - The campaign ID to cancel
   */
  async cancelScheduledCampaign(campaignId) {
    try {
      const campaign = await SmsCampaign.findById(campaignId);

      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      if (!campaign.canBeCancelled()) {
        throw new Error(`Campaign ${campaignId} cannot be cancelled`);
      }

      // Cancel the job
      if (campaign.jobId) {
        await SmsJobQueueService.cancelJob(campaign.jobId);
      }

      // Update campaign
      campaign.status = 'cancelled';
      campaign.scheduleStatus = 'cancelled';
      campaign.jobId = null;
      campaign.cancelledAt = new Date();
      await campaign.save();

      console.log(`[SmsSchedulerService] Cancelled campaign ${campaignId}`);
      return { success: true };

    } catch (error) {
      console.error(`[SmsSchedulerService] Error cancelling campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Reschedule a campaign
   * @param {string} campaignId - The campaign ID to reschedule
   * @param {Date} newScheduledTime - New scheduled time
   */
  async rescheduleCampaign(campaignId, newScheduledTime) {
    try {
      const campaign = await SmsCampaign.findById(campaignId);

      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      if (campaign.status !== 'scheduled' || !campaign.jobId) {
        throw new Error(`Campaign ${campaignId} is not scheduled`);
      }

      // Reschedule the job
      await SmsJobQueueService.rescheduleJob(campaign.jobId, newScheduledTime);

      // Update campaign
      campaign.scheduledAt = newScheduledTime;
      await campaign.save();

      console.log(`[SmsSchedulerService] Rescheduled campaign ${campaignId} to ${newScheduledTime.toISOString()}`);
      return { success: true };

    } catch (error) {
      console.error(`[SmsSchedulerService] Error rescheduling campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Get campaign status and job info
   * @param {string} campaignId - The campaign ID
   */
  async getCampaignStatus(campaignId) {
    try {
      const campaign = await SmsCampaign.findById(campaignId);

      if (!campaign) {
        return null;
      }

      let jobStatus = null;
      if (campaign.jobId) {
        jobStatus = await SmsJobQueueService.getJobStatus(campaign.jobId);
      }

      return {
        campaign: {
          id: campaign._id,
          title: campaign.title,
          status: campaign.status,
          scheduledAt: campaign.scheduledAt,
          sentAt: campaign.sentAt,
          jobId: campaign.jobId,
        },
        job: jobStatus,
      };

    } catch (error) {
      console.error(`[SmsSchedulerService] Error getting status for campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Manually trigger processing of a specific campaign (add immediate job)
   * @param {string} campaignId - The campaign ID to process
   */
  async processCampaignById(campaignId) {
    try {
      const campaign = await SmsCampaign.findById(campaignId);

      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      if (!campaign.canBeSent()) {
        throw new Error(`Campaign ${campaignId} cannot be processed`);
      }

      // Use the immediate send method
      const result = await this.sendCampaignImmediately(campaignId);

      return {
        success: true,
        campaignId,
        jobId: result.jobId
      };

    } catch (error) {
      console.error(`[SmsSchedulerService] Error processing campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Get scheduler and queue status
   */
  async getStatus() {
    try {
      const queueStats = await SmsJobQueueService.getQueueStats();
      const isHealthy = await SmsJobQueueService.isHealthy();

      return {
        isRunning: this.isRunning,
        isHealthy,
        queueStats,
      };
    } catch (error) {
      console.error('[SmsSchedulerService] Error getting status:', error);
      return {
        isRunning: this.isRunning,
        error: error.message,
      };
    }
  }
}

module.exports = new SmsSchedulerService();