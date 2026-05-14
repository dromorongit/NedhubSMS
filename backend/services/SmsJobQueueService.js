const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const NaloSmsService = require('./NaloSmsService');
const BatchProcessorService = require('./BatchProcessorService');
const logger = require('../utils/logger');
const MetricsService = require('./MetricsService');
const AlertingService = require('../utils/alerting');
const Sentry = require('../utils/sentry');

class SmsJobQueueService {
  constructor() {
    this.queue = null;
    this.worker = null;
    this.scheduler = null;
    this.redisConnection = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the queue service with Redis connection
   * Returns true if successful, false if Redis is unavailable (non-fatal)
   */
  async initialize() {
    if (this.isInitialized) {
      logger.info('Queue service already initialized');
      return true;
    }

    try {
      // Create Redis connection
      if (process.env.REDIS_URL) {
        this.redisConnection = new IORedis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          retryDelayOnFailover: 100,
          lazyConnect: true,
          connectTimeout: 3000,
        });
      } else {
        this.redisConnection = new IORedis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          db: parseInt(process.env.REDIS_DB) || 0,
          username: process.env.REDIS_USERNAME || undefined,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: null,
          lazyConnect: true,
          connectTimeout: 3000,
        });
      }

      // Handle Redis connection events
      this.redisConnection.on('connect', () => {
        console.log('[SmsJobQueueService] Redis connected successfully');
      });

      this.redisConnection.on('error', (error) => {
        console.error('[SmsJobQueueService] Redis connection error:', error);
      });

      this.redisConnection.on('ready', () => {
        console.log('[SmsJobQueueService] Redis connection ready');
      });

      // Test Redis connection with timeout
      try {
        // Add a timeout wrapper to prevent blocking server startup
        const connectWithTimeout = async () => {
          return Promise.race([
            (async () => {
              await this.redisConnection.connect();
              await this.redisConnection.ping();
              return true;
            })(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Redis connection timeout')), 3000)
            )
          ]);
        };
        
        await connectWithTimeout();
      } catch (redisError) {
        console.warn('[SmsJobQueueService] Redis connection failed, continuing without queue service:', redisError.message);
        this.redisConnection = null;
        return false;
      }

      // Initialize queue
      this.queue = new Queue('sms-campaigns', {
        connection: this.redisConnection,
        defaultJobOptions: {
          removeOnComplete: 50, // Keep last 50 completed jobs
          removeOnFail: 100,    // Keep last 100 failed jobs (for dead letter)
          attempts: 5,          // Enhanced retry: up to 5 attempts
          backoff: {
            type: 'exponential',
            delay: 2000, // 2 seconds initial delay
          },
        },
      });

      // Handle queue errors
      this.queue.on('error', (error) => {
        console.error('[SmsJobQueueService] Queue error:', error.message);
        try {
          Sentry.captureException(error, {
            tags: { component: 'bullmq-queue', queue: 'sms-campaigns' }
          });
        } catch (e) {}
      });

      // Initialize dead letter queue
      this.deadLetterQueue = new Queue('sms-dead-letter', {
        connection: this.redisConnection,
        defaultJobOptions: {
          removeOnComplete: 0, // Keep all dead letter jobs
          removeOnFail: 0,
        },
      });

      // Handle dead letter queue errors
      this.deadLetterQueue.on('error', (error) => {
        console.error('[SmsJobQueueService] Dead letter queue error:', error.message);
        try {
          Sentry.captureException(error, {
            tags: { component: 'bullmq-queue', queue: 'dead-letter' }
          });
        } catch (e) {}
      });

      // QueueScheduler removed in newer bullmq versions; queue handles delayed jobs natively

      // Initialize worker
      this.worker = new Worker('sms-campaigns', this.processJob.bind(this), {
        connection: this.redisConnection,
        concurrency: 2, // Process 2 campaigns concurrently
        limiter: {
          max: 10, // Max 10 jobs per duration
          duration: 1000, // Per second
        },
      });

      // Handle worker errors to prevent process crash
      this.worker.on('error', (error) => {
        console.error('[SmsJobQueueService] Worker error:', error.message);
        // Log to Sentry but don't crash
        try {
          Sentry.captureException(error, {
            tags: { component: 'bullmq-worker' },
            extra: { context: 'Worker initialization or runtime error' }
          });
        } catch (e) {
          // Ignore Sentry errors
        }
      });

      // Handle worker events
      this.worker.on('completed', (job) => {
        logger.info('Queue job completed', { jobId: job.id, campaignId: job.data.campaignId });
        MetricsService.incrementQueueProcessed(job.data.campaignId);
      });

      this.worker.on('failed', async (job, err) => {
        logger.error('Queue job failed', { jobId: job.id, campaignId: job.data.campaignId, error: err.message });
        MetricsService.incrementQueueFailed(job.data.campaignId, err);
        await AlertingService.alertQueueFailure(job.data.campaignId, err);

        // Capture failure in Sentry
        try {
          Sentry.captureException(err, {
            tags: { jobId: job.id, campaignId: job.data.campaignId, type: 'queue_failure' },
            extra: { attemptsMade: job.attemptsMade, jobData: job.data }
          });
        } catch (sentryError) {
          console.error('Failed to capture error in Sentry:', sentryError);
        }

        // Dead letter queue: Move jobs that have exhausted retries
        if (job.attemptsMade >= job.opts.attempts) {
          try {
            await this.deadLetterQueue.add('dead-letter', {
              originalJobId: job.id,
              campaignId: job.data.campaignId,
              error: err.message,
              failedAt: new Date(),
              attemptsMade: job.attemptsMade,
            });
            console.log(`[SmsJobQueueService] Moved job ${job.id} to dead letter queue`);
          } catch (dlqError) {
            console.error(`[SmsJobQueueService] Failed to add to dead letter queue:`, dlqError);
          }
        }
      });

      this.worker.on('stalled', (jobId) => {
        console.warn(`[SmsJobQueueService] Job ${jobId} stalled`);
      });

      this.isInitialized = true;
      console.log('[SmsJobQueueService] Queue service initialized successfully');
      return true;

    } catch (error) {
      console.warn('[SmsJobQueueService] Failed to initialize queue service, continuing without it:', error.message);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Add a job to send campaign immediately
   * @param {string} campaignId - The campaign ID to process
   * @param {object} options - Additional job options
   */
  async addImmediateJob(campaignId, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Queue service not initialized');
    }

    // Use unique job ID for idempotency
    const jobId = `campaign-${campaignId}`;

    const job = await this.queue.add('sendCampaign', { campaignId }, {
      jobId, // Unique job ID to prevent duplicates
      priority: 1, // High priority for immediate sends
      delay: 0,
      ...options,
    });

    console.log(`[SmsJobQueueService] Added immediate job for campaign ${campaignId}, job ID: ${job.id}`);
    return job;
  }

  /**
   * Add a delayed job to send campaign at scheduled time
   * @param {string} campaignId - The campaign ID to process
   * @param {Date} scheduledTime - When to execute the job
   * @param {object} options - Additional job options
   */
  async addScheduledJob(campaignId, scheduledTime, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Queue service not initialized');
    }

    const delay = Math.max(0, scheduledTime.getTime() - Date.now());

    // Use deterministic job ID to prevent duplicates: "campaign-{campaignId}"
    const jobId = `campaign-${campaignId}`;

    // Remove any existing job with the same ID (idempotency)
    try {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        await existingJob.remove();
        console.log(`[SmsJobQueueService] Removed existing job ${jobId} for rescheduling`);
      }
    } catch (error) {
      console.warn(`[SmsJobQueueService] Could not check for existing job ${jobId}:`, error.message);
    }

    const job = await this.queue.add('sendCampaign', { campaignId }, {
      jobId,
      priority: 0, // Lower priority for scheduled sends
      delay,
      ...options,
    });

    console.log(`[SmsJobQueueService] Added scheduled job for campaign ${campaignId} at ${scheduledTime.toISOString()}, job ID: ${job.id}`);
    return job;
  }

  /**
   * Cancel a scheduled job
   * @param {string} jobId - The job ID to cancel
   */
  async cancelJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('Queue service not initialized');
    }

    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`[SmsJobQueueService] Cancelled job ${jobId}`);
      return true;
    }
    return false;
  }

  /**
   * Reschedule a job
   * @param {string} jobId - The job ID to reschedule
   * @param {Date} newScheduledTime - New scheduled time
   */
  async rescheduleJob(jobId, newScheduledTime) {
    if (!this.isInitialized) {
      throw new Error('Queue service not initialized');
    }

    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const delay = Math.max(0, newScheduledTime.getTime() - Date.now());
    await job.changeDelay(delay);

    console.log(`[SmsJobQueueService] Rescheduled job ${jobId} to ${newScheduledTime.toISOString()}`);
    return job;
  }

  /**
   * Get job status
   * @param {string} jobId - The job ID
   */
  async getJobStatus(jobId) {
    if (!this.isInitialized) {
      throw new Error('Queue service not initialized');
    }

    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      opts: job.opts,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      state: await job.getState(),
    };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    if (!this.isInitialized) {
      throw new Error('Queue service not initialized');
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Process a job (campaign sending)
   * @param {Job} job - The BullMQ job
   */
  async processJob(job) {
     const { campaignId } = job.data;

     console.log(`[SmsJobQueueService] Processing campaign job: ${campaignId}`);

     try {
       // Find the campaign
       const campaign = await SmsCampaign.findById(campaignId);
       if (!campaign) {
         throw new Error(`Campaign ${campaignId} not found`);
       }

       // Restart safety: Check if campaign is already in a terminal state to prevent duplicate execution
       if (campaign.status === 'sent' || campaign.status === 'partial_success' || campaign.status === 'failed') {
         console.warn(`[SmsJobQueueService] Campaign ${campaignId} already ${campaign.status}, skipping duplicate execution`);
         return;
       }

       // Check if campaign is still valid for sending
       if (campaign.status !== 'scheduled' && campaign.status !== 'processing') {
         console.warn(`[SmsJobQueueService] Campaign ${campaignId} status is ${campaign.status}, skipping`);
         return;
       }

      // Process the campaign (similar to old processCampaign)
      await this.processCampaign(campaign);

      console.log(`[SmsJobQueueService] Successfully processed campaign ${campaignId}`);
      return { success: true, campaignId };

    } catch (error) {
      console.error(`[SmsJobQueueService] Error processing campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Process a single campaign using batch processing
   * @param {SmsCampaign} campaign - The campaign to process
   */
  async processCampaign(campaign) {
    console.log(`[SmsJobQueueService] Processing campaign: ${campaign.title} (${campaign._id})`);

    // Update campaign status to processing
    campaign.status = 'processing';
    campaign.scheduleStatus = 'processing';
    await campaign.save();
    
    console.log('[CampaignStatus]', {
      campaignId: campaign._id,
      status: campaign.status
    });

    // Capture reservation if exists
    if (campaign.walletReservationId) {
      try {
        const WalletService = require('./WalletService');
        const captureResult = await WalletService.captureReservation(campaign.walletReservationId);
        campaign.actualCost = captureResult.transaction.amount;
        await campaign.save();
      } catch (error) {
        console.error(`[SmsJobQueueService] Failed to capture reservation for campaign ${campaign._id}:`, error);
        campaign.status = 'failed';
        await campaign.save();
        console.log('[CampaignStatus]', {
          campaignId: campaign._id,
          status: campaign.status,
          reason: 'Failed to capture reservation'
        });
        return;
      }
    }

    // Check if there are any queued recipients
    const queuedCount = await SmsRecipient.countDocuments({ campaignId: campaign._id, status: 'queued' });
    if (queuedCount === 0) {
      console.warn(`[SmsJobQueueService] No queued recipients found for campaign ${campaign._id}`);
      campaign.status = 'failed';
      await campaign.save();
      console.log('[CampaignStatus]', {
        campaignId: campaign._id,
        status: campaign.status,
        reason: 'No queued recipients'
      });
      return;
    }

    // Define the processor function for each recipient
    const processRecipient = async (recipient) => {
      try {
        // Skip if already processed (double-check)
        if (recipient.status !== 'queued') {
          return { success: false, reason: 'already processed' };
        }

        // Send SMS
        const smsResult = await NaloSmsService.sendSmsWithFinancialTracking({
          userId: campaign.userId,
          phoneNumber: recipient.phoneNumber,
          senderId: campaign.senderId,
          message: recipient.personalizedMessage,
          recipientsCount: 1,
          skipDeduction: !!campaign.walletReservationId
        });

        if (smsResult.success) {
          await recipient.markAsSent(smsResult.jobId);
          logger.info('SMS sent successfully', { recipientName: recipient.recipientName, phoneNumber: recipient.phoneNumber });
          return { success: true };
        } else {
          await recipient.markAsFailed(smsResult.error);
          logger.error('SMS send failed', { recipientName: recipient.recipientName, phoneNumber: recipient.phoneNumber, error: smsResult.error });
          return { success: false, error: smsResult.error };
        }

      } catch (error) {
        console.error(`[SmsJobQueueService] Error sending to ${recipient.recipientName}:`, error);
        await recipient.markAsFailed(error.message);
        return { success: false, error: error.message };
      }
    };

    try {
      // Process recipients in batches
      const batchResult = await BatchProcessorService.processRecipientsInBatches(
        campaign._id,
        processRecipient,
        { batchSize: BatchProcessorService.getBatchConfig().DEFAULT_SIZE }
      );

      if (batchResult.success) {
        // Get final progress
        const finalProgress = await BatchProcessorService.getProgress(campaign._id);

        // Update campaign with final counts
        campaign.sentCount = finalProgress.successfulRecipients;
        campaign.failedCount = finalProgress.failedRecipients;
        campaign.queuedCount = 0; // All processed

        // Status should already be set by BatchProcessorService.finalizeCampaign
        // But ensure it's set correctly based on actual results
        if (campaign.sentCount === campaign.recipientCount) {
          campaign.status = 'sent';
          campaign.scheduleStatus = 'sent';
          campaign.sentAt = new Date();
        } else if (campaign.sentCount > 0) {
          campaign.status = 'partial_success';
          campaign.scheduleStatus = 'partial_success';
          campaign.sentAt = new Date();
        } else {
          campaign.status = 'failed';
          campaign.scheduleStatus = 'failed';
        }

        await campaign.save();
        
        console.log('[CampaignStatus]', {
          campaignId: campaign._id,
          status: campaign.status,
          sentCount: campaign.sentCount,
          failedCount: campaign.failedCount
        });

        // Record metrics
        MetricsService.recordSmsSent(campaign.sentCount + campaign.failedCount, campaign.sentCount > 0);

        logger.info('Campaign processing completed', {
          campaignId: campaign._id,
          title: campaign.title,
          sentCount: campaign.sentCount,
          failedCount: campaign.failedCount,
          totalBatches: batchResult.totalBatches
        });
      } else {
        throw new Error('Batch processing failed');
      }

    } catch (error) {
      console.error(`[SmsJobQueueService] Batch processing error for campaign ${campaign._id}:`, error);
      
      // Re-fetch campaign to get latest counts (may have been updated by concurrent batch processing)
      const currentCampaign = await SmsCampaign.findById(campaign._id);
      if (currentCampaign) {
        // Determine status based on actual results - never mark as failed if at least one succeeded
        if (currentCampaign.sentCount === currentCampaign.recipientCount) {
          currentCampaign.status = 'sent';
          currentCampaign.scheduleStatus = 'sent';
        } else if (currentCampaign.sentCount > 0) {
          currentCampaign.status = 'partial_success';
          currentCampaign.scheduleStatus = 'partial_success';
        } else {
          currentCampaign.status = 'failed';
          currentCampaign.scheduleStatus = 'failed';
        }
        await currentCampaign.save();
        
        console.log('[CampaignStatus]', {
          campaignId: currentCampaign._id,
          status: currentCampaign.status,
          sentCount: currentCampaign.sentCount,
          failedCount: currentCampaign.failedCount,
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('[SmsJobQueueService] Shutting down queue service...');

    if (this.worker) {
      await this.worker.close();
      console.log('[SmsJobQueueService] Worker closed');
    }


    if (this.queue) {
      await this.queue.close();
      console.log('[SmsJobQueueService] Queue closed');
    }

    if (this.deadLetterQueue) {
      await this.deadLetterQueue.close();
      console.log('[SmsJobQueueService] Dead letter queue closed');
    }

    if (this.redisConnection) {
      this.redisConnection.disconnect();
      console.log('[SmsJobQueueService] Redis disconnected');
    }

    this.isInitialized = false;
    console.log('[SmsJobQueueService] Queue service shutdown complete');
  }

  /**
   * Check if service is healthy
   */
  async isHealthy() {
    if (!this.isInitialized) {
      return false;
    }

    try {
      await this.redisConnection.ping();

      // Check persistence status for enhanced resilience
      const info = await this.redisConnection.info('persistence');
      const isAofEnabled = info.includes('aof_enabled:1');

      return isAofEnabled;
    } catch (error) {
      console.error('[SmsJobQueueService] Health check failed:', error);
      return false;
    }
  }

 /**
  * Get Redis connection for sharing with other services
  */
 getRedisConnection() {
   return this.redisConnection;
 }
}

module.exports = new SmsJobQueueService();