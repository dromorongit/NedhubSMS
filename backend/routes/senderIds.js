const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, authorize } = require('../middleware/auth');
const SenderId = require('../models/SenderId');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/sender-id-docs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and PDF files are allowed.'), false);
    }
  }
});

// Request new Sender ID with document upload
router.post('/', authenticate, upload.single('document'), async (req, res) => {
  try {
    const { senderId, documentType } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!senderId) {
      return res.status(400).json({ error: 'Sender ID is required' });
    }

    if (!documentType) {
      return res.status(400).json({ error: 'Document type is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Document upload is required' });
    }

    // Check if Sender ID already exists
    const existingSenderId = await SenderId.findOne({ senderId });
    if (existingSenderId) {
      return res.status(400).json({ error: 'Sender ID already exists' });
    }

    // Create new Sender ID request with document
    const newSenderId = new SenderId({
      userId,
      senderId,
      documentType,
      documentUrl: `/uploads/sender-id-docs/${req.file.filename}`,
      documentName: req.file.originalname,
      status: 'pending'
    });

    await newSenderId.save();

    res.status(201).json({
      message: 'Sender ID request submitted successfully with document',
      senderId: newSenderId.senderId,
      status: newSenderId.status,
      documentType: newSenderId.documentType
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

    // Hide document URLs for regular users
    const sanitizedSenderIds = senderIds.map(sid => ({
      _id: sid._id,
      senderId: sid.senderId,
      documentType: sid.documentType,
      status: sid.status,
      remarks: sid.remarks,
      createdAt: sid.createdAt,
      updatedAt: sid.updatedAt
    }));

    res.json({ senderIds: sanitizedSenderIds });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Get all Sender IDs with document URLs
router.get('/admin/all', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const senderIds = await SenderId.find().populate('userId', 'name email').sort({ createdAt: -1 });

    res.json({ senderIds });
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
