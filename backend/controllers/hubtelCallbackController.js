const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

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
      console.log('[Callback] Mobile Money callback received:', JSON.stringify(req.body, null, 2));

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
        console.error('[Callback] Missing clientReference in MoMo callback');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      // Find the transaction
      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        console.error(`[Callback] Transaction not found: ${clientReference}`);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Check if already processed
      if (transaction.status === 'completed' || transaction.status === 'failed') {
        console.log(`[Callback] Transaction already processed: ${clientReference}, status: ${transaction.status}`);
        return res.json({ status: 'already_processed' });
      }

      // Hubtel response codes: 0000 = success
      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

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

          console.log(`[Callback] MoMo transfer completed: ${clientReference}, amount: ${transaction.amount}`);
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
          
          console.error(`[Callback] MoMo failed - insufficient balance: ${clientReference}`);
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

        console.log(`[Callback] MoMo transfer failed: ${clientReference}, reason: ${responseMessage}`);
      }

      res.json({ status: 'processed' });

    } catch (error) {
      console.error('[Callback] MoMo callback error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle Bank Transfer callback
   */
  async handleBankCallback(req, res) {
    try {
      console.log('[Callback] Bank Transfer callback received:', JSON.stringify(req.body, null, 2));

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
        console.error('[Callback] Missing clientReference in Bank callback');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        console.error(`[Callback] Bank transaction not found: ${clientReference}`);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (transaction.status === 'completed' || transaction.status === 'failed') {
        console.log(`[Callback] Bank transaction already processed: ${clientReference}`);
        return res.json({ status: 'already_processed' });
      }

      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

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

          console.log(`[Callback] Bank transfer completed: ${clientReference}`);
        } else {
          transaction.status = 'failed';
          transaction.description += ' - FAILED: Insufficient balance';
          transaction.metadata = {
            ...transaction.metadata,
            failedAt: new Date(),
            failureReason: 'Insufficient wallet balance'
          };
          await transaction.save();
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

        console.log(`[Callback] Bank transfer failed: ${clientReference}`);
      }

      res.json({ status: 'processed' });

    } catch (error) {
      console.error('[Callback] Bank callback error:', error);
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
      console.log('[Callback] [AirtimeCallback] Received:', JSON.stringify(req.body, null, 2));

      const { clientReference, status, responseCode, responseMessage, transactionId, amount, phoneNumber, network } = req.body;

      if (!clientReference) {
        console.error('[Callback] [AirtimeCallback] Missing clientReference');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        console.error(`[Callback] [AirtimeCallback] Transaction not found: ${clientReference}`);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Idempotency: if already in a terminal state, skip
      if (transaction.status === 'completed' || transaction.status === 'failed') {
        console.log(`[Callback] [AirtimeCallback] Already processed: ${clientReference}, status: ${transaction.status}`);
        return res.json({ status: 'already_processed' });
      }

      // Hubtel response codes: 0000 = success
      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

      console.log(`[Callback] [AirtimeCallback] Processing: ${clientReference}, isSuccess: ${isSuccess}, responseCode: ${responseCode}`);

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

        console.log(`[Callback] [AirtimeCallback] COMPLETED: ${clientReference}, amount: ${transaction.amount}, hubtelTxnId: ${transactionId}`);
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
          console.log(`[Callback] [AirtimeCallback] Wallet refunded: ${clientReference}, amount: ${transaction.amount}`);
        } catch (refundError) {
          console.error(`[Callback] [AirtimeCallback] CRITICAL: Wallet refund failed for ${clientReference}:`, refundError.message);
        }

        console.log(`[Callback] [AirtimeCallback] FAILED: ${clientReference}, reason: ${responseMessage}`);
      }

      res.json({ status: 'processed' });

    } catch (error) {
      console.error('[Callback] [AirtimeCallback] Error:', error);
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
      console.log('[Callback] [DataCallback] Received:', JSON.stringify(req.body, null, 2));

      const { clientReference, status, responseCode, responseMessage, transactionId, amount, phoneNumber, network } = req.body;

      if (!clientReference) {
        console.error('[Callback] [DataCallback] Missing clientReference');
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        console.error(`[Callback] [DataCallback] Transaction not found: ${clientReference}`);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Idempotency: if already in a terminal state, skip
      if (transaction.status === 'completed' || transaction.status === 'failed') {
        console.log(`[Callback] [DataCallback] Already processed: ${clientReference}, status: ${transaction.status}`);
        return res.json({ status: 'already_processed' });
      }

      // Hubtel response codes: 0000 = success
      const isSuccess = responseCode === '0000' || status === 'SUCCESS' || status === 'SUCCESSFUL';

      console.log(`[Callback] [DataCallback] Processing: ${clientReference}, isSuccess: ${isSuccess}, responseCode: ${responseCode}`);

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

        console.log(`[Callback] [DataCallback] COMPLETED: ${clientReference}, amount: ${transaction.amount}, hubtelTxnId: ${transactionId}`);
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
          console.log(`[Callback] [DataCallback] Wallet refunded: ${clientReference}, amount: ${transaction.amount}`);
        } catch (refundError) {
          console.error(`[Callback] [DataCallback] CRITICAL: Wallet refund failed for ${clientReference}:`, refundError.message);
        }

        console.log(`[Callback] [DataCallback] FAILED: ${clientReference}, reason: ${responseMessage}`);
      }

      res.json({ status: 'processed' });

    } catch (error) {
      console.error('[Callback] [DataCallback] Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new HubtelCallbackController();
