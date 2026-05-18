// API client for frontend
// Use production URL when not on localhost
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocalhost ? 'http://localhost:3000/api' : 'https://nedhubsms-production.up.railway.app/api';

// Get storage function from authStorage
const getStorageFunc = window.getStorage || (() => localStorage);

class ApiClient {
  constructor() {
    const storage = getStorageFunc();
    this.token = storage.getItem('authToken') || null;
    console.log('[TokenStorage] [API Client] Initialized. Token present:', !!this.token, 'Storage type:', storage === sessionStorage ? 'sessionStorage' : 'localStorage');
  }

  setToken(token) {
    this.token = token;
    const storage = getStorageFunc();
    storage.setItem('authToken', token);
    console.log('[TokenStorage] [API Client] Token saved. Storage type:', storage === sessionStorage ? 'sessionStorage' : 'localStorage', 'Token length:', token.length);
  }

  getToken() {
    const storage = getStorageFunc();
    const token = this.token || storage.getItem('authToken');
    console.log('[TokenStorage] [API Client] Token retrieved. Present:', !!token, 'Storage type:', storage === sessionStorage ? 'sessionStorage' : 'localStorage');
    return token;
  }

  clearToken() {
    const storage = getStorageFunc();
    console.log('[TokenStorage] [API Client] Clearing token from memory and', storage === sessionStorage ? 'sessionStorage' : 'localStorage');
    this.token = null;
    storage.removeItem('authToken');
  }

  async request(method, endpoint, data = null, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = this.getToken();

    const headers = {
      'Content-Type': 'application/json'
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      console.log('[PersistentAuth] [API] Authorization header set with token');
    } else {
      console.log('[PersistentAuth] [API] No token available for request');
    }

    try {
      console.log(`[API] ${method} ${url}`);
      console.log('[API] Request headers:', { ...headers, Authorization: token ? 'Bearer <token_set>' : 'none' });
      
      const fetchOptions = {
        method,
        headers,
        credentials: 'include',
        ...options
      };
      if (data !== null && data !== undefined) {
        fetchOptions.body = JSON.stringify(data);
      }
      const response = await fetch(url, fetchOptions);

      console.log(`[API] Response status: ${response.status}`);
      const contentType = response.headers.get('content-type') || 'unknown';
      console.log(`[API] Response Content-Type:`, contentType);

      // Handle 401 Unauthorized - redirect to login
      if (response.status === 401) {
        console.log('[PersistentAuth] [API] 401 Unauthorized - redirecting to login');
        console.log('[PersistentAuth] [API] Token before clear:', token ? 'present' : 'absent');
        this.clearToken();
        // Check if we're on a dashboard page
        if (window.location.pathname.includes('/pages/dashboard/')) {
          console.log('[Redirect] [API] Redirecting to login with session=expired');
          window.location.href = '../auth/login.html?session=expired';
        } else {
          console.log('[Redirect] [API] Redirecting to login');
          window.location.href = '../auth/login.html';
        }
        return { error: 'Session expired. Please login again.' };
      }

      // Read response as text first for safe parsing
      const responseText = await response.text();
      const previewLength = Math.min(300, responseText.length);
      console.log(`[API] Raw response preview (${responseText.length} chars):`, responseText.substring(0, previewLength));

      let result;
      let parseError = null;

      // If response is empty, treat as success with empty data
      if (!responseText || !responseText.trim()) {
        console.log('[API] Empty response body');
        if (response.ok) {
          return { data: { message: 'Request successful' } };
        } else {
          return { 
            error: 'Request failed with empty response', 
            status: response.status 
          };
        }
      }

      // Check if response is JSON based on Content-Type or content pattern
      const isJsonContent = contentType.includes('application/json') || 
                           responseText.trim().startsWith('{') || 
                           responseText.trim().startsWith('[');

      if (isJsonContent) {
        try {
          result = JSON.parse(responseText);
          console.log('[API] JSON parsed successfully');
        } catch (e) {
          parseError = e;
          console.error('[API] JSON parse error:', e.message);
          console.error('[API] Raw response that failed parsing:', responseText.substring(0, 500));
          
          // Return a structured error instead of crashing
          return {
            error: 'Invalid server response format',
            status: response.status,
            rawResponse: responseText.substring(0, 500),
            isParseError: true,
            contentType
          };
        }
      } else {
        // Non-JSON response (HTML, plain text, etc.)
        console.warn('[API] Non-JSON response received:', { contentType, preview: responseText.substring(0, 200) });
        
        // For non-JSON responses, try to extract meaningful error message
        let errorMsg = 'Server returned non-JSON response';
        if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
          errorMsg = 'Server returned an HTML error page. This may indicate a server configuration issue.';
        } else if (responseText.length < 200) {
          errorMsg = `Server response: ${responseText.substring(0, 200)}`;
        }
        
        return {
          error: errorMsg,
          status: response.status,
          rawResponse: responseText.substring(0, 500),
          isParseError: true,
          contentType
        };
      }

      if (!response.ok) {
        // Extract error message from parsed JSON or use default
        const errorMessage = result?.error || result?.message || 'Request failed';
        return { 
          error: errorMessage, 
          status: response.status, 
          data: result,
          contentType: 'application/json'
        };
      }

      // Unwrap the response: if the JSON has a 'data' property, use that as the payload; otherwise use the whole response
      const dataPayload = result.data !== undefined ? result.data : result;
      return { 
        data: dataPayload,
        contentType: 'application/json'
      };
    } catch (error) {
      console.error('[API] Request error:', error);
      // Handle abort signals gracefully
      if (error.name === 'AbortError') {
        return { error: error.message, isAbort: true };
      }
      return { error: 'Network error: ' + error.message };
    }
  }

  // Auth endpoints
  async register(name, email, password) {
    return this.request('POST', '/auth/register', { name, email, password });
  }

  async login(email, password) {
    return this.request('POST', '/auth/login', { email, password });
  }

  async forgotPassword(email) {
    return this.request('POST', '/auth/forgot-password', { email });
  }

  async requestPasswordReset(email) {
    return this.request('POST', '/auth/request-password-reset', { email });
  }

  async resetPassword(email, otp, newPassword) {
    return this.request('POST', '/auth/reset-password', { email, otp, newPassword });
  }

  async verifyEmail(email, otp) {
    return this.request('POST', '/auth/verify-email', { email, otp });
  }

  async resendOTP(email, purpose) {
    return this.request('POST', '/auth/resend-otp', { email, purpose });
  }

  async getUserProfile() {
    return this.request('GET', '/auth/me');
  }

  // Contact endpoints
  async createContact(recipientName, phoneNumber, groupName) {
    return this.request('POST', '/contacts', { recipientName, phoneNumber, groupName });
  }

  async getContacts() {
    return this.request('GET', '/contacts');
  }

  async updateContact(id, recipientName, phoneNumber, groupName) {
    return this.request('PUT', `/contacts/${id}`, { recipientName, phoneNumber, groupName });
  }

  async deleteContact(id) {
    return this.request('DELETE', `/contacts/${id}`);
  }

  async uploadContacts(formData) {
    const url = `${API_BASE_URL}/contacts/import`;
    const token = this.getToken();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData,
        credentials: 'include'
      });

      if (response.status === 401) {
        this.clearToken();
        if (window.location.pathname.includes('/pages/dashboard/')) {
          window.location.href = '../auth/login.html?session=expired';
        } else {
          window.location.href = '../auth/login.html';
        }
        return { error: 'Session expired. Please login again.' };
      }

      const result = await response.json();

      if (!response.ok) {
        return { error: result.error || 'Upload failed' };
      }

      return { data: result };
    } catch (error) {
      console.error('Upload contacts error:', error);
      return { error: 'Network error: ' + error.message };
    }
  }

  async confirmContactImport(fileData, columnMapping, fileName) {
    return this.request('POST', '/contacts/import/confirm', { fileData, columnMapping, fileName });
  }

  async regenerateContactPreview(fileData, columnMapping) {
    return this.request('POST', '/contacts/preview', { fileData, columnMapping });
  }

  // Template endpoints
  async getTemplates() {
    return this.request('GET', '/templates');
  }

  async getTemplate(id) {
    return this.request('GET', `/templates/${id}`);
  }

  async createTemplate(data) {
    return this.request('POST', '/templates', data);
  }

  async updateTemplate(id, data) {
    return this.request('PUT', `/templates/${id}`, data);
  }

  async deleteTemplate(id) {
    return this.request('DELETE', `/templates/${id}`);
  }

  // Campaign endpoints
  async getCampaigns() {
    return this.request('GET', '/campaigns');
  }

  async createCampaign(data) {
    return this.request('POST', '/campaigns', data);
  }

  async getCampaign(id) {
    return this.request('GET', `/campaigns/${id}`);
  }

  async updateCampaign(id, data) {
    return this.request('PUT', `/campaigns/${id}`, data);
  }

  async deleteCampaign(id) {
    return this.request('DELETE', `/campaigns/${id}`);
  }

  // Sender ID endpoints
  async getSenderIds() {
    return this.request('GET', '/sender-ids');
  }

  async createSenderId(senderId, documentType, documentFile) {
    const url = `${API_BASE_URL}/sender-ids`;
    const token = this.getToken();

    const formData = new FormData();
    formData.append('senderId', senderId);
    formData.append('documentType', documentType);
    formData.append('document', documentFile);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData,
        credentials: 'include' // Required for CORS with credentials
      });

      // Handle 401 Unauthorized - redirect to login
      if (response.status === 401) {
        this.clearToken();
        if (window.location.pathname.includes('/pages/dashboard/')) {
          window.location.href = '../auth/login.html?session=expired';
        } else {
          window.location.href = '../auth/login.html';
        }
        return { error: 'Session expired. Please login again.' };
      }

      const result = await response.json();

      if (!response.ok) {
        return { error: result.error || 'Request failed' };
      }

      return { data: result };
    } catch (error) {
      console.error('API request error:', error);
      return { error: 'Network error' };
    }
  }

  // SMS endpoints
  async sendSMS(data) {
    const { senderId, recipients, message } = data;
    return this.request('POST', '/sms/send', { senderId, recipients, message });
  }

  async scheduleSMS(data) {
    const { senderId, recipients, message, scheduledAt, timezone } = data;
    return this.request('POST', '/sms/schedule', {
      senderId,
      recipients,
      message,
      scheduledAt,
      timezone: timezone || 'UTC'
    });
  }

  async getMessageHistory() {
    return this.request('GET', '/sms/logs');
  }

  async getSmsCost(params, options = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request('GET', `/sms/calculate-cost?${queryString}`, null, options);
  }

  async resendSms(messageId) {
    return this.request('POST', '/sms/resend', { messageId });
  }

  // SMS Campaign endpoints
  async generateMessagePreview(messageBody, salutation, customSalutation, sampleRecipients) {
    return this.request('POST', '/sms-campaigns/preview-personalized', {
      messageBody,
      salutation,
      customSalutation,
      sampleRecipients
    });
  }

  async previewCampaign(campaignData, options = {}) {
    return this.request('POST', '/sms-campaigns/preview-campaign', campaignData, options);
  }

  async sendPersonalizedCampaign(campaignData) {
    return this.request('POST', '/sms-campaigns/send', campaignData);
  }

  async schedulePersonalizedCampaign(campaignData) {
    return this.request('POST', '/sms-campaigns/schedule', campaignData);
  }

  async getScheduledCampaigns() {
    return this.request('GET', '/sms-campaigns/scheduled');
  }

  async updateScheduledCampaign(id, updates) {
    return this.request('PATCH', `/sms-campaigns/scheduled/${id}`, updates);
  }

  async cancelScheduledCampaign(id) {
    return this.request('DELETE', `/sms-campaigns/scheduled/${id}`);
  }

  async retryFailedRecipients(campaignId) {
    return this.request('POST', `/sms-campaigns/${campaignId}/retry-failed`);
  }

  async duplicateCampaignWithFailed(campaignId) {
    return this.request('POST', `/sms-campaigns/${campaignId}/duplicate`);
  }

  // Reports endpoints
  async getCampaignReports(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/reports/sms-campaigns?${queryString}` : '/reports/sms-campaigns';
    return this.request('GET', endpoint);
  }

  // Wallet endpoints
  async getWalletBalance() {
    return this.request('GET', '/wallet');
  }

  async getTransactionHistory() {
    return this.request('GET', '/wallet/transactions');
  }

  // Transfer endpoints - Airtime
  async buyAirtime(phoneNumber, network, amount) {
    return this.request('POST', '/transfer/airtime', { 
      phoneNumber, 
      network, 
      amount 
    });
  }

  // Transfer endpoints - Data
  async buyData(phoneNumber, network, bundleCode, price) {
    return this.request('POST', '/transfer/data', { 
      phoneNumber, 
      network, 
      bundleCode, 
      price 
    });
  }

  // Get data bundles
  async getDataBundles(network) {
    return this.request('GET', `/transfer/data-bundles/${network}`);
  }

  // Utility endpoints - TV bundles
  async getTVBundles(service) {
    return this.request('GET', `/utility/tv-bundles/${service}`);
  }

  // Utility endpoints - TV payment
  async payTVBill(serviceType, smartCardNumber, amount) {
    return this.request('POST', '/utility/tv-pay', {
      serviceType,
      smartCardNumber,
      amount
    });
  }

  // Utility endpoints - ECG payment
  async payECGBill(meterNumber, meterType, amount) {
    return this.request('POST', '/utility/ecg-pay', {
      meterNumber,
      meterType,
      amount
    });
  }

  // Utility endpoints - Ghana Water payment
  async payGhanaWaterBill(meterNumber, amount) {
    return this.request('POST', '/utility/water-pay', {
      meterNumber,
      amount
    });
  }

  // Check transaction status
  async getTransactionStatus(clientReference) {
    return this.request('GET', `/transfer/status/${clientReference}`);
  }

  // Payment endpoints
  async initiatePayment(amount, description, frontendOrigin = null) {
    return this.request('POST', '/payments/initiate', { amount, description, frontendOrigin });
  }

  async getPaymentHistory() {
    return this.request('GET', '/payments/history');
  }

  async checkPaymentStatus(clientReference) {
    return this.request('GET', `/payments/status/${clientReference}`);
  }

  // Blacklist endpoints
  async addToBlacklist(phoneNumber, reason) {
    return this.request('POST', '/blacklist', { phoneNumber, reason });
  }

  async getBlacklist(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = queryString ? `/blacklist?${queryString}` : '/blacklist';
    return this.request('GET', endpoint);
  }

  async removeFromBlacklist(id) {
    return this.request('DELETE', `/blacklist/${id}`);
  }

  async checkBlacklist(phoneNumber) {
    return this.request('GET', `/blacklist/check/${encodeURIComponent(phoneNumber)}`);
  }
}

// Singleton instance
const apiClient = new ApiClient();

// Make available globally for frontend use
window.apiClient = apiClient;
