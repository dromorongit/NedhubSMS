// API client for frontend
const API_BASE_URL = 'http://localhost:3000/api';

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
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

  private async request<T>(method: string, endpoint: string, data?: any): Promise<ApiResponse<T>> {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = this.getToken();

    const headers: Record<string, string> = {
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
  async register(name: string, email: string, password: string) {
    return this.request<{ token: string; userId: string }>('POST', '/auth/register', { name, email, password });
  }

  async login(email: string, password: string) {
    return this.request<{ token: string; userId: string; role: string }>('POST', '/auth/login', { email, password });
  }

  // Contact endpoints
  async createContact(name: string, phoneNumber: string, groupName?: string) {
    return this.request<{ contactId: string; message: string }>('POST', '/contacts', { name, phoneNumber, groupName });
  }

  async getContacts() {
    return this.request<any[]>('GET', '/contacts');
  }

  async updateContact(id: string, name: string, phoneNumber: string, groupName?: string) {
    return this.request<{ message: string }>('PUT', `/contacts/${id}`, { name, phoneNumber, groupName });
  }

  async deleteContact(id: string) {
    return this.request<{ message: string }>('DELETE', `/contacts/${id}`);
  }

  // SMS endpoints
  async sendSMS(senderId: string, recipients: string[], message: string) {
    return this.request<{ messageId: string; message: string }>('POST', '/sms/send', { senderId, recipients, message });
  }

  async getMessageHistory() {
    return this.request<any[]>('GET', '/sms/logs');
  }
}

export const apiClient = new ApiClient();