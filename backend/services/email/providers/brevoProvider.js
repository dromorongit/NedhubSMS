/**
 * Brevo Email Provider
 * Uses Brevo Transactional Email API (https://api.brevo.com/v3/smtp/email)
 * Compatible with Railway Hobby plan (HTTPS API, no SMTP)
 */
const axios = require('axios');

class BrevoProvider {
  constructor() {
    // Get configuration from environment
    this.apiKey = process.env.BREVO_API_KEY;
    this.fromEmail = process.env.EMAIL_FROM || 'support@nedhubgh.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Nedhub Support';
    this.baseUrl = 'https://api.brevo.com/v3/smtp/email';

    if (!this.apiKey) {
      throw new Error('[BREVO] BREVO_API_KEY is required in environment variables');
    }

    console.log('[EMAIL] Provider: Brevo');
    console.log(`[EMAIL]   From: ${this.fromName} <${this.fromEmail}>`);
  }

  /**
   * Send email using Brevo API
   * @param {string} to - Recipient email
   * @param {string} subject - Email subject
   * @param {string} html - HTML content
   * @param {string} text - Plain text fallback
   * @param {Object} options - Additional options (tags, templateId, etc.)
   * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
   */
  async sendEmail(to, subject, html, text, options = {}) {
    try {
      // Build Brevo-compatible request body
      const requestBody = {
        sender: {
          name: this.fromName,
          email: this.fromEmail
        },
        to: [
          {
            email: to
          }
        ],
        subject: subject,
        htmlContent: html,
        textContent: text
      };

      // Add name to recipient only if provided
      if (options.toName) {
        requestBody.to[0].name = options.toName;
      }

      // Add optional parameters if provided
      if (options.tags && Array.isArray(options.tags) && options.tags.length > 0) {
        requestBody.tags = options.tags;
      }

      if (options.templateId) {
        requestBody.templateId = options.templateId;
      }

      if (options.replyTo) {
        requestBody.replyTo = options.replyTo;
      }

      // Make the API request to Brevo
      const response = await axios.post(this.baseUrl, requestBody, {
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      // Extract messageId from response if available
      const messageId = response.data.messageId || response.data.messageIds?.[0] || null;

      console.log(`[EMAIL][BREVO] ✓ Email sent successfully to ${to}`);

      if (messageId) {
        console.log(`[EMAIL][BREVO]   MessageId: ${messageId}`);
      }

      return { success: true, messageId };
    } catch (error) {
      // Parse and log error safely
      let errorMessage = 'Failed to send email';
      
      if (error.response) {
        // Brevo API returned an error
        const status = error.response.status;
        const responseData = error.response.data;
        
        if (responseData && responseData.message) {
          errorMessage = responseData.message;
        }
        
        console.error(`[EMAIL][BREVO] Error (${status}):`, errorMessage);
        
        // Log error code if available
        if (responseData && responseData.code) {
          console.error(`[EMAIL][BREVO] Error code:`, responseData.code);
        }
      } else if (error.request) {
        // No response received
        errorMessage = 'No response from Brevo API';
        console.error(`[EMAIL][BREVO] Network error:`, errorMessage);
      } else {
        // Error in request setup
        console.error(`[EMAIL][BREVO] Request error:`, error.message);
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Verify API key is working
   * @returns {Promise<boolean>}
   */
  async verifyConnection() {
    try {
      // Send a test email to verify the connection
      const result = await this.sendEmail(
        'test@example.com',
        'Test Email - Nedhub',
        '<p>This is a test email from Nedhub.</p>',
        'This is a test email from Nedhub.'
      );

      if (result.success) {
        console.log('[EMAIL][BREVO] ✓ API connection verified');
        return true;
      } else {
        console.error('[EMAIL][BREVO] ✗ API connection verification failed:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[EMAIL][BREVO] ✗ Connection verification error:', error.message);
      return false;
    }
  }

  /**
   * Send batch emails (for future use)
   * @param {Array} emails - Array of email objects
   * @returns {Promise<{success: boolean, error?: string, messageIds?: Array}>}
   */
  async sendBatch(emails) {
    try {
      const requestBody = {
        sender: {
          name: this.fromName,
          email: this.fromEmail
        },
        to: emails.map(e => ({
          email: e.to,
          name: e.toName || ''
        })),
        subject: emails[0].subject,
        htmlContent: emails[0].html,
        textContent: emails[0].text
      };

      const response = await axios.post(this.baseUrl, requestBody, {
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      return { 
        success: true, 
        messageIds: response.data.messageIds || [] 
      };
    } catch (error) {
      console.error('[EMAIL][BREVO] Batch send error:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// Export class
module.exports = BrevoProvider;