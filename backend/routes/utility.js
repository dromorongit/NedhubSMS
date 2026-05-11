const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const HubtelCommissionService = require('../services/HubtelCommissionService');

/**
 * GET /api/utility/tv-bundles/:service
 * Get available TV bundles for a service
 */
router.get('/tv-bundles/:service', authenticate, async (req, res) => {
  try {
    const { service } = req.params;
    const validServices = ['DSTV', 'GOTV', 'STARTIMES'];
    
     if (!validServices.includes(service.toUpperCase())) {
       return res.status(400).json({
         success: false,
         message: 'Invalid TV service. Supported: DSTV, GOTV, STARTIMES',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
    
    const bundles = HubtelCommissionService.getTVBundles(service);
    
    res.json({
      success: true,
      service: service.toUpperCase(),
      bundles: bundles
    });
  } catch (error) {
    console.error('[Utility] Get TV Bundles Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get TV bundles',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/utility/tv-pay
 * Pay TV bill
 */
router.post('/tv-pay', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { serviceType, smartCardNumber, amount, customerName } = req.body;

     // Server-side validation
     if (!serviceType) {
       return res.status(400).json({
         success: false,
         message: 'Service type is required (DSTV, GOTV, or STARTIMES)',
         error: { code: 'VALIDATION_ERROR' }
       });
     }
     if (!smartCardNumber) {
       return res.status(400).json({
         success: false,
         message: 'Smart card number is required',
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
     const minAmount = 10;
     if (amount < minAmount) {
       return res.status(400).json({
         success: false,
         message: `Minimum payment amount is GHS ${minAmount.toFixed(2)}`,
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Validate service type
     const validServices = ['DSTV', 'GOTV', 'STARTIMES'];
     if (!validServices.includes(serviceType.toUpperCase())) {
       return res.status(400).json({
         success: false,
         message: 'Invalid service type. Supported: DSTV, GOTV, STARTIMES',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Check wallet balance
     const wallet = await Wallet.findOne({ userId });
     if (!wallet || wallet.balance < amount) {
       return res.status(400).json({
         success: false,
         message: 'Insufficient wallet balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelCommissionService.generateClientReference('TVPAY');

    // Deduct from wallet
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: amount } },
      { 
        $inc: { balance: -amount },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );

     if (!updatedWallet) {
       return res.status(400).json({
         success: false,
         message: 'Insufficient balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    // Create pending transaction record
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: amount,
      description: `${serviceType.toUpperCase()} payment for card ${smartCardNumber}`,
      reference: clientReference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore - amount,
      status: 'pending',
      metadata: {
        serviceType: serviceType.toUpperCase(),
        smartCardNumber: smartCardNumber,
        customerName: customerName || '',
        transactionType: 'TV_PAYMENT'
      }
    });
    await transaction.save();

    // Initiate TV payment
    try {
      await HubtelCommissionService.payTVBill({
        serviceType: serviceType,
        smartCardNumber: smartCardNumber,
        amount: amount,
        clientReference: clientReference
      });
    } catch (hubtelError) {
      // Rollback on failure
      await Wallet.findOneAndUpdate(
        { userId },
        { 
          $inc: { balance: amount },
          $set: { updatedAt: new Date() }
        }
      );
      transaction.status = 'failed';
      transaction.description += ' - FAILED';
      await transaction.save();
      
      throw new Error(`TV payment failed: ${hubtelError.message}`);
    }

    console.log(`[Utility] TV payment initiated: ${clientReference}, amount: ${amount}, user: ${userId}`);

    res.json({
      success: true,
      message: `${serviceType} payment initiated successfully`,
      clientReference: clientReference,
      amount: amount,
      serviceType: serviceType.toUpperCase(),
      smartCardNumber: smartCardNumber,
      newBalance: balanceBefore - amount
    });

  } catch (error) {
    console.error('[Utility] TV Pay Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process TV payment' });
  }
});

/**
 * GET /api/utility/utility-types
 * Get available utility types
 */
router.get('/utility-types', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      utilities: [
        { 
          code: 'ECG', 
          name: 'ECG (Electricity Company of Ghana)',
          type: 'prepaid_postpaid',
          fields: ['meterNumber', 'meterType', 'amount']
        },
        { 
          code: 'GHANA_WATER', 
          name: 'Ghana Water Company',
          type: 'prepaid',
          fields: ['meterNumber', 'amount']
        }
      ]
    });
  } catch (error) {
    console.error('[Utility] Get Utility Types Error:', error);
    res.status(500).json({ error: 'Failed to get utility types' });
  }
});

/**
 * POST /api/utility/ecg-pay
 * Pay ECG bill
 */
router.post('/ecg-pay', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { meterNumber, meterType, amount } = req.body;

    // Server-side validation
    if (!meterNumber) {
      return res.status(400).json({ error: 'Meter number is required' });
    }
    if (!meterType) {
      return res.status(400).json({ error: 'Meter type is required (PREPAID or POSTPAID)' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Validate meter type
    const validMeterTypes = ['PREPAID', 'POSTPAID'];
    if (!validMeterTypes.includes(meterType.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid meter type. Supported: PREPAID, POSTPAID' });
    }

    // Validate minimum amount
    const minAmount = 5;
    if (amount < minAmount) {
      return res.status(400).json({ error: `Minimum payment amount is GHS ${minAmount.toFixed(2)}` });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelCommissionService.generateClientReference('ECGPAY');

    // Deduct from wallet
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: amount } },
      { 
        $inc: { balance: -amount },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );

     if (!updatedWallet) {
       return res.status(400).json({
         success: false,
         message: 'Insufficient balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    // Create pending transaction record
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: amount,
      description: `ECG payment for meter ${meterNumber} (${meterType})`,
      reference: clientReference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore - amount,
      status: 'pending',
      metadata: {
        serviceType: 'ECG',
        meterNumber: meterNumber,
        meterType: meterType.toUpperCase(),
        transactionType: 'UTILITY_PAYMENT'
      }
    });
    await transaction.save();

    // Initiate ECG payment
    try {
      await HubtelCommissionService.payECGBill({
        meterNumber: meterNumber,
        meterType: meterType,
        amount: amount,
        clientReference: clientReference
      });
    } catch (hubtelError) {
      // Rollback on failure
      await Wallet.findOneAndUpdate(
        { userId },
        { 
          $inc: { balance: amount },
          $set: { updatedAt: new Date() }
        }
      );
      transaction.status = 'failed';
      transaction.description += ' - FAILED';
      await transaction.save();
      
      throw new Error(`ECG payment failed: ${hubtelError.message}`);
    }

    console.log(`[Utility] ECG payment initiated: ${clientReference}, amount: ${amount}, user: ${userId}`);

    res.json({
      success: true,
      message: 'ECG payment initiated successfully',
      clientReference: clientReference,
      amount: amount,
      meterNumber: meterNumber,
      meterType: meterType.toUpperCase(),
      newBalance: balanceBefore - amount
    });

  } catch (error) {
    console.error('[Utility] ECG Pay Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process ECG payment' });
  }
});

/**
 * POST /api/utility/water-pay
 * Pay Ghana Water bill
 */
router.post('/water-pay', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { meterNumber, amount } = req.body;

    // Server-side validation
    if (!meterNumber) {
      return res.status(400).json({ error: 'Meter number is required' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Validate minimum amount
    const minAmount = 5;
    if (amount < minAmount) {
      return res.status(400).json({ error: `Minimum payment amount is GHS ${minAmount.toFixed(2)}` });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelCommissionService.generateClientReference('GWCLPAY');

    // Deduct from wallet
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: amount } },
      { 
        $inc: { balance: -amount },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );

     if (!updatedWallet) {
       return res.status(400).json({
         success: false,
         message: 'Insufficient balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    // Create pending transaction record
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: amount,
      description: `Ghana Water payment for meter ${meterNumber}`,
      reference: clientReference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore - amount,
      status: 'pending',
      metadata: {
        serviceType: 'GHANA_WATER',
        meterNumber: meterNumber,
        transactionType: 'UTILITY_PAYMENT'
      }
    });
    await transaction.save();

    // Initiate Ghana Water payment
    try {
      await HubtelCommissionService.payGhanaWaterBill({
        meterNumber: meterNumber,
        amount: amount,
        clientReference: clientReference
      });
    } catch (hubtelError) {
      // Rollback on failure
      await Wallet.findOneAndUpdate(
        { userId },
        { 
          $inc: { balance: amount },
          $set: { updatedAt: new Date() }
        }
      );
      transaction.status = 'failed';
      transaction.description += ' - FAILED';
      await transaction.save();
      
      throw new Error(`Ghana Water payment failed: ${hubtelError.message}`);
    }

    console.log(`[Utility] Ghana Water payment initiated: ${clientReference}, amount: ${amount}, user: ${userId}`);

    res.json({
      success: true,
      message: 'Ghana Water payment initiated successfully',
      clientReference: clientReference,
      amount: amount,
      meterNumber: meterNumber,
      newBalance: balanceBefore - amount
    });

  } catch (error) {
    console.error('[Utility] Water Pay Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process Ghana Water payment' });
  }
});

/**
 * GET /api/utility/status/:clientReference
 * Check utility transaction status
 */
router.get('/status/:clientReference', authenticate, async (req, res) => {
  try {
    const { clientReference } = req.params;
    
    // Find transaction in our database
    const transaction = await Transaction.findOne({ reference: clientReference });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Only allow user to view their own transactions
    if (transaction.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

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
    console.error('[Utility] Get Status Error:', error);
    res.status(500).json({ error: 'Failed to get transaction status' });
  }
});

module.exports = router;
