const axios = require('axios');
const SmsMessage = require('../models/SmsMessage');
const WalletService = require('./WalletService');
const CostCalculatorService = require('./CostCalculatorService');
const FinancialSummary = require('../models/FinancialSummary');
const SenderId = require('../models/SenderId');
const Wallet = require('../models/Wallet');

class NaloSmsService {
  constructor() {
    this.apiKey = process.env.NALO_API_KEY;
    this.baseUrl = 'https://sms.nalosolutions.com';
    this.endpoint = '/smsbackend/Resl_Nalo/send-message/';

    if (!this.apiKey) {
      throw new Error('NALO_API_KEY environment variable is required');
    }
  }

  /**
   * Convert phone number to Ghana format (233XXXXXXXXX)
   */
  formatPhoneNumber(msisdn) {
    if (!msisdn) return null;
    
    // Remove any spaces, dashes, plus signs
    let cleaned = msisdn.replace(/[\s\-+]/g, '');
    
    // If starts with 0, replace with 233
    if (cleaned.startsWith('0')) {
      cleaned = '233' + cleaned.substring(1);
    }
    
    // If doesn't start with 233, add it
    if (!cleaned.startsWith('233')) {
      cleaned = '233' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Validate phone number format (Ghana format: 233XXXXXXXXX)
   */
  validateMsisdn(msisdn) {
    const formatted = this.formatPhoneNumber(msisdn);
    const ghanaRegex = /^233[0-9]{9}$/;
    return ghanaRegex.test(formatted);
  }

  /**
   * Validate sender ID
   */
  validateSenderId(senderId) {
    return /^[a-zA-Z0-9]{1,11}$/.test(senderId);
  }

  /**
   * Parse Nalo response - handles both JSON and pipe-delimited string
   */
  parseNaloResponse(responseData) {
    // If it's already an object, return it
    if (typeof responseData === 'object') {
      return responseData;
    }
    
    // If it's a string, try to parse
    if (typeof responseData === 'string') {
      // Check if it's pipe-delimited (e.g., "1701|123456")
      if (responseData.includes('|')) {
        const parts = responseData.split('|');
        return {
          status: parts[0],
          message_id: parts[1] || null,
          error_message: parts[2] || null
        };
      }
      
      // Try JSON parsing
      try {
        return JSON.parse(responseData);
      } catch (e) {
        // Return as-is
        return { status: responseData };
      }
    }
    
    return { status: 'unknown' };
  }

  /**
   * Refund wallet after failed SMS
   */
  async refundWallet(userId, amount, description) {
    try {
      await Wallet.findOneAndUpdate(
        { userId },
        { 
          $inc: { balance: amount },
          $set: { updatedAt: new Date() }
        }
      );
      console.log(`[NaloSmsService] Wallet refunded: ${amount} GHS for user ${userId}`);
    } catch (error) {
      console.error('[NaloSmsService] Wallet refund failed:', error.message);
    }
  }

  /**
   * Send SMS using Nalo API with full financial tracking
   */
  async sendSmsWithFinancialTracking(request) {
    const { userId, msisdn, senderId, message, recipientsCount = 1 } = request;

    try {
      // Validate phone number
      const formattedMsisdn = this.formatPhoneNumber(msisdn);
      if (!this.validateMsisdn(msisdn)) {
        return {
          success: false,
          error: 'Invalid phone number format. Use Ghana format: 233XXXXXXXXX',
          code: 'INVALID_PHONE_NUMBER'
        };
      }

      // Validate sender ID
      if (!this.validateSenderId(senderId)) {
        return {
          success: false,
          error: 'Invalid sender ID: must be alphanumeric, max 11 characters',
          code: 'INVALID_SENDER_ID'
        };
      }

      // Verify sender ID is approved
      const senderIdDoc = await SenderId.findOne({ userId, senderId });
      if (!senderIdDoc || !senderIdDoc.isApproved()) {
        return {
          success: false,
          error: 'Sender ID is not approved. Please wait for admin approval.',
          code: 'SENDER_ID_NOT_APPROVED'
        };
      }

      // Calculate financial breakdown
      const financialBreakdown = await CostCalculatorService.calculateFinancialBreakdown(
        userId,
        message,
        recipientsCount
      );

      console.log('[NaloSmsService] Financial breakdown:', JSON.stringify(financialBreakdown));

      // Check wallet balance
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

      // Deduct from wallet FIRST (wallet protection rule)
      const deductionResult = await WalletService.deductGhsForSms(
        userId,
        financialBreakdown,
        `SMS to ${recipientsCount} recipient(s), ${financialBreakdown.segments} segment(s)`
      );

      console.log('[NaloSmsService] Wallet deducted:', deductionResult.amountDeducted);

      // Send SMS via Nalo API
      const payload = {
        key: this.apiKey,
        msisdn: formattedMsisdn,
        sender_id: senderId,
        message: message.trim()
      };

      let naloResponse;
      let smsStatus = 'pending';
      let errorCode = null;
      let errorMessage = null;
      let jobId = null;

      try {
        console.log('[NaloSmsService] Sending to:', `${this.baseUrl}${this.endpoint}`);
        console.log('[NaloSmsService] Payload:', { ...payload, key: '***' }); // Hide API key in logs

        const response = await axios.post(
          `${this.baseUrl}${this.endpoint}`,
          payload,
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
            validateStatus: (status) => status === 200
          }
        );

        console.log('[NaloSmsService] Raw response:', response.data);
        
        naloResponse = this.parseNaloResponse(response.data);
        console.log('[NaloSmsService] Parsed response:', naloResponse);

        // Check for success (1701)
        if (naloResponse.status === '1701') {
          smsStatus = 'sent';
          jobId = naloResponse.message_id || naloResponse.job_id || `nalo-${Date.now()}`;
        } else {
          smsStatus = 'failed';
          errorCode = naloResponse.status;
          errorMessage = naloResponse.error_message || this.mapErrorCode(naloResponse.status);
          
          // Refund wallet on failure
          await this.refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS failed - refund');
        }

      } catch (apiError) {
        console.error('[NaloSmsService] API Error:', apiError.message);
        smsStatus = 'failed';
        errorMessage = apiError.message;
        
        // Refund wallet on API error
        await this.refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS API error - refund');
      }

      // Create SMS record
      const smsMessageData = {
        userId: userId,
        msisdn: formattedMsisdn,
        senderId: senderId,
        message: message.trim(),
        provider: 'nalo',
        jobId: jobId || `failed-${Date.now()}`,
        status: smsStatus,
        errorCode: errorCode,
        errorMessage: errorMessage,
        sellPricePerSms: financialBreakdown.sellPricePerSms,
        providerCostPerSms: financialBreakdown.providerCostPerSms,
        segments: financialBreakdown.segments,
        recipientsCount: recipientsCount,
        totalChargedToUser: smsStatus === 'sent' ? financialBreakdown.totalChargedToUser : 0,
        totalCostToProvider: financialBreakdown.totalCostToProvider,
        profitAmount: smsStatus === 'sent' ? financialBreakdown.profitAmount : 0
      };

      const savedMessage = await SmsMessage.create(smsMessageData);

      // Update monthly financial summary only on success
      if (smsStatus === 'sent') {
        try {
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          
          await FinancialSummary.addTransaction(
            'monthly',
            startOfMonth,
            userId,
            financialBreakdown.totalChargedToUser,
            financialBreakdown.totalCostToProvider,
            0,
            1,
            recipientsCount,
            financialBreakdown.segments
          );
        } catch (summaryError) {
          console.error('[NaloSmsService] Error updating financial summary:', summaryError.message);
        }

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
          error: errorMessage,
          messageId: savedMessage._id.toString(),
          code: errorCode || 'SMS_SEND_FAILED'
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
   * Handle delivery report callback from Nalo
   */
  async handleDeliveryReport(payload) {
    try {
      const { job_id, status, recipient, timestamp } = payload;

      if (!job_id) {
        throw new Error('Missing job_id in callback payload');
      }

      const smsMessage = await SmsMessage.findOne({ jobId: job_id });
      if (!smsMessage) {
        throw new Error(`SMS message with job_id ${job_id} not found`);
      }

      let updateData = { status: 'delivered' };

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
      '1706': 'Invalid destination number',
      '1707': 'Invalid sender ID',
      '1025': 'Insufficient credit at provider',
      '1710': 'Internal provider error'
    };

    return errorMap[code] || `Unknown error: ${code}`;
  }
}

module.exports = NaloSmsService;
