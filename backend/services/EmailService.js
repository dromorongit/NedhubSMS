/**
 * Email Service - Resend API based email service
 * 
 * This module has been migrated from SMTP to Resend API for compatibility
 * with Railway Hobby plan which blocks outbound SMTP connections.
 * 
 * All configuration is read from environment variables:
 * - RESEND_API_KEY: Resend API key (required)
 * - EMAIL_FROM: From email address (default: support@nedhubgh.com)
 * - EMAIL_FROM_NAME: From display name (default: Nedhub)
 * - FRONTEND_URL: Frontend URL for email links
 */

const crypto = require('crypto');

// Import the new modular email service
const emailService = require('./email/emailService');

/**
 * EmailService - Wrapper for backwards compatibility
 * Re-exports all methods from the new email service
 */
class EmailService {
  constructor() {
    // Get configuration from environment
    this.baseUrl = process.env.FRONTEND_URL || 'https://app.nedhubgh.com';
    this.provider = emailService.provider;
    
    console.log('[EMAIL] Email service initialized with Resend API');
    console.log('[EMAIL] Provider: Resend (HTTPS API)');
  }

  /**
   * Send email verification OTP
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {Promise<boolean>}
   */
  async sendVerificationOTP(email, fullName, otp) {
    const result = await emailService.sendVerificationOTP(email, fullName, otp);
    return result.success;
  }

  /**
   * Send password reset OTP
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {Promise<boolean>}
   */
  async sendPasswordResetOTP(email, fullName, otp) {
    const result = await emailService.sendPasswordResetOTP(email, fullName, otp);
    return result.success;
  }

  /**
   * Send email verification with link (token-based)
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} token - Verification token
   * @returns {Promise<boolean>}
   */
  async sendVerificationLink(email, fullName, token) {
    const result = await emailService.sendVerificationLink(email, fullName, token);
    return result.success;
  }

  /**
   * Send password reset link
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} token - Reset token
   * @returns {Promise<boolean>}
   */
  async sendPasswordResetLink(email, fullName, token) {
    const result = await emailService.sendPasswordResetLink(email, fullName, token);
    return result.success;
  }

  // Template methods - for backwards compatibility
  getVerificationEmailTemplate(fullName, otp) {
    return emailService.getVerificationEmailTemplate(fullName, otp);
  }

  getPasswordResetEmailTemplate(fullName, otp) {
    return emailService.getPasswordResetEmailTemplate(fullName, otp);
  }

  getVerificationLinkTemplate(fullName, verifyUrl) {
    return emailService.getVerificationLinkTemplate(fullName, verifyUrl);
  }

  getVerificationLinkTextTemplate(fullName, verifyUrl) {
    return emailService.getVerificationLinkTextTemplate(fullName, verifyUrl);
  }

  getPasswordResetLinkTemplate(fullName, resetUrl) {
    return emailService.getPasswordResetLinkTemplate(fullName, resetUrl);
  }

  getPasswordResetLinkTextTemplate(fullName, resetUrl) {
    return emailService.getPasswordResetLinkTextTemplate(fullName, resetUrl);
  }
}

// Export singleton instance
module.exports = new EmailService();
