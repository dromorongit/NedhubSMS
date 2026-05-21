const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const HubtelTransferService = require('../services/HubtelTransferService');

/**
 * POST /api/transfer/airtime
 * Buy airtime for phone number
 */
router.post('/airtime', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { phoneNumber, network, amount } = req.body;

    console.log(JSON.stringify({
      label: 'AirtimePurchase',
      timestamp: new Date().toISOString(),
      userId,
      phoneNumber,
      network,
      amount,
      phase: 'validation_start'
    }, null, 2));

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
       console.log(JSON.stringify({
         label: 'AirtimePurchase',
         timestamp: new Date().toISOString(),
         userId,
         phoneNumber,
         network,
         amount,
         phase: 'wallet_check_failed',
         walletFound: !!wallet,
         balance: wallet?.balance || 0
       }, null, 2));
       return res.status(400).json({
         success: false,
         message: 'Insufficient wallet balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelTransferService.generateClientReference('AIRTIME');

   console.log(JSON.stringify({
     label: 'AirtimePurchase',
     timestamp: new Date().toISOString(),
     userId,
     phoneNumber,
     network,
     amount,
     clientReference,
     balanceBefore,
     phase: 'transaction_created'
   }, null, 2));

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

   console.log(JSON.stringify({
     label: 'AirtimePurchase',
     timestamp: new Date().toISOString(),
     userId,
     clientReference,
     phoneNumber,
     network,
     amount,
     phase: 'provider_request_start'
   }, null, 2));

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
     console.error(JSON.stringify({
       label: 'AirtimePurchase',
       timestamp: new Date().toISOString(),
       userId,
       clientReference,
       phoneNumber,
       network,
       amount,
       phase: 'provider_request_failed',
       error: hubtelError.message,
       code: hubtelError.code,
       response: hubtelError.response?.data
     }, null, 2));

     // Rollback: mark transaction as failed (wallet was never deducted — reservation only)
     transaction.status = 'failed';
     transaction.description += ' - FAILED';
     transaction.metadata = {
       ...transaction.metadata,
       failureReason: hubtelError.message,
       failedAt: new Date()
     };
     try {
       await transaction.save();
     } catch (saveError) {
       console.error('[Transfer] CRITICAL: Failed to save failed transaction status:', saveError.message);
     }

     console.error('[Transfer] Hubtel API error details:', {
       message: hubtelError.message,
       stack: hubtelError.stack,
       code: hubtelError.code,
       response: hubtelError.response?.data
     });

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

   console.log(JSON.stringify({
     label: 'AirtimePurchase',
     timestamp: new Date().toISOString(),
     userId,
     clientReference,
     phoneNumber,
     network,
     amount,
     hubtelTransactionId: hubtelResult?.hubtelTransactionId,
     phase: 'provider_request_success',
     status: 'pending_confirmation'
   }, null, 2));

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
    console.error('[Transfer] Buy Airtime Error:', error);
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

    console.log(JSON.stringify({
      label: 'DataPurchase',
      timestamp: new Date().toISOString(),
      userId,
      phoneNumber,
      network,
      bundleCode,
      price,
      phase: 'validation_start'
    }, null, 2));

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
       console.log(JSON.stringify({
         label: 'DataPurchase',
         timestamp: new Date().toISOString(),
         userId,
         phoneNumber,
         network,
         bundleCode,
         price,
         phase: 'wallet_check_failed',
         walletFound: !!wallet,
         balance: wallet?.balance || 0
       }, null, 2));
       return res.status(400).json({
         success: false,
         message: 'Insufficient wallet balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelTransferService.generateClientReference('DATA');

   console.log(JSON.stringify({
     label: 'DataPurchase',
     timestamp: new Date().toISOString(),
     userId,
     phoneNumber,
     network,
     bundleCode,
     price,
     clientReference,
     balanceBefore,
     phase: 'transaction_created'
   }, null, 2));

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

   console.log(JSON.stringify({
     label: 'DataPurchase',
     timestamp: new Date().toISOString(),
     userId,
     clientReference,
     phoneNumber,
     network,
     bundleCode,
     price,
     phase: 'provider_request_start'
   }, null, 2));

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
     console.error(JSON.stringify({
       label: 'DataPurchase',
       timestamp: new Date().toISOString(),
       userId,
       clientReference,
       phoneNumber,
       network,
       bundleCode,
       price,
       phase: 'provider_request_failed',
       error: hubtelError.message,
       code: hubtelError.code,
       response: hubtelError.response?.data
     }, null, 2));

     // Rollback: mark transaction as failed (wallet was never deducted — reservation only)
     transaction.status = 'failed';
     transaction.description += ' - FAILED';
     transaction.metadata = {
       ...transaction.metadata,
       failureReason: hubtelError.message,
       failedAt: new Date()
     };
     try {
       await transaction.save();
     } catch (saveError) {
       console.error('[Transfer] CRITICAL: Failed to save failed transaction status (Data):', saveError.message);
     }

     console.error('[Transfer] Hubtel API error details (Data):', {
       message: hubtelError.message,
       stack: hubtelError.stack,
       code: hubtelError.code,
       response: hubtelError.response?.data
     });

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

   console.log(JSON.stringify({
     label: 'DataPurchase',
     timestamp: new Date().toISOString(),
     userId,
     clientReference,
     phoneNumber,
     network,
     bundleCode,
     price,
     hubtelTransactionId: hubtelResult?.hubtelTransactionId,
     phase: 'provider_request_success',
     status: 'pending_confirmation'
   }, null, 2));

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
    console.error('[Transfer] Buy Data Error:', error);
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

    console.log(JSON.stringify({
      label: 'TransactionLifecycle',
      timestamp: new Date().toISOString(),
      userId,
      clientReference,
      phase: 'status_check'
    }, null, 2));

    // Find transaction in our database
    const transaction = await Transaction.findOne({ reference: clientReference });

    if (!transaction) {
      console.log(JSON.stringify({
        label: 'TransactionLifecycle',
        timestamp: new Date().toISOString(),
        userId,
        clientReference,
        phase: 'not_found'
      }, null, 2));
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Only allow user to view their own transactions
    if (transaction.userId.toString() !== userId) {
      console.log(JSON.stringify({
        label: 'TransactionLifecycle',
        timestamp: new Date().toISOString(),
        userId,
        clientReference,
        phase: 'unauthorized_access'
      }, null, 2));
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log(JSON.stringify({
      label: 'TransactionLifecycle',
      timestamp: new Date().toISOString(),
      userId,
      clientReference,
      status: transaction.status,
      amount: transaction.amount,
      phase: 'status_returned'
    }, null, 2));

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
    console.error('[Transfer] Get Status Error:', error);
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

    console.log(JSON.stringify({
      label: 'TransactionReconciliation',
      timestamp: new Date().toISOString(),
      userId,
      phase: 'reconciliation_start'
    }, null, 2));

    // Find all pending_confirmation transactions older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const pendingTransactions = await Transaction.find({
      status: 'pending_confirmation',
      createdAt: { $lt: fiveMinutesAgo },
      'metadata.transactionType': { $in: ['AIRTIME_PURCHASE', 'DATA_PURCHASE'] }
    }).limit(100);

    console.log(JSON.stringify({
      label: 'TransactionReconciliation',
      timestamp: new Date().toISOString(),
      pendingCount: pendingTransactions.length,
      phase: 'pending_found'
    }, null, 2));

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

    console.log(JSON.stringify({
      label: 'TransactionReconciliation',
      timestamp: new Date().toISOString(),
      ...results,
      phase: 'reconciliation_complete'
    }, null, 2));

    res.json({
      success: true,
      message: 'Reconciliation complete',
      results
    });

  } catch (error) {
    console.error('[Transfer] Reconciliation Error:', error);
    res.status(500).json({ error: 'Reconciliation failed', details: error.message });
  }
});

module.exports = router;
