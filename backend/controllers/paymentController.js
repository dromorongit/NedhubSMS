const mongoose = require('mongoose');
const CallbackVerificationService = require('../services/callbackVerificationService');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const logger = require('../utils/logger');

const verificationService = new CallbackVerificationService();

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
    const clientReference = verificationService.paymentService.generateClientReference();

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
    logger.info('[Payment] Created pending payment', { clientReference, userId, amount: payment.amount });

    // Build return URL pointing to Railway backend
    const backendUrl = process.env.BACKEND_URL || 'https://nedhubsms-production.up.railway.app';
    let returnUrl = `${backendUrl}/payment/return`;

    // Add frontend origin as parameter so we can redirect back to correct frontend
    if (frontendOrigin) {
      returnUrl += `?frontend=${encodeURIComponent(frontendOrigin)}`;
    }

    // Initiate payment with Hubtel
    const hubtelResult = await verificationService.paymentService.initiatePayment({
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

    logger.info('[Payment] Hubtel result', { clientReference, checkoutId: hubtelResult.checkoutId });

    // Prepare response
    const responseData = {
      success: true,
      clientReference: payment.clientReference,
      checkoutUrl: hubtelResult.checkoutUrl,
      message: 'Payment initiated successfully. Redirecting to checkout...'
    };

    // Return checkout URL to frontend for redirect
    res.status(200).json(responseData);

  } catch (error) {
    logger.error('[Payment] Initiate error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate payment'
    });
  }
};

/**
 * Handle Hubtel payment callback
 * POST /api/payments/hubtel/callback
 *
 * The callback body is never trusted for the credit decision: the payment is
 * looked up in OUR database and Hubtel is queried server-to-server for the
 * final status and amount. Wallet credit uses the amount stored on our own
 * payment record, never an amount from the callback body.
 */
const handleHubtelCallback = async (req, res) => {
  try {
    const callbackData = req.body || {};

    logger.info('[Payment] Hubtel callback received', {
      clientReference: extractClientReference(callbackData) || '<missing>'
    });

    const clientReference = extractClientReference(callbackData);

    if (!clientReference) {
      logger.warn('[Payment] Callback missing clientReference');
      return res.status(200).json({ received: true });
    }

    const payment = await Payment.findOne({ clientReference });

    if (!payment) {
      logger.warn('[Payment] Payment not found for callback', { clientReference });
      // Answer 200 so Hubtel stops retrying; nothing to process
      return res.status(200).json({ success: false, message: 'Payment not found' });
    }

    // Already in a terminal state: nothing to do (idempotent)
    if (payment.status === 'paid' || payment.status === 'failed' || payment.status === 'cancelled') {
      logger.info('[Payment] Duplicate callback for already-terminal payment', { clientReference, status: payment.status });
      return res.status(200).json({ success: true, message: 'Already processed', status: payment.status });
    }

    const result = await verificationService.processPaymentCallback(clientReference);

    switch (result.action) {
      case 'credit':
        logger.info('[Payment] Callback credited wallet via server-to-server confirmation', {
          clientReference, amount: assessmentAmount(result), providerAmount: result.providerAmount
        });
        return res.status(200).json({ success: true, message: 'Payment processed successfully', clientReference });
      case 'mark_failed':
        logger.info('[Payment] Callback marked payment failed via provider confirmation', { clientReference });
        return res.status(200).json({ success: true, message: 'Payment failed', clientReference });
      case 'already_terminal':
        return res.status(200).json({ success: true, message: 'Already processed', clientReference, status: result.status });
      case 'not_found':
        return res.status(200).json({ success: false, message: 'Payment not found', clientReference });
      case 'provider_unavailable':
        logger.warn('[Payment] Provider unavailable for callback, payment left pending', {
          clientReference, error: result.error
        });
        return res.status(200).json({ success: true, message: 'Payment left pending', clientReference });
      default:
        logger.info('[Payment] Callback left payment pending', { clientReference, providerStatus: result.providerStatus });
        return res.status(200).json({ success: true, message: 'Payment left pending', clientReference, providerStatus: result.providerStatus });
    }

  } catch (error) {
    logger.error('[Payment] Callback error', { error: error.message, stack: error.stack });
    // Always answer 200 so the provider does not retry; the reconcile script
    // picks up any pending payment later.
    return res.status(200).json({ success: false, message: 'Internal server error' });
  }
};

function assessmentAmount(result) {
  return result.payment ? result.payment.amount : null;
}

/**
 * Extract client reference from the various Hubtel callback body shapes.
 * Never trusts nested body fields for amounts or status - only the reference
 * used to look up OUR record.
 */
function extractClientReference(callbackData) {
  return callbackData.clientReference
    || callbackData.ClientReference
    || callbackData.Data?.ClientReference
    || callbackData.data?.clientReference
    || callbackData.PaymentDetails?.Data?.ClientReference
    || callbackData.paymentDetails?.data?.clientReference;
}

/**
 * Check payment status
 * GET /api/payments/status/:clientReference
 *
 * Authenticated user may refresh THEIR OWN pending payment: Hubtel is queried
 * server-to-server and the same callback rules are applied. A reference that
 * belongs to another user is rejected with 403.
 */
const checkPaymentStatus = async (req, res) => {
  try {
    const { clientReference } = req.params;

    if (!clientReference) {
      return res.status(400).json({ success: false, error: 'Client reference is required' });
    }

    const payment = await Payment.findOne({ clientReference });

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    // Only the owner may refresh a payment
    if (payment.userId.toString() !== req.user.userId) {
      logger.warn('[Payment] User attempted to refresh another user payment', {
        clientReference, requestingUser: req.user.userId, owner: payment.userId.toString()
      });
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Already paid: make sure the wallet was credited (idempotent safety net)
    if (payment.status === 'paid') {
      await verificationService.creditWalletOnce(
        payment.userId,
        payment.amount,
        `Wallet top-up via Hubtel (${payment.amount} GHS)`,
        `PAYMENT-${payment.clientReference}`
      );
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

    // Already failed or cancelled: nothing to do
    if (payment.status === 'failed' || payment.status === 'cancelled') {
      return res.status(200).json({
        success: true,
        clientReference: payment.clientReference,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        message: `Payment ${payment.status}`
      });
    }

    // Pending or processing: re-check Hubtel server-to-server and apply callback rules
    const result = await verificationService.refreshUserPayment(req.user.userId, clientReference);

    const current = await Payment.findOne({ clientReference });

    let message;
    switch (result.action) {
      case 'credit': message = 'Payment confirmed and wallet credited'; break;
      case 'mark_failed': message = 'Payment failed'; break;
      case 'already_terminal': message = 'Payment already confirmed via callback'; break;
      case 'provider_unavailable': message = 'Provider unavailable, payment left pending'; break;
      case 'not_found': message = 'Payment not found'; break;
      default: message = 'Payment left pending';
    }

    return res.status(200).json({
      success: true,
      clientReference: current.clientReference,
      status: current.status,
      amount: current.amount,
      currency: current.currency,
      message
    });

  } catch (error) {
    logger.error('[Payment] Status check error', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to check payment status' });
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
    logger.error('[Payment] History error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get payment history' });
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
      logger.info('[Payment] Payment not found for return', { reference });
      return res.redirect(`/src/pages/dashboard/payment-error.html?message=payment_not_found`);
    }

    // Redirect based on payment status
    if (payment.status === 'paid') {
      if (frontend) {
        try {
          const frontendUrl = new URL(frontend);
          return res.redirect(`${frontendUrl.origin}/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
        } catch (e) {
          return res.redirect(`/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
        }
      }
      return res.redirect(`/src/pages/dashboard/payment-success.html?reference=${payment.clientReference}`);
    } else if (payment.status === 'failed') {
      return res.redirect(`/src/pages/dashboard/payment-error.html?reference=${payment.clientReference}&message=payment_failed`);
    } else {
      // Payment still pending - server-to-server check with Hubtel as fallback
      logger.info('[Payment] Return handler checking Hubtel for pending payment', { clientReference: payment.clientReference });

      try {
        const provider = await verificationService.checkProviderStatus('payment', payment.clientReference);

        if (provider.ok && provider.status === 'paid' && Number(provider.amount || 0) >= payment.amount) {
          const updated = await Payment.findOneAndUpdate(
            { clientReference: payment.clientReference, status: { $in: ['pending', 'processing'] } },
            {
              $set: {
                status: 'paid',
                callbackVerified: true,
                hubtelTransactionId: provider.transactionId,
                paymentMethod: provider.paymentMethod,
                paidAt: new Date()
              }
            }
          );
          if (updated) {
            await verificationService.creditWalletOnce(
              payment.userId,
              payment.amount,
              `Wallet top-up via Hubtel (${payment.amount} GHS)`,
              `PAYMENT-${payment.clientReference}`
            );
          }
          return res.redirect(redirectTo(frontend, payment.clientReference, 'success'));
        } else if (provider.ok && provider.status === 'failed') {
          await Payment.findOneAndUpdate(
            { clientReference: payment.clientReference, status: { $in: ['pending', 'processing'] } },
            { $set: { status: 'failed', callbackVerified: true, failureReason: provider.message } }
          );
          return res.redirect(`/src/pages/dashboard/payment-error.html?reference=${payment.clientReference}&message=payment_failed`);
        }
      } catch (hubtelError) {
        logger.error('[Payment] Hubtel status check error in return handler', { error: hubtelError.message });
      }

      // Payment still pending, redirect to pending page
      return res.redirect(`/src/pages/dashboard/payment-pending.html?reference=${payment.clientReference}`);
    }

  } catch (error) {
    logger.error('[Payment] Return handler error', { error: error.message });
    res.redirect(`/src/pages/dashboard/payment-error.html?message=internal_error`);
  }
};

function redirectTo(frontend, reference, kind) {
  const page = kind === 'success' ? 'payment-success.html' : 'payment-error.html';
  if (frontend) {
    try {
      const frontendUrl = new URL(frontend);
      return `${frontendUrl.origin}/src/pages/dashboard/${page}?reference=${reference}`;
    } catch (e) {
      return `/src/pages/dashboard/${page}?reference=${reference}`;
    }
  }
  return `/src/pages/dashboard/${page}?reference=${reference}`;
}

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
