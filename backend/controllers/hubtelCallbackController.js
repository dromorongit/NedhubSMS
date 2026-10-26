const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const CallbackVerificationService = require('../services/callbackVerificationService');
const logger = require('../utils/logger');

const verificationService = new CallbackVerificationService();

/**
 * HubtelCallbackController
 *
 * Handles callbacks from Hubtel for Mobile Money, Bank Transfers, Airtime and
 * Data. The callback body is never trusted for state changes: OUR transaction
 * record is looked up by reference and Hubtel is queried server-to-server for
 * the final status. Completion, failure and refunds use amounts from OUR
 * transaction record, never from the callback body. Every state change is a
 * single conditional update so a repeated callback can never apply twice.
 */
class HubtelCallbackController {
  async handleMomoCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Momo] Callback received', {
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const { clientReference } = req.body || {};

      if (!clientReference) {
        logger.warn('[HubtelCallback] [Momo] Missing clientReference');
        return res.status(200).json({ received: true });
      }

      const result = await verificationService.processTransferCallback(clientReference, 'momo');

      switch (result.action) {
        case 'complete':
          logger.info('[HubtelCallback] [Momo] Transfer completed via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'completed' });
        case 'mark_failed':
          logger.info('[HubtelCallback] [Momo] Transfer failed via provider confirmation', {
            clientReference, reason: result.reason
          });
          return res.status(200).json({ status: 'failed' });
        case 'already_terminal':
          logger.info('[HubtelCallback] [Momo] Already processed (idempotent)', {
            clientReference, status: result.status
          });
          return res.status(200).json({ status: 'already_processed' });
        case 'not_found':
          logger.warn('[HubtelCallback] [Momo] Transaction not found', { clientReference });
          return res.status(200).json({ received: true });
        case 'provider_unavailable':
          logger.warn('[HubtelCallback] [Momo] Provider unavailable, transaction left waiting', {
            clientReference, error: result.error
          });
          return res.status(200).json({ status: 'left_pending' });
        default:
          logger.info('[HubtelCallback] [Momo] Transaction left waiting', {
            clientReference, providerStatus: result.providerStatus
          });
          return res.status(200).json({ status: 'left_pending' });
      }
    } catch (error) {
      logger.error('[HubtelCallback] [Momo] Unhandled error', {
        error: error.message, stack: error.stack
      });
      return res.status(200).json({ received: true });
    }
  }

  async handleBankCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Bank] Callback received', { body: { hasBody: !!req.body } });

      const { clientReference } = req.body || {};

      if (!clientReference) {
        logger.warn('[HubtelCallback] [Bank] Missing clientReference');
        return res.status(200).json({ received: true });
      }

      const result = await verificationService.processTransferCallback(clientReference, 'bank');

      switch (result.action) {
        case 'complete':
          logger.info('[HubtelCallback] [Bank] Transfer completed via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'completed' });
        case 'mark_failed':
          logger.info('[HubtelCallback] [Bank] Transfer failed via provider confirmation', {
            clientReference, reason: result.reason
          });
          return res.status(200).json({ status: 'failed' });
        case 'already_terminal':
          logger.info('[HubtelCallback] [Bank] Already processed (idempotent)', {
            clientReference, status: result.status
          });
          return res.status(200).json({ status: 'already_processed' });
        case 'not_found':
          logger.warn('[HubtelCallback] [Bank] Transaction not found', { clientReference });
          return res.status(200).json({ received: true });
        case 'provider_unavailable':
          logger.warn('[HubtelCallback] [Bank] Provider unavailable, transaction left waiting', {
            clientReference, error: result.error
          });
          return res.status(200).json({ status: 'left_pending' });
        default:
          logger.info('[HubtelCallback] [Bank] Transaction left waiting', {
            clientReference, providerStatus: result.providerStatus
          });
          return res.status(200).json({ status: 'left_pending' });
      }
    } catch (error) {
      logger.error('[HubtelCallback] [Bank] Unhandled error', {
        error: error.message, stack: error.stack
      });
      return res.status(200).json({ received: true });
    }
  }

  async handleAirtimeCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Airtime] Callback received', {
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const { clientReference } = req.body || {};

      if (!clientReference) {
        logger.warn('[HubtelCallback] [Airtime] Missing clientReference');
        return res.status(200).json({ received: true });
      }

      const result = await verificationService.processAirtimeCallback(clientReference);

      switch (result.action) {
        case 'complete':
          logger.info('[HubtelCallback] [Airtime] COMPLETED via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'completed' });
        case 'refund':
          logger.info('[HubtelCallback] [Airtime] Wallet refunded via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'refunded' });
        case 'already_terminal':
          logger.info('[HubtelCallback] [Airtime] Already processed (idempotent)', {
            clientReference, status: result.status
          });
          return res.status(200).json({ status: 'already_processed' });
        case 'not_found':
          logger.warn('[HubtelCallback] [Airtime] Transaction not found', { clientReference });
          return res.status(200).json({ received: true });
        case 'provider_unavailable':
          logger.warn('[HubtelCallback] [Airtime] Provider unavailable, transaction left waiting', {
            clientReference, error: result.error
          });
          return res.status(200).json({ status: 'left_pending' });
        default:
          logger.info('[HubtelCallback] [Airtime] Transaction left waiting', {
            clientReference, providerStatus: result.providerStatus
          });
          return res.status(200).json({ status: 'left_pending' });
      }
    } catch (error) {
      logger.error('[HubtelCallback] [Airtime] Unhandled error', {
        error: error.message, stack: error.stack
      });
      return res.status(200).json({ received: true });
    }
  }

  async handleDataCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Data] Callback received', {
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const { clientReference } = req.body || {};

      if (!clientReference) {
        logger.warn('[HubtelCallback] [Data] Missing clientReference');
        return res.status(200).json({ received: true });
      }

      const result = await verificationService.processDataCallback(clientReference);

      switch (result.action) {
        case 'complete':
          logger.info('[HubtelCallback] [Data] COMPLETED via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'completed' });
        case 'refund':
          logger.info('[HubtelCallback] [Data] Wallet refunded via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'refunded' });
        case 'already_terminal':
          logger.info('[HubtelCallback] [Data] Already processed (idempotent)', {
            clientReference, status: result.status
          });
          return res.status(200).json({ status: 'already_processed' });
        case 'not_found':
          logger.warn('[HubtelCallback] [Data] Transaction not found', { clientReference });
          return res.status(200).json({ received: true });
        case 'provider_unavailable':
          logger.warn('[HubtelCallback] [Data] Provider unavailable, transaction left waiting', {
            clientReference, error: result.error
          });
          return res.status(200).json({ status: 'left_pending' });
        default:
          logger.info('[HubtelCallback] [Data] Transaction left waiting', {
            clientReference, providerStatus: result.providerStatus
          });
          return res.status(200).json({ status: 'left_pending' });
      }
    } catch (error) {
      logger.error('[HubtelCallback] [Data] Unhandled error', {
        error: error.message, stack: error.stack
      });
      return res.status(200).json({ received: true });
    }
  }

  async handleTvCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [TV] Callback received', {
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const { clientReference } = req.body || {};

      if (!clientReference) {
        logger.warn('[HubtelCallback] [TV] Missing clientReference');
        return res.status(200).json({ received: true });
      }

      const result = await verificationService.processTvCallback(clientReference);

      switch (result.action) {
        case 'complete':
          logger.info('[HubtelCallback] [TV] COMPLETED via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'completed' });
        case 'refund':
          logger.info('[HubtelCallback] [TV] Wallet refunded via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'refunded' });
        case 'already_terminal':
          logger.info('[HubtelCallback] [TV] Already processed (idempotent)', {
            clientReference, status: result.status
          });
          return res.status(200).json({ status: 'already_processed' });
        case 'not_found':
          logger.warn('[HubtelCallback] [TV] Transaction not found', { clientReference });
          return res.status(200).json({ received: true });
        case 'provider_unavailable':
          logger.warn('[HubtelCallback] [TV] Provider unavailable, transaction left waiting', {
            clientReference, error: result.error
          });
          return res.status(200).json({ status: 'left_pending' });
        default:
          logger.info('[HubtelCallback] [TV] Transaction left waiting', {
            clientReference, providerStatus: result.providerStatus
          });
          return res.status(200).json({ status: 'left_pending' });
      }
    } catch (error) {
      logger.error('[HubtelCallback] [TV] Unhandled error', {
        error: error.message, stack: error.stack
      });
      return res.status(200).json({ received: true });
    }
  }

  async handleUtilityCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Utility] Callback received', {
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const { clientReference } = req.body || {};

      if (!clientReference) {
        logger.warn('[HubtelCallback] [Utility] Missing clientReference');
        return res.status(200).json({ received: true });
      }

      const result = await verificationService.processUtilityCallback(clientReference);

      switch (result.action) {
        case 'complete':
          logger.info('[HubtelCallback] [Utility] COMPLETED via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'completed' });
        case 'refund':
          logger.info('[HubtelCallback] [Utility] Wallet refunded via provider confirmation', {
            clientReference, amount: result.transaction.amount
          });
          return res.status(200).json({ status: 'refunded' });
        case 'already_terminal':
          logger.info('[HubtelCallback] [Utility] Already processed (idempotent)', {
            clientReference, status: result.status
          });
          return res.status(200).json({ status: 'already_processed' });
        case 'not_found':
          logger.warn('[HubtelCallback] [Utility] Transaction not found', { clientReference });
          return res.status(200).json({ received: true });
        case 'provider_unavailable':
          logger.warn('[HubtelCallback] [Utility] Provider unavailable, transaction left waiting', {
            clientReference, error: result.error
          });
          return res.status(200).json({ status: 'left_pending' });
        default:
          logger.info('[HubtelCallback] [Utility] Transaction left waiting', {
            clientReference, providerStatus: result.providerStatus
          });
          return res.status(200).json({ status: 'left_pending' });
      }
    } catch (error) {
      logger.error('[HubtelCallback] [Utility] Unhandled error', {
        error: error.message, stack: error.stack
      });
      return res.status(200).json({ received: true });
    }
  }
}

module.exports = new HubtelCallbackController();
