const NaloSmsService = require('../services/NaloSmsService');

const naloService = NaloSmsService;

/**
 * Send SMS endpoint with financial tracking
 * POST /api/sms/send
 */
const sendSms = async (req, res) => {
  try {
    const { phoneNumber, senderId, message, recipientsCount = 1 } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: { code: 'UNAUTHORIZED' }
      });
    }

    if (!phoneNumber || !senderId || !message) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber, senderId, and message are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Use the new method with financial tracking
    const result = await naloService.sendSmsWithFinancialTracking({
      userId,
      phoneNumber,
      senderId,
      message,
      recipientsCount
    });

    if (result.success) {
      const responsePayload = {
        success: true,
        message: 'SMS sent successfully',
        data: {
          messageId: result.messageId,
          jobId: result.jobId,
          financial: result.financial
        }
      };
      
      console.log('[NaloController] SMS sent successfully:', {
        userId: req.user?.userId,
        phoneNumber: req.body.phoneNumber,
        messageId: result.messageId,
        jobId: result.jobId,
        status: 200,
        contentType: 'application/json'
      });
      
      res.status(200).json(responsePayload);
    } else {
      const statusCode = result.code === 'INSUFFICIENT_BALANCE' ? 402 : 400;
      const responsePayload = {
        success: false,
        message: result.error,
        error: {
          code: result.code || 'SMS_SEND_FAILED'
        }
      };
      
      console.log('[NaloController] SMS send failed:', {
        userId: req.user?.userId,
        phoneNumber: req.body.phoneNumber,
        error: result.error,
        code: result.code,
        status: statusCode,
        contentType: 'application/json'
      });
      
      res.status(statusCode).json(responsePayload);
    }

  } catch (error) {
    console.error('SMS send controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send SMS',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
};

/**
 * Send bulk SMS endpoint with financial tracking
 * POST /api/sms/send-bulk
 */
const sendBulkSms = async (req, res) => {
  try {
    const { senderId, recipients, message } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: { code: 'UNAUTHORIZED' }
      });
    }

    if (!senderId || !recipients || !message) {
      return res.status(400).json({
        success: false,
        message: 'senderId, recipients, and message are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Recipients must be a non-empty array',
        error: { code: 'VALIDATION_ERROR' }
      });
    }

    // Process each recipient with financial tracking
    const results = [];
    let totalCharged = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let successCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      const result = await naloService.sendSmsWithFinancialTracking({
        userId,
        phoneNumber: recipient,
        senderId,
        message,
        recipientsCount: 1
      });

      if (result.success) {
        successCount++;
        if (result.financial) {
          totalCharged += result.financial.charged;
          totalCost += result.financial.cost;
          totalProfit += result.financial.profit;
        }
      } else {
        failedCount++;
      }

      results.push({
        recipient,
        success: result.success,
        messageId: result.messageId,
        error: result.error
      });
    }

    res.status(200).json({
      success: failedCount === 0,
      summary: {
        total: recipients.length,
        success: successCount,
        failed: failedCount,
        financial: {
          totalCharged,
          totalCost,
          totalProfit
        }
      },
      results
    });

  } catch (error) {
    console.error('Bulk SMS send controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk SMS',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
};

module.exports = {
  sendSms,
  sendBulkSms
};
