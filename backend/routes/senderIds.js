const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const SenderId = require('../models/SenderId');

// Request new Sender ID
router.post('/', authenticate, async (req, res) => {
  try {
    const { senderId } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!senderId) {
      return res.status(400).json({ error: 'Sender ID is required' });
    }

    // Check if Sender ID already exists
    const existingSenderId = await SenderId.findOne({ senderId });
    if (existingSenderId) {
      return res.status(400).json({ error: 'Sender ID already exists' });
    }

    // Create new Sender ID request
    const newSenderId = new SenderId({
      userId,
      senderId,
      status: 'pending'
    });

    await newSenderId.save();

    res.status(201).json({
      message: 'Sender ID request submitted successfully',
      senderId: newSenderId.senderId,
      status: newSenderId.status
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get user's Sender IDs
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const senderIds = await SenderId.find({ userId }).sort({ createdAt: -1 });

    res.json(senderIds);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Approve Sender ID
router.put('/:id/approve', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const senderId = await SenderId.findById(id);
    if (!senderId) {
      return res.status(404).json({ error: 'Sender ID not found' });
    }

    senderId.status = 'approved';
    senderId.remarks = remarks || '';
    await senderId.save();

    res.json({
      message: 'Sender ID approved successfully',
      senderId: senderId.senderId,
      status: senderId.status
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Reject Sender ID
router.put('/:id/reject', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const senderId = await SenderId.findById(id);
    if (!senderId) {
      return res.status(404).json({ error: 'Sender ID not found' });
    }

    senderId.status = 'rejected';
    senderId.remarks = remarks || '';
    await senderId.save();

    res.json({
      message: 'Sender ID rejected successfully',
      senderId: senderId.senderId,
      status: senderId.status
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

module.exports = router;