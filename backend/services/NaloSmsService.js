const axios = require('axios');
const SmsMessage = require('../models/SmsMessage');
const WalletService = require('./WalletService');
const CostCalculatorService = require('./CostCalculatorService');
const FinancialSummary = require('../models/FinancialSummary');

class NaloSmsService {
  constructor() {
    this.apiKey = process.env.NALO_API_KEY;
    this.resellerPrefix = process.env.NALO_RESELLER_PREFIX || '';
    this.baseUrl = 'https://sms.nalosolutions.com/smsbackend';

    if (!this.apiKey) {
      throw new Error('NALO_API_KEY environment variable is required');
    }
  }

  /**
   * Validate phone number format (local or international)
   */
  validateMsisdn(msisdn) {
    // Allow local format (e.g., 0712345678) or international (e.g., +254712345678)
    const localRegex = /^0[17]\d{8}$/; // Kenyan local format
    const internationalRegex = /^\+254[17]\d{8}$/; // International format
    return localRegex.test(msisdn) || internationalRegex.test(msisdn);
  }

  /**
   * Validate sender ID
   */
  validateSenderId(senderId) {
    // Max 11 characters, alphanumeric
    return /^[a-zA-Z0-9]{1,11}$/.test(senderId);
  }

  /**
   * Send SMS using Nalo API with full financial tracking
   * This is the main method that integrates wallet deduction and financial logging
   */
  async sendSmsWithFinancialTracking(request) {
    const { userId, msisdn, senderId, message, recipientsCount = 1 } = request;

    try {
      // Step 1: Calculate financial breakdown
      const financialBreakdown = await CostCalculatorService.calculateFinancialBreakdown(
        userId,
        message,
        recipientsCount
      );

      console.log('[NaloSmsService] Financial breakdown:', JSON.stringify(financialBreakdown));

      // Step 2: Check wallet balance
      const hasSufficientBalance = await WalletService.hasSufficientBalance(
        userId,
        financialBreakdown.totalChargedToUser
      );

      if (!hasSufficientBalance) {
        return {
          success: false,
          error: 'Insufficient wallet balance',
          required: financialBreakdown.totalChargedToUser,
          code: 'INSUFFICIENT_BALANCE'
        };
      }

      // Step 3: Atomically deduct from wallet
      const deductionResult = await WalletService.deductGhsForSms(
        userId,
        financialBreakdown,
        `SMS to ${recipientsCount} recipient(s), ${financialBreakdown.segments} segment(s)`
      );

      console.log('[NaloSmsService] Wallet deducted:', deductionResult.amountDeducted);

      // Step 4: Send SMS via Nalo API
      const payload = {
        api_key: this.apiKey,
        reseller_prefix: this.resellerPrefix,
        sender_id: senderId,
        msisdn: msisdn,
        message: message.trim()
      };

      let naloResponse;
      let smsStatus = 'pending';
      let errorCode = null;
      let errorMessage = null;

      try {
        const response = await axios.post(`${this.baseUrl}/send`, payload, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        naloResponse = response.data;
        smsStatus = naloResponse.status === '1701' ? 'sent' : 'failed';
        errorCode = naloResponse.error_code;
        errorMessage = naloResponse.error_message;

      } catch (apiError) {
        console.error('[NaloSmsService] API Error:', apiError.message);
        smsStatus = 'failed';
        errorMessage = apiError.message;
        naloResponse = { error: apiError.message };
      }

      // Step 5: Create SMS record with financial fields
      const smsMessage = {
        userId: userId,
        msisdn: msisdn,
        senderId: senderId,
        message: message.trim(),
        provider: 'nalo',
        jobId: naloResponse?.message_id || `local-${Date.now()}`,
        status: smsStatus,
        errorCode: errorCode,
        errorMessage: errorMessage,
        // Financial tracking fields
        sellPricePerSms: financialBreakdown.sellPricePerSms,
        providerCostPerSms: financialBreakdown.providerCostPerSms,
        segments: financialBreakdown.segments,
        recipientsCount: recipientsCount,
        totalChargedToUser: financialBreakdown.totalChargedToUser,
        totalCostToProvider: financialBreakdown.totalCostToProvider,
        profitAmount: financialBreakdown.profitAmount
      };

      const savedMessage = await SmsMessage.create(smsMessage);

      // Step 6: Update monthly financial summary
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        await FinancialSummary.addTransaction(
          'monthly',
          startOfMonth,
          userId,
          financialBreakdown.totalChargedToUser,
          financialBreakdown.totalCostToProvider,
          0, // gatewayFee (0 for SMS sending)
          1, // smsCount
          recipientsCount,
          financialBreakdown.segments
        );
      } catch (summaryError) {
        console.error('[NaloSmsService] Error updating financial summary:', summaryError.message);
        // Don't fail the SMS send if summary update fails
      }

      if (smsStatus === 'sent') {
        return {
          success: true,
          messageId: savedMessage._id.toString(),
          jobId: savedMessage.jobId,
          financial: {
            charged: financialBreakdown.totalChargedToUser,
            cost: financialBreakdown.totalCostToProvider,
            profit: financialBreakdown.profitAmount,
            segments: financialBreakdown.segments
          }
        };
      } else {
        return {
          success: false,
          error: errorMessage || this.mapErrorCode(errorCode),
          messageId: savedMessage._id.toString(),
          code: 'SMS_SEND_FAILED'
        };
      }

    } catch (error) {
      console.error('[NaloSmsService] Error:', error.message);
      return {
        success: false,
        error: error.message,
        code: 'INTERNAL_ERROR'
      };
    }
  }

  /**
   * Send SMS using Nalo API (legacy method without financial tracking)
   * @deprecated Use sendSmsWithFinancialTracking instead
   */
  async sendSms(request) {
    try {
      const { userId, msisdn, senderId, message } = request;

      // Validate inputs
      if (!msisdn || !this.validateMsisdn(msisdn)) {
        throw new Error('Invalid MSISDN format');
      }

      if (!senderId || !this.validateSenderId(senderId)) {
        throw new Error('Invalid sender ID: must be alphanumeric, max 11 characters');
      }

      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      // Prepare payload
      const payload = {
        api_key: this.apiKey,
        reseller_prefix: this.resellerPrefix,
        sender_id: senderId,
        msisdn: msisdn,
        message: message.trim()
      };

      // Send request to Nalo API
      const response = await axios.post(`${this.baseUrl}/send`, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const naloResponse = response.data;

      // Create SMS record
      const smsMessage = {
        userId: userId,
        msisdn: msisdn,
        senderId: senderId,
        message: message.trim(),
        provider: 'nalo',
        jobId: naloResponse.message_id,
        status: naloResponse.status === '1701' ? 'sent' : 'failed',
        errorCode: naloResponse.error_code,
        errorMessage: naloResponse.error_message
      };

      const savedMessage = await SmsMessage.create(smsMessage);

      if (naloResponse.status === '1701') {
        return { success: true, messageId: savedMessage._id.toString() };
      } else {
        return { success: false, error: this.mapErrorCode(naloResponse.error_code || naloResponse.status) };
      }

    } catch (error) {
      console.error('Nalo SMS send error:', error.message);

      // Still log the attempt
      await SmsMessage.create({
        userId: request.userId,
        msisdn: request.msisdn,
        senderId: request.senderId,
        message: request.message.trim(),
        provider: 'nalo',
        status: 'failed',
        errorMessage: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Handle delivery report callback from Nalo
   */
  async handleDeliveryReport(payload) {
    try {
      const { job_id, status, recipient, timestamp } = payload;

      if (!job_id) {
        throw new Error('Missing job_id in callback payload');
      }

      // Find the SMS message by jobId
      const smsMessage = await SmsMessage.findOne({ jobId: job_id });
      if (!smsMessage) {
        throw new Error(`SMS message with job_id ${job_id} not found`);
      }

      // Update status
      let updateData = { status: 'delivered' }; // Default to delivered

      if (status === 'delivered' || status === 'DELIVERED') {
        updateData.status = 'delivered';
        updateData.deliveredAt = timestamp ? new Date(timestamp) : new Date();
      } else if (status === 'failed' || status === 'FAILED') {
        updateData.status = 'failed';
      } else if (status === 'sent' || status === 'SENT') {
        updateData.status = 'sent';
      }

      await SmsMessage.findByIdAndUpdate(smsMessage._id, updateData);

      return { success: true };

    } catch (error) {
      console.error('Delivery report processing error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Map Nalo error codes to user-friendly messages
   */
  mapErrorCode(code) {
    const errorMap = {
      '1701': 'Success',
      '1702': 'Missing parameters',
      '1703': 'Authentication failed',
      '1706': 'Invalid destination',
      '1707': 'Invalid sender ID',
      '1025': 'Insufficient balance'
    };

    return errorMap[code] || `Unknown error: ${code}`;
  }
}

module.exports = NaloSmsService;
