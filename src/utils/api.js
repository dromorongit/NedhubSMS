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
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined
      });

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

  async resetPassword(token, newPassword) {
    return this.request('POST', '/auth/reset-password', { token, newPassword });
  }

  async getUserProfile() {
    return this.request('GET', '/auth/me');
  }

  // Contact endpoints
  async createContact(name, phoneNumber, groupName) {
    return this.request('POST', '/contacts', { name, phoneNumber, groupName });
  }

  async getContacts() {
    return this.request('GET', '/contacts');
  }

  async updateContact(id, name, phoneNumber, groupName) {
    return this.request('PUT', `/contacts/${id}`, { name, phoneNumber, groupName });
  }

  async deleteContact(id) {
    return this.request('DELETE', `/contacts/${id}`);
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
        body: formData
      });

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

  // Wallet endpoints
  async getWalletBalance() {
    return this.request('GET', '/wallet');
  }

  async getTransactionHistory() {
    return this.request('GET', '/wallet/transactions');
  }

  // Payment endpoints
  async initiatePayment(amount, description) {
    return this.request('POST', '/payments/initiate', { amount, description });
  }

  async getPaymentHistory() {
    return this.request('GET', '/payments/history');
  }

  async checkPaymentStatus(clientReference) {
    return this.request('GET', `/payments/status/${clientReference}`);
  }
}

// Singleton instance
const apiClient = new ApiClient();

// Make available globally for frontend use
window.apiClient = apiClient;
