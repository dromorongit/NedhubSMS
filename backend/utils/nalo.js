const axios = require('axios');

const NALO_API_KEY = process.env.NALO_API_KEY;
const NALO_RESELLER_PREFIX = process.env.NALO_RESELLER_PREFIX || '';

// Try multiple Nalo API endpoints with different paths
const NALO_API_ENDPOINTS = [
  'https://api.nalosolutions.com/v1/sms',
  'https://api.nalosolutions.com/sms',
  'https://sms.nalosolutions.com/smsbackend',
  'https://sms.nalosolutions.com/smsbackend/api',
  process.env.NALO_API_URL
].filter(Boolean);

const sendSMS = async (senderId, recipients, message) => {
  const msisdn = Array.isArray(recipients) ? recipients[0] : recipients;
  
  for (const endpoint of NALO_API_ENDPOINTS) {
    try {
      const payload = {
        api_key: NALO_API_KEY,
        reseller_prefix: NALO_RESELLER_PREFIX,
        sender_id: senderId,
        msisdn: msisdn,
        message: message
      };
      
      console.log('[Nalo API] Trying:', `${endpoint}/send`);
      
      const response = await axios.post(`${endpoint}/send`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      console.log('[Nalo API] Response:', response.data);
      
      if (response.data.status === '1701') {
        return response.data;
      }
      throw new Error(response.data.error_message || `Nalo error: ${response.data.status}`);
    } catch (error) {
      console.log(`[Nalo API] Failed: ${endpoint} - ${error.message}`);
      if (error.response?.status === 404) continue;
      if (endpoint === NALO_API_ENDPOINTS[NALO_API_ENDPOINTS.length - 1]) throw error;
    }
  }
  throw new Error('All Nalo API endpoints failed');
};

const checkBalance = async () => {
  for (const endpoint of NALO_API_ENDPOINTS) {
    try {
      const response = await axios.get(`${endpoint}/balance`, {
        params: { api_key: NALO_API_KEY },
        timeout: 5000
      });
      return response.data.balance;
    } catch (error) {
      if (error.response?.status === 404) continue;
    }
  }
  console.warn('[Nalo] Balance check failed, assuming credits available');
  return 1000;
};

module.exports = { sendSMS, checkBalance };
