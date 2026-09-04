const axios = require('axios');

const NALO_API_KEY = process.env.NALO_API_KEY;
const NALO_BASE_URL = 'https://sms.nalosolutions.com';
const NALO_ENDPOINT = '/smsbackend/Resl_Nalo/send-message/';

/**
 * Convert phone number to Ghana format (233XXXXXXXXX)
 */
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return null;

  // Remove any spaces, dashes, plus signs
  let cleaned = phoneNumber.replace(/[\s\-+]/g, '');
  
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
    // Handle both single recipient (string) and array of recipients
    let phoneNumber;
    if (Array.isArray(recipients)) {
      // If array, use the first recipient (for backward compatibility)
      // The caller should loop through recipients for bulk sends
      phoneNumber = recipients[0];
    } else {
      phoneNumber = recipients;
    }
    
    const formattedPhoneNumber = formatPhoneNumber(phoneNumber);
    
    const payload = {
      key: NALO_API_KEY,
      msisdn: formattedPhoneNumber,
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

    // Handle bare success code (number or string without pipe/JSON wrapper)
    if (naloResponse === 1701 || naloResponse === '1701') {
      naloResponse = { status: '1701', message_id: null, error_message: null };
    } else if (typeof response.data === 'string' && response.data.includes('|')) {
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
  try {
    const response = await axios.get(
      `${NALO_BASE_URL}/smsbackend/Resl_Nalo/balance/`,
      {
        headers: { 'Content-Type': 'application/json' },
        params: { key: NALO_API_KEY },
        timeout: 10000
      }
    );
    const raw = response.data;
    const balance = typeof raw?.balance === 'number' ? raw.balance :
                    typeof raw?.credits === 'number' ? raw.credits :
                    0;
    console.log('[Nalo] Balance check', { raw, balance });
    return { ok: true, balance, error: null };
  } catch (error) {
    const reason = error.code === 'ECONNABORTED' ? 'timeout' :
                   error.response ? `provider_error_${error.response.status}` :
                   'network';
    console.warn('[Nalo] Balance check failed:', { reason, message: error.message });
    return { ok: false, balance: null, error: reason };
  }
};

module.exports = {
  sendSMS,
  checkBalance
};
