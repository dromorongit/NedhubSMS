const ResilientHttpClient = require('../utils/ResilientHttpClient');
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

    if (!this.apiKey || this.apiKey === 'dummy_nalo_key_for_testing') {
      console.warn('[NaloSmsService] Using dummy API key - SMS sending will be simulated');
      this.isDummyMode = true;
    }

    // Initialize resilient HTTP client for SMS operations
    this.httpClient = new ResilientHttpClient({
      serviceName: 'nalo-sms',
      baseURL: this.baseUrl,
      timeout: 15000, // 15 seconds for SMS
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      failureThreshold: 5,
      recoveryTimeout: 30000
    });
  }

  /**
   * Convert phone number to Ghana format (233XXXXXXXXX)
   */
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    
    // Remove any spaces, dashes, plus signs
    let cleaned = phoneNumber.replace(/[\s\-+]/g, '');
    
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
  validatePhoneNumber(phoneNumber) {
    const formatted = this.formatPhoneNumber(phoneNumber);
    const ghanaRegex = /^233[0-9]{9}$/;
    return ghanaRegex.test(formatted);
  }

  /**
   * Validate sender ID
   */
  validateSenderId(senderId) {
    return /^[a-zA-Z0-9\s\-_.]{1,11}$/.test(senderId);
  }

  /**
   * Parse Nalo response - handles both JSON and pipe-delimited string
   * @param {string|object} responseData - Raw response from Nalo API
   * @param {Object} context - Context for logging { phoneNumber, formattedPhoneNumber, userId, campaignId, recipientId }
   * @returns {Object} Parsed response with status, message_id, error_message
   */
  parseNaloResponse(responseData, context = {}) {
    const logger = require('../utils/logger');
    const { phoneNumber, formattedPhoneNumber, userId, campaignId, recipientId } = context;
    let parsed;

    // Handle bare success code (number or string without pipe/JSON wrapper)
    if (responseData === 1701 || responseData === '1701') {
      return { status: '1701', message_id: null, error_message: null };
    }

    // If it's already an object, use it directly
    if (typeof responseData === 'object' && responseData !== null) {
      parsed = responseData;
    }
    // If it's a string, try to parse
    else if (typeof responseData === 'string') {
      // Check if it's pipe-delimited (e.g., "1701|123456")
      if (responseData.includes('|')) {
        const parts = responseData.split('|');
        parsed = {
          status: parts[0],
          message_id: parts[1] || null,
          error_message: parts[2] || null
        };
      } else {
        // Try JSON parsing
        try {
          parsed = JSON.parse(responseData);
        } catch (e) {
          // Log the parsing failure with raw response
          logger.responseParser.warn('Failed to parse Nalo response as JSON', {
            rawResponse: responseData.substring(0, 200),
            error: e.message
          });
          // Return as-is with status indicating unknown
          return {
            status: 'PARSE_ERROR',
            error_message: `Invalid response format: ${responseData.substring(0, 100)}`
          };
        }
      }
    } else {
      return { status: 'unknown' };
    }

    // Normalize status to string for consistent comparison
    if (parsed.status !== undefined) {
      parsed.status = String(parsed.status);
    }

    // Detect network from formatted phone number for targeted logging
    const isTelecel = formattedPhoneNumber && (
      formattedPhoneNumber.startsWith('23320') || // 020 prefix → Telecel/Vodafone
      formattedPhoneNumber.startsWith('23350')    // 050 prefix → Telecel/Vodafone
    );
    const isMTN = formattedPhoneNumber && (
      formattedPhoneNumber.startsWith('23324') || // 024 prefix → MTN
      formattedPhoneNumber.startsWith('23354') || // 054 prefix → MTN
      formattedPhoneNumber.startsWith('23355') || // 055 prefix → MTN
      formattedPhoneNumber.startsWith('23359')    // 059 prefix → MTN
    );
    const isAirtelTigo = formattedPhoneNumber && (
      formattedPhoneNumber.startsWith('23326') || // 026 prefix → AirtelTigo
      formattedPhoneNumber.startsWith('23327') || // 027 prefix → AirtelTigo
      formattedPhoneNumber.startsWith('23328') || // 028 prefix → AirtelTigo
      formattedPhoneNumber.startsWith('23356') || // 056 prefix → AirtelTigo
      formattedPhoneNumber.startsWith('23357')    // 057 prefix → AirtelTigo
    );

    // Log the parsed provider response with [ProviderResponse] tag
    console.log('[ProviderResponse]', {
      rawStatus: responseData,
      parsedStatus: parsed.status,
      hasMessageId: !!parsed.message_id,
      hasError: !!parsed.error_message,
      network: isTelecel ? 'Telecel/Vodafone' : isMTN ? 'MTN' : isAirtelTigo ? 'AirtelTigo' : 'Unknown',
      formattedPhoneNumber: formattedPhoneNumber || 'N/A',
      userId: userId || 'N/A',
      timestamp: new Date().toISOString()
    });

    // Telecel/Vodafone specific audit logging
    if (isTelecel) {
      console.log('[TelecelAudit]', {
        originalNumber: phoneNumber || 'N/A',
        normalizedNumber: formattedPhoneNumber,
        providerResponse: parsed.status,
        hasMessageId: !!parsed.message_id,
        hasError: !!parsed.error_message,
        errorMessage: parsed.error_message || null,
        userId: userId || 'N/A',
        campaignId: campaignId || 'N/A',
        recipientId: recipientId || 'N/A',
        timestamp: new Date().toISOString()
      });
    }

    return parsed;
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
      const { userId, phoneNumber, senderId, message, recipientsCount = 1, skipDeduction = false, campaignId = null, recipientId = null } = request;
      const logger = require('../utils/logger');
      const SmsRecipient = require('../models/SmsRecipient');

      // Log phone number normalization with [PhoneNormalization] tag
      const formattedPhoneNumber = this.formatPhoneNumber(phoneNumber);

      // Detect network type from normalized phone number
      const networkType = SmsRecipient.detectNetwork(formattedPhoneNumber);

      console.log('[PhoneNormalization]', {
          originalNumber: phoneNumber,
          normalizedNumber: formattedPhoneNumber,
          networkType,
          userId,
          timestamp: new Date().toISOString()
      });
      
      // Log send initiation with [SmsSend] tag
      console.log('[SmsSend]', {
          userId,
          phoneNumber,
          senderId,
          recipientsCount,
          messageLength: message.length,
          skipDeduction
      });
      
      // Log provider payload with [ProviderPayload] tag
      const providerPayload = {
          key: this.apiKey ? '***HIDDEN***' : null, // Hide API key
          msisdn: formattedPhoneNumber,
          sender_id: senderId,
          message: message.trim()
      };
      console.log('[ProviderPayload]', {
          ...providerPayload,
          userId,
          campaignId,
          recipientId,
          timestamp: new Date().toISOString()
      });

    try {
      // Validate phone number
      const formattedPhoneNumber = this.formatPhoneNumber(phoneNumber);
      if (!this.validatePhoneNumber(phoneNumber)) {
        logger.smsSend.warn('Invalid phone number format', {
          userId,
          phoneNumber,
          senderId
        });
        return {
          success: false,
          error: 'Invalid phone number format. Use Ghana format: 233XXXXXXXXX',
          code: 'INVALID_PHONE_NUMBER'
        };
      }

      // Validate sender ID
      if (!this.validateSenderId(senderId)) {
        logger.smsSend.warn('Invalid sender ID', {
          userId,
          senderId
        });
        return {
          success: false,
          error: 'Invalid sender ID: must be alphanumeric, max 11 characters',
          code: 'INVALID_SENDER_ID'
        };
      }

      // Verify sender ID is approved
      const senderIdDoc = await SenderId.findOne({ userId, senderId });
      if (!senderIdDoc || !senderIdDoc.isApproved()) {
        logger.smsSend.warn('Sender ID not approved', {
          userId,
          senderId
        });
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

      logger.smsSend.info('SMS financial breakdown', {
        userId,
        phoneNumber,
        senderId,
        recipientsCount,
        estimatedCost: financialBreakdown.totalChargedToUser,
        segments: financialBreakdown.avgSegments
      });

      // Check wallet balance and deduct (skip for reservation-based campaigns)
      let deductionResult = null;
      if (!skipDeduction) {
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
        deductionResult = await WalletService.deductGhsForSms(
          userId,
          financialBreakdown,
          `SMS to ${recipientsCount} recipient(s), ${financialBreakdown.avgSegments} segment(s)`
        );

        console.log('[NaloSmsService] Wallet deducted:', deductionResult.amountDeducted);
      } else {
        // For skip deduction, create a mock result
        const wallet = await Wallet.findOne({ userId });
        deductionResult = {
          success: true,
          wallet,
          transaction: null,
          newBalance: wallet.balance,
          amountDeducted: 0
        };
      }

      // Send SMS via Nalo API or simulate in dummy mode
      const payload = {
        key: this.apiKey,
        msisdn: formattedPhoneNumber,
        sender_id: senderId,
        message: message.trim()
      };

      let naloResponse;
      let smsStatus = 'queued';  // Canonical: all messages start as queued
      let errorCode = null;
      let errorMessage = null;
      let jobId = null;

      if (this.isDummyMode) {
        // Simulate SMS sending in dummy mode
        logger.smsSend.info('[NaloSmsService] Dummy mode: Simulating SMS send', {
          userId,
          phoneNumber: formattedPhoneNumber,
          senderId
        });
        smsStatus = 'sent';  // In dummy mode, immediately mark as sent
        jobId = `dummy-${Date.now()}`;
      } else {
        try {
          logger.smsSend.info('[NaloSmsService] Sending SMS via Nalo API', {
            userId,
            phoneNumber: formattedPhoneNumber,
            senderId,
            messageLength: message.length
          });

          const response = await this.httpClient.post(this.endpoint, payload, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: (status) => status === 200
          });

          const rawResponseData = String(response.data);
          logger.smsSend.info('[NaloSmsService] Nalo API response received', {
            userId,
            phoneNumber: formattedPhoneNumber,
            responseType: typeof response.data,
            responsePreview: rawResponseData.substring(0, 200)
          });

          naloResponse = this.parseNaloResponse(response.data, {
            phoneNumber,
            formattedPhoneNumber,
            userId,
            campaignId,
            recipientId
          });

          console.log('[NaloForensic]', {
            timestamp: new Date().toISOString(),
            userId,
            campaignId: campaignId || 'N/A',
            recipientId: recipientId || 'N/A',
            httpStatus: 200,
            providerEndpoint: this.endpoint,
            senderId: senderId || 'N/A',
            recipientPhone: formattedPhoneNumber || 'N/A',
            messageSegments: typeof financialBreakdown !== 'undefined' && financialBreakdown ? financialBreakdown.avgSegments : 'N/A',
            rawResponse: rawResponseData.substring(0, 500),
            parsedStatus: naloResponse.status,
            providerMessageId: naloResponse.message_id || null,
            providerErrorCode: naloResponse.status !== '1701' ? naloResponse.status : null,
            providerErrorMessage: naloResponse.error_message || null,
            isSuccess: naloResponse.status === '1701'
          });
          logger.smsSend.info('[NaloSmsService] Nalo response parsed', {
            userId,
            providerStatus: naloResponse.status,
            hasMessageId: !!naloResponse.message_id,
            hasError: !!naloResponse.error_message
          });

          // Check for success (1701)
          if (naloResponse.status === '1701') {
            smsStatus = 'sent';  // Provider accepted - mark as sent
            jobId = naloResponse.message_id || naloResponse.job_id || `nalo-${Date.now()}`;
            
            logger.info('[StatusMapping] SMS accepted by provider', {
              messageId: jobId,
              userId,
              phoneNumber: formattedPhoneNumber,
              status: smsStatus
            });
          } else {
            smsStatus = 'failed';  // Provider rejected - mark as failed
            errorCode = naloResponse.status;
           // Provide more user-friendly error messages for common Nalo errors
           if (naloResponse.status === '1707') {
             errorMessage = 'Sender ID not registered with Nalo. Please contact admin to register your sender ID with the SMS provider.';
           } else if (naloResponse.status === '1704') {
             errorMessage = 'Invalid API key. Please contact admin to verify Nalo configuration.';
           } else if (naloResponse.status === '1705') {
             errorMessage = 'Account suspended. Please contact admin.';
           } else if (naloResponse.status === '1025') {
             errorMessage = 'Insufficient SMS credits at provider. Please top up your Nalo account.';
           } else if (naloResponse.status === '1706') {
             errorMessage = 'Invalid destination number. The phone number format may be incorrect.';
            } else if (naloResponse.status === '1708') {
              errorMessage = 'Message too long for provider single-segment limit. The application should split long messages into multipart SMS before sending.';
           } else if (naloResponse.status === '1709') {
             errorMessage = 'Message contains invalid characters.';
           } else if (naloResponse.status === '1710') {
             errorMessage = 'Internal provider error. Please try again later.';
           } else if (naloResponse.status === '1711') {
             errorMessage = 'Service temporarily unavailable. Please try again later.';
           } else if (naloResponse.status === '1026') {
             errorMessage = 'Message blocked by spam filter.';
           } else if (naloResponse.status === '1027') {
             errorMessage = 'Destination number is blacklisted.';
           } else if (naloResponse.status === '1028') {
             errorMessage = 'Invalid message format.';
           } else if (naloResponse.status === '1703') {
             errorMessage = 'Authentication failed. Please contact admin.';
           } else {
             errorMessage = naloResponse.error_message || this.mapErrorCode(naloResponse.status);
           }

            logger.warn('[StatusMapping] SMS rejected by provider', {
              messageId: jobId,
              userId,
              phoneNumber: formattedPhoneNumber,
              status: smsStatus,
              errorCode: errorCode,
              errorMessage: errorMessage
            });

            // Telecel-specific failure logging
            if (networkType === 'Telecel') {
              console.log('[TelecelAudit]', {
                event: 'SMS_FAILED',
                originalNumber: phoneNumber,
                normalizedNumber: formattedPhoneNumber,
                providerStatus: naloResponse.status,
                errorCode: errorCode,
                errorMessage: errorMessage,
                userId,
                campaignId,
                recipientId,
                timestamp: new Date().toISOString()
              });
            }

            // Refund wallet on failure
            if (!skipDeduction) {
              await this.refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS failed - refund');
            }
          }

          } catch (apiError) {
            logger.smsSend.error('[NaloSmsService] Nalo API error', {
              userId,
              phoneNumber: formattedPhoneNumber,
              error: apiError.message,
              status: apiError.response?.status,
              responseData: apiError.response?.data
            });
            smsStatus = 'failed';
            // Provide specific error messages for common HTTP status codes
            if (apiError.response) {
              const status = apiError.response.status;
              const responseData = apiError.response.data;
              if (status === 401) {
                errorMessage = 'Authentication failed with Nalo provider. Please contact admin.';
              } else if (status === 403) {
                errorMessage = 'Access denied by Nalo provider. Please contact admin.';
              } else if (status === 412) {
                errorMessage = 'Sender ID not recognized by Nalo. Please ensure your sender ID is registered with the SMS provider.';
              } else if (status === 429) {
                errorMessage = 'Rate limited by Nalo provider. Please wait and try again.';
              } else if (status >= 500) {
                errorMessage = `Nalo provider error (HTTP ${status}). Please try again later.`;
              } else {
                errorMessage = responseData?.error_message || responseData?.message || apiError.message;
              }
            } else {
              errorMessage = apiError.message;
            }

            console.log('[NaloForensic]', {
              timestamp: new Date().toISOString(),
              userId,
              campaignId: campaignId || 'N/A',
              recipientId: recipientId || 'N/A',
              httpStatus: apiError.response?.status || 'NETWORK_ERROR',
              providerEndpoint: this.endpoint,
              senderId: senderId || 'N/A',
              recipientPhone: formattedPhoneNumber || 'N/A',
              messageSegments: typeof financialBreakdown !== 'undefined' && financialBreakdown ? financialBreakdown.avgSegments : 'N/A',
              rawResponse: String(apiError.response?.data || apiError.message).substring(0, 500),
              parsedStatus: 'HTTP_ERROR',
              providerMessageId: null,
              providerErrorCode: apiError.response?.status ? `HTTP_${apiError.response.status}` : 'NETWORK_ERROR',
              providerErrorMessage: errorMessage,
              isSuccess: false
            });

          logger.error('[StatusMapping] SMS failed due to API error', {
            messageId: jobId,
            userId,
            phoneNumber: formattedPhoneNumber,
            status: smsStatus,
            error: errorMessage
          });

           // Refund wallet on API error
           if (!skipDeduction) {
             await this.refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS API error - refund');
           }
         }
      }

        // Create SMS record
      const smsMessageData = {
        userId: userId,
        phoneNumber: formattedPhoneNumber,
        normalizedPhoneNumber: formattedPhoneNumber,
        networkType: networkType,
        senderId: senderId,
        message: message.trim(),
        provider: 'nalo',
        jobId: jobId || `failed-${Date.now()}`,
        status: smsStatus,
        errorCode: errorCode,
        errorMessage: errorMessage,
        sellPricePerSms: financialBreakdown.sellPricePerSms,
        providerCostPerSms: financialBreakdown.providerCostPerSms,
        segments: financialBreakdown.avgSegments,
        recipientsCount: recipientsCount,
        totalChargedToUser: smsStatus === 'sent' && !skipDeduction ? financialBreakdown.totalChargedToUser : 0,
        totalCostToProvider: financialBreakdown.totalCostToProvider,
        profitAmount: smsStatus === 'sent' && !skipDeduction ? financialBreakdown.profitAmount : 0
      };

      const savedMessage = await SmsMessage.create(smsMessageData);

      // Update monthly financial summary only on success and non-skip deduction
      if (smsStatus === 'sent' && !skipDeduction) {
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
            financialBreakdown.avgSegments
          );
        } catch (summaryError) {
          console.error('[NaloSmsService] Error updating financial summary:', summaryError.message);
        }

        logger.smsSend.info('SMS sent successfully', {
          userId,
          phoneNumber: formattedPhoneNumber,
          messageId: savedMessage._id,
          jobId: savedMessage.jobId,
          charged: financialBreakdown.totalChargedToUser
        });
        
        // Log send result with [SendResult] tag
        console.log('[SendResult]', {
          userId,
          phoneNumber: formattedPhoneNumber,
          success: true,
          messageId: savedMessage._id.toString(),
          jobId: savedMessage.jobId,
          status: smsStatus,
          charged: financialBreakdown.totalChargedToUser
        });
        
        return {
          success: true,
          messageId: savedMessage._id.toString(),
          jobId: savedMessage.jobId,
          financial: {
            charged: skipDeduction ? 0 : financialBreakdown.totalChargedToUser,
            cost: financialBreakdown.totalCostToProvider,
            profit: skipDeduction ? 0 : financialBreakdown.profitAmount,
            segments: financialBreakdown.avgSegments
          }
        };
      } else {
        logger.smsSend.error('SMS send failed', {
          userId,
          phoneNumber: formattedPhoneNumber,
          errorCode,
          errorMessage
        });
        
        // Log send result with [SendResult] tag
        console.log('[SendResult]', {
          userId,
          phoneNumber: formattedPhoneNumber,
          success: false,
          errorCode,
          errorMessage,
          status: smsStatus,
          messageId: savedMessage._id.toString()
        });
        
        return {
          success: false,
          error: errorMessage,
          messageId: savedMessage._id.toString(),
          code: errorCode || 'SMS_SEND_FAILED'
        };
      }

    } catch (error) {
      console.error('[NaloSmsService] Error:', error.message);

      let failedMessageId = null;
      let errorCode = 'INTERNAL_ERROR';
      let errorMessage = error.message;

      try {
        const failedMessage = await SmsMessage.create({
          userId,
          phoneNumber: phoneNumber,
          normalizedPhoneNumber: this.formatPhoneNumber(phoneNumber),
          networkType: 'unknown',
          senderId: senderId || '',
          message: message || '',
          provider: 'nalo',
          jobId: `failed-${Date.now()}`,
          status: 'failed',
          errorCode: errorCode,
          errorMessage: errorMessage,
          sellPricePerSms: 0,
          providerCostPerSms: 0,
          segments: 0,
          recipientsCount: 1,
          totalChargedToUser: 0,
          totalCostToProvider: 0,
          profitAmount: 0
        });
        failedMessageId = failedMessage._id.toString();
      } catch (dbError) {
        console.error('[NaloSmsService] Failed to create error SmsMessage record:', dbError.message);
      }

      if (!skipDeduction && typeof financialBreakdown !== 'undefined' && financialBreakdown) {
        try {
          await this.refundWallet(userId, financialBreakdown.totalChargedToUser, 'SMS internal error - refund');
        } catch (refundErr) {
          console.error('[NaloSmsService] Refund failed in outer catch:', refundErr.message);
        }
      }

      console.log('[SendResult]', {
        userId,
        phoneNumber: phoneNumber,
        success: false,
        error: errorMessage,
        code: errorCode,
        messageId: failedMessageId
      });

      return {
        success: false,
        error: errorMessage,
        code: errorCode,
        messageId: failedMessageId
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
      '1704': 'Invalid API key',
      '1705': 'Account suspended',
      '1706': 'Invalid destination number',
      '1707': 'Invalid sender ID',
      '1708': 'Message too long',
      '1709': 'Message contains invalid characters',
      '1710': 'Internal provider error',
      '1711': 'Service temporarily unavailable',
      '1025': 'Insufficient credit at provider',
      '1026': 'Message blocked by spam filter',
      '1027': 'Destination number blacklisted',
      '1028': 'Invalid message format'
    };

    return errorMap[code] || `Unknown error: ${code}`;
  }

  /**
   * Normalize delivery status for internal use
   */
  normalizeDeliveryStatus(providerStatus) {
    const statusMap = {
      // Canonical mapping
      'DELIVERED': 'delivered',
      'delivered': 'delivered',
      'SENT': 'sent',
      'sent': 'sent',
      'FAILED': 'failed',
      'failed': 'failed',
      'UNDELIVERED': 'failed',
      'undelivered': 'failed',
      'EXPIRED': 'failed',
      'expired': 'failed',
      'REJECTED': 'failed',
      'rejected': 'failed',
      'PENDING': 'queued',      // Canonical: queued
      'pending': 'queued',      // Canonical: queued
      'QUEUED': 'queued',
      'queued': 'queued',
      'PROCESSING': 'processing',
      'processing': 'processing',
      'SCHEDULED': 'scheduled',
      'scheduled': 'scheduled',
      'CANCELLED': 'cancelled',
      'cancelled': 'cancelled',
      'CANCELED': 'cancelled'
    };

    return statusMap[providerStatus] || 'unknown';
  }

  /**
   * Reset Nalo HTTP client circuit breaker
   * Called before each send campaign to ensure previous failures don't block new sends
   */
  resetCircuitBreaker() {
    if (this.httpClient && typeof this.httpClient.resetCircuitBreaker === 'function') {
      this.httpClient.resetCircuitBreaker();
      console.log('[NaloSmsService] Circuit breaker reset');
    }
  }

  /**
   * Get Nalo HTTP client circuit breaker status for diagnostics
   */
  getCircuitBreakerStatus() {
    if (this.httpClient && typeof this.httpClient.getCircuitBreakerStatus === 'function') {
      return this.httpClient.getCircuitBreakerStatus();
    }
    return { state: 'unknown', failures: 0 };
  }
}

module.exports = new NaloSmsService();
