const crypto = require('crypto');
const ResilientHttpClient = require('../utils/ResilientHttpClient');
const logger = require('../utils/logger');

// Log tags for structured logging
const LogTags = {
  HUBTEL_AUTH: '[HubtelAuth]',
  HUBTEL_403: '[Hubtel403]',
  HUBTEL_VALIDATION: '[HubtelValidation]',
  PROVIDER_FAILURE: '[ProviderFailure]'
};

/**
 * HubtelTransferService
 * Handles Hubtel Direct API for Mobile Money, Bank Transfers, Airtime and Data
 * Reference: https://hubtel.com/docs/direct-api
 */
class HubtelTransferService {
  constructor() {
    // Hubtel API configuration from environment variables
    this.clientId = process.env.HUBTEL_CLIENT_ID;
    this.clientSecret = process.env.HUBTEL_CLIENT_SECRET;
    this.merchantAccountNumber = process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;
    this.prepaidDepositId = process.env.HUBTEL_PREPAID_DEPOSIT_ID;
    this.callbackUrl = process.env.HUBTEL_CALLBACK_URL;
    // Separate callback URLs per transaction type (HUBTEL_CALLBACK_URL may only have airtime URL)
    this.airtimeCallbackUrl = process.env.HUBTEL_AIRTIME_CALLBACK_URL || this.callbackUrl || `${process.env.APP_URL}/api/hubtel/airtime-callback`;
    this.dataCallbackUrl = process.env.HUBTEL_DATA_CALLBACK_URL || `${process.env.APP_URL}/api/hubtel/data-callback`;
    this.momoCallbackUrl = process.env.HUBTEL_MOMO_CALLBACK_URL || `${process.env.APP_URL}/api/hubtel/momo-callback`;
    this.bankCallbackUrl = process.env.HUBTEL_BANK_CALLBACK_URL || `${process.env.APP_URL}/api/hubtel/bank-callback`;

    // Hubtel Direct API endpoints
    this.momoEndpoint = process.env.HUBTEL_MOMO_ENDPOINT || 'https://smp.hubtel.com/api/merchants';
    this.bankEndpoint = process.env.HUBTEL_BANK_ENDPOINT || 'https://smp.hubtel.com/api/merchants';
    this.airtimeEndpoint = process.env.HUBTEL_AIRTIME_ENDPOINT || 'https://smp.hubtel.com/api/merchants';
    this.dataEndpoint = process.env.HUBTEL_DATA_ENDPOINT || 'https://smp.hubtel.com/api/merchants';

    // Configurable timeout for pending_confirmation auto-failure (default 10 minutes)
    this.pendingConfirmationTimeoutMs = parseInt(process.env.PENDING_CONFIRMATION_TIMEOUT_MS) || 10 * 60 * 1000;

    // Basic Auth header value (computed once)
    this.basicAuthHeader = this._computeBasicAuthHeader();

    // Initialize resilient HTTP client for transfer operations
    this.httpClient = new ResilientHttpClient({
      serviceName: 'hubtel-transfer',
      timeout: 60000, // 60 seconds for transfers
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      failureThreshold: 5,
      recoveryTimeout: 60000
    });

    logger.info('[HubtelTransferService] Initialized', {
      clientId: this.clientId ? 'configured' : 'MISSING',
      prepaidDepositId: this.prepaidDepositId ? 'configured' : 'MISSING',
      callbackUrl: this.callbackUrl || 'not set',
      airtimeCallbackUrl: this.airtimeCallbackUrl,
      dataCallbackUrl: this.dataCallbackUrl,
      pendingConfirmationTimeoutMs: this.pendingConfirmationTimeoutMs
    });
    
    // Ghana bank codes
    this.bankCodes = {
      'GBA': 'Gillette Savings & Loans',
      'STANBIC': 'Stanbic Bank Ghana',
      'SG-SSB': 'Savings & Loans Bank',
      'EB-ACC': 'Ecobank Ghana',
      'CAL': 'CalBank Ghana',
      'ADB': 'Agricultural Development Bank',
      'UTB': 'Universal TBL Bank',
      'CONSOLIDATED': 'Consolidated Bank Ghana',
      'FBN': 'First Bank of Nigeria',
      'FIDELITY': 'Fidelity Bank Ghana',
      'PRIVATE': 'Private Trust Bank',
      'TECHIMAN': 'Techno Bank',
      'ZENITH': 'Zenith Bank Ghana',
      'GCB': 'Ghana Commercial Bank',
      'ACCESS': 'Access Bank Ghana',
      'ARREARS': 'OmniBSIC Bank',
      'BSIC': 'Bank of Baroda Ghana',
      'FEXDE': 'First Trust Bank',
      'NIB': 'National Investment Bank',
      'PBB': 'Pan African Bank',
      'REPUBLIC': 'Republic Bank Ghana',
      'STANDARD CHARTERED': 'Standard Chartered Bank Ghana'
    };
  }

/**
    * Compute Basic Auth header from client credentials
    */
  _computeBasicAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      logger.warn(LogTags.HUBTEL_AUTH + ' Hubtel credentials not configured');
      return null;
    }
    return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  /**
   * Mask client ID for logging (show first 4 and last 4 chars)
   */
  _maskClientId(clientId) {
    if (!clientId) return 'NOT_CONFIGURED';
    if (clientId.length <= 8) return '****' + clientId.slice(-4);
    return clientId.slice(0, 4) + '****' + clientId.slice(-4);
  }

  /**
   * Log full Hubtel response body for non-2xx responses with authorization context
   */
  _logNon2xxResponse(response, context) {
    if (!response) return;

    const status = response.status;
    const data = response.data;

    if (status >= 200 && status < 300) return;

    const maskedClientId = this._maskClientId(this.clientId);

    logger.error(LogTags.HUBTEL_AUTH + ' Non-2xx response received', {
      ...context,
      httpStatus: status,
      endpointUrl: response.config?.url || context.endpoint,
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED',
      clientIdHash: maskedClientId,
      callbackUrl: this.airtimeCallbackUrl,
      fullResponseBody: JSON.stringify(data),
      responseHeaders: response.headers
    });

    if (status === 403) {
      logger.error(LogTags.HUBTEL_403 + ' Authorization denied by Hubtel', {
        ...context,
        httpStatus: status,
        endpointUrl: response.config?.url || context.endpoint,
        merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
        prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED',
        clientIdHash: maskedClientId,
        callbackUrl: this.airtimeCallbackUrl,
        fullErrorPayload: JSON.stringify(data),
        errorCode: data?.error || data?.responseCode || 'UNKNOWN',
        errorMessage: data?.message || data?.responseMessage || data?.error || 'Access forbidden'
      });
    }

    if (status >= 400 && status < 500) {
      logger.error(LogTags.HUBTEL_VALIDATION + ' Client error from Hubtel', {
        ...context,
        httpStatus: status,
        endpointUrl: response.config?.url || context.endpoint,
        errorMsg: data?.error || data?.responseMessage || 'Unknown client error'
      });
    }

    if (status >= 500) {
      logger.error(LogTags.PROVIDER_FAILURE + ' Server error from Hubtel', {
        ...context,
        httpStatus: status,
        endpointUrl: response.config?.url || context.endpoint,
        errorMsg: data?.error || 'Unknown server error'
      });
    }
  }

  /**
   * Generate a unique client reference for transactions
   */
  generateClientReference(prefix = 'TXN') {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(6).toString('hex');
    return `${prefix}-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Validate phone number format (Ghana format)
   */
  validatePhoneNumber(phone) {
    // Remove any whitespace or special characters (keep digits only)
    let cleaned = phone.replace(/\D/g, '');
    
    // Handle various formats
    if (cleaned.startsWith('233') && cleaned.length === 12) {
      // Already in 233XXXXXXXXX format — keep as-is for API
      // (Hubtel API accepts both 0XXXXXXXXX and 233XXXXXXXXX)
      return cleaned;
    } else if (cleaned.startsWith('0') && cleaned.length === 10) {
      // 0XXXXXXXXX format — keep as-is
      return cleaned;
    } else if (cleaned.length === 9) {
      // 9-digit bare number — prepend 0
      cleaned = '0' + cleaned;
      return cleaned;
    } else if (cleaned.startsWith('233') && cleaned.length > 12) {
      // Too long — strip leading 233 and prepend 0
      cleaned = '0' + cleaned.substring(3);
      return cleaned;
    }
    
    // Validate final format: must be 0XXXXXXXXX (10 digits) or 233XXXXXXXXX (12 digits)
    if (!/^0[5-9]\d{8}$/.test(cleaned) && !/^233[5-9]\d{8}$/.test(cleaned)) {
      throw new Error('Invalid Ghana phone number format');
    }
    
    return cleaned;
  }

  /**
   * Get network provider from phone number
   */
  getNetworkFromPhone(phone) {
    const cleaned = this.validatePhoneNumber(phone);
    const prefix = cleaned.substring(1, 3);
    
    const networks = {
      '50': 'MTN',
      '54': 'MTN',
      '55': 'MTN',
      '56': 'MTN',
      '57': 'MTN',
      '20': 'MTN',
      '26': 'MTN',
      '27': 'MTN',
      '28': 'MTN',
      '29': 'MTN',
      '24': 'Vodafone',
      '23': 'Vodafone',
      '54': 'Telecel',
      '55': 'Telecel',
      '44': 'AirtelTigo',
      '45': 'AirtelTigo',
      '47': 'AirtelTigo',
      '53': 'AirtelTigo'
    };
    
    return networks[prefix] || 'MTN'; // Default to MTN if unknown
  }

/**
    * Send Mobile Money (MTN, Telecel, AirtelTigo)
    */
  async sendMobileMoney(options) {
    const {
      recipientPhone,
      recipientName,
      amount,
      description,
      clientReference,
      network
    } = options;

    logger.info(LogTags.HUBTEL_VALIDATION + ' [MomoSend] Request initiated', {
      recipientPhone,
      network,
      amount,
      clientReference,
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED'
    });

    // Validate required fields
    if (!recipientPhone) throw new Error('Recipient phone number is required');
    if (!recipientName) throw new Error('Recipient name is required');
    if (!amount || amount <= 0) throw new Error('Amount must be a positive number');
    if (!description) throw new Error('Description is required');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');
    if (!this.prepaidDepositId) throw new Error('Prepaid Deposit ID not configured');

    // Validate and format phone number
    const validatedPhone = this.validatePhoneNumber(recipientPhone);
    
    // Determine network if not provided
    const targetNetwork = network || this.getNetworkFromPhone(recipientPhone);

    // Map network names to Hubtel format
    const networkMap = {
      'MTN': 'MTN',
      'VODAFONE': 'VODAFONE',
      'TELECEL': 'TELECEL',
      'AIRTELTIGO': 'AIRTELTIGO'
    };

    // Prepare API payload
    const payload = {
      recipient: {
        name: recipientName,
        phone: validatedPhone,
        network: networkMap[targetNetwork] || 'MTN'
      },
      amount: parseFloat(amount).toFixed(2),
      clientReference: clientReference || this.generateClientReference('MOMO'),
      callbackUrl: this.callbackUrl || `${process.env.APP_URL}/api/hubtel/momo-callback`,
      description: description.substring(0, 500)
    };

    try {
      const endpoint = `${this.momoEndpoint}/${this.prepaidDepositId}/send/mobilemoney`;

      logger.info(LogTags.HUBTEL_AUTH + ' [MomoSend] Dispatching request', {
        clientReference: payload.clientReference,
        recipient: payload.recipient.phone,
        network: payload.recipient.network,
        amount: payload.amount,
        endpointUrl: endpoint,
        callbackUrl: payload.callbackUrl,
        merchantAccountNumber: this.merchantAccountNumber,
        prepaidDepositId: this.prepaidDepositId,
        clientIdHash: this._maskClientId(this.clientId)
      });

      const response = await this.httpClient.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      const responseData = response.data;

      // Log non-2xx responses with full body
      this._logNon2xxResponse(response, {
        check: 'momo_send',
        clientReference: payload.clientReference
      });

      logger.info(LogTags.HUBTEL_RESPONSE + ' [MomoSend] Response received', {
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage,
        hubtelTransactionId: responseData.data?.transactionId || responseData.data?.hubtelTransactionId,
        httpStatus: response.status,
        is403: response.status === 403
      });

      // CRITICAL: HTTP 403 must be treated as failure, not success
      if (response.status === 403) {
        logger.error(LogTags.HUBTEL_403 + ' [MomoSend] Treating 403 as failure', {
          clientReference: payload.clientReference,
          fullErrorPayload: responseData
        });
        throw new Error(responseData?.error || responseData?.responseMessage || 'Authorization failed (403)');
      }

      // Hubtel may return errors as { error: "message" } (e.g. 403) or
      // as { responseCode: "XXXX", responseMessage: "..." } (e.g. 200 with error code).
      // Check both shapes since the HTTP client is configured to not throw on 4xx.
      if (responseData.error) {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [MomoSend] Provider returned error in response body', {
          clientReference: payload.clientReference,
          error: responseData.error,
          fullResponseBody: responseData
        });
        throw new Error(responseData.error);
      }
      if (responseData.responseCode && responseData.responseCode !== '0000') {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [MomoSend] Provider returned non-success responseCode', {
          clientReference: payload.clientReference,
          responseCode: responseData.responseCode,
          responseMessage: responseData.responseMessage,
          fullResponseBody: responseData
        });
        throw new Error(responseData.responseMessage || 'Mobile money transfer failed');
      }

      logger.info(LogTags.HUBTEL_RESPONSE + ' [MomoSend] Request successful', {
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId || responseData.data?.hubtelTransactionId
      });

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId || responseData.data?.hubtelTransactionId,
        status: 'pending',
        message: responseData.responseMessage || 'Mobile money transfer initiated'
      };

    } catch (error) {
      logger.error(LogTags.PROVIDER_FAILURE + ' [MomoSend] Request failed', {
        clientReference: payload?.clientReference,
        error: error.message,
        code: error.code,
        response: error.response?.data,
        httpStatus: error.response?.status,
        fullErrorPayload: error.response?.data,
        isTimeout: error.code === 'ECONNABORTED' || error.message?.includes('timeout'),
        isNetworkError: !error.response
      });
      throw new Error(`Failed to send mobile money: ${error.message}`);
    }
  }

/**
    * Send to Bank Account
    */
  async sendToBank(options) {
    const {
      bankCode,
      accountNumber,
      accountName,
      amount,
      description,
      clientReference
    } = options;

    logger.info(LogTags.HUBTEL_VALIDATION + ' [BankSend] Request initiated', {
      bankCode,
      amount,
      clientReference,
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED'
    });

    // Validate required fields
    if (!bankCode) throw new Error('Bank code is required');
    if (!accountNumber) throw new Error('Account number is required');
    if (!accountName) throw new Error('Account name is required');
    if (!amount || amount <= 0) throw new Error('Amount must be a positive number');
    if (!description) throw new Error('Description is required');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');
    if (!this.prepaidDepositId) throw new Error('Prepaid Deposit ID not configured');

    // Validate account number format
    if (accountNumber.length < 4 || accountNumber.length > 16) {
      throw new Error('Invalid account number format');
    }

    // Prepare API payload
    const payload = {
      destination: {
        bankCode: bankCode,
        accountNumber: accountNumber,
        accountName: accountName
      },
      amount: parseFloat(amount).toFixed(2),
      clientReference: clientReference || this.generateClientReference('BANK'),
      callbackUrl: this.callbackUrl || `${process.env.APP_URL}/api/hubtel/bank-callback`,
      description: description.substring(0, 500)
    };

    try {
      const endpoint = `${this.bankEndpoint}/${this.prepaidDepositId}/send/bank/gh/${bankCode}`;

      logger.info(LogTags.HUBTEL_AUTH + ' [BankSend] Dispatching request', {
        clientReference: payload.clientReference,
        bankCode: payload.destination.bankCode,
        accountNumber: 'XXXX' + payload.destination.accountNumber.slice(-4),
        amount: payload.amount,
        endpointUrl: endpoint,
        merchantAccountNumber: this.merchantAccountNumber,
        prepaidDepositId: this.prepaidDepositId,
        clientIdHash: this._maskClientId(this.clientId)
      });

      const response = await this.httpClient.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      const responseData = response.data;

      // Log non-2xx responses with full body
      this._logNon2xxResponse(response, {
        check: 'bank_send',
        clientReference: payload.clientReference
      });

      logger.info(LogTags.HUBTEL_RESPONSE + ' [BankSend] Response received', {
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage,
        hubtelTransactionId: responseData.data?.transactionId || responseData.data?.hubtelTransactionId,
        httpStatus: response.status,
        is403: response.status === 403
      });

      // CRITICAL: HTTP 403 must be treated as failure, not success
      if (response.status === 403) {
        logger.error(LogTags.HUBTEL_403 + ' [BankSend] Treating 403 as failure', {
          clientReference: payload.clientReference,
          fullErrorPayload: responseData
        });
        throw new Error(responseData?.error || responseData?.responseMessage || 'Authorization failed (403)');
      }

      // Hubtel may return errors as { error: "message" } (e.g. 403) or
      // as { responseCode: "XXXX", responseMessage: "..." } (e.g. 200 with error code).
      // Check both shapes since the HTTP client is configured to not throw on 4xx.
      if (responseData.error) {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [BankSend] Provider returned error in response body', {
          clientReference: payload.clientReference,
          error: responseData.error,
          fullResponseBody: responseData
        });
        throw new Error(responseData.error);
      }
      if (responseData.responseCode && responseData.responseCode !== '0000') {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [BankSend] Provider returned non-success responseCode', {
          clientReference: payload.clientReference,
          responseCode: responseData.responseCode,
          responseMessage: responseData.responseMessage,
          fullResponseBody: responseData
        });
        throw new Error(responseData.responseMessage || 'Bank transfer failed');
      }

      logger.info(LogTags.HUBTEL_RESPONSE + ' [BankSend] Request successful', {
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId || responseData.data?.hubtelTransactionId
      });

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId || responseData.data?.hubtelTransactionId,
        status: 'pending',
        message: responseData.responseMessage || 'Bank transfer initiated'
      };

    } catch (error) {
      logger.error(LogTags.PROVIDER_FAILURE + ' [BankSend] Request failed', {
        clientReference: payload?.clientReference,
        error: error.message,
        code: error.code,
        response: error.response?.data,
        httpStatus: error.response?.status,
        fullErrorPayload: error.response?.data,
        isTimeout: error.code === 'ECONNABORTED' || error.message?.includes('timeout'),
        isNetworkError: !error.response
      });
      throw new Error(`Failed to send to bank: ${error.message}`);
    }
  }

  /**
   * Buy Airtime
   */
  async buyAirtime(options) {
    const {
      phoneNumber,
      network,
      amount,
      clientReference
    } = options;

    logger.info(LogTags.HUBTEL_VALIDATION + ' [AirtimeBuy] Request initiated', {
      phoneNumber,
      network,
      amount,
      clientReference,
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED'
    });

    // Validate required fields
    if (!phoneNumber) throw new Error('Phone number is required');
    if (!network) throw new Error('Network is required');
    if (!amount || amount <= 0) throw new Error('Amount must be a positive number');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');
    if (!this.prepaidDepositId) throw new Error('Prepaid Deposit ID not configured');

    // Validate and format phone number
    const validatedPhone = this.validatePhoneNumber(phoneNumber);

    // Map network names
    const networkMap = {
      'MTN': 'MTN',
      'VODAFONE': 'VODAFONE',
      'TELECEL': 'TELECEL',
      'AIRTELTIGO': 'AIRTELTIGO'
    };

    const payload = {
      recipient: {
        phone: validatedPhone,
        network: networkMap[network.toUpperCase()] || 'MTN'
      },
      amount: parseFloat(amount).toFixed(2),
      clientReference: clientReference || this.generateClientReference('AIRTIME'),
      callbackUrl: this.airtimeCallbackUrl
    };

    try {
      const endpoint = `${this.airtimeEndpoint}/${this.prepaidDepositId}/buy/airtime`;

      logger.info(LogTags.HUBTEL_AUTH + ' [AirtimeBuy] Dispatching request to Hubtel', {
        clientReference: payload.clientReference,
        phone: payload.recipient.phone,
        network: payload.recipient.network,
        amount: payload.amount,
        endpointUrl: endpoint,
        callbackUrl: payload.callbackUrl,
        merchantAccountNumber: this.merchantAccountNumber,
        prepaidDepositId: this.prepaidDepositId,
        clientIdHash: this._maskClientId(this.clientId)
      });

      const response = await this.httpClient.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      const responseData = response.data;

      // Log non-2xx responses with full body
      this._logNon2xxResponse(response, {
        check: 'airtime_purchase',
        clientReference: payload.clientReference
      });

      logger.info(LogTags.HUBTEL_RESPONSE + ' [AirtimeBuy] Response received from Hubtel', {
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage,
        hubtelTransactionId: responseData.data?.transactionId,
        httpStatus: response.status,
        is403: response.status === 403
      });

      // CRITICAL: HTTP 403 must be treated as failure, not success
      if (response.status === 403) {
        logger.error(LogTags.HUBTEL_403 + ' [AirtimeBuy] Treating 403 as failure', {
          clientReference: payload.clientReference,
          fullErrorPayload: responseData
        });
        throw new Error(responseData?.error || responseData?.responseMessage || 'Authorization failed (403)');
      }

      // Hubtel may return errors as { error: "message" } (e.g. 403) or
      // as { responseCode: "XXXX", responseMessage: "..." } (e.g. 200 with error code).
      // Check both shapes since the HTTP client is configured to not throw on 4xx.
      if (responseData.error) {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [AirtimeBuy] Provider returned error in response body', {
          clientReference: payload.clientReference,
          error: responseData.error,
          fullResponseBody: responseData
        });
        throw new Error(responseData.error);
      }
      if (responseData.responseCode && responseData.responseCode !== '0000') {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [AirtimeBuy] Provider returned non-success responseCode', {
          clientReference: payload.clientReference,
          responseCode: responseData.responseCode,
          responseMessage: responseData.responseMessage,
          fullResponseBody: responseData
        });
        throw new Error(responseData.responseMessage || 'Airtime purchase failed');
      }

      logger.info(LogTags.HUBTEL_RESPONSE + ' [AirtimeBuy] Request successful', {
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId
      });

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId,
        status: 'success',
        message: responseData.responseMessage || 'Airtime purchased successfully'
      };

    } catch (error) {
      logger.error(LogTags.PROVIDER_FAILURE + ' [AirtimeBuy] Request failed', {
        clientReference: payload?.clientReference,
        error: error.message,
        code: error.code,
        response: error.response?.data,
        httpStatus: error.response?.status,
        fullErrorPayload: error.response?.data,
        isTimeout: error.code === 'ECONNABORTED' || error.message?.includes('timeout'),
        isNetworkError: !error.response
      });
      throw new Error(`Failed to buy airtime: ${error.message}`);
    }
  }

  /**
   * Buy Data Bundle
   */
  async buyData(options) {
    const {
      phoneNumber,
      network,
      dataBundleCode,
      clientReference
    } = options;

    logger.info(LogTags.HUBTEL_VALIDATION + ' [DataBuy] Request initiated', {
      phoneNumber,
      network,
      dataBundleCode,
      clientReference,
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED'
    });

    // Validate required fields
    if (!phoneNumber) throw new Error('Phone number is required');
    if (!network) throw new Error('Network is required');
    if (!dataBundleCode) throw new Error('Data bundle code is required');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');
    if (!this.prepaidDepositId) throw new Error('Prepaid Deposit ID not configured');

    const validatedPhone = this.validatePhoneNumber(phoneNumber);

    const networkMap = {
      'MTN': 'MTN',
      'VODAFONE': 'VODAFONE',
      'TELECEL': 'TELECEL',
      'AIRTELTIGO': 'AIRTELTIGO'
    };

    const payload = {
      recipient: {
        phone: validatedPhone,
        network: networkMap[network.toUpperCase()] || 'MTN'
      },
      bundleId: dataBundleCode,
      clientReference: clientReference || this.generateClientReference('DATA'),
      callbackUrl: this.dataCallbackUrl
    };

    try {
      const endpoint = `${this.dataEndpoint}/${this.prepaidDepositId}/buy/databundle`;

      logger.info(LogTags.HUBTEL_AUTH + ' [DataBuy] Dispatching request to Hubtel', {
        clientReference: payload.clientReference,
        phone: payload.recipient.phone,
        network: payload.recipient.network,
        bundleId: payload.bundleId,
        endpointUrl: endpoint,
        callbackUrl: payload.callbackUrl,
        merchantAccountNumber: this.merchantAccountNumber,
        prepaidDepositId: this.prepaidDepositId,
        clientIdHash: this._maskClientId(this.clientId)
      });

      const response = await this.httpClient.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      const responseData = response.data;

      // Log non-2xx responses with full body
      this._logNon2xxResponse(response, {
        check: 'data_purchase',
        clientReference: payload.clientReference
      });

      logger.info(LogTags.HUBTEL_RESPONSE + ' [DataBuy] Response received from Hubtel', {
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage,
        hubtelTransactionId: responseData.data?.transactionId,
        httpStatus: response.status,
        is403: response.status === 403
      });

      // CRITICAL: HTTP 403 must be treated as failure, not success
      if (response.status === 403) {
        logger.error(LogTags.HUBTEL_403 + ' [DataBuy] Treating 403 as failure', {
          clientReference: payload.clientReference,
          fullErrorPayload: responseData
        });
        throw new Error(responseData?.error || responseData?.responseMessage || 'Authorization failed (403)');
      }

      // Hubtel may return errors as { error: "message" } (e.g. 403) or
      // as { responseCode: "XXXX", responseMessage: "..." } (e.g. 200 with error code).
      // Check both shapes since the HTTP client is configured to not throw on 4xx.
      if (responseData.error) {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [DataBuy] Provider returned error in response body', {
          clientReference: payload.clientReference,
          error: responseData.error,
          fullResponseBody: responseData
        });
        throw new Error(responseData.error);
      }
      if (responseData.responseCode && responseData.responseCode !== '0000') {
        logger.error(LogTags.HUBTEL_RESPONSE + ' [DataBuy] Provider returned non-success responseCode', {
          clientReference: payload.clientReference,
          responseCode: responseData.responseCode,
          responseMessage: responseData.responseMessage,
          fullResponseBody: responseData
        });
        throw new Error(responseData.responseMessage || 'Data bundle purchase failed');
      }

      logger.info(LogTags.HUBTEL_RESPONSE + ' [DataBuy] Request successful', {
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId
      });

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId,
        status: 'success',
        message: responseData.responseMessage || 'Data bundle purchased successfully'
      };

    } catch (error) {
      logger.error(LogTags.PROVIDER_FAILURE + ' [DataBuy] Request failed', {
        clientReference: payload?.clientReference,
        error: error.message,
        code: error.code,
        response: error.response?.data,
        httpStatus: error.response?.status,
        fullErrorPayload: error.response?.data,
        isTimeout: error.code === 'ECONNABORTED' || error.message?.includes('timeout'),
        isNetworkError: !error.response
      });
      throw new Error(`Failed to buy data bundle: ${error.message}`);
    }
  }

  /**
   * Check transaction status
   */
  async checkTransactionStatus(clientReference) {
    if (!clientReference) throw new Error('Client reference is required');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');

    try {
      const endpoint = `${this.momoEndpoint}/transactions/${clientReference}/status`;

      logger.info('[HubtelRequest] [StatusCheck] Checking transaction status', {
        clientReference,
        endpoint
      });

      const response = await this.httpClient.get(endpoint, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      const responseData = response.data;
      const mappedStatus = this._mapTransactionStatus(responseData.status || responseData.responseCode);

      logger.info('[HubtelResponse] [StatusCheck] Status response received', {
        clientReference,
        rawStatus: responseData.status || responseData.responseCode,
        mappedStatus,
        responseCode: responseData.responseCode,
        httpStatus: response.status
      });

      return {
        success: true,
        status: mappedStatus,
        responseCode: responseData.responseCode,
        data: responseData.data
      };

    } catch (error) {
      logger.error('[ProviderCatch] [StatusCheck]', {
        clientReference,
        error: error.message,
        code: error.code,
        isTimeout: error.code === 'ECONNABORTED' || error.message?.includes('timeout')
      });
      throw new Error(`Failed to check transaction status: ${error.message}`);
    }
  }

  /**
   * Map Hubtel transaction status to internal status
   */
  _mapTransactionStatus(status) {
    const statusMap = {
      'SUCCESS': 'success',
      'SUCCESSFUL': 'success',
      'PENDING': 'pending',
      'pending': 'pending',
      'FAILED': 'failed',
      'CANCELLED': 'cancelled',
      'cancelled': 'cancelled'
    };
    const mapped = statusMap[status] || 'pending';
    logger.debug('[HubtelTransferService] Status mapped', { rawStatus: status, mappedStatus: mapped });
    return mapped;
  }

  /**
   * Get available bank codes
   */
  getBankCodes() {
    return this.bankCodes;
  }

  /**
   * Get available data bundles for a network
   */
  getDataBundles(network) {
    const bundles = {
      MTN: [
        { code: 'MTN-10MB', name: 'MTN 10MB (1 Day)', price: 1.50 },
        { code: 'MTN-50MB', name: 'MTN 50MB (3 Days)', price: 3.50 },
        { code: 'MTN-100MB', name: 'MTN 100MB (7 Days)', price: 6.00 },
        { code: 'MTN-200MB', name: 'MTN 200MB (14 Days)', price: 10.00 },
        { code: 'MTN-500MB', name: 'MTN 500MB (30 Days)', price: 20.00 },
        { code: 'MTN-1GB', name: 'MTN 1GB (30 Days)', price: 35.00 },
        { code: 'MTN-2GB', name: 'MTN 2GB (30 Days)', price: 60.00 },
        { code: 'MTN-5GB', name: 'MTN 5GB (30 Days)', price: 120.00 }
      ],
      TELECEL: [
        { code: 'TELECEL-10MB', name: 'Telecel 10MB (1 Day)', price: 1.50 },
        { code: 'TELECEL-50MB', name: 'Telecel 50MB (3 Days)', price: 3.50 },
        { code: 'TELECEL-100MB', name: 'Telecel 100MB (7 Days)', price: 6.00 },
        { code: 'TELECEL-200MB', name: 'Telecel 200MB (14 Days)', price: 10.00 },
        { code: 'TELECEL-500MB', name: 'Telecel 500MB (30 Days)', price: 20.00 },
        { code: 'TELECEL-1GB', name: 'Telecel 1GB (30 Days)', price: 35.00 }
      ],
      AIRTELTIGO: [
        { code: 'AIRTEL-10MB', name: 'AirtelTigo 10MB (1 Day)', price: 1.50 },
        { code: 'AIRTEL-50MB', name: 'AirtelTigo 50MB (3 Days)', price: 3.50 },
        { code: 'AIRTEL-100MB', name: 'AirtelTigo 100MB (7 Days)', price: 6.00 },
        { code: 'AIRTEL-200MB', name: 'AirtelTigo 200MB (14 Days)', price: 10.00 },
        { code: 'AIRTEL-500MB', name: 'AirtelTigo 500MB (30 Days)', price: 20.00 },
        { code: 'AIRTEL-1GB', name: 'AirtelTigo 1GB (30 Days)', price: 35.00 }
      ]
    };

    const result = bundles[network] || bundles['MTN'];
    if (network && network !== 'MTN' && !bundles[network]) {
      logger.warn('[HubtelTransferService] [DataBundles] Unknown network, falling back to MTN bundles', { network });
    }
    return result;
  }
}

/**
 * Scan for transactions stuck in pending_confirmation beyond the configured timeout
 * and mark them as failed with wallet refund.
 * Intended to be called periodically (e.g. via a cron job or setInterval).
 */
async function expireStalePendingConfirmations() {
  const Transaction = require('../models/Transaction');
  const Wallet = require('../models/Wallet');
  const timeoutMs = new HubtelTransferService().pendingConfirmationTimeoutMs;
  const cutoff = new Date(Date.now() - timeoutMs);

  logger.info('[TransactionLifecycle] Scanning for stale pending_confirmation transactions', {
    cutoff: cutoff.toISOString(),
    timeoutMs
  });

  const staleTxns = await Transaction.find({
    status: 'pending_confirmation',
    createdAt: { $lt: cutoff },
    'metadata.transactionType': { $in: ['AIRTIME_PURCHASE', 'DATA_PURCHASE'] }
  });

  if (staleTxns.length === 0) {
    logger.info('[TransactionLifecycle] No stale pending_confirmation transactions found');
    return { scanned: 0, expired: 0, errors: 0 };
  }

  logger.warn('[TransactionLifecycle] Stale pending_confirmation transactions found', {
    count: staleTxns.length
  });

  let expired = 0;
  let errors = 0;

  for (const tx of staleTxns) {
    try {
      tx.status = 'failed';
      tx.description += ` - AUTO-FAILED: No provider callback received within ${timeoutMs / 1000}s`;
      tx.metadata = {
        ...tx.metadata,
        failedAt: new Date(),
        failureReason: `Provider did not confirm within ${timeoutMs / 1000}s timeout`,
        autoFailed: true,
        timeoutMs
      };
      await tx.save();

      // Refund wallet
      await Wallet.findOneAndUpdate(
        { userId: tx.userId },
        { $inc: { balance: tx.amount }, $set: { updatedAt: new Date() } }
      );

      logger.warn('[TransactionLifecycle] Transaction auto-failed and wallet refunded', {
        reference: tx.reference,
        userId: tx.userId,
        amount: tx.amount,
        type: tx.metadata.transactionType
      });
      expired++;
    } catch (err) {
      logger.error('[TransactionLifecycle] Failed to auto-expire transaction', {
        reference: tx.reference,
        error: err.message
      });
      errors++;
    }
  }

  logger.info('[TransactionLifecycle] Stale transaction scan complete', { scanned: staleTxns.length, expired, errors });
  return { scanned: staleTxns.length, expired, errors };
}

module.exports = new HubtelTransferService();
module.exports.expireStalePendingConfirmations = expireStalePendingConfirmations;
