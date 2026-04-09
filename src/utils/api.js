// API client for frontend
// Use production URL when not on localhost
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocalhost ? 'http://localhost:3000/api' : 'https://nedhubsms-production.up.railway.app/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('authToken') || null;
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  getToken() {
    return this.token || localStorage.getItem('authToken');
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('authToken');
  }

  async request(method, endpoint, data = null) {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = this.getToken();

    const headers = {
      'Content-Type': 'application/json'
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      console.log(`[API] ${method} ${url}`);
      
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        credentials: 'include' // Required for CORS with credentials
      });

      // Handle 401 Unauthorized - redirect to login
      if (response.status === 401) {
        console.log('[API] 401 Unauthorized - redirecting to login');
        this.clearToken();
        // Check if we're on a dashboard page
        if (window.location.pathname.includes('/pages/dashboard/')) {
          window.location.href = '../auth/login.html?session=expired';
        } else {
          window.location.href = '../auth/login.html';
        }
        return { error: 'Session expired. Please login again.' };
      }

      console.log(`[API] Response status: ${response.status}`);
      
      const result = await response.json();
      console.log(`[API] Response data:`, result);

      if (!response.ok) {
        return { error: result.error || 'Request failed', status: response.status };
      }

      return { data: result };
    } catch (error) {
      console.error('[API] Request error:', error);
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
  async sendSMS(senderId, recipients, message) {
    return this.request('POST', '/sms/send', { senderId, recipients, message });
  }

  async getMessageHistory() {
    return this.request('GET', '/sms/logs');
  }

  async getSmsCost(params) {
    const queryString = new URLSearchParams(params).toString();
    return this.request('GET', `/sms/calculate-cost?${queryString}`);
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

  async previewCampaign(campaignData) {
    return this.request('POST', '/sms-campaigns/preview-campaign', campaignData);
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
