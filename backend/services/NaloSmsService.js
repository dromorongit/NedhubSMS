const axios = require('axios');
const SmsMessage = require('../models/SmsMessage');

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
   * Send SMS using Nalo API
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
      '1025': 'Insufficient credit'
    };

    return errorMap[code] || `Unknown error: ${code}`;
  }
}

module.exports = NaloSmsService;