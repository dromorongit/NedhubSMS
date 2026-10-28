const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const HubtelPaymentService = require('../services/HubtelPaymentService');
const HubtelTransferService = require('../services/HubtelTransferService');
const HubtelCommissionService = require('../services/HubtelCommissionService');
const logger = require('../utils/logger');

/**
 * Gateway fee configuration (percentage). Informational only - wallet is credited
 * with the amount stored on our own payment record, never with an amount from a
 * provider callback body.
 */
const GATEWAY_FEE_RATES = {
  mobile_money: 0.015,
  bank_card: 0.025,
  hubtel_wallet: 0.01,
  ghqr: 0.015,
  unknown: 0.02
};

function calculateGatewayFee(paymentMethod, amount) {
  const rate = GATEWAY_FEE_RATES[paymentMethod] || GATEWAY_FEE_RATES.unknown;
  return Math.max(amount * rate, 0.50);
}

/**
 * Normalise a provider status word: trimmed and compared case-insensitively so
 * 'paid', 'Paid', ' PAID ', 'failed', 'Failed', 'FAILED' all map the same.
 */
function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

const hubtelPaymentService = new HubtelPaymentService();
const hubtelTransferService = HubtelTransferService;
const hubtelCommissionService = HubtelCommissionService;

const PAYMENT_PENDING_STATUSES = ['pending', 'processing'];
const PAYMENT_TERMINAL_STATUSES = ['paid', 'failed', 'cancelled'];
const PURCHASE_TERMINAL_STATUSES = ['completed', 'failed'];

/**
 * CallbackVerificationService
 *
 * Single source of truth for server-to-server callback verification. Wallet
 * credits, debits and refunds are decided ONLY by what the provider reports via
 * a direct server-to-server status call - never by the incoming callback body.
 * All state transitions are a single conditional update so a repeated callback
 * can never apply twice.
 */
class CallbackVerificationService {
  constructor(opts = {}) {
    this.Payment = opts.Payment || Payment;
    this.Transaction = opts.Transaction || Transaction;
    this.Wallet = opts.Wallet || Wallet;
    this.paymentService = opts.paymentService || hubtelPaymentService;
    this.transferService = opts.transferService || hubtelTransferService;
    this.commissionService = opts.commissionService || hubtelCommissionService;
    this.logger = opts.logger || logger;
  }

  /**
   * Ask the provider for the final status of a transaction. Never trusts the
   * callback body. Returns { ok, status, amount, transactionId, paymentMethod, message }
   * or { ok: false, error } when the provider call fails/times out.
   */
  async checkProviderStatus(kind, clientReference) {
    let result;
    try {
      if (kind === 'payment') {
        result = await this.paymentService.checkTransactionStatus(clientReference);
      } else if (kind === 'commission') {
        result = await this.commissionService.checkTransactionStatus(clientReference);
      } else {
        result = await this.transferService.checkTransactionStatus(clientReference);
      }
    } catch (err) {
      this.logger.warn('[CallbackVerification] Provider status check failed', {
        kind, clientReference, error: err.message
      });
      return { ok: false, error: err.message };
    }
    return {
      ok: true,
      status: result.status,
      rawStatus: result.rawStatus,
      amount: result.amount,
      transactionId: result.transactionId,
      paymentMethod: result.paymentMethod,
      message: result.message
    };
  }

  /**
   * Credit a wallet exactly once for a reference. Idempotent: a Transaction with
   * the same reference already existing means the credit was already recorded.
   * The Transaction record is saved before the wallet is incremented so a crash
   * cannot credit without recording (under-credits are recovered by reconcile,
   * over-credits are impossible).
   */
  async creditWalletOnce(userId, amount, description, reference) {
    const existing = await this.Transaction.findOne({ reference });
    if (existing) {
      return { alreadyCredited: true };
    }

    const wallet = await this.Wallet.findOne({ userId });
    const balanceBefore = wallet ? Number(wallet.balance) : 0;

    const transaction = new this.Transaction({
      userId,
      type: 'credit',
      amount,
      description,
      reference,
      balanceBefore,
      balanceAfter: balanceBefore + amount
    });
    try {
      await transaction.save();
    } catch (err) {
      if (err && (err.code === 11000 || /duplicate key/i.test(err.message || ''))) {
        return { alreadyCredited: true };
      }
      throw err;
    }

    await this.Wallet.findOneAndUpdate(
      { userId },
      { $inc: { balance: amount, smsBalance: amount }, $set: { updatedAt: new Date() } }
    );

    this.logger.info('[CallbackVerification] Wallet credited', {
      reference, amount, outcome: 'credited'
    });
    return { credited: true };
  }

  /**
   * Refund a wallet exactly once per transaction. Idempotent via the unique
   * Transaction reference (REFUND-<clientReference>) and the conditional status
   * transition that only one callback request can win.
   */
  async refundWalletOnce(userId, amount, description, reference) {
    const existing = await this.Transaction.findOne({ reference });
    if (existing) {
      return { alreadyRefunded: true };
    }

    const wallet = await this.Wallet.findOne({ userId });
    const balanceBefore = wallet ? Number(wallet.balance) : 0;

    const transaction = new this.Transaction({
      userId,
      type: 'credit',
      amount,
      description,
      reference,
      balanceBefore,
      balanceAfter: balanceBefore + amount
    });
    try {
      await transaction.save();
    } catch (err) {
      if (err && (err.code === 11000 || /duplicate key/i.test(err.message || ''))) {
        return { alreadyRefunded: true };
      }
      throw err;
    }

    await this.Wallet.findOneAndUpdate(
      { userId },
      { $inc: { balance: amount, smsBalance: amount }, $set: { updatedAt: new Date() } }
    );

    this.logger.info('[CallbackVerification] Wallet refunded', {
      reference, amount, outcome: 'refunded'
    });
    return { refunded: true };
  }

  /**
   * Assess a payment top-up callback without mutating anything.
   */
  async assessPayment(clientReference) {
    const payment = await this.Payment.findOne({ clientReference });
    if (!payment) {
      return { action: 'not_found', clientReference };
    }
    if (PAYMENT_TERMINAL_STATUSES.includes(payment.status)) {
      return { action: 'already_terminal', clientReference, status: payment.status };
    }

    const provider = await this.checkProviderStatus('payment', clientReference);
    if (!provider.ok) {
      return { action: 'provider_unavailable', clientReference, error: provider.error };
    }

    const providerAmount = Number(provider.amount) || 0;
    const status = normalizeStatus(provider.status);
    if (status === 'paid' && providerAmount != null && Math.round(providerAmount * 100) >= Math.round(payment.amount * 100)) {
      return {
        action: 'credit',
        clientReference,
        payment,
        providerAmount,
        hubtelTransactionId: provider.transactionId,
        paymentMethod: provider.paymentMethod
      };
    }
    if (status === 'failed') {
      return { action: 'mark_failed', clientReference, payment, reason: provider.message };
    }
    return { action: 'leave_pending', clientReference, providerStatus: provider.status };
  }

  /**
   * Apply a payment assessment. Only the request that wins the conditional
   * pending->paid transition credits the wallet.
   */
  async applyPaymentAssessment(assessment) {
    if (assessment.action !== 'credit' && assessment.action !== 'mark_failed') {
      return { ...assessment, applied: false };
    }

    const filter = { clientReference: assessment.clientReference, status: { $in: PAYMENT_PENDING_STATUSES } };
    const update = {};

    if (assessment.action === 'credit') {
      const estimatedFee = calculateGatewayFee(assessment.paymentMethod || 'unknown', assessment.payment.amount);
      Object.assign(update, {
        status: 'paid',
        callbackVerified: true,
        hubtelTransactionId: assessment.hubtelTransactionId,
        paymentMethod: assessment.paymentMethod,
        paidAt: new Date(),
        gatewayFeeEstimated: estimatedFee,
        netAmountReceived: assessment.payment.amount - estimatedFee,
        grossAmountPaid: assessment.payment.amount
      });
    } else {
      Object.assign(update, {
        status: 'failed',
        callbackVerified: true,
        failureReason: assessment.reason
      });
    }

    const updated = await this.Payment.findOneAndUpdate(filter, { $set: update }, { new: true });
    if (!updated) {
      this.logger.info('[CallbackVerification] Payment already transitioned by another request', {
        clientReference: assessment.clientReference
      });
      return { ...assessment, applied: false, reason: 'lost_conditional_update' };
    }

    if (assessment.action === 'credit') {
      await this.creditWalletOnce(
        assessment.payment.userId,
        assessment.payment.amount,
        `Wallet top-up via Hubtel (${assessment.payment.amount} GHS)`,
        `PAYMENT-${assessment.payment.clientReference}`
      );
    }

    return { ...assessment, applied: true };
  }

  /**
   * Process a payment callback end to end (assess + apply). Used by the HTTP
   * callback handler and by the reconcile script.
   */
  async processPaymentCallback(clientReference) {
    const assessment = await this.assessPayment(clientReference);
    if (assessment.action === 'credit' || assessment.action === 'mark_failed') {
      return this.applyPaymentAssessment(assessment);
    }
    return { ...assessment, applied: false };
  }

  /**
   * Assess a wallet-funded transfer (MoMo / bank) callback. The wallet is only
   * debited here when the provider confirms success.
   */
  async assessTransfer(clientReference, kind) {
    const transaction = await this.Transaction.findOne({ reference: clientReference });
    if (!transaction) {
      return { action: 'not_found', clientReference };
    }
    if (PURCHASE_TERMINAL_STATUSES.includes(transaction.status)) {
      return { action: 'already_terminal', clientReference, status: transaction.status };
    }

    const provider = await this.checkProviderStatus('transfer', clientReference);
    if (!provider.ok) {
      return { action: 'provider_unavailable', clientReference, error: provider.error };
    }

    const status = normalizeStatus(provider.status);
    if (status === 'success' || status === 'paid') {
      return { action: 'complete', clientReference, transaction };
    }
    if (status === 'failed') {
      return { action: 'mark_failed', clientReference, transaction, reason: provider.message };
    }
    return { action: 'leave_pending', clientReference, providerStatus: provider.status };
  }

  async applyTransferAssessment(assessment) {
    if (assessment.action === 'complete') {
      const transaction = assessment.transaction;
      const updated = await this.Transaction.findOneAndUpdate(
        { reference: transaction.reference, status: { $nin: PURCHASE_TERMINAL_STATUSES } },
        {
          $set: {
            status: 'completed',
            balanceAfter: transaction.balanceBefore - transaction.amount,
            metadata: {
              ...transaction.metadata,
              completedAt: new Date(),
              providerStatus: 'delivered'
            }
          }
        },
        { new: true }
      );
      if (!updated) {
        return { ...assessment, applied: false, reason: 'lost_conditional_update' };
      }
      await this.Wallet.findOneAndUpdate(
        { userId: transaction.userId, balance: { $gte: transaction.amount } },
        { $inc: { balance: -transaction.amount }, $set: { updatedAt: new Date() } }
      );
      return { ...assessment, applied: true, debited: true };
    }

    if (assessment.action === 'mark_failed') {
      const updated = await this.Transaction.findOneAndUpdate(
        { reference: assessment.transaction.reference, status: { $nin: PURCHASE_TERMINAL_STATUSES } },
        {
          $set: {
            status: 'failed',
            metadata: {
              ...assessment.transaction.metadata,
              failedAt: new Date(),
              failureReason: assessment.reason,
              providerStatus: 'failed'
            }
          }
        },
        { new: true }
      );
      return { ...assessment, applied: !!updated };
    }

    return { ...assessment, applied: false };
  }

  async processTransferCallback(clientReference, kind) {
    const assessment = await this.assessTransfer(clientReference, kind);
    if (assessment.action === 'complete' || assessment.action === 'mark_failed') {
      return this.applyTransferAssessment(assessment);
    }
    return { ...assessment, applied: false };
  }

  /**
   * Assess an airtime / data / TV / utility purchase callback. The wallet was
   * debited at purchase time; success confirms the purchase, failure triggers a
   * refund - always decided by the provider, never the callback body.
   */
  async assessPurchase(clientReference, opts = {}) {
    const {
      pendingStatuses = ['pending_confirmation'],
      providerKind = 'transfer'
    } = opts;

    const transaction = await this.Transaction.findOne({ reference: clientReference });
    if (!transaction) {
      return { action: 'not_found', clientReference };
    }
    if (PURCHASE_TERMINAL_STATUSES.includes(transaction.status)) {
      return { action: 'already_terminal', clientReference, status: transaction.status };
    }

    const provider = await this.checkProviderStatus(providerKind, clientReference);
    if (!provider.ok) {
      return { action: 'provider_unavailable', clientReference, error: provider.error };
    }

    const status = normalizeStatus(provider.status);
    const rawStatus = normalizeStatus(provider.rawStatus);
    // An explicit Cancelled / Canceled on a purchase (wallet already debited) is
    // treated as a failure that triggers the single idempotent refund.
    if (status === 'success' || status === 'paid') {
      return { action: 'complete', clientReference, transaction };
    }
    if (status === 'failed' || rawStatus === 'cancelled' || rawStatus === 'canceled') {
      return { action: 'refund', clientReference, transaction, reason: provider.message };
    }
    return { action: 'leave_pending', clientReference, providerStatus: provider.status };
  }

  async applyPurchaseAssessment(assessment, opts = {}) {
    const { pendingStatuses = ['pending_confirmation'] } = opts;

    if (assessment.action === 'complete') {
      const updated = await this.Transaction.findOneAndUpdate(
        { reference: assessment.transaction.reference, status: { $in: pendingStatuses } },
        {
          $set: {
            status: 'completed',
            metadata: {
              ...assessment.transaction.metadata,
              completedAt: new Date(),
              providerStatus: 'delivered'
            }
          }
        },
        { new: true }
      );
      if (!updated) {
        return { ...assessment, applied: false, reason: 'lost_conditional_update' };
      }
      return { ...assessment, applied: true };
    }

    if (assessment.action === 'refund') {
      const updated = await this.Transaction.findOneAndUpdate(
        { reference: assessment.transaction.reference, status: { $in: pendingStatuses } },
        {
          $set: {
            status: 'failed',
            metadata: {
              ...assessment.transaction.metadata,
              failedAt: new Date(),
              failureReason: assessment.reason,
              providerStatus: 'failed'
            }
          }
        },
        { new: true }
      );
      if (!updated) {
        return { ...assessment, applied: false, reason: 'lost_conditional_update' };
      }
      await this.refundWalletOnce(
        assessment.transaction.userId,
        assessment.transaction.amount,
        `Refund for failed ${assessment.transaction.metadata?.transactionType || 'purchase'} (${assessment.transaction.amount} GHS)`,
        `REFUND-${assessment.transaction.reference}`
      );
      return { ...assessment, applied: true, refunded: true };
    }

    return { ...assessment, applied: false };
  }

  async processAirtimeCallback(clientReference) {
    const assessment = await this.assessPurchase(clientReference, {
      pendingStatuses: ['pending_confirmation'],
      providerKind: 'transfer'
    });
    if (assessment.action === 'complete' || assessment.action === 'refund') {
      return this.applyPurchaseAssessment(assessment, { pendingStatuses: ['pending_confirmation'] });
    }
    return { ...assessment, applied: false };
  }

  async processDataCallback(clientReference) {
    const assessment = await this.assessPurchase(clientReference, {
      pendingStatuses: ['pending_confirmation'],
      providerKind: 'transfer'
    });
    if (assessment.action === 'complete' || assessment.action === 'refund') {
      return this.applyPurchaseAssessment(assessment, { pendingStatuses: ['pending_confirmation'] });
    }
    return { ...assessment, applied: false };
  }

  async processTvCallback(clientReference) {
    const assessment = await this.assessPurchase(clientReference, {
      pendingStatuses: ['pending'],
      providerKind: 'commission'
    });
    if (assessment.action === 'complete' || assessment.action === 'refund') {
      return this.applyPurchaseAssessment(assessment, { pendingStatuses: ['pending'] });
    }
    return { ...assessment, applied: false };
  }

  async processUtilityCallback(clientReference) {
    const assessment = await this.assessPurchase(clientReference, {
      pendingStatuses: ['pending'],
      providerKind: 'commission'
    });
    if (assessment.action === 'complete' || assessment.action === 'refund') {
      return this.applyPurchaseAssessment(assessment, { pendingStatuses: ['pending'] });
    }
    return { ...assessment, applied: false };
  }

  /**
   * Authenticated user refresh of THEIR OWN pending payment. Re-checks Hubtel
   * server-side and applies the same rules as the callback. Ownership is
   * enforced before any provider call.
   */
  async refreshUserPayment(userId, clientReference) {
    const payment = await this.Payment.findOne({ clientReference });
    if (!payment) {
      return { action: 'not_found', clientReference };
    }
    if (payment.userId.toString() !== userId.toString()) {
      return { action: 'forbidden', clientReference };
    }

    if (payment.status === 'paid') {
      await this.creditWalletOnce(
        payment.userId,
        payment.amount,
        `Wallet top-up via Hubtel (${payment.amount} GHS)`,
        `PAYMENT-${payment.clientReference}`
      );
      return { action: 'already_paid', clientReference, status: 'paid' };
    }
    if (PAYMENT_TERMINAL_STATUSES.includes(payment.status)) {
      return { action: 'already_terminal', clientReference, status: payment.status };
    }

    return this.processPaymentCallback(clientReference);
  }
}

module.exports = CallbackVerificationService;
module.exports.calculateGatewayFee = calculateGatewayFee;
