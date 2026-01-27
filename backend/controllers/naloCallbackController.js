const NaloSmsService = require('../services/NaloSmsService');

const naloService = new NaloSmsService();

/**
 * Handle Nalo delivery report callback
 * POST /api/sms/callback/nalo
 */
const handleDeliveryReport = async (req, res) => {
  try {
    const callbackPayload = req.body;

    // Validate callback payload
    if (!callbackPayload || typeof callbackPayload !== 'object') {
      return res.status(400).json({ error: 'Invalid callback payload' });
    }

    // Nalo callback payload structure: { job_id, status, recipient, timestamp? }
    const { job_id, status, recipient, timestamp } = callbackPayload;

    if (!job_id || !status) {
      return res.status(400).json({ error: 'Missing required fields: job_id and status' });
    }

    const result = await naloService.handleDeliveryReport({
      job_id,
      status,
      recipient,
      timestamp
    });

    if (result.success) {
      res.status(200).json({ message: 'Delivery report processed successfully' });
    } else {
      console.error('Delivery report processing failed:', result.error);
      res.status(500).json({ error: 'Failed to process delivery report' });
    }

  } catch (error) {
    console.error('Callback controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  handleDeliveryReport
};