/**
 * Email Service - Modular email service
 * 
 * This module has been migrated from SMTP to Brevo API for compatibility
 * with Railway Hobby plan which blocks outbound SMTP connections.
 * 
 * All configuration is read from environment variables:
 * - EMAIL_PROVIDER: 'resend' or 'brevo' (default: 'resend')
 * - BREVO_API_KEY: Brevo API key (required when using Brevo)
 * - RESEND_API_KEY: Resend API key (required when using Resend)
 * - EMAIL_FROM: From email address (default: support@nedhubgh.com)
 * - EMAIL_FROM_NAME: From display name (default: Nedhub Support)
 * - FRONTEND_URL: Frontend URL for email links
 */

const crypto = require('crypto');

// Import the new modular email service
const EmailServiceClass = require('./email/emailService');

/**
 * EmailService - Wrapper for backwards compatibility
 * Re-exports all methods from the new email service
 */
class EmailService {
  constructor() {
    // Get configuration from environment
    this.baseUrl = process.env.FRONTEND_URL || 'https://app.nedhubgh.com';

    // Instantiate the new email service
    this.emailServiceInstance = new EmailServiceClass();
    this.provider = this.emailServiceInstance.provider;

    const providerType = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
    console.log(`[EMAIL] Email service initialized with ${providerType === 'brevo' ? 'Brevo' : 'Resend'} API`);
  }

  /**
   * Send email verification OTP
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {Promise<boolean>}
   */
  async sendVerificationOTP(email, fullName, otp) {
    const result = await this.emailServiceInstance.sendVerificationOTP(email, fullName, otp);
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
    const result = await this.emailServiceInstance.sendPasswordResetOTP(email, fullName, otp);
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
    const result = await this.emailServiceInstance.sendVerificationLink(email, fullName, token);
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
    const result = await this.emailServiceInstance.sendPasswordResetLink(email, fullName, token);
    return result.success;
  }

  // Template methods - for backwards compatibility
  getVerificationEmailTemplate(fullName, otp) {
    return this.emailServiceInstance.getVerificationEmailTemplate(fullName, otp);
  }

  getPasswordResetEmailTemplate(fullName, otp) {
    return this.emailServiceInstance.getPasswordResetEmailTemplate(fullName, otp);
  }

  getVerificationLinkTemplate(fullName, verifyUrl) {
    return this.emailServiceInstance.getVerificationLinkTemplate(fullName, verifyUrl);
  }

  getVerificationLinkTextTemplate(fullName, verifyUrl) {
    return this.emailServiceInstance.getVerificationLinkTextTemplate(fullName, verifyUrl);
  }

  getPasswordResetLinkTemplate(fullName, resetUrl) {
    return this.emailServiceInstance.getPasswordResetLinkTemplate(fullName, resetUrl);
  }

  getPasswordResetLinkTextTemplate(fullName, resetUrl) {
    return this.emailServiceInstance.getPasswordResetLinkTextTemplate(fullName, resetUrl);
  }

  /**
   * Send admin notification when a user successfully verifies their email
   * @param {Object} user - User object with name, email, _id, emailVerifiedAt
   * @returns {Promise<boolean>}
   */
  async sendAdminUserVerifiedNotification(user) {
    return await this.emailServiceInstance.sendAdminUserVerifiedNotification(user);
  }

  /**
   * Send admin notification when a new Sender ID approval request is submitted
   * @param {Object} requestData - Sender ID request data
   * @returns {Promise<boolean>}
   */
  async sendAdminSenderIdRequestNotification(requestData) {
    return await this.emailServiceInstance.sendAdminSenderIdRequestNotification(requestData);
  }
}

// Export class
module.exports = EmailService;
