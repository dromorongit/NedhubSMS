const crypto = require('crypto');

// Import providers
const resendProvider = require('./providers/resendProvider');
const brevoProvider = require('./providers/brevoProvider');

// Import admin notification templates
const adminUserVerifiedTemplate = require('./templates/adminUserVerifiedTemplate');
const adminSenderIdRequestTemplate = require('./templates/adminSenderIdRequestTemplate');

/**
 * Email Service - Modular email service supporting multiple providers
 * Supported providers: Resend, Brevo (for Railway Hobby compatibility)
 * Supports multiple email types: verification, password reset, etc.
 */
class EmailService {
  constructor() {
    // Get configuration from environment
    this.baseUrl = process.env.FRONTEND_URL || 'https://app.nedhubgh.com';
    
    // Admin notification recipient
    this.adminNotificationEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'info@nedhubgh.com';
    
    // Select provider based on EMAIL_PROVIDER env var
    const providerType = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
    
    if (providerType === 'brevo') {
      this.provider = brevoProvider;
      console.log('[EMAIL] Email service initialized with Brevo provider');
    } else {
      this.provider = resendProvider;
      console.log('[EMAIL] Email service initialized with Resend provider');
    }
    
    console.log(`[EMAIL] Admin notifications will be sent to: ${this.adminNotificationEmail}`);
  }

  /**
   * Send email verification OTP
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {Promise<boolean>}
   */
  async sendVerificationOTP(email, fullName, otp) {
    return await this.provider.sendEmail(
      email,
      'Verify Your Email - Nedhub',
      this.getVerificationEmailTemplate(fullName, otp),
      this.getVerificationEmailTextTemplate(fullName, otp)
    );
  }

  /**
   * Send password reset OTP
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {Promise<boolean>}
   */
  async sendPasswordResetOTP(email, fullName, otp) {
    return await this.provider.sendEmail(
      email,
      'Reset Your Password - Nedhub',
      this.getPasswordResetEmailTemplate(fullName, otp),
      this.getPasswordResetEmailTextTemplate(fullName, otp)
    );
  }

  /**
   * Send email verification with link (token-based)
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} token - Verification token
   * @returns {Promise<boolean>}
   */
  async sendVerificationLink(email, fullName, token) {
    const verifyUrl = `${this.baseUrl}/verify-email?token=${token}`;
    return await this.provider.sendEmail(
      email,
      'Verify Your Email - Nedhub',
      this.getVerificationLinkTemplate(fullName, verifyUrl),
      this.getVerificationLinkTextTemplate(fullName, verifyUrl)
    );
  }

  /**
   * Send password reset link
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} token - Reset token
   * @returns {Promise<boolean>}
   */
  async sendPasswordResetLink(email, fullName, token) {
    const resetUrl = `${this.baseUrl}/reset-password?token=${token}`;
    return await this.provider.sendEmail(
      email,
      'Reset Your Password - Nedhub',
      this.getPasswordResetLinkTemplate(fullName, resetUrl),
      this.getPasswordResetLinkTextTemplate(fullName, resetUrl)
    );
  }

  // ==================== Email Templates ====================

  /**
   * Get HTML template for email verification (OTP)
   */
  getVerificationEmailTemplate(fullName, otp) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-card { background: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .email-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 28px; font-weight: 600; }
    .email-body { padding: 40px 30px; }
    .greeting { font-size: 18px; margin-bottom: 20px; color: #333; }
    .message { font-size: 16px; margin-bottom: 30px; color: #555; }
    .otp-container { background: #f8f9fa; border: 2px dashed #667eea; border-radius: 8px; padding: 25px; text-align: center; margin: 30px 0; }
    .otp-label { font-size: 14px; color: #666; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
    .otp-code { font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace; }
    .expiry-notice { font-size: 14px; color: #e74c3c; margin-top: 15px; font-weight: 500; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
    .footer a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="email-card">
      <div class="email-header">
        <h1>Nedhub</h1>
      </div>
      <div class="email-body">
        <p class="greeting">Hello ${fullName},</p>
        <p class="message">
          Thank you for registering with Nedhub! To complete your registration and verify your email address, 
          please use the following verification code:
        </p>
        <div class="otp-container">
          <div class="otp-label">Verification Code</div>
          <div class="otp-code">${otp}</div>
          <p class="expiry-notice">This code expires in 15 minutes</p>
        </div>
        <p class="message">
          If you didn't create an account with Nedhub, you can safely ignore this email.
        </p>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Nedhub. All rights reserved.</p>
        <p><a href="https://nedhubgh.com">Visit our website</a> | <a href="mailto:support@nedhubgh.com">Contact Support</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get plain text template for email verification (OTP)
   */
  getVerificationEmailTextTemplate(fullName, otp) {
    return `Hello ${fullName},

Thank you for registering with Nedhub! To complete your registration and verify your email address, please use the following verification code:

${otp}

This code expires in 15 minutes.

If you didn't create an account with Nedhub, you can safely ignore this email.

© ${new Date().getFullYear()} Nedhub. All rights reserved.`;
  }

  /**
   * Get HTML template for password reset (OTP)
   */
  getPasswordResetEmailTemplate(fullName, otp) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-card { background: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .email-header { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; padding: 30px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 28px; font-weight: 600; }
    .email-body { padding: 40px 30px; }
    .greeting { font-size: 18px; margin-bottom: 20px; color: #333; }
    .message { font-size: 16px; margin-bottom: 30px; color: #555; }
    .otp-container { background: #f8f9fa; border: 2px dashed #e74c3c; border-radius: 8px; padding: 25px; text-align: center; margin: 30px 0; }
    .otp-label { font-size: 14px; color: #666; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
    .otp-code { font-size: 36px; font-weight: bold; color: #e74c3c; letter-spacing: 8px; font-family: 'Courier New', monospace; }
    .expiry-notice { font-size: 14px; color: #e74c3c; margin-top: 15px; font-weight: 500; }
    .security-notice { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; font-size: 14px; color: #856404; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
    .footer a { color: #e74c3c; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="email-card">
      <div class="email-header">
        <h1>Password Reset</h1>
      </div>
      <div class="email-body">
        <p class="greeting">Hello ${fullName},</p>
        <p class="message">
          We received a request to reset your password for your Nedhub account. 
          Use the following code to reset your password:
        </p>
        <div class="otp-container">
          <div class="otp-label">Reset Code</div>
          <div class="otp-code">${otp}</div>
          <p class="expiry-notice">This code expires in 15 minutes</p>
        </div>
        <div class="security-notice">
          <strong>Security Notice:</strong> If you didn't request a password reset, 
          please ignore this email or contact support if you have concerns.
        </div>
        <p class="message">
          For security reasons, never share this code with anyone. Nedhub staff will never ask for your OTP.
        </p>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Nedhub. All rights reserved.</p>
        <p><a href="https://nedhubgh.com">Visit our website</a> | <a href="mailto:support@nedhubgh.com">Contact Support</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get plain text template for password reset (OTP)
   */
  getPasswordResetEmailTextTemplate(fullName, otp) {
    return `Hello ${fullName},

We received a request to reset your password for your Nedhub account. Use the following code to reset your password:

${otp}

This code expires in 15 minutes.

If you didn't request a password reset, please ignore this email or contact support if you have concerns.

For security reasons, never share this code with anyone.

© ${new Date().getFullYear()} Nedhub. All rights reserved.`;
  }

  /**
   * Get HTML template for email verification link
   */
  getVerificationLinkTemplate(fullName, verifyUrl) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-card { background: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .email-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 28px; font-weight: 600; }
    .email-body { padding: 40px 30px; }
    .greeting { font-size: 18px; margin-bottom: 20px; color: #333; }
    .message { font-size: 16px; margin-bottom: 30px; color: #555; }
    .btn { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; font-weight: 600; }
    .btn:hover { opacity: 0.9; }
    .expiry-notice { font-size: 14px; color: #e74c3c; margin-top: 15px; font-weight: 500; }
    .fallback-link { font-size: 14px; color: #667eea; word-break: break-all; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
    .footer a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="email-card">
      <div class="email-header">
        <h1>Nedhub</h1>
      </div>
      <div class="email-body">
        <p class="greeting">Hello ${fullName},</p>
        <p class="message">
          Thank you for registering with Nedhub! To complete your registration and verify your email address, 
          please click the button below:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" class="btn">Verify Email</a>
        </div>
        <p class="expiry-notice">This link expires in 24 hours</p>
        <p class="message">
          If the button above doesn't work, you can copy and paste this link into your browser:
          <br>
          <span class="fallback-link">${verifyUrl}</span>
        </p>
        <p class="message">
          If you didn't create an account with Nedhub, you can safely ignore this email.
        </p>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Nedhub. All rights reserved.</p>
        <p><a href="https://nedhubgh.com">Visit our website</a> | <a href="mailto:support@nedhubgh.com">Contact Support</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get plain text template for email verification link
   */
  getVerificationLinkTextTemplate(fullName, verifyUrl) {
    return `Hello ${fullName},

Thank you for registering with Nedhub! To complete your registration and verify your email address, please click the link below:

${verifyUrl}

This link expires in 24 hours.

If you didn't create an account with Nedhub, you can safely ignore this email.

© ${new Date().getFullYear()} Nedhub. All rights reserved.`;
  }

  /**
   * Get HTML template for password reset link
   */
  getPasswordResetLinkTemplate(fullName, resetUrl) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-card { background: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .email-header { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; padding: 30px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 28px; font-weight: 600; }
    .email-body { padding: 40px 30px; }
    .greeting { font-size: 18px; margin-bottom: 20px; color: #333; }
    .message { font-size: 16px; margin-bottom: 30px; color: #555; }
    .btn { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; text-decoration: none; border-radius: 5px; font-weight: 600; }
    .btn:hover { opacity: 0.9; }
    .expiry-notice { font-size: 14px; color: #e74c3c; margin-top: 15px; font-weight: 500; }
    .fallback-link { font-size: 14px; color: #e74c3c; word-break: break-all; }
    .security-notice { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; font-size: 14px; color: #856404; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
    .footer a { color: #e74c3c; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="email-card">
      <div class="email-header">
        <h1>Password Reset</h1>
      </div>
      <div class="email-body">
        <p class="greeting">Hello ${fullName},</p>
        <p class="message">
          We received a request to reset your password for your Nedhub account. 
          Click the button below to create a new password:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" class="btn">Reset Password</a>
        </div>
        <p class="expiry-notice">This link expires in 30 minutes</p>
        <p class="message">
          If the button above doesn't work, you can copy and paste this link into your browser:
          <br>
          <span class="fallback-link">${resetUrl}</span>
        </p>
        <div class="security-notice">
          <strong>Security Notice:</strong> If you didn't request a password reset, 
          please ignore this email or contact support if you have concerns.
        </div>
        <p class="message">
          For security reasons, never share this link with anyone. Nedhub staff will never ask for your password reset link.
        </p>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Nedhub. All rights reserved.</p>
        <p><a href="https://nedhubgh.com">Visit our website</a> | <a href="mailto:support@nedhubgh.com">Contact Support</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get plain text template for password reset link
   */
  getPasswordResetLinkTextTemplate(fullName, resetUrl) {
    return `Hello ${fullName},

We received a request to reset your password for your Nedhub account. Click the link below to create a new password:

${resetUrl}

This link expires in 30 minutes.

If you didn't request a password reset, please ignore this email or contact support if you have concerns.

For security reasons, never share this link with anyone.

© ${new Date().getFullYear()} Nedhub. All rights reserved.`;
  }

  // ==================== Admin Notification Methods ====================

  /**
   * Send admin notification when a user successfully verifies their email
   * @param {Object} user - User object with name, email, _id, emailVerifiedAt
   * @returns {Promise<boolean>}
   */
  async sendAdminUserVerifiedNotification(user) {
    try {
      const html = adminUserVerifiedTemplate.getAdminUserVerifiedTemplate(user);
      const text = adminUserVerifiedTemplate.getAdminUserVerifiedTextTemplate(user);
      
      const result = await this.provider.sendEmail(
        this.adminNotificationEmail,
        'New User Verified Successfully - Nedhub',
        html,
        text,
        { tags: ['admin-notification', 'user-verified'] }
      );

      if (result.success) {
        console.log(`[EMAIL][ADMIN] ✓ User verified notification sent to ${this.adminNotificationEmail}`);
      } else {
        console.error(`[EMAIL][ADMIN][ERROR] Failed to send user verified notification:`, result.error);
      }

      return result.success;
    } catch (error) {
      console.error(`[EMAIL][ADMIN][ERROR] Exception sending user verified notification:`, error.message);
      return false;
    }
  }

  /**
   * Send admin notification when a new Sender ID approval request is submitted
   * @param {Object} requestData - Sender ID request data
   * @param {string} requestData.userName - Requesting user's full name
   * @param {string} requestData.userEmail - Requesting user's email
   * @param {string} requestData.senderId - Requested Sender ID
   * @param {string} requestData.businessName - Business name (optional)
   * @param {string} requestData.documentType - Document type
   * @param {string} requestData.requestId - Request ID
   * @returns {Promise<boolean>}
   */
  async sendAdminSenderIdRequestNotification(requestData) {
    try {
      const html = adminSenderIdRequestTemplate.getAdminSenderIdRequestTemplate(requestData);
      const text = adminSenderIdRequestTemplate.getAdminSenderIdRequestTextTemplate(requestData);
      
      const result = await this.provider.sendEmail(
        this.adminNotificationEmail,
        'New Sender ID Approval Request Submitted - Nedhub',
        html,
        text,
        { tags: ['admin-notification', 'sender-id-request'] }
      );

      if (result.success) {
        console.log(`[EMAIL][ADMIN] ✓ Sender ID request notification sent to ${this.adminNotificationEmail}`);
      } else {
        console.error(`[EMAIL][ADMIN][ERROR] Failed to send Sender ID request notification:`, result.error);
      }

      return result.success;
    } catch (error) {
      console.error(`[EMAIL][ADMIN][ERROR] Exception sending Sender ID request notification:`, error.message);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new EmailService();