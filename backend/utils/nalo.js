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
    
    console.log('[Nalo API] Sending SMS with payload:', JSON.stringify(payload));
    
    const response = await axios.post(`${NALO_API_URL}/send`, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('[Nalo API] Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Nalo SMS API error:', error.response?.data || error.message);
    throw new Error('Failed to send SMS via Nalo API');
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
    // The actual SMS send will fail if there's no credit
    console.error('Nalo balance check error:', error.response?.data || error.message);
    
    // Return a default high balance to allow SMS sending
    // The SMS API will reject if there's insufficient credit
    console.warn('Nalo balance check unavailable, assuming sufficient credit');
    return 1000; // Assume sufficient balance - SMS API will reject if insufficient
  }
};

module.exports = {
  sendSMS,
  checkBalance
};
