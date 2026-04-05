/**
 * Admin Notification Template - User Verified Successfully
 * Sends internal notification to admin when a user completes email verification
 */

function getAdminUserVerifiedTemplate(user) {
  const fullName = user.name || 'N/A';
  const email = user.email || 'N/A';
  const userId = user._id ? user._id.toString() : 'N/A';
  const verificationDate = user.emailVerifiedAt 
    ? new Date(user.emailVerifiedAt).toLocaleString('en-GB', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      })
    : new Date().toLocaleString('en-GB', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New User Verified</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-card { background: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .email-header { background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); color: white; padding: 25px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .badge { display: inline-block; padding: 4px 12px; background: #27ae60; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px; }
    .email-body { padding: 30px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .info-table th { text-align: left; padding: 12px; background: #f8f9fa; border-bottom: 2px solid #e9ecef; font-weight: 600; color: #495057; width: 40%; }
    .info-table td { padding: 12px; border-bottom: 1px solid #e9ecef; color: #212529; }
    .highlight { background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
    .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; font-size: 14px; color: #856404; }
  </style>
</head>
<body>
  <div class="container">
    <div class="email-card">
      <div class="email-header">
        <h1>✓ User Verified Successfully</h1>
        <span class="badge">New Account Activation</span>
      </div>
      <div class="email-body">
        <p>A new user has successfully completed email verification and their account is now active.</p>
        
        <div class="highlight">
          <strong>User Details</strong>
        </div>
        
        <table class="info-table">
          <tr>
            <th>Full Name</th>
            <td>${fullName}</td>
          </tr>
          <tr>
            <th>Email Address</th>
            <td>${email}</td>
          </tr>
          <tr>
            <th>User ID</th>
            <td>${userId}</td>
          </tr>
          <tr>
            <th>Verified At</th>
            <td>${verificationDate}</td>
          </tr>
        </table>

        <div class="alert">
          <strong>Note:</strong> This is an automated internal notification. Please do not reply to this email.
        </div>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Nedhub Admin Panel</p>
        <p>Internal Notification System</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function getAdminUserVerifiedTextTemplate(user) {
  const fullName = user.name || 'N/A';
  const email = user.email || 'N/A';
  const userId = user._id ? user._id.toString() : 'N/A';
  const verificationDate = user.emailVerifiedAt 
    ? new Date(user.emailVerifiedAt).toLocaleString('en-GB')
    : new Date().toLocaleString('en-GB');

  return `New User Verified Successfully

A new user has successfully completed email verification and their account is now active.

USER DETAILS:
-------------
Full Name: ${fullName}
Email Address: ${email}
User ID: ${userId}
Verified At: ${verificationDate}

---
This is an automated internal notification from Nedhub Admin Panel.
Please do not reply to this email.`;
}

module.exports = {
  getAdminUserVerifiedTemplate,
  getAdminUserVerifiedTextTemplate
};