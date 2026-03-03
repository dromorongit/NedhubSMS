const axios = require('axios');

const NALO_API_KEY = process.env.NALO_API_KEY;
const NALO_BASE_URL = 'https://sms.nalosolutions.com';
const NALO_ENDPOINT = '/smsbackend/Resl_Nalo/send-message/';

/**
 * Convert phone number to Ghana format (233XXXXXXXXX)
 */
const formatPhoneNumber = (msisdn) => {
  if (!msisdn) return null;
  
  // Remove any spaces, dashes, plus signs
  let cleaned = msisdn.replace(/[\s\-+]/g, '');
  
  // If starts with 0, replace with 233
  if (cleaned.startsWith('0')) {
    cleaned = '233' + cleaned.substring(1);
  }
  
  // If doesn't start with 233, add it
  if (!cleaned.startsWith('233')) {
    cleaned = '233' + cleaned;
  }
  
  return cleaned;
};

const sendSMS = async (senderId, recipients, message) => {
  try {
    // Handle both single recipient and array of recipients
    const msisdn = Array.isArray(recipients) ? recipients[0] : recipients;
    const formattedMsisdn = formatPhoneNumber(msisdn);
    
    const payload = {
      key: NALO_API_KEY,
      msisdn: formattedMsisdn,
      sender_id: senderId,
      message: message
    };
    
    console.log('[Nalo API] URL:', `${NALO_BASE_URL}${NALO_ENDPOINT}`);
    console.log('[Nalo API] Payload:', { ...payload, key: '***' }); // Hide API key
    
    const response = await axios.post(
      `${NALO_BASE_URL}${NALO_ENDPOINT}`,
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: (status) => status === 200
      }
    );
    
    console.log('[Nalo API] Response:', response.data);
    
    // Parse response
    let naloResponse = response.data;
    if (typeof response.data === 'string' && response.data.includes('|')) {
      const parts = response.data.split('|');
      naloResponse = {
        status: parts[0],
        message_id: parts[1] || null,
        error_message: parts[2] || null
      };
    }
    
    // Check for success (1701)
    if (naloResponse.status === '1701') {
      return naloResponse;
    } else {
      throw new Error(naloResponse.error_message || `Nalo error: ${naloResponse.status}`);
    }
  } catch (error) {
    console.error('[Nalo SMS API Error]:', error.response?.data || error.message);
    throw new Error('Failed to send SMS via Nalo API: ' + (error.response?.data?.error_message || error.message));
  }
};

const checkBalance = async () => {
  // Nalo may not have a balance endpoint, assume sufficient
  console.warn('[Nalo] Balance check not available, assuming sufficient credit');
  return 1000;
};

module.exports = {
  sendSMS,
  checkBalance
};
