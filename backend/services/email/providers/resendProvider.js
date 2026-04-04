const { Resend } = require('resend');

/**
 * Resend Email Provider
 * Handles all email sending via Resend API
 */
class ResendProvider {
  constructor() {
    // Initialize Resend with API key from environment
    const apiKey = process.env.RESEND_API_KEY;
    
    if (!apiKey) {
      throw new Error('[RESEND] RESEND_API_KEY is required in environment variables');
    }
    
    this.resend = new Resend(apiKey);
    this.fromEmail = process.env.EMAIL_FROM || 'support@nedhubgh.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Nedhub';
    
    console.log('[EMAIL] Resend provider initialized');
    console.log(`[EMAIL]   From: ${this.fromName} <${this.fromEmail}>`);
  }

  /**
   * Send email using Resend API
   * @param {string} to - Recipient email
   * @param {string} subject - Email subject
   * @param {string} html - HTML content
   * @param {string} text - Plain text fallback
   * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
   */
  async sendEmail(to, subject, html, text) {
    try {
      const data = await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: to,
        subject: subject,
        html: html,
        text: text
      });

      if (data.error) {
        console.error('[RESEND] API Error:', data.error);
        return { success: false, error: data.error.message };
      }

      console.log(`[EMAIL] ✓ Email sent successfully to ${to}`);
      console.log(`[EMAIL]   Message ID: ${data.data?.id}`);
      return { success: true, messageId: data.data?.id };
    } catch (error) {
      console.error('[RESEND] Send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify API key is working
   * @returns {Promise<boolean>}
   */
  async verifyConnection() {
    try {
      const { data, error } = await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: 'test@resend.dev', // Resend's test email
        subject: 'Test email',
        html: '<p>Test</p>',
        text: 'Test'
      });

      if (error) {
        console.error('[EMAIL] Resend verification failed:', error);
        return false;
      }

      console.log('[EMAIL] ✓ Resend API connection verified');
      return true;
    } catch (error) {
      console.error('[EMAIL] Resend verification error:', error.message);
      return false;
    }
  }
}

module.exports = new ResendProvider();