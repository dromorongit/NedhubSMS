const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

/**
 * HubtelCallbackController
 * Handles callbacks from Hubtel for Mobile Money, Bank Transfers, Airtime and Data
 */
class HubtelCallbackController {
  /**
   * Handle Mobile Money callback
   */
  async handleMomoCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Momo] Callback received', {
        body: req.body,
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const {
        clientReference,
        status,
        responseCode,
        responseMessage,
        transactionId,
        amount,
        phoneNumber,
        network
      } = req.body;

      // Validate callback has required fields
      if (!clientReference) {
        logger.error('[HubtelCallback] [Momo] Missing clientReference');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      // Find the transaction
      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        logger.error('[HubtelCallback] [Momo] Transaction not found', { clientReference });
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Check if already processed
      if (transaction.status === 'completed' || transaction.status === 'failed') {
        logger.info('[HubtelCallback] [Momo] Already processed (idempotent)', {
          clientReference, status: transaction.status
        });
        return res.json({ status: 'already_processed' });
      }

      // Hubtel response codes: 0000 = success
      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

      logger.info('[HubtelCallback] [Momo] Processing callback', {
        clientReference, responseCode, status, isSuccess
      });

      if (isSuccess) {
        // Deduct from wallet (transfer was initiated but wallet wasn't debited yet)
        const wallet = await Wallet.findOne({ userId: transaction.userId });

        if (wallet && wallet.balance >= transaction.amount) {
          // Deduct the amount from wallet
          await Wallet.findOneAndUpdate(
            { userId: transaction.userId, balance: { $gte: transaction.amount } },
            {
              $inc: { balance: -transaction.amount },
              $set: { updatedAt: new Date() }
            }
          );

          // Update transaction status
          transaction.status = 'completed';
          transaction.balanceAfter = wallet.balance - transaction.amount;
          transaction.metadata = {
            ...transaction.metadata,
            hubtelTransactionId: transactionId,
            completedAt: new Date(),
            callbackResponse: { responseCode, responseMessage }
          };
          await transaction.save();

          logger.info('[HubtelCallback] [Momo] Transfer completed', {
            clientReference, amount: transaction.amount, transactionId
          });
        } else {
          // Wallet might have insufficient balance now, mark as failed
          transaction.status = 'failed';
          transaction.description += ' - FAILED: Insufficient balance';
          transaction.metadata = {
            ...transaction.metadata,
            failedAt: new Date(),
            failureReason: 'Insufficient wallet balance at callback time'
          };
          await transaction.save();

          logger.error('[HubtelCallback] [Momo] Failed - insufficient balance', {
            clientReference, balance: wallet?.balance, amount: transaction.amount
          });
        }
      } else {
        // Transfer failed
        transaction.status = 'failed';
        transaction.description += ` - FAILED: ${responseMessage || 'Transfer failed'}`;
        transaction.metadata = {
          ...transaction.metadata,
          failedAt: new Date(),
          failureReason: responseMessage || 'Transfer failed'
        };
        await transaction.save();

        logger.warn('[HubtelCallback] [Momo] Transfer failed', {
          clientReference, responseCode, responseMessage
        });
      }

      res.json({ status: 'processed' });

    } catch (error) {
      logger.error('[HubtelCallback] [Momo] Unhandled error', {
        error: error.message, stack: error.stack
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle Bank Transfer callback
   */
  async handleBankCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Bank] Callback received', { body: req.body });

      const {
        clientReference,
        status,
        responseCode,
        responseMessage,
        transactionId,
        amount,
        bankCode,
        accountNumber
      } = req.body;

      if (!clientReference) {
        logger.error('[HubtelCallback] [Bank] Missing clientReference');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        logger.error('[HubtelCallback] [Bank] Transaction not found', { clientReference });
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (transaction.status === 'completed' || transaction.status === 'failed') {
        logger.info('[HubtelCallback] [Bank] Already processed (idempotent)', {
          clientReference, status: transaction.status
        });
        return res.json({ status: 'already_processed' });
      }

      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

      logger.info('[HubtelCallback] [Bank] Processing callback', {
        clientReference, responseCode, isSuccess
      });

      if (isSuccess) {
        const wallet = await Wallet.findOne({ userId: transaction.userId });

        if (wallet && wallet.balance >= transaction.amount) {
          await Wallet.findOneAndUpdate(
            { userId: transaction.userId, balance: { $gte: transaction.amount } },
            {
              $inc: { balance: -transaction.amount },
              $set: { updatedAt: new Date() }
            }
          );

          transaction.status = 'completed';
          transaction.balanceAfter = wallet.balance - transaction.amount;
          transaction.metadata = {
            ...transaction.metadata,
            hubtelTransactionId: transactionId,
            completedAt: new Date(),
            callbackResponse: { responseCode, responseMessage }
          };
          await transaction.save();

          logger.info('[HubtelCallback] [Bank] Transfer completed', {
            clientReference, amount: transaction.amount, transactionId
          });
        } else {
          transaction.status = 'failed';
          transaction.description += ' - FAILED: Insufficient balance';
          transaction.metadata = {
            ...transaction.metadata,
            failedAt: new Date(),
            failureReason: 'Insufficient wallet balance'
          };
          await transaction.save();

          logger.error('[HubtelCallback] [Bank] Failed - insufficient balance', {
            clientReference, balance: wallet?.balance
          });
        }
      } else {
        transaction.status = 'failed';
        transaction.description += ` - FAILED: ${responseMessage || 'Transfer failed'}`;
        transaction.metadata = {
          ...transaction.metadata,
          failedAt: new Date(),
          failureReason: responseMessage || 'Transfer failed'
        };
        await transaction.save();

        logger.warn('[HubtelCallback] [Bank] Transfer failed', {
          clientReference, responseCode, responseMessage
        });
      }

      res.json({ status: 'processed' });

    } catch (error) {
      logger.error('[HubtelCallback] [Bank] Unhandled error', {
        error: error.message, stack: error.stack
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle Airtime callback
   * CRITICAL: This is the authoritative source for final fulfillment status.
   * The transaction is created as 'pending_confirmation' and only marked
   * 'completed' here when Hubtel confirms successful delivery.
   */
  async handleAirtimeCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Airtime] Callback received', {
        body: req.body,
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const { clientReference, status, responseCode, responseMessage, transactionId, amount, phoneNumber, network } = req.body;

      if (!clientReference) {
        logger.error('[HubtelCallback] [Airtime] Missing clientReference');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        logger.error('[HubtelCallback] [Airtime] Transaction not found', { clientReference });
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Idempotency: if already in a terminal state, skip
      if (transaction.status === 'completed' || transaction.status === 'failed') {
        logger.info('[HubtelCallback] [Airtime] Already processed (idempotent)', {
          clientReference, status: transaction.status
        });
        return res.json({ status: 'already_processed' });
      }

      // Hubtel response codes: 0000 = success
      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

      logger.info('[HubtelCallback] [Airtime] Processing callback', {
        clientReference, responseCode, isSuccess
      });

      if (isSuccess) {
        // Wallet was already deducted at purchase time (balanceAfter set in route)
        // Just confirm the transaction as completed
        transaction.status = 'completed';
        transaction.metadata = {
          ...transaction.metadata,
          hubtelTransactionId: transactionId,
          completedAt: new Date(),
          callbackResponse: { responseCode, responseMessage },
          providerStatus: 'delivered'
        };
        await transaction.save();

        logger.info('[HubtelCallback] [Airtime] COMPLETED', {
          clientReference, amount: transaction.amount, hubtelTransactionId: transactionId
        });
      } else {
        // Provider failed — refund the wallet
        transaction.status = 'failed';
        transaction.description += ` - FAILED: ${responseMessage || 'Airtime delivery failed'}`;
        transaction.metadata = {
          ...transaction.metadata,
          hubtelTransactionId: transactionId,
          failedAt: new Date(),
          failureReason: responseMessage || 'Airtime delivery failed',
          callbackResponse: { responseCode, responseMessage },
          providerStatus: 'failed'
        };
        await transaction.save();

        // Refund wallet
        try {
          await Wallet.findOneAndUpdate(
            { userId: transaction.userId },
            {
              $inc: { balance: transaction.amount },
              $set: { updatedAt: new Date() }
            }
          );
          logger.info('[HubtelCallback] [Airtime] Wallet refunded', {
            clientReference, amount: transaction.amount
          });
        } catch (refundError) {
          logger.error('[HubtelCallback] [Airtime] CRITICAL: Wallet refund failed', {
            clientReference, error: refundError.message
          });
        }

        logger.warn('[HubtelCallback] [Airtime] FAILED', {
          clientReference, responseCode, responseMessage
        });
      }

      res.json({ status: 'processed' });

    } catch (error) {
      logger.error('[HubtelCallback] [Airtime] Unhandled error', {
        error: error.message, stack: error.stack
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle Data callback
   * CRITICAL: This is the authoritative source for final fulfillment status.
   * The transaction is created as 'pending_confirmation' and only marked
   * 'completed' here when Hubtel confirms successful delivery.
   */
  async handleDataCallback(req, res) {
    try {
      logger.info('[HubtelCallback] [Data] Callback received', {
        body: req.body,
        headers: {
          'user-agent': req.get('user-agent'),
          'x-forwarded-for': req.get('x-forwarded-for')
        }
      });

      const { clientReference, status, responseCode, responseMessage, transactionId, amount, phoneNumber, network } = req.body;

      if (!clientReference) {
        logger.error('[HubtelCallback] [Data] Missing clientReference');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        logger.error('[HubtelCallback] [Data] Transaction not found', { clientReference });
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Idempotency: if already in a terminal state, skip
      if (transaction.status === 'completed' || transaction.status === 'failed') {
        logger.info('[HubtelCallback] [Data] Already processed (idempotent)', {
          clientReference, status: transaction.status
        });
        return res.json({ status: 'already_processed' });
      }

      // Hubtel response codes: 0000 = success
      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

      logger.info('[HubtelCallback] [Data] Processing callback', {
        clientReference, responseCode, isSuccess
      });

      if (isSuccess) {
        // Wallet was already deducted at purchase time (balanceAfter set in route)
        // Just confirm the transaction as completed
        transaction.status = 'completed';
        transaction.metadata = {
          ...transaction.metadata,
          hubtelTransactionId: transactionId,
          completedAt: new Date(),
          callbackResponse: { responseCode, responseMessage },
          providerStatus: 'delivered'
        };
        await transaction.save();

        logger.info('[HubtelCallback] [Data] COMPLETED', {
          clientReference, amount: transaction.amount, hubtelTransactionId: transactionId
        });
      } else {
        // Provider failed — refund the wallet
        transaction.status = 'failed';
        transaction.description += ` - FAILED: ${responseMessage || 'Data delivery failed'}`;
        transaction.metadata = {
          ...transaction.metadata,
          hubtelTransactionId: transactionId,
          failedAt: new Date(),
          failureReason: responseMessage || 'Data delivery failed',
          callbackResponse: { responseCode, responseMessage },
          providerStatus: 'failed'
        };
        await transaction.save();

        // Refund wallet
        try {
          await Wallet.findOneAndUpdate(
            { userId: transaction.userId },
            {
              $inc: { balance: transaction.amount },
              $set: { updatedAt: new Date() }
            }
          );
          logger.info('[HubtelCallback] [Data] Wallet refunded', {
            clientReference, amount: transaction.amount
          });
        } catch (refundError) {
          logger.error('[HubtelCallback] [Data] CRITICAL: Wallet refund failed', {
            clientReference, error: refundError.message
          });
        }

        logger.warn('[HubtelCallback] [Data] FAILED', {
          clientReference, responseCode, responseMessage
        });
      }

      res.json({ status: 'processed' });

    } catch (error) {
      logger.error('[HubtelCallback] [Data] Unhandled error', {
        error: error.message, stack: error.stack
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new HubtelCallbackController();
