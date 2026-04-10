const NaloSmsService = require('../services/NaloSmsService');

const naloService = NaloSmsService;

/**
 * Send SMS endpoint with financial tracking
 * POST /api/sms/send
 */
const sendSms = async (req, res) => {
  try {
    const { msisdn, senderId, message, recipientsCount = 1 } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!msisdn || !senderId || !message) {
      return res.status(400).json({ error: 'msisdn, senderId, and message are required' });
    }

    // Use the new method with financial tracking
    const result = await naloService.sendSmsWithFinancialTracking({
      userId,
      msisdn,
      senderId,
      message,
      recipientsCount
    });

    if (result.success) {
      res.status(200).json({
        success: true,
        messageId: result.messageId,
        jobId: result.jobId,
        financial: result.financial,
        message: 'SMS sent successfully'
      });
    } else {
      const statusCode = result.code === 'INSUFFICIENT_BALANCE' ? 402 : 400;
      res.status(statusCode).json({
        success: false,
        error: result.error,
        code: result.code
      });
    }

  } catch (error) {
    console.error('SMS send controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!senderId || !recipients || !message) {
      return res.status(400).json({ error: 'senderId, recipients, and message are required' });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Recipients must be a non-empty array' });
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
        msisdn: recipient,
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
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  sendSms,
  sendBulkSms
};
