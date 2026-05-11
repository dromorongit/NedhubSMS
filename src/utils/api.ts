// API client for frontend
const API_BASE_URL = 'http://localhost:3000/api';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status?: number;
  isParseError?: boolean;
  rawResponse?: string;
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
      console.log(`[API] ${method} ${url}`);
      
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        credentials: 'include'
      });

      console.log(`[API] Response status: ${response.status}`);
      console.log(`[API] Response headers:`, {
        'content-type': response.headers.get('content-type')
      });

      // Read response as text first for safe parsing
      const responseText = await response.text();
      console.log(`[API] Raw response preview:`, responseText.substring(0, 200));

      let result: any;
      let parseError = null;

      if (responseText.trim()) {
        try {
          result = JSON.parse(responseText);
        } catch (e) {
          parseError = e;
          console.error('[API] JSON parse error:', e instanceof Error ? e.message : String(e));
          console.error('[API] Raw response that failed parsing:', responseText);
          
          // Return a structured error instead of crashing
          return {
            error: 'Invalid server response format',
            status: response.status,
            rawResponse: responseText.substring(0, 500),
            isParseError: true
          };
        }
      } else {
        // Empty response
        result = { message: 'Request successful with empty response' };
      }

      if (!response.ok) {
        // Extract error message from parsed JSON or use default
        const errorMessage = result?.error || result?.message || 'Request failed';
        return { error: errorMessage, status: response.status, data: result };
      }

      return { data: result };
    } catch (error) {
      console.error('[API] Request error:', error instanceof Error ? error.message : String(error));
      return { error: 'Network error: ' + (error instanceof Error ? error.message : String(error)) };
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