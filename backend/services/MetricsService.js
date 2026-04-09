const logger = require('../utils/logger');

class MetricsService {
  constructor() {
    this.metrics = {
      queueJobsProcessed: 0,
      queueJobsFailed: 0,
      apiRequestsTotal: 0,
      apiErrorsTotal: 0,
      paymentCallbacksReceived: 0,
      paymentCallbacksFailed: 0,
      smsDeliveryCallbacksReceived: 0,
      smsDeliveryCallbacksFailed: 0,
      smsSentTotal: 0,
      smsFailedTotal: 0
    };
  }

  // Queue worker metrics
  incrementQueueProcessed(campaignId) {
    this.metrics.queueJobsProcessed++;
    logger.info('Queue job processed', { campaignId, metric: 'queueJobsProcessed' });
  }

  incrementQueueFailed(campaignId, error) {
    this.metrics.queueJobsFailed++;
    logger.error('Queue job failed', { campaignId, error: error.message, metric: 'queueJobsFailed' });
  }

  // API metrics
  recordApiRequest(endpoint, method, statusCode) {
    this.metrics.apiRequestsTotal++;
    if (statusCode >= 400) {
      this.metrics.apiErrorsTotal++;
      logger.warn('API error', { endpoint, method, statusCode, metric: 'apiErrors' });
    }
  }

  // Payment callback metrics
  recordPaymentCallback(clientReference, success) {
    this.metrics.paymentCallbacksReceived++;
    if (!success) {
      this.metrics.paymentCallbacksFailed++;
      logger.error('Payment callback failed', { clientReference, metric: 'paymentCallbacksFailed' });
    } else {
      logger.info('Payment callback processed', { clientReference, metric: 'paymentCallbacksReceived' });
    }
  }

  // SMS delivery callback metrics
  recordSmsDeliveryCallback(messageId, status) {
    this.metrics.smsDeliveryCallbacksReceived++;
    if (status === 'failed') {
      this.metrics.smsDeliveryCallbacksFailed++;
      logger.error('SMS delivery failed', { messageId, status, metric: 'smsDeliveryCallbacksFailed' });
    } else {
      logger.info('SMS delivery status updated', { messageId, status, metric: 'smsDeliveryCallbacksReceived' });
    }
  }

  // SMS sending metrics
  recordSmsSent(recipientCount, success) {
    this.metrics.smsSentTotal += recipientCount;
    if (!success) {
      this.metrics.smsFailedTotal += recipientCount;
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

module.exports = new MetricsService();