const axios = require('axios');

const NALO_API_KEY = process.env.NALO_API_KEY;
const NALO_RESELLER_PREFIX = process.env.NALO_RESELLER_PREFIX || '';
// Use the same base URL as NaloSmsService
const NALO_API_URL = process.env.NALO_API_URL || 'https://sms.nalosolutions.com/smsbackend';

const sendSMS = async (senderId, recipients, message) => {
  try {
    // Handle both single recipient and array of recipients
    const msisdn = Array.isArray(recipients) ? recipients[0] : recipients;
    
    const payload = {
      api_key: NALO_API_KEY,
      reseller_prefix: NALO_RESELLER_PREFIX,
      sender_id: senderId,
      msisdn: msisdn,
      message: message
    };
    
    console.log('[Nalo API] URL:', `${NALO_API_URL}/send`);
    console.log('[Nalo API] Payload:', JSON.stringify(payload));
    
    const response = await axios.post(`${NALO_API_URL}/send`, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('[Nalo API] Response status:', response.status);
    console.log('[Nalo API] Response data:', response.data);
    
    // Check for Nalo success status
    if (response.data.status === '1701') {
      return response.data;
    } else {
      // Nalo returned an error
      console.error('[Nalo API] Error:', response.data.error_message || response.data);
      throw new Error(response.data.error_message || 'Nalo API error: ' + JSON.stringify(response.data));
    }
  } catch (error) {
    console.error('[Nalo SMS API Error] Full error:', error.message);
    console.error('[Nalo SMS API Error] Response:', error.response?.data);
    console.error('[Nalo SMS API Error] Status:', error.response?.status);
    
    // If we have a response from Nalo, include that in the error message
    if (error.response?.data) {
      throw new Error(`Nalo API error: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error('Failed to send SMS via Nalo API: ' + error.message);
  }
};

const checkBalance = async () => {
  try {
    // Try the balance endpoint - may not be available on all Nalo API versions
    const response = await axios.get(`${NALO_API_URL}/balance`, {
      params: { api_key: NALO_API_KEY }
    });
    
    return response.data.balance;
  } catch (error) {
    // If balance check fails, log but don't fail the SMS send
    console.error('[Nalo balance check error]:', error.response?.data || error.message);
    
    // Return a default high balance to allow SMS sending
    console.warn('[Nalo] Balance check unavailable, assuming sufficient credit');
    return 1000;
  }
};

module.exports = {
  sendSMS,
  checkBalance
};
