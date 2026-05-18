// API client for frontend
const API_BASE_URL = 'http://localhost:3000/api';
import { getStorage } from './authStorage';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status?: number;
  isParseError?: boolean;
  rawResponse?: string;
  contentType?: string;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    getStorage().setItem('authToken', token);
  }

  getToken() {
    return this.token || getStorage().getItem('authToken');
  }

  clearToken() {
    this.token = null;
    getStorage().removeItem('authToken');
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
      const contentType = response.headers.get('content-type') || 'unknown';
      console.log(`[API] Response Content-Type:`, contentType);

      // Handle 401 Unauthorized - redirect to login
      if (response.status === 401) {
        console.log('[API] 401 Unauthorized - redirecting to login');
        this.clearToken();
        if (window.location.pathname.includes('/pages/dashboard/')) {
          window.location.href = '../auth/login.html?session=expired';
        } else {
          window.location.href = '../auth/login.html';
        }
        return { error: 'Session expired. Please login again.' };
      }

      // Read response as text first for safe parsing
      const responseText = await response.text();
      const previewLength = Math.min(300, responseText.length);
      console.log(`[API] Raw response preview (${responseText.length} chars):`, responseText.substring(0, previewLength));

      let result: any;
      let parseError = null;

      // If response is empty, treat as success with empty data
      if (!responseText || !responseText.trim()) {
        console.log('[API] Empty response body');
        if (response.ok) {
          return { data: { message: 'Request successful' } as any };
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
          console.error('[API] JSON parse error:', e instanceof Error ? e.message : String(e));
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