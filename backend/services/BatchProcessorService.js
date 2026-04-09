const SmsRecipient = require('../models/SmsRecipient');
const SmsCampaign = require('../models/SmsCampaign');
const SmsJobQueueService = require('./SmsJobQueueService');
const logger = require('../utils/logger');

/**
 * BatchProcessorService
 * Handles batch processing of SMS campaign recipients with Redis-based progress tracking
 */
class BatchProcessorService {
  constructor() {
    this.redis = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the service with Redis connection
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Get Redis connection from SmsJobQueueService
      this.redis = SmsJobQueueService.getRedisConnection();
      if (!this.redis) {
        throw new Error('Redis connection not available');
      }
      this.isInitialized = true;
      console.log('[BatchProcessorService] Initialized successfully');
    } catch (error) {
      console.error('[BatchProcessorService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get batch configuration
   */
  getBatchConfig() {
    return {
      DEFAULT_SIZE: parseInt(process.env.SMS_BATCH_SIZE) || 100,
      MAX_SIZE: 500,
      MIN_SIZE: 10,
      MAX_CONCURRENT_BATCHES: parseInt(process.env.SMS_MAX_CONCURRENT_BATCHES) || 5,
      RETRY_ATTEMPTS: parseInt(process.env.SMS_BATCH_RETRY_ATTEMPTS) || 3,
      PROGRESS_TTL: 24 * 60 * 60, // 24 hours in seconds
      UPDATE_INTERVAL: 10, // Update progress every 10 batches
      TIME_UPDATE_INTERVAL: 30 * 1000, // Update every 30 seconds
    };
  }

  /**
   * Initialize progress tracking for a campaign
   */
  async initializeProgress(campaignId, totalRecipients) {
    if (!this.isInitialized) await this.initialize();

    const progressKey = `campaign:progress:${campaignId}`;
    const totalBatches = Math.ceil(totalRecipients / this.getBatchConfig().DEFAULT_SIZE);

    const progressData = {
      totalRecipients,
      processedRecipients: 0,
      successfulRecipients: 0,
      failedRecipients: 0,
      currentBatch: 0,
      totalBatches,
      status: 'processing',
      lastUpdated: new Date().toISOString(),
      estimatedCompletion: null,
      batchMetrics: {}
    };

    await this.redis.set(progressKey, JSON.stringify(progressData), 'EX', this.getBatchConfig().PROGRESS_TTL);
    return progressData;
  }

  /**
   * Get progress for a campaign
   */
  async getProgress(campaignId) {
    if (!this.isInitialized) await this.initialize();

    const progressKey = `campaign:progress:${campaignId}`;
    const data = await this.redis.get(progressKey);

    if (!data) return null;

    return JSON.parse(data);
  }

  /**
   * Update progress for a campaign
   */
  async updateProgress(campaignId, updateData) {
    if (!this.isInitialized) await this.initialize();

    const progressKey = `campaign:progress:${campaignId}`;
    const current = await this.getProgress(campaignId);

    if (!current) return false;

    const updated = {
      ...current,
      ...updateData,
      lastUpdated: new Date().toISOString()
    };

    // Calculate estimated completion if we have enough data
    if (updated.processedRecipients > 0 && updated.currentBatch > 0) {
      const avgTimePerBatch = (Date.now() - new Date(current.lastUpdated).getTime()) / updated.currentBatch;
      const remainingBatches = updated.totalBatches - updated.currentBatch;
      updated.estimatedCompletion = new Date(Date.now() + (avgTimePerBatch * remainingBatches)).toISOString();
    }

    await this.redis.set(progressKey, JSON.stringify(updated), 'EX', this.getBatchConfig().PROGRESS_TTL);
    return updated;
  }

  /**
   * Process recipients in batches
   */
  async processRecipientsInBatches(campaignId, processorFn, options = {}) {
    if (!this.isInitialized) await this.initialize();

    const config = this.getBatchConfig();
    const batchSize = Math.min(Math.max(options.batchSize || config.DEFAULT_SIZE, config.MIN_SIZE), config.MAX_SIZE);

    // Default query for pending recipients, but allow override
    const query = options.query || { campaignId, status: 'pending' };
    const sortOrder = options.sort || { _id: 1 };

    // Get total recipients count
    const totalRecipients = await SmsRecipient.countDocuments(query);
    if (totalRecipients === 0) return { success: true, message: 'No recipients found for processing' };

    // Initialize progress
    await this.initializeProgress(campaignId, totalRecipients);

    let offset = 0;
    let batchNumber = 0;
    let lastProgressUpdate = Date.now();

    while (offset < totalRecipients) {
      batchNumber++;

      try {
        // Load batch of recipients
        const batch = await SmsRecipient.find(query)
          .limit(batchSize)
          .skip(offset)
          .sort(sortOrder); // Ensure consistent ordering

        if (batch.length === 0) break;

        // Process batch
        const batchResults = await this.processBatch(batch, processorFn, batchNumber);

        // Update progress
        const progressUpdate = {
          processedRecipients: Math.min(offset + batch.length, totalRecipients),
          currentBatch: batchNumber,
          successfulRecipients: batchResults.successful,
          failedRecipients: batchResults.failed,
          batchMetrics: {
            ...await this.getProgress(campaignId).batchMetrics,
            [batchNumber]: batchResults
          }
        };

        await this.updateProgress(campaignId, progressUpdate);

        // Periodic updates
        if (batchNumber % config.UPDATE_INTERVAL === 0 || Date.now() - lastProgressUpdate > config.TIME_UPDATE_INTERVAL) {
          await this.updateCampaignStatus(campaignId);
          lastProgressUpdate = Date.now();
        }

        offset += batchSize;

        // Memory cleanup
        if (global.gc) global.gc();

      } catch (error) {
        logger.error(`Batch ${batchNumber} processing failed for campaign ${campaignId}:`, error);

        // Mark batch as failed
        await this.markBatchFailed(campaignId, batchNumber, error.message);

        // Retry logic if enabled
        if (options.retryOnFailure !== false) {
          await this.retryFailedBatch(campaignId, batchNumber, processorFn, options);
        }

        break; // Stop processing on batch failure
      }
    }

    // Finalize
    await this.finalizeCampaign(campaignId);
    return { success: true, totalBatches: batchNumber };
  }

  /**
   * Process a single batch
   */
  async processBatch(recipients, processorFn, batchNumber) {
    let successful = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        const result = await processorFn(recipient);
        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`Recipient ${recipient._id} failed in batch ${batchNumber}:`, error);
        failed++;
      }
    }

    return { successful, failed, total: recipients.length };
  }

  /**
   * Retry a failed batch
   */
  async retryFailedBatch(campaignId, batchNumber, processorFn, options = {}) {
    const config = this.getBatchConfig();
    const maxRetries = options.maxRetries || config.RETRY_ATTEMPTS;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Retrying batch ${batchNumber} for campaign ${campaignId}, attempt ${attempt}`);

        // Get batch recipients (those that failed)
        const batchSize = options.batchSize || config.DEFAULT_SIZE;
        const offset = (batchNumber - 1) * batchSize;

        const batch = await SmsRecipient.find({
          campaignId,
          status: 'failed',
          retryCount: { $lt: 3 } // Respect retry limits
        })
          .limit(batchSize)
          .skip(offset)
          .sort({ _id: 1 });

        if (batch.length === 0) break;

        const batchResults = await this.processBatch(batch, processorFn, batchNumber);

        // Update progress with retry results
        await this.updateProgress(campaignId, {
          successfulRecipients: batchResults.successful,
          failedRecipients: batchResults.failed
        });

        if (batchResults.failed === 0) {
          logger.info(`Batch ${batchNumber} retry successful`);
          return { success: true };
        }

      } catch (error) {
        logger.error(`Batch ${batchNumber} retry attempt ${attempt} failed:`, error);
        if (attempt === maxRetries) {
          throw error;
        }
      }

      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    return { success: false };
  }

  /**
   * Mark a batch as failed
   */
  async markBatchFailed(campaignId, batchNumber, error) {
    const progress = await this.getProgress(campaignId);
    if (progress) {
      progress.batchMetrics[batchNumber] = { ...progress.batchMetrics[batchNumber], error };
      await this.updateProgress(campaignId, { status: 'failed', batchMetrics: progress.batchMetrics });
    }
  }

  /**
   * Update campaign status based on progress
   */
  async updateCampaignStatus(campaignId) {
    const progress = await this.getProgress(campaignId);
    if (!progress) return;

    const campaign = await SmsCampaign.findById(campaignId);
    if (!campaign) return;

    // Update campaign with current progress
    campaign.sentCount = progress.successfulRecipients;
    campaign.failedCount = progress.failedRecipients;
    campaign.pendingCount = progress.totalRecipients - progress.processedRecipients;

    await campaign.save();
  }

  /**
   * Finalize campaign after processing
   */
  async finalizeCampaign(campaignId) {
    const progress = await this.getProgress(campaignId);
    if (!progress) return;

    const campaign = await SmsCampaign.findById(campaignId);
    if (!campaign) return;

    // Set final status
    if (progress.failedRecipients === 0) {
      campaign.status = 'sent';
    } else if (progress.successfulRecipients === 0) {
      campaign.status = 'failed';
    } else {
      campaign.status = 'sent'; // Partial success
    }

    campaign.sentAt = new Date();
    await campaign.save();

    // Update final progress
    await this.updateProgress(campaignId, { status: 'completed' });
  }

  /**
   * Cleanup progress data
   */
  async cleanupProgress(campaignId) {
    if (!this.isInitialized) await this.initialize();

    const progressKey = `campaign:progress:${campaignId}`;
    await this.redis.del(progressKey);
  }
}

module.exports = new BatchProcessorService();