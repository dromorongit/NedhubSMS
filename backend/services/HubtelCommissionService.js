const crypto = require('crypto');
const axios = require('axios');

/**
 * HubtelCommissionService
 * Handles Hubtel Commission Services API for utility payments and airtime/data
 * Reference: https://cs.hubtel.com/commissionservices
 */
class HubtelCommissionService {
  constructor() {
    // Hubtel API configuration from environment variables
    this.clientId = process.env.HUBTEL_CLIENT_ID;
    this.clientSecret = process.env.HUBTEL_CLIENT_SECRET;
    this.merchantAccountNumber = process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;
    this.callbackUrl = process.env.HUBTEL_CALLBACK_URL;
    
    // Hubtel Commission Services API base URL
    this.baseURL = process.env.HUBTEL_COMMISSION_BASE_URL || 'https://cs.hubtel.com/commissionservices';
    
    // Basic Auth header value (computed once)
    this.basicAuthHeader = this._computeBasicAuthHeader();
    
    // TV Service Codes
    this.tvServiceCodes = {
      'DSTV': 'DSTVGH',
      'GOTV': 'GOTVGH',
      'STARTIMES': 'STARTIMESGH'
    };
    
    // Utility Service Codes
    this.utilityServiceCodes = {
      'ECG': 'ECGPREPAID',
      'GHANA_WATER': 'GWCLPREPAID'
    };
  }

  /**
   * Compute Basic Auth header from client credentials
   */
  _computeBasicAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      console.warn('Hubtel Commission Services credentials not configured');
      return null;
    }
    return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
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
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    if (cleaned.startsWith('233')) {
      cleaned = '0' + cleaned.substring(3);
    } else if (cleaned.startsWith('+233')) {
      cleaned = '0' + cleaned.substring(4);
    } else if (!cleaned.startsWith('0')) {
      cleaned = '0' + cleaned;
    }
    
    if (cleaned.length !== 10 || !/^0[5-9]\d{8}$/.test(cleaned)) {
      throw new Error('Invalid Ghana phone number format');
    }
    
    return cleaned;
  }

  /**
   * Validate meter number format
   */
  validateMeterNumber(meterNumber, serviceType) {
    if (!meterNumber || meterNumber.trim() === '') {
      throw new Error('Meter number is required');
    }
    
    // ECG meter numbers are typically 11 digits
    if (serviceType === 'ECG' && !/^\d{8,11}$/.test(meterNumber)) {
      throw new Error('Invalid ECG meter number format');
    }
    
    // Ghana Water meter numbers vary
    if (serviceType === 'GHANA_WATER' && meterNumber.length < 4) {
      throw new Error('Invalid Ghana Water meter number');
    }
    
    return meterNumber.trim();
  }

  /**
   * Validate smart card number
   */
  validateSmartCardNumber(cardNumber, serviceType) {
    if (!cardNumber || cardNumber.trim() === '') {
      throw new Error('Smart card number is required');
    }
    
    // DSTV smart card numbers are typically 10-12 digits
    if (serviceType === 'DSTV' && !/^\d{10,12}$/.test(cardNumber)) {
      throw new Error('Invalid DSTV smart card number');
    }
    
    // GOtv smart card numbers are typically 10 digits
    if (serviceType === 'GOTV' && !/^\d{10,11}$/.test(cardNumber)) {
      throw new Error('Invalid GOtv smart card number');
    }
    
    // StarTimes smart card numbers vary
    if (serviceType === 'STARTIMES' && !/^\d{8,12}$/.test(cardNumber)) {
      throw new Error('Invalid StarTimes smart card number');
    }
    
    return cardNumber.trim();
  }

  /**
   * Get available bundles for a TV service
   */
  getTVBundles(serviceType) {
    const bundles = {
      'DSTV': [
        { code: 'DSTV-PAD', name: 'DSTV Personal', price: 65.00 },
        { code: 'DSTV-PAD+X', name: 'DSTV Personal + Extra View', price: 100.00 },
        { code: 'DSTV-COM', name: 'DSTV Compact', price: 225.00 },
        { code: 'DSTV-COM+X', name: 'DSTV Compact + Extra View', price: 260.00 },
        { code: 'DSTV-COMPL', name: 'DSTV Compact Plus', price: 335.00 },
        { code: 'DSTV-PREM', name: 'DSTV Premium', price: 580.00 },
        { code: 'DSTV-PREM+X', name: 'DSTV Premium + Extra View', price: 615.00 }
      ],
      'GOTV': [
        { code: 'GOTV-LITE', name: 'GOtv Lite', price: 35.00 },
        { code: 'GOTV-JINJA', name: 'GOtv Jinja', price: 125.00 },
        { code: 'GOTV-JOLI', name: 'GOtv Joli', price: 180.00 },
        { code: 'GOTV-MAX', name: 'GOtv Max', price: 320.00 }
      ],
      'STARTIMES': [
        { code: 'STAR-LITE', name: 'StarTimes Lite', price: 30.00 },
        { code: 'STAR-NOVA', name: 'StarTimes Nova', price: 80.00 },
        { code: 'STAR-SMART', name: 'StarTimes Smart', price: 140.00 },
        { code: 'STAR-COMPLETE', name: 'StarTimes Complete', price: 240.00 },
        { code: 'STAR-SUPER', name: 'StarTimes Super', price: 420.00 }
      ]
    };
    
    return bundles[serviceType] || [];
  }

  /**
   * Get available ECG meter types
   */
  getECGMeterTypes() {
    return [
      { code: 'PREPAID', name: 'Prepaid Meter' },
      { code: 'POSTPAID', name: 'Postpaid Meter' }
    ];
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

    if (!phoneNumber) throw new Error('Phone number is required');
    if (!network) throw new Error('Network is required');
    if (!amount || amount <= 0) throw new Error('Amount must be a positive number');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');

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
      amount: parseFloat(amount).toFixed(2),
      clientReference: clientReference || this.generateClientReference('AIRTIME'),
      callbackUrl: this.callbackUrl || `${process.env.APP_URL}/api/hubtel/airtime-callback`
    };

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/buy/airtime`;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_AIRTIME_BUY',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        phone: payload.recipient.phone,
        network: payload.recipient.network,
        amount: payload.amount
      }, null, 2));

      const response = await axios.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const responseData = response.data;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_AIRTIME_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage
      }, null, 2));

      if (responseData.responseCode !== '0000') {
        throw new Error(responseData.responseMessage || 'Airtime purchase failed');
      }

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId,
        status: 'success',
        message: responseData.responseMessage || 'Airtime purchased successfully'
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_AIRTIME_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        error: error.message,
        response: error.response?.data
      }, null, 2));

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
      bundleCode,
      clientReference
    } = options;

    if (!phoneNumber) throw new Error('Phone number is required');
    if (!network) throw new Error('Network is required');
    if (!bundleCode) throw new Error('Data bundle code is required');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');

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
      bundleId: bundleCode,
      clientReference: clientReference || this.generateClientReference('DATA'),
      callbackUrl: this.callbackUrl || `${process.env.APP_URL}/api/hubtel/data-callback`
    };

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/buy/databundle`;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_DATA_BUY',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        phone: payload.recipient.phone,
        network: payload.recipient.network,
        bundleId: payload.bundleId
      }, null, 2));

      const response = await axios.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const responseData = response.data;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_DATA_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage
      }, null, 2));

      if (responseData.responseCode !== '0000') {
        throw new Error(responseData.responseMessage || 'Data bundle purchase failed');
      }

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId,
        status: 'success',
        message: responseData.responseMessage || 'Data bundle purchased successfully'
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_DATA_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        error: error.message,
        response: error.response?.data
      }, null, 2));

      throw new Error(`Failed to buy data bundle: ${error.message}`);
    }
  }

  /**
   * Get TV bundles
   */
  async getTVBundlesAPI(serviceType) {
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');
    
    const serviceCode = this.tvServiceCodes[serviceType.toUpperCase()];
    if (!serviceCode) throw new Error('Invalid TV service type');

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/services/${serviceCode}/bundles`;
      
      const response = await axios.get(endpoint, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const responseData = response.data;
      
      if (responseData.responseCode !== '0000') {
        throw new Error(responseData.responseMessage || 'Failed to get TV bundles');
      }

      return {
        success: true,
        bundles: responseData.data?.bundles || this.getTVBundles(serviceType)
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_TV_BUNDLES_ERROR',
        timestamp: new Date().toISOString(),
        serviceType: serviceType,
        error: error.message
      }, null, 2));

      // Return local bundles as fallback
      return {
        success: true,
        bundles: this.getTVBundles(serviceType)
      };
    }
  }

  /**
   * Pay TV Bill
   */
  async payTVBill(options) {
    const {
      serviceType,
      smartCardNumber,
      amount,
      clientReference
    } = options;

    if (!serviceType) throw new Error('Service type is required');
    if (!smartCardNumber) throw new Error('Smart card number is required');
    if (!amount || amount <= 0) throw new Error('Amount must be a positive number');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');

    const validatedCard = this.validateSmartCardNumber(smartCardNumber, serviceType);
    const serviceCode = this.tvServiceCodes[serviceType.toUpperCase()];
    
    if (!serviceCode) {
      throw new Error('Invalid TV service type. Supported: DSTV, GOTV, STARTIMES');
    }

    const payload = {
      recipient: {
        smartcardNumber: validatedCard
      },
      amount: parseFloat(amount).toFixed(2),
      clientReference: clientReference || this.generateClientReference('TVBILL'),
      callbackUrl: this.callbackUrl || `${process.env.APP_URL}/api/hubtel/tv-callback`
    };

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/paybill/${serviceCode}`;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_TV_BILL_PAY',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        serviceType: serviceType,
        smartCard: validatedCard,
        amount: payload.amount
      }, null, 2));

      const response = await axios.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const responseData = response.data;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_TV_BILL_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage
      }, null, 2));

      if (responseData.responseCode !== '0000') {
        throw new Error(responseData.responseMessage || 'TV bill payment failed');
      }

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId,
        status: 'pending',
        message: responseData.responseMessage || 'TV bill payment initiated'
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_TV_BILL_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        error: error.message,
        response: error.response?.data
      }, null, 2));

      throw new Error(`Failed to pay TV bill: ${error.message}`);
    }
  }

  /**
   * Get ECG meter info
   */
  async getECGMeterInfo(meterNumber) {
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');
    if (!meterNumber) throw new Error('Meter number is required');

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/verify/meter/${meterNumber}`;
      
      const response = await axios.get(endpoint, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const responseData = response.data;
      
      if (responseData.responseCode !== '0000') {
        throw new Error(responseData.responseMessage || 'Failed to get meter info');
      }

      return {
        success: true,
        meterInfo: responseData.data
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_ECG_METER_ERROR',
        timestamp: new Date().toISOString(),
        meterNumber: meterNumber,
        error: error.message
      }, null, 2));

      throw new Error(`Failed to get meter info: ${error.message}`);
    }
  }

  /**
   * Pay ECG Bill
   */
  async payECGBill(options) {
    const {
      meterNumber,
      meterType,
      amount,
      clientReference
    } = options;

    if (!meterNumber) throw new Error('Meter number is required');
    if (!meterType) throw new Error('Meter type is required');
    if (!amount || amount <= 0) throw new Error('Amount must be a positive number');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');

    const validatedMeter = this.validateMeterNumber(meterNumber, 'ECG');

    const payload = {
      recipient: {
        meterNumber: validatedMeter,
        meterType: meterType.toUpperCase()
      },
      amount: parseFloat(amount).toFixed(2),
      clientReference: clientReference || this.generateClientReference('ECG'),
      callbackUrl: this.callbackUrl || `${process.env.APP_URL}/api/hubtel/utility-callback`
    };

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/paybill/${this.utilityServiceCodes['ECG']}`;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_ECG_PAY',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        meterNumber: validatedMeter,
        meterType: meterType,
        amount: payload.amount
      }, null, 2));

      const response = await axios.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const responseData = response.data;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_ECG_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage
      }, null, 2));

      if (responseData.responseCode !== '0000') {
        throw new Error(responseData.responseMessage || 'ECG payment failed');
      }

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId,
        status: 'pending',
        message: responseData.responseMessage || 'ECG payment initiated'
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_ECG_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        error: error.message,
        response: error.response?.data
      }, null, 2));

      throw new Error(`Failed to pay ECG bill: ${error.message}`);
    }
  }

  /**
   * Pay Ghana Water Bill
   */
  async payGhanaWaterBill(options) {
    const {
      meterNumber,
      amount,
      clientReference
    } = options;

    if (!meterNumber) throw new Error('Meter number is required');
    if (!amount || amount <= 0) throw new Error('Amount must be a positive number');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');

    const validatedMeter = this.validateMeterNumber(meterNumber, 'GHANA_WATER');

    const payload = {
      recipient: {
        meterNumber: validatedMeter
      },
      amount: parseFloat(amount).toFixed(2),
      clientReference: clientReference || this.generateClientReference('GWCL'),
      callbackUrl: this.callbackUrl || `${process.env.APP_URL}/api/hubtel/utility-callback`
    };

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/paybill/${this.utilityServiceCodes['GHANA_WATER']}`;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_GWCL_PAY',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        meterNumber: validatedMeter,
        amount: payload.amount
      }, null, 2));

      const response = await axios.post(endpoint, payload, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const responseData = response.data;
      
      console.log(JSON.stringify({
        label: 'HUBTEL_GWCL_RESPONSE',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        responseCode: responseData.responseCode,
        responseMessage: responseData.responseMessage
      }, null, 2));

      if (responseData.responseCode !== '0000') {
        throw new Error(responseData.responseMessage || 'Ghana Water payment failed');
      }

      return {
        success: true,
        clientReference: payload.clientReference,
        hubtelTransactionId: responseData.data?.transactionId,
        status: 'pending',
        message: responseData.responseMessage || 'Ghana Water payment initiated'
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_GWCL_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: payload.clientReference,
        error: error.message,
        response: error.response?.data
      }, null, 2));

      throw new Error(`Failed to pay Ghana Water bill: ${error.message}`);
    }
  }

  /**
   * Check transaction status
   */
  async checkTransactionStatus(clientReference) {
    if (!clientReference) throw new Error('Client reference is required');
    if (!this.basicAuthHeader) throw new Error('Hubtel credentials not configured');

    try {
      const endpoint = `${this.baseURL}/api/merchants/${this.merchantAccountNumber}/transactions/${clientReference}/status`;
      
      const response = await axios.get(endpoint, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const responseData = response.data;
      
      return {
        success: true,
        status: this._mapTransactionStatus(responseData.status || responseData.responseCode),
        responseCode: responseData.responseCode,
        data: responseData.data
      };

    } catch (error) {
      console.error(JSON.stringify({
        label: 'HUBTEL_STATUS_CHECK_ERROR',
        timestamp: new Date().toISOString(),
        clientReference: clientReference,
        error: error.message
      }, null, 2));

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
      'FAILED': 'failed',
      'CANCELLED': 'cancelled',
      'cancelled': 'cancelled'
    };
    return statusMap[status] || 'pending';
  }
}

module.exports = new HubtelCommissionService();
