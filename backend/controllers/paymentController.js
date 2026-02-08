const HubtelPaymentService = require('../services/HubtelPaymentService');
const WalletService = require('../services/WalletService');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
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
    const { amount, description, frontendOrigin } = req.body;
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

    // Build return URL pointing to Railway backend
    const backendUrl = process.env.BACKEND_URL || 'https://nedhubsms-production.up.railway.app';
    let returnUrl = `${backendUrl}/payment/return`;
    
    // Add frontend origin as parameter so we can redirect back to correct frontend
    if (frontendOrigin) {
      returnUrl += `?frontend=${encodeURIComponent(frontendOrigin)}`;
    }

    // Initiate payment with Hubtel
    const hubtelResult = await hubtelService.initiatePayment({
      amount: payment.amount,
      description: payment.description,
      clientReference: payment.clientReference,
      customerEmail: user.email,
      customerPhone: user.phone,
      returnUrl: returnUrl
    });

    // Update payment with Hubtel checkout ID
    payment.hubtelCheckoutId = hubtelResult.checkoutId;
    payment.status = 'processing';
    await payment.save();

    console.log('[Payment] Hubtel result:', JSON.stringify(hubtelResult, null, 2));

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
 * Helper function to credit wallet if not already credited
 * @param {Object} payment - Payment document
 * @returns {boolean} - True if wallet was credited, false if already credited
 */
async function creditWalletIfNeeded(payment) {
  const creditsToAdd = Math.floor(payment.amount * CREDITS_PER_GHS);
  
  // Check if wallet was already credited for this payment
  const existingTransaction = await Transaction.findOne({ 
    reference: `PAYMENT-${payment.clientReference}` 
  });
  
  if (existingTransaction) {
    console.log(`[Payment] Wallet already credited for: ${payment.clientReference}`);
    return false;
  }
  
  // Credit the wallet
  try {
    await walletService.creditWalletWithReference(
      payment.userId,
      creditsToAdd,
      `Wallet top-up via Hubtel (${payment.amount} GHS)`,
      `PAYMENT-${payment.clientReference}`,
      null
    );
    console.log(`[Payment] Wallet credited: ${payment.userId}, credits: ${creditsToAdd}`);
    return true;
  } catch (walletError) {
    console.error('[Payment] Failed to credit wallet:', walletError);
    throw walletError;
  }
}

/**
 * Handle Hubtel payment callback
 * POST /api/payments/hubtel/callback
 * This endpoint receives payment results from Hubtel
 */
const handleHubtelCallback = async (req, res) => {
  try {
    const callbackData = req.body;

    console.log('[Payment] Hubtel callback received:', JSON.stringify(callbackData, null, 2));

    // Extract key fields from callback - Hubtel sends data in different formats
    const clientReference = callbackData.clientReference 
      || callbackData.ClientReference 
      || callbackData.Data?.ClientReference
      || callbackData.data?.clientReference
      || callbackData.PaymentDetails?.Data?.ClientReference
      || callbackData.paymentDetails?.data?.clientReference;
    const responseCode = callbackData.responseCode || callbackData.ResponseCode;
    const status = callbackData.status || callbackData.Status;
    const transactionId = callbackData.transactionId || callbackData.POS_SALES_ID;
    const paymentMethod = callbackData.paymentMethod || callbackData.Type;

    // Validate required fields
    if (!clientReference) {
      console.error('[Payment] Callback missing clientReference, looking for it in nested structures');
      console.error('[Payment] Available fields:', Object.keys(callbackData));
      return res.status(400).json({ 
        success: false, 
        error: 'Missing clientReference' 
      });
    }

    console.log('[Payment] Extracted clientReference:', clientReference);

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
    const isSuccess = responseCode === '0000' || status === 'Success' || status === 'SUCCESS' || status === 'success';

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

      // Credit user's wallet
      try {
        await creditWalletIfNeeded(payment);
      } catch (walletError) {
        console.error('[Payment] Failed to credit wallet:', walletError);
        // Payment is still recorded as paid, but wallet credit failed
        // The checkPaymentStatus endpoint will retry on next call
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

    // If payment is already confirmed as paid, ensure wallet is credited
    if (payment.status === 'paid') {
      try {
        await creditWalletIfNeeded(payment);
      } catch (walletError) {
        console.error('[Payment] Wallet credit failed for paid payment:', walletError);
      }
      
      return res.status(200).json({
        success: true,
        clientReference: payment.clientReference,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt,
        message: 'Payment successful'
      });
    }

    // If payment is already confirmed as failed
    if (payment.status === 'failed') {
      return res.status(200).json({
        success: true,
        clientReference: payment.clientReference,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        message: 'Payment failed'
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
        await creditWalletIfNeeded(payment);

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
    const { clientReference, checkoutid, frontend } = req.query;

    // Hubtel may pass checkoutid instead of clientReference
    const reference = clientReference || checkoutid;

    if (!reference) {
      return res.redirect(`/src/pages/dashboard/payment-error.html?message=missing_reference`);
    }

    // Find payment by clientReference or checkoutId
    const payment = await Payment.findOne({ 
      $or: [
        { clientReference: reference },
        { hubtelCheckoutId: reference }
      ]
    });

    if (!payment) {
      console.log(`[Payment] Payment not found for reference: ${reference}`);
      return res.redirect(`/src/pages/dashboard/payment-error.html?message=payment_not_found`);
    }

    // Redirect based on payment status
    if (payment.status === 'paid') {
      // Use frontend parameter if provided to redirect back to GitHub Pages
      if (frontend) {
        try {
          const frontendUrl = new URL(frontend);
          return res.redirect(`${frontendUrl.origin}/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
        } catch (e) {
          // Invalid frontend URL, use relative path
          return res.redirect(`/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
        }
      }
      return res.redirect(`/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
    } else if (payment.status === 'failed') {
      return res.redirect(`/src/pages/dashboard/payment-error.html?reference=${payment.clientReference}&message=payment_failed`);
    } else {
      // Payment still pending - check with Hubtel as fallback
      try {
        const hubtelStatus = await hubtelService.checkTransactionStatus(payment.clientReference);
        if (hubtelStatus.status === 'paid') {
          // Update payment status
          payment.status = 'paid';
          payment.callbackVerified = true;
          payment.hubtelTransactionId = hubtelStatus.transactionId;
          payment.paymentMethod = mapPaymentMethod(hubtelStatus.paymentMethod);
          payment.paidAt = new Date();
          await payment.save();
          
          // Credit wallet using helper function
          await creditWalletIfNeeded(payment);
          
          if (frontend) {
            try {
              const frontendUrl = new URL(frontend);
              return res.redirect(`${frontendUrl.origin}/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
            } catch (e) {
              return res.redirect(`/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
            }
          }
          return res.redirect(`/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
        } else if (hubtelStatus.status === 'failed') {
          payment.status = 'failed';
          payment.callbackVerified = true;
          payment.failureReason = hubtelStatus.message;
          await payment.save();
          return res.redirect(`/src/pages/dashboard/payment-error.html?reference=${payment.clientReference}&message=payment_failed`);
        }
      } catch (hubtelError) {
        console.error('[Payment] Hubtel status check error in return handler:', hubtelError);
      }
      
      // Payment still pending, redirect to pending page
      return res.redirect(`/src/pages/dashboard/payment-pending.html?reference=${payment.clientReference}`);
    }

  } catch (error) {
    console.error('[Payment] Return handler error:', error);
    res.redirect(`/src/pages/dashboard/payment-error.html?message=internal_error`);
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

  res.redirect(`/pages/dashboard/payment-cancelled.html`);
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
