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
       return res.status(400).json({
         success: false,
         message: 'Insufficient wallet balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelTransferService.generateClientReference('AIRTIME');

    // Deduct from wallet immediately for airtime (instant service)
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

    // Create transaction record
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: amount,
      description: `Airtime purchase for ${phoneNumber} (${network})`,
      reference: clientReference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore - amount,
      status: 'completed',
      metadata: {
        phoneNumber,
        network,
        transactionType: 'AIRTIME_PURCHASE'
      }
    });
    await transaction.save();

    // Initiate airtime purchase
    try {
      await HubtelTransferService.buyAirtime({
        phoneNumber,
        network,
        amount,
        clientReference
      });
    } catch (hubtelError) {
      // Rollback the wallet deduction if Hubtel fails
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
      
      throw new Error(`Airtime purchase failed: ${hubtelError.message}`);
    }

    console.log(`[Transfer] Airtime purchased: ${clientReference}, amount: ${amount}, user: ${userId}`);

    res.json({
      success: true,
      message: 'Airtime purchased successfully',
      clientReference: clientReference,
      amount: amount,
      phoneNumber: phoneNumber,
      network: network,
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
       return res.status(400).json({
         success: false,
         message: 'Insufficient wallet balance',
         error: { code: 'INSUFFICIENT_BALANCE' }
       });
     }

    const balanceBefore = wallet.balance;
    const clientReference = HubtelTransferService.generateClientReference('DATA');

    // Deduct from wallet
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: price } },
      { 
        $inc: { balance: -price },
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

    // Create transaction record
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: price,
      description: `Data bundle purchase for ${phoneNumber} (${selectedBundle.name})`,
      reference: clientReference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore - price,
      status: 'completed',
      metadata: {
        phoneNumber,
        network,
        bundleCode,
        bundleName: selectedBundle.name,
        transactionType: 'DATA_PURCHASE'
      }
    });
    await transaction.save();

    // Initiate data purchase
    try {
      await HubtelTransferService.buyData({
        phoneNumber,
        network,
        dataBundleCode: bundleCode,
        clientReference
      });
    } catch (hubtelError) {
      // Rollback on failure
      await Wallet.findOneAndUpdate(
        { userId },
        { 
          $inc: { balance: price },
          $set: { updatedAt: new Date() }
        }
      );
      transaction.status = 'failed';
      transaction.description += ' - FAILED';
      await transaction.save();
      
      throw new Error(`Data purchase failed: ${hubtelError.message}`);
    }

    console.log(`[Transfer] Data purchased: ${clientReference}, amount: ${price}, user: ${userId}`);

    res.json({
      success: true,
      message: 'Data bundle purchased successfully',
      clientReference: clientReference,
      amount: price,
      bundle: selectedBundle,
      phoneNumber: phoneNumber,
      network: network,
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
    console.error('[Transfer] Get Status Error:', error);
    res.status(500).json({ error: 'Failed to get transaction status' });
  }
});

module.exports = router;
