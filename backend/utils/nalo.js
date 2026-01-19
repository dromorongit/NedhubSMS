const axios = require('axios');

const NALO_API_KEY = process.env.NALO_API_KEY;
const NALO_API_URL = process.env.NALO_API_URL || 'https://api.nalosolutions.com/v1/sms';

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
    const response = await axios.get(`${NALO_API_URL}/balance`, {
      params: { api_key: NALO_API_KEY }
    });
    
    return response.data.balance;
  } catch (error) {
    console.error('Nalo balance check error:', error.response?.data || error.message);
    throw new Error('Failed to check SMS balance');
  }
};

module.exports = {
  sendSMS,
  checkBalance
};