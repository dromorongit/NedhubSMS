/**
 * Admin Notification Template - New Sender ID Approval Request
 * Sends internal notification to admin when a user submits a Sender ID approval request
 */

function getAdminSenderIdRequestTemplate(requestData) {
  const {
    userName = 'N/A',
    userEmail = 'N/A',
    senderId = 'N/A',
    businessName = 'N/A',
    documentType = 'N/A',
    requestId = 'N/A',
    submittedAt = new Date().toLocaleString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    })
  } = requestData;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Sender ID Request</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-card { background: #ffffff; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .email-header { background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; padding: 25px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .badge { display: inline-block; padding: 4px 12px; background: #3498db; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px; }
    .email-body { padding: 30px; }
    .sender-id-highlight { background: #ebf5fb; border: 2px solid #3498db; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
    .sender-id-highlight .label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; letter-spacing: 1px; }
    .sender-id-highlight .value { font-size: 28px; font-weight: bold; color: #2c3e50; letter-spacing: 2px; font-family: 'Courier New', monospace; margin-top: 5px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .info-table th { text-align: left; padding: 12px; background: #f8f9fa; border-bottom: 2px solid #e9ecef; font-weight: 600; color: #495057; width: 40%; }
    .info-table td { padding: 12px; border-bottom: 1px solid #e9ecef; color: #212529; }
    .status-pending { display: inline-block; padding: 6px 16px; background: #f39c12; color: white; border-radius: 20px; font-size: 14px; font-weight: 600; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
    .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; font-size: 14px; color: #856404; }
    .action-items { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .action-items ul { margin: 10px 0; padding-left: 20px; }
    .action-items li { margin: 5px 0; color: #495057; }
  </style>
</head>
<body>
  <div class="container">
    <div class="email-card">
      <div class="email-header">
        <h1>📝 New Sender ID Request</h1>
        <span class="badge">Approval Required</span>
      </div>
      <div class="email-body">
        <p>A new Sender ID approval request has been submitted and requires your review.</p>
        
        <div class="sender-id-highlight">
          <div class="label">Requested Sender ID</div>
          <div class="value">${senderId}</div>
        </div>
        
        <div class="status-pending">Status: Pending Review</div>
        
        <table class="info-table">
          <tr>
            <th>Request ID</th>
            <td>${requestId}</td>
          </tr>
          <tr>
            <th>User Name</th>
            <td>${userName}</td>
          </tr>
          <tr>
            <th>User Email</th>
            <td>${userEmail}</td>
          </tr>
          <tr>
            <th>Business Name</th>
            <td>${businessName}</td>
          </tr>
          <tr>
            <th>Document Type</th>
            <td>${documentType}</td>
          </tr>
          <tr>
            <th>Submitted At</th>
            <td>${submittedAt}</td>
          </tr>
        </table>

        <div class="action-items">
          <strong>Next Steps:</strong>
          <ul>
            <li>Review the submitted document</li>
            <li>Verify the Sender ID meets guidelines</li>
            <li>Approve or reject the request in the admin panel</li>
          </ul>
        </div>

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

function getAdminSenderIdRequestTextTemplate(requestData) {
  const {
    userName = 'N/A',
    userEmail = 'N/A',
    senderId = 'N/A',
    businessName = 'N/A',
    documentType = 'N/A',
    requestId = 'N/A',
    submittedAt = new Date().toLocaleString('en-GB')
  } = requestData;

  return `New Sender ID Approval Request

A new Sender ID approval request has been submitted and requires your review.

REQUESTED SENDER ID: ${senderId}
Status: Pending Review

REQUEST DETAILS:
----------------
Request ID: ${requestId}
User Name: ${userName}
User Email: ${userEmail}
Business Name: ${businessName}
Document Type: ${documentType}
Submitted At: ${submittedAt}

NEXT STEPS:
-----------
1. Review the submitted document
2. Verify the Sender ID meets guidelines
3. Approve or reject the request in the admin panel

---
This is an automated internal notification from Nedhub Admin Panel.
Please do not reply to this email.`;
}

module.exports = {
  getAdminSenderIdRequestTemplate,
  getAdminSenderIdRequestTextTemplate
};