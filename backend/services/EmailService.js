const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || 'support@nedhubgh.com',
        pass: process.env.SMTP_PASS || ''
      }
    });
  }

  /**
   * Send email verification OTP
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {Promise<boolean>} - Returns true if email sent successfully
   */
  async sendVerificationOTP(email, fullName, otp) {
    const mailOptions = {
      from: `"Nedhub" <${process.env.SMTP_USER || 'support@nedhubgh.com'}>`,
      to: email,
      subject: 'Verify Your Email - Nedhub',
      html: this.getVerificationEmailTemplate(fullName, otp)
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`[EMAIL] Verification OTP sent to ${email}`);
      return true;
    } catch (error) {
      console.error('[EMAIL] Error sending verification OTP:', error);
      throw new Error('Failed to send verification email');
    }
  }

  /**
   * Send password reset OTP
   * @param {string} email - Recipient email
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {Promise<boolean>} - Returns true if email sent successfully
   */
  async sendPasswordResetOTP(email, fullName, otp) {
    const mailOptions = {
      from: `"Nedhub" <${process.env.SMTP_USER || 'support@nedhubgh.com'}>`,
      to: email,
      subject: 'Reset Your Password - Nedhub',
      html: this.getPasswordResetEmailTemplate(fullName, otp)
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`[EMAIL] Password reset OTP sent to ${email}`);
      return true;
    } catch (error) {
      console.error('[EMAIL] Error sending password reset OTP:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Get HTML template for email verification
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {string} - HTML email template
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
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .email-card {
            background: #ffffff;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          .email-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
          }
          .email-header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
          }
          .email-body {
            padding: 40px 30px;
          }
          .greeting {
            font-size: 18px;
            margin-bottom: 20px;
            color: #333;
          }
          .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #555;
          }
          .otp-container {
            background: #f8f9fa;
            border: 2px dashed #667eea;
            border-radius: 8px;
            padding: 25px;
            text-align: center;
            margin: 30px 0;
          }
          .otp-label {
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .otp-code {
            font-size: 36px;
            font-weight: bold;
            color: #667eea;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
          }
          .expiry-notice {
            font-size: 14px;
            color: #e74c3c;
            margin-top: 15px;
            font-weight: 500;
          }
          .footer {
            text-align: center;
            padding: 20px;
            font-size: 12px;
            color: #999;
            border-top: 1px solid #eee;
          }
          .footer a {
            color: #667eea;
            text-decoration: none;
          }
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
              <p>
                <a href="https://nedhubgh.com">Visit our website</a> | 
                <a href="mailto:support@nedhubgh.com">Contact Support</a>
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get HTML template for password reset
   * @param {string} fullName - User's full name
   * @param {string} otp - OTP code
   * @returns {string} - HTML email template
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
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .email-card {
            background: #ffffff;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          .email-header {
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            color: white;
            padding: 30px;
            text-align: center;
          }
          .email-header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
          }
          .email-body {
            padding: 40px 30px;
          }
          .greeting {
            font-size: 18px;
            margin-bottom: 20px;
            color: #333;
          }
          .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #555;
          }
          .otp-container {
            background: #f8f9fa;
            border: 2px dashed #e74c3c;
            border-radius: 8px;
            padding: 25px;
            text-align: center;
            margin: 30px 0;
          }
          .otp-label {
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .otp-code {
            font-size: 36px;
            font-weight: bold;
            color: #e74c3c;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
          }
          .expiry-notice {
            font-size: 14px;
            color: #e74c3c;
            margin-top: 15px;
            font-weight: 500;
          }
          .security-notice {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            font-size: 14px;
            color: #856404;
          }
          .footer {
            text-align: center;
            padding: 20px;
            font-size: 12px;
            color: #999;
            border-top: 1px solid #eee;
          }
          .footer a {
            color: #e74c3c;
            text-decoration: none;
          }
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
              <p>
                <a href="https://nedhubgh.com">Visit our website</a> | 
                <a href="mailto:support@nedhubgh.com">Contact Support</a>
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = new EmailService();
