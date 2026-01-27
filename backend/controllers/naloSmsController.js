const NaloSmsService = require('../services/NaloSmsService');

const naloService = new NaloSmsService();

/**
 * Send SMS endpoint
 * POST /api/sms/send
 */
const sendSms = async (req, res) => {
  try {
    const { msisdn, senderId, message } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!msisdn || !senderId || !message) {
      return res.status(400).json({ error: 'msisdn, senderId, and message are required' });
    }

    const result = await naloService.sendSms({
      userId,
      msisdn,
      senderId,
      message
    });

    if (result.success) {
      res.status(200).json({
        success: true,
        messageId: result.messageId,
        message: 'SMS sent successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('SMS send controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  sendSms
};