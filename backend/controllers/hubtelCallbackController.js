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
   */
  async handleAirtimeCallback(req, res) {
    try {
      console.log('[Callback] Airtime callback received:', JSON.stringify(req.body, null, 2));

      const { clientReference, status, responseCode, responseMessage, transactionId } = req.body;

      if (!clientReference) {
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Airtime is already deducted from wallet at purchase time
      // This callback just confirms the status
      if (transaction.status !== 'completed') {
        const isSuccess = responseCode === '0000' || status === 'SUCCESS';
        
        transaction.status = isSuccess ? 'completed' : 'failed';
        transaction.metadata = {
          ...transaction.metadata,
          hubtelTransactionId: transactionId,
          callbackResponse: { responseCode, responseMessage }
        };
        
        if (!isSuccess) {
          transaction.description += ' - FAILED';
        }
        
        await transaction.save();
      }

      res.json({ status: 'processed' });

    } catch (error) {
      console.error('[Callback] Airtime callback error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle Data callback
   */
  async handleDataCallback(req, res) {
    try {
      console.log('[Callback] Data callback received:', JSON.stringify(req.body, null, 2));

      const { clientReference, status, responseCode, responseMessage, transactionId } = req.body;

      if (!clientReference) {
        return res.status(400).json({ error: 'Missing clientReference' });
      }

      const transaction = await Transaction.findOne({ reference: clientReference });

      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Data is already deducted from wallet at purchase time
      if (transaction.status !== 'completed') {
        const isSuccess = responseCode === '0000' || status === 'SUCCESS';
        
        transaction.status = isSuccess ? 'completed' : 'failed';
        transaction.metadata = {
          ...transaction.metadata,
          hubtelTransactionId: transactionId,
          callbackResponse: { responseCode, responseMessage }
        };
        
        if (!isSuccess) {
          transaction.description += ' - FAILED';
        }
        
        await transaction.save();
      }

      res.json({ status: 'processed' });

    } catch (error) {
      console.error('[Callback] Data callback error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new HubtelCallbackController();
