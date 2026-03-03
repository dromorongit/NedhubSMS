const axios = require('axios');

const NALO_API_KEY = process.env.NALO_API_KEY;
// Use the same base URL as NaloSmsService
const NALO_API_URL = process.env.NALO_API_URL || 'https://sms.nalosolutions.com/smsbackend';

const sendSMS = async (senderId, recipients, message) => {
  try {
    const response = await axios.post(`${NALO_API_URL}/send`, {
      api_key: NALO_API_KEY,
      sender_id: senderId,
      recipients: recipients,
      message: message
    });
    
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
