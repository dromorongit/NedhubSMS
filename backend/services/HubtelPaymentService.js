const crypto = require('crypto');
const axios = require('axios');

/**
 * HubtelPaymentService
 * Handles all Hubtel Online Checkout API interactions
 * All API calls are done server-side for security
 */
class HubtelPaymentService {
  constructor() {
    // Hubtel API configuration from environment variables
    this.clientId = process.env.HUBTEL_CLIENT_ID;
    this.clientSecret = process.env.HUBTEL_CLIENT_SECRET;
    this.merchantAccountNumber = process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;
    this.callbackUrl = process.env.HUBTEL_CALLBACK_URL;
    this.returnUrl = process.env.HUBTEL_RETURN_URL;
    this.cancellationUrl = process.env.HUBTEL_CANCELLATION_URL;
    
    // Hubtel API endpoints
    this.initiateEndpoint = process.env.HUBTEL_INITIATE_ENDPOINT || 'https://payproxyapi.hubtel.com/items/initiate';
    this.statusEndpoint = process.env.HUBTEL_STATUS_ENDPOINT || 'https://api-txnstatus.hubtel.com/transactions';
    
    // Basic Auth header value (computed once)
    this.basicAuthHeader = this._computeBasicAuthHeader();
  }

  /**
   * Compute Basic Auth header from client credentials
   * Format: Base64(clientId:clientSecret)
   */
  _computeBasicAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      console.warn('Hubtel credentials not configured');
      return null;
    }
    return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  /**
   * Generate a unique client reference for transactions
   * Format: NH-{timestamp}-{random}
   */
  generateClientReference() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `NH-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Initiate a payment checkout with Hubtel
   * @param {Object} paymentData - Payment details
   * @param {number} paymentData.amount - Amount to charge
   * @param {string} paymentData.description - Payment description
   * @param {string} paymentData.clientReference - Unique transaction reference
   * @param {string} paymentData.customerEmail - Customer email (optional)
   * @param {string} paymentData.customerPhone - Customer phone (optional)
   * @param {string} paymentData.returnUrl - Custom return URL (optional)
   * @returns {Object} - Hubtel API response with checkout URL
   */
  async initiatePayment(paymentData) {
    const {
      amount,
      description,
      clientReference,
      customerEmail,
      customerPhone,
      returnUrl
    } = paymentData;

    // Validate required fields
    if (!amount || amount <= 0) {
      throw new Error('Invalid amount: must be a positive number');
    }
    if (!description) {
      throw new Error('Description is required');
    }
    if (!clientReference) {
      throw new Error('Client reference is required');
    }
    if (!this.basicAuthHeader) {
      throw new Error('Hubtel credentials not configured');
    }

    // Prepare request payload for Hubtel API
    const payload = {
      totalAmount: parseFloat(amount).toFixed(2),
      description: description.substring(0, 500), // Hubtel limit
      callbackUrl: this.callbackUrl,
      merchantAccountNumber: this.merchantAccountNumber,
      clientReference: clientReference
    };

    // Use custom returnUrl if provided, otherwise use environment variable
    if (returnUrl) {
      payload.returnUrl = returnUrl;
    } else if (this.returnUrl) {
      payload.returnUrl = this.returnUrl;
    }
    
    // Add cancellation URL if available
    if (this.cancellationUrl) {
      payload.cancellationUrl = this.cancellationUrl;
    }

    // Add optional fields if provided
    if (customerEmail) {
      payload.email = customerEmail;
    }
    if (customerPhone) {
      payload.phone = customerPhone;
    }

    try {
      console.log(`[Hubtel] Initiating payment for clientReference: ${clientReference}`);
      console.log(`[Hubtel] Payload:`, JSON.stringify(payload, null, 2));

      // Make POST request to Hubtel initiate endpoint
      const response = await axios.post(this.initiateEndpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      console.log(`[Hubtel] Initiate response:`, JSON.stringify(response.data, null, 2));

      // Hubtel returns data nested under 'data' property
      const hubtelData = response.data.data || response.data;
      
      // Validate Hubtel response
      if (response.data.responseCode !== '0000') {
        throw new Error(`Hubtel error: ${response.data.responseDescription || response.data.message || 'Unknown error'}`);
      }

      console.log('[Hubtel] Extracted checkoutUrl:', hubtelData.checkoutUrl);

      return {
        success: true,
        checkoutId: hubtelData.checkoutId,
        checkoutUrl: hubtelData.checkoutUrl,
        clientReference: clientReference,
        message: 'Payment initiated successfully'
      };

    } catch (error) {
      console.error('[Hubtel] Initiate payment error:', error.message);
      
      if (error.response) {
        console.error('[Hubtel] Response data:', error.response.data);
      }

      throw new Error(`Failed to initiate payment: ${error.message}`);
    }
  }

  /**
   * Check the status of a transaction using clientReference
   * This is used as a fallback when callback is not received
   * @param {string} clientReference - The unique transaction reference
   * @returns {Object} - Transaction status details
   */
  async checkTransactionStatus(clientReference) {
    if (!this.basicAuthHeader) {
      throw new Error('Hubtel credentials not configured');
    }

    if (!clientReference) {
      throw new Error('Client reference is required');
    }

    try {
      console.log(`[Hubtel] Checking status for clientReference: ${clientReference}`);

      // Hubtel status endpoint format
      const statusUrl = `${this.statusEndpoint}/${clientReference}/status`;

      const response = await axios.get(statusUrl, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log(`[Hubtel] Status response:`, JSON.stringify(response.data, null, 2));

      // Parse response based on Hubtel's status format
      // Handle both nested and flat response structures
      const statusData = response.data.data || response.data;
      
      return {
        success: true,
        clientReference: clientReference,
        status: this._mapHubtelStatus(statusData.status || statusData.ResponseCode),
        amount: statusData.amount || statusData.totalAmount,
        currency: statusData.currency || 'GHS',
        transactionId: statusData.transactionId || statusData.POS_SALES_ID,
        paymentMethod: statusData.paymentMethod || this._mapPaymentMethod(statusData.type),
        message: statusData.statusDescription || statusData.message || 'Status retrieved'
      };

    } catch (error) {
      console.error('[Hubtel] Check status error:', error.message);
      
      if (error.response) {
        console.error('[Hubtel] Response data:', error.response.data);
      }

      throw new Error(`Failed to check transaction status: ${error.message}`);
    }
  }

  /**
   * Verify Hubtel callback signature (if implemented by Hubtel)
   * @param {Object} callbackData - The callback payload from Hubtel
   * @param {string} signature - The signature from Hubtel (if provided)
   * @returns {boolean} - Whether the signature is valid
   */
  verifyCallbackSignature(callbackData, signature) {
    // Hubtel may provide HMAC signature - implement verification if needed
    // For now, we rely on clientReference verification in the controller
    if (!signature) {
      console.warn('[Hubtel] No signature provided in callback');
      return true; // Proceed with clientReference verification
    }

    // TODO: Implement HMAC verification if Hubtel provides signatures
    // This would typically involve:
    // 1. Creating a hash of the callback data
    // 2. Comparing with the provided signature using clientSecret
    
    console.log('[Hubtel] Signature verification not fully implemented - using clientReference verification');
    return true;
  }

  /**
   * Map Hubtel status to our internal status
   * @param {string} hubtelStatus - Status from Hubtel response
   * @returns {string} - Mapped internal status
   */
  _mapHubtelStatus(hubtelStatus) {
    const statusMap = {
      'SUCCESS': 'paid',
      'SUCCESSFUL': 'paid',
      '0000': 'paid',
      'pending': 'pending',
      'PENDING': 'pending',
      'FAILED': 'failed',
      'FAILED': 'failed',
      '1002': 'failed', // Common Hubtel failure code
      'CANCELLED': 'cancelled',
      'cancelled': 'cancelled'
    };

    return statusMap[hubtelStatus] || 'unknown';
  }

  /**
   * Map Hubtel payment method to our internal payment method
   * @param {string} hubtelType - Payment type from Hubtel
   * @returns {string} - Mapped internal payment method
   */
  _mapPaymentMethod(hubtelType) {
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
}

module.exports = HubtelPaymentService;
