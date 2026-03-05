const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const HubtelTransferService = require('../services/HubtelTransferService');

/**
 * POST /api/transfer/send-momo
 * Send money to mobile money wallet
 */
router.post('/send-momo', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 
      recipientPhone, 
      recipientName, 
      network, 
      amount, 
      description 
    } = req.body;

    // Server-side validation
    if (!recipientPhone) {
      return res.status(400).json({ error: 'Recipient phone number is required' });
    }
    if (!recipientName) {
      return res.status(400).json({ error: 'Recipient name is required' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    // Validate minimum amount
    if (amount < 1) {
      return res.status(400).json({ error: 'Minimum transfer amount is GHS 1.00' });
    }

    // Validate maximum amount (can be configured)
    const maxAmount = parseFloat(process.env.MAX_TRANSFER_AMOUNT) || 5000;
    if (amount > maxAmount) {
      return res.status(400).json({ error: `Maximum transfer amount is GHS ${maxAmount}` });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // Generate unique client reference
    const clientReference = HubtelTransferService.generateClientReference('MOMO');

    // Store pending transfer record in transaction
    const balanceBefore = wallet.balance;

    // Initiate the transfer
    const transferResult = await HubtelTransferService.sendMobileMoney({
      recipientPhone,
      recipientName,
      network,
      amount,
      description,
      clientReference
    });

    // Create pending transaction record (debit only after callback)
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: amount,
      description: `Send Money to ${recipientName} (${recipientPhone}) - ${description}`,
      reference: clientReference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore, // Will be updated after callback
      status: 'pending',
      metadata: {
        recipientPhone,
        recipientName,
        network,
        hubtelTransactionId: transferResult.hubtelTransactionId,
        transactionType: 'SEND_MONEY'
      }
    });
    await transaction.save();

    console.log(`[Transfer] Mobile money initiated: ${clientReference}, amount: ${amount}, user: ${userId}`);

    res.json({
      success: true,
      message: 'Mobile money transfer initiated successfully',
      clientReference: clientReference,
      status: 'pending',
      amount: amount,
      recipient: {
        phone: recipientPhone,
        name: recipientName
      }
    });

  } catch (error) {
    console.error('[Transfer] Send Momo Error:', error);
    res.status(500).json({ error: error.message || 'Failed to send mobile money' });
  }
});

/**
 * POST /api/transfer/send-bank
 * Send money to bank account
 */
router.post('/send-bank', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 
      bankCode, 
      accountNumber, 
      accountName, 
      amount, 
      description 
    } = req.body;

    // Server-side validation
    if (!bankCode) {
      return res.status(400).json({ error: 'Bank code is required' });
    }
    if (!accountNumber) {
      return res.status(400).json({ error: 'Account number is required' });
    }
    if (!accountName) {
      return res.status(400).json({ error: 'Account name is required' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    // Validate minimum amount
    if (amount < 5) {
      return res.status(400).json({ error: 'Minimum bank transfer amount is GHS 5.00' });
    }

    // Validate maximum amount
    const maxAmount = parseFloat(process.env.MAX_BANK_TRANSFER_AMOUNT) || 20000;
    if (amount > maxAmount) {
      return res.status(400).json({ error: `Maximum bank transfer amount is GHS ${maxAmount}` });
    }

    // Validate account number
    if (!/^\d{4,16}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Invalid account number format' });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // Generate unique client reference
    const clientReference = HubtelTransferService.generateClientReference('BANK');

    const balanceBefore = wallet.balance;

    // Initiate bank transfer
    const transferResult = await HubtelTransferService.sendToBank({
      bankCode,
      accountNumber,
      accountName,
      amount,
      description,
      clientReference
    });

    // Create pending transaction record
    const transaction = new Transaction({
      userId,
      type: 'debit',
      amount: amount,
      description: `Bank Transfer to ${accountName} (${accountNumber.slice(-4)}****) - ${description}`,
      reference: clientReference,
      balanceBefore: balanceBefore,
      balanceAfter: balanceBefore,
      status: 'pending',
      metadata: {
        bankCode,
        accountNumber: 'XXXX' + accountNumber.slice(-4),
        accountName,
        hubtelTransactionId: transferResult.hubtelTransactionId,
        transactionType: 'BANK_TRANSFER'
      }
    });
    await transaction.save();

    console.log(`[Transfer] Bank transfer initiated: ${clientReference}, amount: ${amount}, user: ${userId}`);

    res.json({
      success: true,
      message: 'Bank transfer initiated successfully',
      clientReference: clientReference,
      status: 'pending',
      amount: amount,
      destination: {
        bankCode,
        accountNumber: 'XXXX' + accountNumber.slice(-4),
        accountName
      }
    });

  } catch (error) {
    console.error('[Transfer] Send Bank Error:', error);
    res.status(500).json({ error: error.message || 'Failed to send to bank' });
  }
});

/**
 * POST /api/airtime/buy
 * Buy airtime for phone number
 */
router.post('/buy-airtime', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { phoneNumber, network, amount } = req.body;

    // Server-side validation
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    if (!network) {
      return res.status(400).json({ error: 'Network is required' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Validate minimum amount
    if (amount < 1) {
      return res.status(400).json({ error: 'Minimum airtime amount is GHS 1.00' });
    }

    // Validate maximum amount
    const maxAmount = parseFloat(process.env.MAX_AIRTIME_AMOUNT) || 500;
    if (amount > maxAmount) {
      return res.status(400).json({ error: `Maximum airtime amount is GHS ${maxAmount}` });
    }

    // Validate network
    const validNetworks = ['MTN', 'TELECEL', 'AIRTELTIGO', 'VODAFONE'];
    if (!validNetworks.includes(network.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid network. Supported: MTN, Telecel, AirtelTigo, Vodafone' });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
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
      return res.status(400).json({ error: 'Insufficient balance' });
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
    res.status(500).json({ error: error.message || 'Failed to buy airtime' });
  }
});

/**
 * POST /api/data/buy
 * Buy data bundle for phone number
 */
router.post('/buy-data', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { phoneNumber, network, bundleCode, price } = req.body;

    // Server-side validation
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    if (!network) {
      return res.status(400).json({ error: 'Network is required' });
    }
    if (!bundleCode) {
      return res.status(400).json({ error: 'Data bundle code is required' });
    }
    if (!price || price <= 0) {
      return res.status(400).json({ error: 'Bundle price is required' });
    }

    // Validate network
    const validNetworks = ['MTN', 'TELECEL', 'AIRTELTIGO', 'VODAFONE'];
    if (!validNetworks.includes(network.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    // Get available bundles for validation
    const bundles = HubtelTransferService.getDataBundles(network);
    const selectedBundle = bundles.find(b => b.code === bundleCode);
    
    if (!selectedBundle) {
      return res.status(400).json({ error: 'Invalid bundle code' });
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.balance < price) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
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
      return res.status(400).json({ error: 'Insufficient balance' });
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
    res.status(500).json({ error: error.message || 'Failed to buy data bundle' });
  }
});

/**
 * GET /api/transfer/bank-codes
 * Get available bank codes
 */
router.get('/bank-codes', authenticate, async (req, res) => {
  try {
    const bankCodes = HubtelTransferService.getBankCodes();
    res.json({
      success: true,
      banks: Object.entries(bankCodes).map(([code, name]) => ({ code, name }))
    });
  } catch (error) {
    console.error('[Transfer] Get Bank Codes Error:', error);
    res.status(500).json({ error: 'Failed to get bank codes' });
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
