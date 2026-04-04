/**
 * SendGrid Email Provider
 * Uses SendGrid API for email sending (compatible with Node.js 18)
 */
const sgMail = require('@sendgrid/mail');

class SendGridProvider {
  constructor() {
    // Initialize SendGrid with API key from environment
    const apiKey = process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY;
    
    if (!apiKey) {
      throw new Error('[SendGrid] SENDGRID_API_KEY is required in environment variables');
    }
    
    sgMail.setApiKey(apiKey);
    this.fromEmail = process.env.EMAIL_FROM || 'support@nedhubgh.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Nedhub';
    
    console.log('[EMAIL] SendGrid provider initialized');
    console.log(`[EMAIL]   From: ${this.fromName} <${this.fromEmail}>`);
  }

  /**
   * Send email using SendGrid API
   * @param {string} to - Recipient email
   * @param {string} subject - Email subject
   * @param {string} html - HTML content
   * @param {string} text - Plain text fallback
   * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
   */
  async sendEmail(to, subject, html, text) {
    try {
      const msg = {
        to: to,
        from: `${this.fromName} <${this.fromEmail}>`,
        subject: subject,
        html: html,
        text: text
      };

      await sgMail.send(msg);
      
      console.log(`[EMAIL] ✓ Email sent successfully to ${to}`);
      return { success: true };
    } catch (error) {
      console.error('[SendGrid] Send error:', error.message);
      if (error.response) {
        console.error('[SendGrid] Response:', error.response.body);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify API key is working
   * @returns {Promise<boolean>}
   */
  async verifyConnection() {
    try {
      const msg = {
        to: 'test@example.com',
        from: `${this.fromName} <${this.fromEmail}>`,
        subject: 'Test email',
        html: '<p>Test</p>',
        text: 'Test'
      };

      await sgMail.send(msg);
      console.log('[EMAIL] ✓ SendGrid API connection verified');
      return true;
    } catch (error) {
      console.error('[EMAIL] SendGrid verification error:', error.message);
      return false;
    }
  }
}

module.exports = new SendGridProvider();