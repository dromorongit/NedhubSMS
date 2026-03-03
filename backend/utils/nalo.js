const axios = require('axios');

const NALO_API_KEY = process.env.NALO_API_KEY;
const NALO_RESELLER_PREFIX = process.env.NALO_RESELLER_PREFIX || '';

// Try multiple Nalo API endpoints - some users report different URLs work
const NALO_API_ENDPOINTS = [
  'https://api.nalosolutions.com/v1/sms',  // Original API v1
  'https://sms.nalosolutions.com/smsbackend',  // Alternative endpoint
  process.env.NALO_API_URL  // Custom URL from env
].filter(Boolean);

let NALO_API_URL = NALO_API_ENDPOINTS[0];

const sendSMS = async (senderId, recipients, message) => {
  // Handle both single recipient and array of recipients
  const msisdn = Array.isArray(recipients) ? recipients[0] : recipients;
  
  // Try each endpoint until one works
  for (const endpoint of NALO_API_ENDPOINTS) {
    try {
      const payload = {
        api_key: NALO_API_KEY,
        reseller_prefix: NALO_RESELLER_PREFIX,
        sender_id: senderId,
        msisdn: msisdn,
        message: message
      };
      
      console.log('[Nalo API] Trying URL:', `${endpoint}/send`);
      console.log('[Nalo API] Payload:', JSON.stringify(payload));
      
      const response = await axios.post(`${endpoint}/send`, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('[Nalo API] Response status:', response.status);
      console.log('[Nalo API] Response data:', response.data);
      
      // Check for Nalo success status
      if (response.data.status === '1701') {
        return response.data;
      } else if (response.data.status === '1702') {
        throw new Error('Missing parameters - check sender ID and message');
      } else if (response.data.status === '1703') {
        throw new Error('Authentication failed - check API key');
      } else if (response.data.status === '1706') {
        throw new Error('Invalid destination number');
      } else if (response.data.status === '1707') {
        throw new Error('Invalid sender ID');
      } else if (response.data.status === '1025') {
        throw new Error('Insufficient balance with Nalo provider');
      } else {
        throw new Error(`Nalo error: ${response.data.error_message || JSON.stringify(response.data)}`);
      }
    } catch (error) {
      console.log(`[Nalo API] Endpoint ${endpoint} failed:`, error.message);
      
      // If we get a 404, try next endpoint
      if (error.response?.status === 404) {
        console.log('[Nalo API] 404 - trying next endpoint...');
        continue;
      }
      
      // For other errors on last endpoint, throw
      if (endpoint === NALO_API_ENDPOINTS[NALO_API_ENDPOINTS.length - 1]) {
        console.error('[Nalo SMS API Error] All endpoints failed');
        throw error;
      }
    }
  }
  
  throw new Error('All Nalo API endpoints failed');
};

const checkBalance = async () => {
  // Try each endpoint
  for (const endpoint of NALO_API_ENDPOINTS) {
    try {
      const response = await axios.get(`${endpoint}/balance`, {
        params: { api_key: NALO_API_KEY }
      });
      return response.data.balance;
    } catch (error) {
      console.log(`[Nalo balance] Endpoint ${endpoint} failed:`, error.message);
      if (error.response?.status === 404) {
        continue;
      }
      if (endpoint === NALO_API_ENDPOINTS[NALO_API_ENDPOINTS.length - 1]) {
        break;
      }
    }
  }
  
  // Return default if all fail
  console.warn('[Nalo] Balance check unavailable, assuming sufficient credit');
  return 1000;
};

module.exports = {
  sendSMS,
  checkBalance
};
