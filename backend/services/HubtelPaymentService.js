const crypto = require('crypto');
const ResilientHttpClient = require('../utils/ResilientHttpClient');

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
    this.paymentCallbackUrl = process.env.HUBTEL_PAYMENT_CALLBACK_URL || process.env.HUBTEL_CALLBACK_URL;
    this.returnUrl = process.env.HUBTEL_RETURN_URL;
    this.cancellationUrl = process.env.HUBTEL_CANCELLATION_URL;
    
    // Hubtel API endpoints
    this.initiateEndpoint = process.env.HUBTEL_INITIATE_ENDPOINT || 'https://payproxyapi.hubtel.com/items/initiate';
    this.statusEndpoint = process.env.HUBTEL_STATUS_ENDPOINT || 'https://api-txnstatus.hubtel.com/transactions';

    // URL form: 'client_ref_in_path' (default, current behaviour) or
    // 'merchant_in_path_with_query' (merchant account number in path,
    // clientReference as a query parameter). Read-only flag; never changes
    // crediting behaviour. Set HUBTEL_STATUS_URL_FORM for Railway.
    this.statusUrlForm = String(process.env.HUBTEL_STATUS_URL_FORM || 'client_ref_in_path').toLowerCase();

    // Basic Auth header value (computed once)
    this.basicAuthHeader = this._computeBasicAuthHeader();

    // Initialize resilient HTTP client for payment operations
    this.httpClient = new ResilientHttpClient({
      serviceName: 'hubtel-payment',
      timeout: 30000, // 30 seconds for payments
      maxRetries: 2,
      baseDelay: 2000,
      maxDelay: 15000,
      failureThreshold: 5,
      recoveryTimeout: 60000
    });
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
      returnUrl,
      callbackUrl
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
      callbackUrl: callbackUrl || this.paymentCallbackUrl,
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
      const timestamp = new Date().toISOString();
      
      console.log(JSON.stringify({
        label: 'HUBTEL_INITIATE_RESPONSE',
        timestamp: timestamp,
        clientReference: clientReference,
        initiatingPayment: true,
        payload: {
          totalAmount: payload.totalAmount,
          description: payload.description,
          merchantAccountNumber: payload.merchantAccountNumber,
          clientReference: payload.clientReference
        }
      }, null, 2));

      // Make POST request to Hubtel initiate endpoint using resilient client
      const response = await this.httpClient.post(this.initiateEndpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      // Extract response data
      const fullResponseBody = response.data;
      const hubtelData = fullResponseBody.data || fullResponseBody;
      
      // Structured logging for HUBTEL_INITIATE_RESPONSE - response data
      console.log(JSON.stringify({
        label: 'HUBTEL_INITIATE_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: clientReference,
        responseCode: fullResponseBody.responseCode,
        status: hubtelData.status || (fullResponseBody.responseCode === '0000' ? 'Success' : 'Failed'),
        checkoutId: hubtelData.checkoutId,
        checkoutUrl: hubtelData.checkoutUrl,
        fullResponseBody: fullResponseBody
      }, null, 2));
      
      // Validate Hubtel response
      if (fullResponseBody.responseCode !== '0000') {
        throw new Error(`Hubtel error: ${fullResponseBody.responseDescription || fullResponseBody.message || 'Unknown error'}`);
      }

      // Return success response
      return {
        success: true,
        checkoutId: hubtelData.checkoutId,
        checkoutUrl: hubtelData.checkoutUrl,
        clientReference: clientReference,
        message: 'Payment initiated successfully'
      };

    } catch (error) {
      // Structured error logging with sanitization
      console.error(JSON.stringify({
        label: 'HUBTEL_INITIATE_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: clientReference,
        error: error.message,
        errorStack: error.stack
      }, null, 2));
      
      if (error.response) {
        // Sanitize sensitive data from error response
        const sanitizedResponse = JSON.parse(JSON.stringify(error.response.data));
        delete sanitizedResponse.access_token;
        delete sanitizedResponse.token;
        delete sanitizedResponse.clientSecret;
        console.error(JSON.stringify({
          label: 'HUBTEL_INITIATE_ERROR_RESPONSE',
          timestamp: new Date().toISOString(),
          clientReference: clientReference,
          status: error.response.status,
          sanitizedResponseData: sanitizedResponse
        }, null, 2));
      }

      throw new Error(`Failed to initiate payment: ${error.message}`);
    }
  }

  /**
   * Extract the raw transaction status from a Hubtel provider response body.
   * When the response has a `data` object, its `status`/`transactionStatus`
     * fields are authoritative and any top-level status field is ignored.
   * A top-level status field is used only when there is no `data` object.
   * Looks under the field names 'status' and 'transactionStatus'.
   * Returns the first non-empty value found, or undefined when none is present.
   */
  _extractStatus(body) {
    const data = body && body.data;
    if (data && data !== body) {
      // data object present: only its status fields are authoritative
      const found = this._extractStatusFromObject(data);
      if (found) return found;
    }
    // No data object: fall back to top-level status fields
    return this._extractStatusFromObject(body);
  }

  /**
   * Extract status/transactionStatus from a single object (no recursion into
   * nested objects beyond this level).
   */
  _extractStatusFromObject(obj) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (typeof obj.status !== 'undefined' && String(obj.status).trim() !== '') return String(obj.status).trim();
    if (typeof obj.transactionStatus !== 'undefined' && String(obj.transactionStatus).trim() !== '') return String(obj.transactionStatus).trim();
    return undefined;
  }

  /**
   * Build the transaction status check URL from the configured form.
   * Form A 'client_ref_in_path' (default): {statusEndpoint}/{clientReference}/status
   * Form B 'merchant_in_path_with_query': {statusEndpoint}/{merchantAccountNumber}/status?clientReference={ref}
   * Form B is only available when HUBTEL_MERCHANT_ACCOUNT_NUMBER is configured.
   * @param {string} clientReference - The unique transaction reference
   * @returns {string} - The full status-check URL
   */
  _buildStatusUrl(clientReference) {
    if (this.statusUrlForm === 'merchant_in_path_with_query') {
      const merchant = this.merchantAccountNumber || '';
      if (merchant) {
        return `${this.statusEndpoint}/${merchant}/status?clientReference=${clientReference}`;
      }
    }
    // Form A (default, and fallback when form B has no merchant account number)
    return `${this.statusEndpoint}/${clientReference}/status`;
  }

  /**
   * Perform a read-only status check returning raw response info. Never writes
   * to the database and never credits anything. The `urlForm` override lets
   * callers probe a specific URL form independently of this instance's default.
   * @param {string} clientReference - The unique transaction reference
   * @param {string} urlForm - override: 'client_ref_in_path' or 'merchant_in_path_with_query'
   * @returns {Object} - { httpStatus, code, message, hasStatus, hasAmount }
   */
  async checkStatusRaw(clientReference, urlForm) {
    if (!this.basicAuthHeader) {
      throw new Error('Hubtel credentials not configured');
    }
    if (!clientReference) {
      throw new Error('Client reference is required');
    }

    const form = urlForm || this.statusUrlForm;
    let statusUrl;
    if (form === 'merchant_in_path_with_query') {
      const merchant = this.merchantAccountNumber || '';
      if (!merchant) {
        throw new Error('Merchant account number not configured for form B');
      }
      statusUrl = `${this.statusEndpoint}/${merchant}/status?clientReference=${clientReference}`;
    } else {
      statusUrl = `${this.statusEndpoint}/${clientReference}/status`;
    }

    const response = await this.httpClient.get(statusUrl, {
      headers: {
        'Authorization': this.basicAuthHeader,
        'Content-Type': 'application/json'
      }
    });

    const body = response.data && typeof response.data === 'object' ? response.data : {};
    const top = response.data;
    const hasStatus = Boolean(
      (top && (typeof top.status !== 'undefined' || typeof top.transactionStatus !== 'undefined')) ||
      (body.data && (typeof body.data.status !== 'undefined' || typeof body.data.transactionStatus !== 'undefined'))
    );
    const hasAmount = Boolean(
      (top && (typeof top.amount !== 'undefined' || typeof top.totalAmount !== 'undefined')) ||
      (body.data && (typeof body.data.amount !== 'undefined' || typeof body.data.totalAmount !== 'undefined'))
    );

    const code = body.responseCode || body.response_code || body.code || body.Status || body.status;
    const message = HubtelPaymentService.sanitizeShortMessage(
      body.statusDescription || body.message || body.responseDescription || ''
    );

    return {
      httpStatus: response.status,
      code,
      message,
      hasStatus,
      hasAmount
    };
  }

  /**
   * Sanitize a short user-facing message: truncate to 160 chars and strip
   * anything resembling a key/token. Never returns secrets.
   */
  static sanitizeShortMessage(message) {
    let m = String(message || '');
    // Remove anything resembling a key/token/secret (alphanumeric runs with
    // dashes/underscores longer than 12 chars).
    m = m.replace(/[A-Za-z0-9_-]{13,}/g, '<redacted>');
    if (m.length > 160) m = m.slice(0, 160) + '…';
    return m;
  }

  /**
   * Check the status of a transaction using clientReference
   * This is used as a fallback when callback is not received
   * @param {string} clientReference - The unique transaction reference
   * @returns {Object} - Transaction status details
   * Verify against Hubtel's current Transaction Status documentation.
   */
  async checkTransactionStatus(clientReference) {
    if (!this.basicAuthHeader) {
      throw new Error('Hubtel credentials not configured');
    }

    if (!clientReference) {
      throw new Error('Client reference is required');
    }

    try {
      // Structured logging for HUBTEL_STATUS_CHECK_RESPONSE - initiating
      console.log(JSON.stringify({
        label: 'HUBTEL_STATUS_CHECK_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: clientReference,
        checkingStatus: true
      }, null, 2));

      // Hubtel status endpoint URL built from the configured form.
      const statusUrl = this._buildStatusUrl(clientReference);

      const response = await this.httpClient.get(statusUrl, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      // Any non-2xx HTTP status is a verification failure, not a transaction
      // status. 401/403 mean credentials or IP are blocked; 404 means Hubtel
      // has no record; 5xx means the provider is down. These must never be
      // mapped to a transaction 'pending' status.
      if (response.status < 200 || response.status >= 300) {
        const statusData = response.data && typeof response.data === 'object' ? response.data : {};
        const err = new Error(`Hubtel status check failed with HTTP ${response.status}`);
        err.httpStatus = response.status;
        err.code = statusData.responseCode || statusData.response_code || statusData.code || statusData.Status || statusData.status;
        err.isHttpError = true;
        throw err;
      }

      // Extract full response body
      const fullResponseBody = response.data;
      const statusData = fullResponseBody.data || fullResponseBody;

      // Raw provider status: checked at the top level and one level down under
      // 'data', under the field names 'status' and 'transactionStatus'
      const rawStatus = this._extractStatus(fullResponseBody);

      // Structured logging for HUBTEL_STATUS_CHECK_RESPONSE - response data
      console.log(JSON.stringify({
        label: 'HUBTEL_STATUS_CHECK_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: clientReference,
        responseCode: statusData.ResponseCode || statusData.responseCode,
        status: rawStatus,
        transactionId: statusData.transactionId || statusData.POS_SALES_ID,
        amount: statusData.amount || statusData.totalAmount,
        fullResponseBody: fullResponseBody
      }, null, 2));
      
      // Amount the provider reports for this transaction. HUBTEL_AMOUNT_MODE
      // selects which provider field is read:
      //   gross (default, current behaviour): statusData.amount, falling back
      //     to statusData.totalAmount
      //   net: statusData.netAmount, then statusData.net_amount, then
      //     statusData.amountAfterFee. In net mode there is NO gross fallback:
      //     if no net field is present the amount is unknown (null), the
      //     payment stays pending and one warning is logged.
      // The exact comparison used by the callback verifier is
      //   Math.round(providerAmount*100) >= Math.round(payment.amount*100)
      //   (whole pesewas, assessPayment in callbackVerificationService.js)
      // The owner can switch modes after capturing a real Hubtel response with
      // scripts/inspect-hubtel-status.js, without a code change. Default is
      // the current (gross) behaviour.
      const amountMode = String(process.env.HUBTEL_AMOUNT_MODE || 'gross').toLowerCase();
      let providerAmount;
      if (amountMode === 'net') {
        const net =
          statusData.netAmount != null ? statusData.netAmount
          : statusData.net_amount != null ? statusData.net_amount
          : statusData.amountAfterFee != null ? statusData.amountAfterFee
          : undefined;
        if (net == null) {
          console.warn('[HubtelPaymentService] HUBTEL_AMOUNT_MODE=net but no net amount field present in provider response; amount unknown, payment will stay pending', { clientReference });
          providerAmount = null;
        } else {
          providerAmount = net;
        }
      } else {
        // gross - current behaviour
        providerAmount = statusData.amount || statusData.totalAmount;
      }

      return {
        success: true,
        httpStatus: response.status,
        clientReference: clientReference,
        status: this._mapHubtelStatus(rawStatus),
        rawStatus,
        amount: providerAmount,
        currency: statusData.currency || 'GHS',
        transactionId: statusData.transactionId || statusData.POS_SALES_ID,
        paymentMethod: statusData.paymentMethod || this._mapPaymentMethod(statusData.type),
        message: statusData.statusDescription || statusData.message || 'Status retrieved'
      };

    } catch (error) {
      // Classify the failure so callers can distinguish a genuine provider
      // 'pending' from a verification that could not be completed.
      const httpStatus = error.response ? error.response.status : undefined;
      let code;
      if (error.response && error.response.data && typeof error.response.data === 'object') {
        const body = error.response.data;
        code = body.responseCode || body.response_code || body.code || body.Status || body.status;
      }
      const message = error.message || '';
      const isTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(message);
      const isNetwork = !error.response;
      const isUnparseable = isNetwork && /JSON|parse|syntax/i.test(message);

      // Structured error logging
      console.error(JSON.stringify({
        label: 'HUBTEL_STATUS_CHECK_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: clientReference,
        error: error.message,
        errorStack: error.stack
      }, null, 2));
      
      if (error.response) {
        // Sanitize sensitive data from error response
        const sanitizedResponse = JSON.parse(JSON.stringify(error.response.data));
        delete sanitizedResponse.access_token;
        delete sanitizedResponse.token;
        delete sanitizedResponse.clientSecret;
        console.error(JSON.stringify({
          label: 'HUBTEL_STATUS_CHECK_ERROR_RESPONSE',
          timestamp: new Date().toISOString(),
          clientReference: clientReference,
          status: error.response.status,
          sanitizedResponseData: sanitizedResponse
        }, null, 2));
      }

      const err = new Error(`Failed to check transaction status: ${error.message}`);
      err.httpStatus = httpStatus;
      err.code = code;
      err.isTimeout = isTimeout;
      err.isNetwork = isNetwork;
      err.isUnparseable = isUnparseable;
      throw err;
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
    // Map the provider's inner transaction status only. The top-level
    // responseCode (e.g. '0000' meaning the API call itself succeeded) must
    // never by itself mark a transaction paid or failed. Anything
    // unrecognised, missing or malformed stays pending.
    //
    // CONSERVATIVE MAPPING: only explicit success words map to paid and only
    // explicit failure words map to failed. 'Unpaid', 'Refunded', '1002' and
    // every other value not explicitly listed below map to pending - a
    // refunded payment never credits and is not marked failed; it stays
    // pending for manual review (see reconcile-pending.js).
    //
    // PAYMENT (top-up): accept Paid/Success/Successful/Completed (case-insensitive).
    // Hubtel callback and status responses may use any of these words; all are
    // treated as confirmed payment.
    //
    // Comparison is trimmed and case-insensitive so 'paid', 'Paid', ' PAID ',
    // 'success', 'SUCCESS', 'completed', 'COMPLETED' all map as expected.
    const raw = String(hubtelStatus || '').trim().toLowerCase();
    const paidWords = ['paid', 'success', 'successful', 'completed'];
    const failedWords = ['failed'];

    if (paidWords.includes(raw)) return 'paid';
    if (failedWords.includes(raw)) return 'failed';
    return 'pending';
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
