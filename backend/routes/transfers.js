const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const HubtelTransferService = require('../services/HubtelTransferService');
const logger = require('../utils/logger');

/**
 * POST /api/transfer/airtime
 * Buy airtime for phone number
 */
router.post('/airtime', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { phoneNumber, network, amount } = req.body;

    logger.info('[AirtimeExecution] Purchase request received', {
      userId, phoneNumber, network, amount, phase: 'validation_start'
    });

     // Server-side validation
     if (!phoneNumber) {
       return res.status(400).json({
         success: false,
         message: 'Phone number is required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
     if (!network) {
       return res.status(400).json({
         success: false,
         message: 'Network is required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
     if (!amount || amount <= 0) {
       return res.status(400).json({
         success: false,
         message: 'Amount must be a positive number',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Validate minimum amount
     if (amount < 1) {
       return res.status(400).json({
         success: false,
         message: 'Minimum airtime amount is GHS 1.00',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Validate maximum amount
     const maxAmount = parseFloat(process.env.MAX_AIRTIME_AMOUNT) || 500;
     if (amount > maxAmount) {
       return res.status(400).json({
         success: false,
         message: `Maximum airtime amount is GHS ${maxAmount}`,
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Validate network
     const validNetworks = ['MTN', 'TELECEL', 'AIRTELTIGO', 'VODAFONE'];
     if (!validNetworks.includes(network.toUpperCase())) {
       return res.status(400).json({
         success: false,
         message: 'Invalid network. Supported: MTN, Telecel, AirtelTigo, Vodafone',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Check wallet balance
     const wallet = await Wallet.findOne({ userId });
     if (!wallet || wallet.balance < amount) {
       logger.warn('[AirtimeExecution] Wallet check failed', {
         userId, phoneNumber, network, amount,
         walletFound: !!wallet,
         balance: wallet?.balance || 0,
         phase: 'wallet_check_failed'
       });
       return res.status(400).json({
         success: false,
         message: 'Insufficient wallet balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelTransferService.generateClientReference('AIRTIME');

    logger.info('[AirtimeExecution] Transaction record created', {
      userId, phoneNumber, network, amount, clientReference, balanceBefore,
      phase: 'transaction_created'
    });

   // Create transaction record FIRST with 'pending_confirmation' status
   // CRITICAL: Status must NOT be 'completed' until Hubtel confirms delivery via callback
   const transaction = new Transaction({
     userId,
     type: 'debit',
     amount: amount,
     description: `Airtime purchase for ${phoneNumber} (${network})`,
     reference: clientReference,
     balanceBefore: balanceBefore,
     balanceAfter: balanceBefore - amount,
     status: 'pending_confirmation',
     metadata: {
       phoneNumber,
       network,
       transactionType: 'AIRTIME_PURCHASE',
       providerStatus: 'initiated'
     }
   });
   await transaction.save();

   logger.info('[AirtimeExecution] Dispatching provider request', {
     userId, clientReference, phoneNumber, network, amount,
     phase: 'provider_request_start'
   });

   // Initiate airtime purchase with Hubtel
   let hubtelResult;
   try {
     hubtelResult = await HubtelTransferService.buyAirtime({
       phoneNumber,
       network,
       amount,
       clientReference
     });
   } catch (hubtelError) {
     logger.error('[AirtimeExecution] Provider request failed', {
       userId, clientReference, phoneNumber, network, amount,
       phase: 'provider_request_failed',
       error: hubtelError.message,
       code: hubtelError.code,
       response: hubtelError.response?.data
     });

     // Rollback: mark transaction as failed
     transaction.status = 'failed';
     transaction.description += ' - FAILED';
     transaction.metadata = {
       ...transaction.metadata,
       failureReason: hubtelError.message,
       failedAt: new Date()
     };
     try {
       await transaction.save();
       logger.info('[AirtimeExecution] Transaction marked as failed after provider error', {
         clientReference, phase: 'rollback_complete'
       });
     } catch (saveError) {
       logger.error('[AirtimeExecution] CRITICAL: Failed to save failed transaction status', {
         clientReference, error: saveError.message
       });
     }

     // Return a more specific error message based on the error type
     let userMessage = 'Failed to buy airtime. Please try again.';
     if (hubtelError.message.includes('credentials') || hubtelError.message.includes('not configured')) {
       userMessage = 'Airtime service is currently unavailable. Please contact support.';
     } else if (hubtelError.message.includes('Invalid') || hubtelError.message.includes('invalid')) {
       userMessage = `Invalid request: ${hubtelError.message}`;
     } else if (hubtelError.message.includes('network') || hubtelError.message.includes('Network')) {
       userMessage = `Network error: ${hubtelError.message}`;
     } else if (hubtelError.message.includes('ETIMEDOUT') || hubtelError.message.includes('ECONNRESET') || hubtelError.message.includes('ENOTFOUND')) {
       userMessage = 'Network connection issue. Please check your connection and try again.';
     }

     return res.status(400).json({
       success: false,
       message: userMessage,
       error: {
         code: 'AIRTIME_PURCHASE_FAILED',
         details: hubtelError.message
       }
     });
   }

   logger.info('[AirtimeExecution] Provider request succeeded, returning to frontend', {
     userId, clientReference, phoneNumber, network, amount,
     hubtelTransactionId: hubtelResult?.hubtelTransactionId,
     phase: 'provider_request_success',
     status: 'pending_confirmation'
   });

   res.json({
     success: true,
     message: 'Airtime purchase initiated. You will be notified when delivery is confirmed.',
     clientReference: clientReference,
     amount: amount,
     phoneNumber: phoneNumber,
     network: network,
     hubtelTransactionId: hubtelResult?.hubtelTransactionId,
     status: 'pending_confirmation',
     newBalance: balanceBefore - amount
   });

  } catch (error) {
    logger.error('[AirtimeExecution] Unhandled error in route handler', {
      userId, error: error.message, stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Failed to buy airtime',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/transfer/data
 * Buy data bundle for phone number
 */
router.post('/data', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { phoneNumber, network, bundleCode, price } = req.body;

    logger.info('[DataExecution] Purchase request received', {
      userId, phoneNumber, network, bundleCode, price, phase: 'validation_start'
    });

     // Server-side validation
     if (!phoneNumber) {
       return res.status(400).json({
         success: false,
         message: 'Phone number is required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
     if (!network) {
       return res.status(400).json({
         success: false,
         message: 'Network is required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
     if (!bundleCode) {
       return res.status(400).json({
         success: false,
         message: 'Data bundle code is required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
     if (!price || price <= 0) {
       return res.status(400).json({
         success: false,
         message: 'Bundle price is required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Validate network
     const validNetworks = ['MTN', 'TELECEL', 'AIRTELTIGO', 'VODAFONE'];
     if (!validNetworks.includes(network.toUpperCase())) {
       return res.status(400).json({
         success: false,
         message: 'Invalid network',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Get available bundles for validation
     const bundles = HubtelTransferService.getDataBundles(network);
     const selectedBundle = bundles.find(b => b.code === bundleCode);
     
     if (!selectedBundle) {
       return res.status(400).json({
         success: false,
         message: 'Invalid bundle code',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Check wallet balance
     const wallet = await Wallet.findOne({ userId });
     if (!wallet || wallet.balance < price) {
       logger.warn('[DataExecution] Wallet check failed', {
         userId, phoneNumber, network, bundleCode, price,
         walletFound: !!wallet,
         balance: wallet?.balance || 0,
         phase: 'wallet_check_failed'
       });
       return res.status(400).json({
         success: false,
         message: 'Insufficient wallet balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelTransferService.generateClientReference('DATA');

    logger.info('[DataExecution] Transaction record created', {
      userId, phoneNumber, network, bundleCode, price, clientReference, balanceBefore,
      phase: 'transaction_created'
    });

   // Create transaction record FIRST with 'pending_confirmation' status
   // CRITICAL: Status must NOT be 'completed' until Hubtel confirms delivery via callback
   const transaction = new Transaction({
     userId,
     type: 'debit',
     amount: price,
     description: `Data bundle purchase for ${phoneNumber} (${selectedBundle.name})`,
     reference: clientReference,
     balanceBefore: balanceBefore,
     balanceAfter: balanceBefore - price,
     status: 'pending_confirmation',
     metadata: {
       phoneNumber,
       network,
       bundleCode,
       bundleName: selectedBundle.name,
       transactionType: 'DATA_PURCHASE',
       providerStatus: 'initiated'
     }
   });
   await transaction.save();

   logger.info('[DataExecution] Dispatching provider request', {
     userId, clientReference, phoneNumber, network, bundleCode, price,
     phase: 'provider_request_start'
   });

   // Initiate data purchase with Hubtel
   let hubtelResult;
   try {
     hubtelResult = await HubtelTransferService.buyData({
       phoneNumber,
       network,
       dataBundleCode: bundleCode,
       clientReference
     });
   } catch (hubtelError) {
     logger.error('[DataExecution] Provider request failed', {
       userId, clientReference, phoneNumber, network, bundleCode, price,
       phase: 'provider_request_failed',
       error: hubtelError.message,
       code: hubtelError.code,
       response: hubtelError.response?.data
     });

     // Rollback: mark transaction as failed
     transaction.status = 'failed';
     transaction.description += ' - FAILED';
     transaction.metadata = {
       ...transaction.metadata,
       failureReason: hubtelError.message,
       failedAt: new Date()
     };
     try {
       await transaction.save();
       logger.info('[DataExecution] Transaction marked as failed after provider error', {
         clientReference, phase: 'rollback_complete'
       });
     } catch (saveError) {
       logger.error('[DataExecution] CRITICAL: Failed to save failed transaction status (Data)', {
         clientReference, error: saveError.message
       });
     }

     // Return a more specific error message based on the error type
     let userMessage = 'Failed to buy data bundle. Please try again.';
     if (hubtelError.message.includes('credentials') || hubtelError.message.includes('not configured')) {
       userMessage = 'Data bundle service is currently unavailable. Please contact support.';
     } else if (hubtelError.message.includes('Invalid') || hubtelError.message.includes('invalid')) {
       userMessage = `Invalid request: ${hubtelError.message}`;
     } else if (hubtelError.message.includes('network') || hubtelError.message.includes('Network')) {
       userMessage = `Network error: ${hubtelError.message}`;
     } else if (hubtelError.message.includes('ETIMEDOUT') || hubtelError.message.includes('ECONNRESET') || hubtelError.message.includes('ENOTFOUND')) {
       userMessage = 'Network connection issue. Please check your connection and try again.';
     }

     return res.status(400).json({
       success: false,
       message: userMessage,
       error: {
         code: 'DATA_PURCHASE_FAILED',
         details: hubtelError.message
       }
     });
   }

   logger.info('[DataExecution] Provider request succeeded, returning to frontend', {
     userId, clientReference, phoneNumber, network, bundleCode, price,
     hubtelTransactionId: hubtelResult?.hubtelTransactionId,
     phase: 'provider_request_success',
     status: 'pending_confirmation'
   });

   res.json({
     success: true,
     message: 'Data bundle purchase initiated. You will be notified when delivery is confirmed.',
     clientReference: clientReference,
     amount: price,
     bundle: selectedBundle,
     phoneNumber: phoneNumber,
     network: network,
     hubtelTransactionId: hubtelResult?.hubtelTransactionId,
     status: 'pending_confirmation',
     newBalance: balanceBefore - price
   });

  } catch (error) {
    logger.error('[DataExecution] Unhandled error in route handler', {
      userId, error: error.message, stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Failed to buy data bundle',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

/**
 * GET /api/transfer/data-bundles/:network
 * Get available data bundles for a network
 */
router.get('/data-bundles/:network', authenticate, async (req, res) => {
  try {
    const { network } = req.params;
    const bundles = HubtelTransferService.getDataBundles(network);
    res.json({
      success: true,
      network: network,
      bundles: bundles
    });
  } catch (error) {
    console.error('[Transfer] Get Data Bundles Error:', error);
    res.status(500).json({ error: 'Failed to get data bundles' });
  }
});

/**
 * GET /api/transfer/status/:clientReference
 * Check transaction status
 */
router.get('/status/:clientReference', authenticate, async (req, res) => {
  try {
    const { clientReference } = req.params;
    const userId = req.user.userId;

    logger.info('[TransactionLifecycle] Status poll received', {
      userId, clientReference, phase: 'status_check'
    });

    // Find transaction in our database
    const transaction = await Transaction.findOne({ reference: clientReference });

    if (!transaction) {
      logger.warn('[TransactionLifecycle] Transaction not found on status poll', {
        userId, clientReference, phase: 'not_found'
      });
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Only allow user to view their own transactions
    if (transaction.userId.toString() !== userId) {
      logger.warn('[TransactionLifecycle] Unauthorized status poll attempt', {
        userId, clientReference, phase: 'unauthorized_access'
      });
      return res.status(403).json({ error: 'Unauthorized' });
    }

    logger.info('[TransactionLifecycle] Status returned to frontend', {
      userId, clientReference,
      status: transaction.status,
      amount: transaction.amount,
      phase: 'status_returned'
    });

    res.json({
      success: true,
      transaction: {
        reference: transaction.reference,
        status: transaction.status,
        amount: transaction.amount,
        type: transaction.type,
        description: transaction.description,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        metadata: transaction.metadata
      }
    });

  } catch (error) {
    logger.error('[TransactionLifecycle] Get Status Error', {
      error: error.message, stack: error.stack
    });
    res.status(500).json({ error: 'Failed to get transaction status' });
  }
});

/**
 * GET /api/transfer/reconcile
 * Admin-only: Reconcile pending_confirmation transactions
 * Checks Hubtel for final status of transactions stuck in pending_confirmation
 */
router.get('/reconcile', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await require('../models/User').findById(userId);

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    logger.info('[TransactionLifecycle] Manual reconciliation triggered', {
      userId, phase: 'reconciliation_start'
    });

    // Find all pending_confirmation transactions older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const pendingTransactions = await Transaction.find({
      status: 'pending_confirmation',
      createdAt: { $lt: fiveMinutesAgo },
      'metadata.transactionType': { $in: ['AIRTIME_PURCHASE', 'DATA_PURCHASE'] }
    }).limit(100);

    logger.info('[TransactionLifecycle] Pending transactions found for reconciliation', {
      pendingCount: pendingTransactions.length,
      phase: 'pending_found'
    });

    const results = {
      totalChecked: pendingTransactions.length,
      updated: 0,
      stillPending: 0,
      errors: 0,
      details: []
    };

    for (const tx of pendingTransactions) {
      try {
        const hubtelStatus = await HubtelTransferService.checkTransactionStatus(tx.reference);

        if (hubtelStatus.success) {
          const mappedStatus = hubtelStatus.status; // 'success', 'failed', 'pending', 'cancelled'

          if (mappedStatus === 'success') {
            tx.status = 'completed';
            tx.metadata = {
              ...tx.metadata,
              completedAt: new Date(),
              providerStatus: 'delivered',
              reconciliationNote: 'Confirmed via reconciliation check'
            };
            await tx.save();
            results.updated++;
            results.details.push({ reference: tx.reference, action: 'completed' });
          } else if (mappedStatus === 'failed' || mappedStatus === 'cancelled') {
            tx.status = 'failed';
            tx.description += ` - FAILED (reconciliation): ${hubtelStatus.responseCode || 'unknown'}`;
            tx.metadata = {
              ...tx.metadata,
              failedAt: new Date(),
              failureReason: `Provider reported ${mappedStatus}`,
              reconciliationNote: 'Confirmed failed via reconciliation check'
            };
            await tx.save();
            // Refund wallet
            await Wallet.findOneAndUpdate(
              { userId: tx.userId },
              { $inc: { balance: tx.amount }, $set: { updatedAt: new Date() } }
            );
            results.updated++;
            results.details.push({ reference: tx.reference, action: 'failed_refunded' });
          } else {
            results.stillPending++;
            results.details.push({ reference: tx.reference, action: 'still_pending', hubtelStatus: mappedStatus });
          }
        } else {
          results.errors++;
          results.details.push({ reference: tx.reference, action: 'status_check_failed', error: hubtelStatus });
        }
      } catch (err) {
        results.errors++;
        results.details.push({ reference: tx.reference, action: 'error', error: err.message });
      }
    }

    logger.info('[TransactionLifecycle] Reconciliation complete', {
      ...results, phase: 'reconciliation_complete'
    });

    res.json({
      success: true,
      message: 'Reconciliation complete',
      results
    });

  } catch (error) {
    logger.error('[TransactionLifecycle] Reconciliation Error', {
      error: error.message, stack: error.stack
    });
    res.status(500).json({ error: 'Reconciliation failed', details: error.message });
  }
});

module.exports = router;
