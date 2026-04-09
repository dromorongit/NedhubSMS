const logger = require('./logger');

class AlertingService {
  async alertCriticalError(message, context) {
    logger.error('CRITICAL ALERT', { message, context, alert: true });
    // Railway will pick up error logs for alerting
  }

  async alertQueueFailure(campaignId, error) {
    logger.error('QUEUE FAILURE ALERT', {
      campaignId,
      error: error.message,
      alert: true,
      type: 'queue_failure'
    });
  }

  async alertPaymentFailure(clientReference, amount) {
    logger.error('PAYMENT FAILURE ALERT', {
      clientReference,
      amount,
      alert: true,
      type: 'payment_failure'
    });
  }
}

module.exports = new AlertingService();