const HubtelPaymentService = require('../services/HubtelPaymentService');
const WalletService = require('../services/WalletService');
const Payment = require('../models/Payment');
const User = require('../models/User');

const hubtelService = new HubtelPaymentService();
const walletService = new WalletService();

// Credit to GHS conversion rate (1 GHS = 100 credits)
const CREDITS_PER_GHS = 100;

/**
 * Initiate a payment for wallet top-up
 * POST /api/payments/initiate
 */
const initiatePayment = async (req, res) => {
  try {
    const { amount, description } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid amount: must be a positive number' 
      });
    }

    if (amount < 1) {
      return res.status(400).json({ 
        success: false, 
        error: 'Minimum payment amount is 1 GHS' 
      });
    }

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    // Generate unique client reference
    const clientReference = hubtelService.generateClientReference();

    // Create pending payment record in database
    const payment = new Payment({
      userId,
      clientReference,
      amount: parseFloat(amount),
      currency: 'GHS',
      description: description || `Wallet top-up of ${amount} GHS`,
      status: 'pending',
      customerEmail: user.email,
      customerPhone: user.phone
    });

    await payment.save();
    console.log(`[Payment] Created pending payment: ${clientReference}`);

    // Initiate payment with Hubtel
    const hubtelResult = await hubtelService.initiatePayment({
      amount: payment.amount,
      description: payment.description,
      clientReference: payment.clientReference,
      customerEmail: user.email,
      customerPhone: user.phone
    });

    // Update payment with Hubtel checkout ID
    payment.hubtelCheckoutId = hubtelResult.checkoutId;
    payment.status = 'processing';
    await payment.save();

    // Prepare response
    const responseData = {
      success: true,
      clientReference: payment.clientReference,
      checkoutUrl: hubtelResult.checkoutUrl,
      message: 'Payment initiated successfully. Redirecting to checkout...'
    };

    console.log('[Payment] Sending response to frontend:', JSON.stringify(responseData, null, 2));

    // Return checkout URL to frontend for redirect
    res.status(200).json(responseData);

  } catch (error) {
    console.error('[Payment] Initiate error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to initiate payment' 
    });
  }
};

/**
 * Handle Hubtel payment callback
 * POST /api/payments/hubtel/callback
 * This endpoint receives payment results from Hubtel
 */
const handleHubtelCallback = async (req, res) => {
  try {
    const callbackData = req.body;

    console.log('[Payment] Hubtel callback received:', JSON.stringify(callbackData, null, 2));

    // Extract key fields from callback
    const clientReference = callbackData.clientReference || callbackData.ClientReference;
    const responseCode = callbackData.responseCode || callbackData.ResponseCode;
    const status = callbackData.status || callbackData.Status;
    const transactionId = callbackData.transactionId || callbackData.POS_SALES_ID;
    const paymentMethod = callbackData.paymentMethod || callbackData.Type;

    // Validate required fields
    if (!clientReference) {
      console.error('[Payment] Callback missing clientReference');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing clientReference' 
      });
    }

    // Find the payment record
    const payment = await Payment.findOne({ clientReference });

    if (!payment) {
      console.error(`[Payment] Payment not found for clientReference: ${clientReference}`);
      // Still return 200 to Hubtel to prevent retries
      return res.status(200).json({ 
        success: false, 
        error: 'Payment not found' 
      });
    }

    // Check for duplicate callback (already processed)
    if (payment.callbackVerified) {
      console.log(`[Payment] Duplicate callback for: ${clientReference} - already processed`);
      return res.status(200).json({ 
        success: true, 
        message: 'Already processed' 
      });
    }

    // Update callback received
    payment.callbackReceivedAt = new Date();

    // Verify payment success
    // Hubtel success criteria: responseCode === '0000' or status === 'Success'
    const isSuccess = responseCode === '0000' || status === 'Success' || status === 'SUCCESS';

    if (isSuccess) {
      // Payment successful
      console.log(`[Payment] Payment successful: ${clientReference}`);

      // Mark payment as paid
      payment.status = 'paid';
      payment.callbackVerified = true;
      payment.hubtelTransactionId = transactionId;
      payment.paymentMethod = mapPaymentMethod(paymentMethod);
      payment.paidAt = new Date();
      await payment.save();

      // Calculate credits to add (1 GHS = 100 credits)
      const creditsToAdd = Math.floor(payment.amount * CREDITS_PER_GHS);

      // Credit user's wallet
      try {
        await walletService.creditWalletWithReference(
          payment.userId,
          creditsToAdd,
          `Wallet top-up via Hubtel (${payment.amount} GHS)`,
          `PAYMENT-${payment.clientReference}`,
          null
        );

        console.log(`[Payment] Wallet credited: ${payment.userId}, credits: ${creditsToAdd}`);

        // Create audit log (optional)
        // await AuditLog.create({ ... });

      } catch (walletError) {
        console.error('[Payment] Failed to credit wallet:', walletError);
        // Payment is still recorded as paid, but wallet credit failed
        // Implement retry mechanism or admin alert here
      }

      // Return success to Hubtel
      return res.status(200).json({ 
        success: true, 
        message: 'Payment processed successfully' 
      });

    } else {
      // Payment failed
      console.log(`[Payment] Payment failed: ${clientReference}, responseCode: ${responseCode}`);

      payment.status = 'failed';
      payment.callbackVerified = true;
      payment.failureReason = callbackData.responseDescription || callbackData.statusDescription || 'Payment failed';
      await payment.save();

      // Return failure to Hubtel
      return res.status(200).json({ 
        success: false, 
        message: 'Payment failed' 
      });
    }

  } catch (error) {
    console.error('[Payment] Callback error:', error);
    // Return 200 to prevent Hubtel from retrying
    res.status(200).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
};

/**
 * Check payment status
 * GET /api/payments/status/:clientReference
 */
const checkPaymentStatus = async (req, res) => {
  try {
    const { clientReference } = req.params;

    if (!clientReference) {
      return res.status(400).json({ 
        success: false, 
        error: 'Client reference is required' 
      });
    }

    // Find payment in database
    const payment = await Payment.findOne({ clientReference });

    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Payment not found' 
      });
    }

    // If payment is already confirmed in our system, return cached status
    if (payment.callbackVerified || payment.status === 'paid' || payment.status === 'failed') {
      return res.status(200).json({
        success: true,
        clientReference: payment.clientReference,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt,
        message: payment.status === 'paid' ? 'Payment successful' : 'Payment failed'
      });
    }

    // If not verified, check with Hubtel as fallback
    try {
      const hubtelStatus = await hubtelService.checkTransactionStatus(clientReference);

      // Update payment based on Hubtel status
      if (hubtelStatus.status === 'paid') {
        payment.status = 'paid';
        payment.hubtelTransactionId = hubtelStatus.transactionId;
        payment.paymentMethod = hubtelStatus.paymentMethod;
        payment.paidAt = new Date();
        payment.callbackVerified = true;
        await payment.save();

        // Credit wallet
        const creditsToAdd = Math.floor(payment.amount * CREDITS_PER_GHS);
        await walletService.creditWalletWithReference(
          payment.userId,
          creditsToAdd,
          `Wallet top-up via Hubtel (${payment.amount} GHS)`,
          `PAYMENT-${payment.clientReference}`,
          null
        );

      } else if (hubtelStatus.status === 'failed') {
        payment.status = 'failed';
        payment.failureReason = hubtelStatus.message;
        payment.callbackVerified = true;
        await payment.save();
      }

      return res.status(200).json({
        success: true,
        clientReference: payment.clientReference,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        message: hubtelStatus.message
      });

    } catch (hubtelError) {
      console.error('[Payment] Hubtel status check error:', hubtelError);
      
      // Return current payment status even if Hubtel check failed
      return res.status(200).json({
        success: true,
        clientReference: payment.clientReference,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        message: 'Status check with provider failed, using cached status'
      });
    }

  } catch (error) {
    console.error('[Payment] Status check error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check payment status' 
    });
  }
};

/**
 * Get payment history for user
 * GET /api/payments/history
 */
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments({ userId });

    res.status(200).json({
      success: true,
      payments: payments.map(p => ({
        id: p._id,
        clientReference: p.clientReference,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        description: p.description,
        paymentMethod: p.paymentMethod,
        createdAt: p.createdAt,
        paidAt: p.paidAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('[Payment] History error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get payment history' 
    });
  }
};

/**
 * Handle payment return (user redirected back after payment)
 * GET /api/payments/return
 */
const handlePaymentReturn = async (req, res) => {
  try {
    const { clientReference, status } = req.query;

    if (!clientReference) {
      return res.redirect('/payment/error?message=missing_reference');
    }

    // Find payment
    const payment = await Payment.findOne({ clientReference });

    if (!payment) {
      return res.redirect('/payment/error?message=payment_not_found');
    }

    // Redirect based on payment status
    if (payment.status === 'paid') {
      return res.redirect('/payment/success?reference=' + clientReference);
    } else if (payment.status === 'failed') {
      return res.redirect('/payment/error?reference=' + clientReference + '&message=payment_failed');
    } else {
      // Payment still pending - user may have closed the browser
      return res.redirect('/payment/pending?reference=' + clientReference);
    }

  } catch (error) {
    console.error('[Payment] Return handler error:', error);
    res.redirect('/payment/error?message=internal_error');
  }
};

/**
 * Handle payment cancellation
 * GET /api/payments/cancelled
 */
const handlePaymentCancelled = async (req, res) => {
  const { clientReference } = req.query;

  if (clientReference) {
    // Mark payment as cancelled
    await Payment.updateOne(
      { clientReference },
      { status: 'cancelled' }
    );
  }

  res.redirect('/payment/cancelled');
};

/**
 * Map Hubtel payment method to internal format
 * @param {string} hubtelType - Hubtel payment type
 * @returns {string} - Internal payment method
 */
function mapPaymentMethod(hubtelType) {
  const methodMap = {
    'momo': 'mobile_money',
    'mobile_money': 'mobile_money',
    'mobilemoney': 'mobile_money',
    'card': 'bank_card',
    'bank_card': 'bank_card',
    'wallet': 'hubtel_wallet',
    'hubtel_wallet': 'hubtel_wallet',
    'qr': 'ghqr',
    'ghqr': 'ghqr'
  };

  return methodMap[hubtelType?.toLowerCase()] || 'unknown';
}

module.exports = {
  initiatePayment,
  handleHubtelCallback,
  checkPaymentStatus,
  getPaymentHistory,
  handlePaymentReturn,
  handlePaymentCancelled
};
