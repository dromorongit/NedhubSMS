const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, authorize } = require('../middleware/auth');
const SenderId = require('../models/SenderId');
const User = require('../models/User');
const EmailServiceClass = require('../services/EmailService');
const logger = require('../utils/logger');

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

// ==================== Helper: Send Admin Notification ====================
async function sendAdminNotification(senderIdRecord) {
  try {
    const user = await User.findById(senderIdRecord.userId).select('name email');
    if (!user) {
      logger.senderIdNotification.warn('User not found for admin notification', {
        senderId: senderIdRecord.senderId,
        userId: senderIdRecord.userId
      });
      return false;
    }

    const emailService = new EmailServiceClass();
    const success = await emailService.sendAdminSenderIdRequestNotification({
      userName: user.name || 'N/A',
      userEmail: user.email || 'N/A',
      senderId: senderIdRecord.senderId,
      businessName: '',
      documentType: senderIdRecord.documentType,
      requestId: senderIdRecord._id.toString(),
      submittedAt: new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    });

    if (success) {
      logger.senderIdNotification.info('Admin notification sent for Sender ID request', {
        senderId: senderIdRecord.senderId,
        requestId: senderIdRecord._id.toString(),
        userEmail: user.email
      });
    } else {
      logger.senderIdNotification.error('Failed to send admin notification for Sender ID request', {
        senderId: senderIdRecord.senderId,
        requestId: senderIdRecord._id.toString()
      });
    }
    return success;
  } catch (err) {
    logger.senderIdEmail.error('Exception in sendAdminNotification', {
      error: err.message,
      stack: err.stack,
      senderId: senderIdRecord?.senderId
    });
    return false;
  }
}

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

    // Check if Sender ID already exists for current user with pending/approved status
    // Note: senderId is unique globally, so we check if any existing record has pending/approved
    const existingPendingOrApproved = await SenderId.findOne({ 
      senderId, 
      status: { $in: ['pending', 'approved'] } 
    });
    if (existingPendingOrApproved) {
      logger.senderIdCreation.warn('Duplicate Sender ID submission blocked', {
        senderId,
        userId,
        existingId: existingPendingOrApproved._id.toString(),
        existingStatus: existingPendingOrApproved.status
      });
      return res.status(400).json({ 
        error: existingPendingOrApproved.status === 'pending' 
          ? 'Sender ID already submitted and pending approval' 
          : 'Sender ID already approved' 
      });
    }

    // If Sender ID exists with rejected status, only allow resubmission by same user
    const rejectedSenderId = await SenderId.findOne({ senderId, status: 'rejected' });
    if (rejectedSenderId) {
      // Only the original user can resubmit; other users cannot take a rejected senderId
      if (rejectedSenderId.userId.toString() !== userId) {
        logger.senderIdCreation.warn('Rejected Sender ID resubmission blocked - different user', {
          senderId,
          userId,
          rejectedByUserId: rejectedSenderId.userId.toString()
        });
        return res.status(400).json({ 
          error: 'This Sender ID is not available' 
        });
      }
      logger.senderIdCreation.info('Replacing rejected Sender ID for resubmission', {
        senderId,
        userId
      });
      await SenderId.deleteOne({ senderId, status: 'rejected' });
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

    logger.senderIdCreation.info('Sender ID created successfully', {
      senderId: newSenderId.senderId,
      requestId: newSenderId._id.toString(),
      userId,
      status: newSenderId.status
    });

    // Send admin notification (non-blocking side effect - never fails the request)
    // Fire and forget - run in background after response is sent
    sendAdminNotification(newSenderId).catch(err => {
      logger.senderIdNotification.error('Background admin notification failed', {
        error: err.message,
        senderId: newSenderId.senderId
      });
    });

    res.status(201).json({
      message: 'Sender ID request submitted successfully with document',
      senderId: newSenderId.senderId,
      status: newSenderId.status,
      documentType: newSenderId.documentType
    });
  } catch (error) {
    logger.senderIdError.error('Sender ID creation error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.userId,
      senderId: req.body?.senderId
    });
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
    logger.api.error('Get Sender IDs error', {
      error: error.message,
      userId: req.user?.userId
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Get all Sender IDs with document URLs
router.get('/admin/all', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const senderIds = await SenderId.find().populate('userId', 'name email').sort({ createdAt: -1 });

    res.json({ senderIds });
  } catch (error) {
    logger.api.error('Admin get Sender IDs error', {
      error: error.message
    });
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

    logger.senderIdApproval.info('Sender ID approved', {
      senderId: senderId.senderId,
      requestId: senderId._id.toString(),
      adminRemarks: remarks || ''
    });

    res.json({
      message: 'Sender ID approved successfully',
      senderId: senderId.senderId,
      status: senderId.status
    });
  } catch (error) {
    logger.senderIdApproval.error('Sender ID approval error', {
      error: error.message,
      requestId: req.params?.id
    });
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

    logger.senderIdApproval.info('Sender ID rejected', {
      senderId: senderId.senderId,
      requestId: senderId._id.toString(),
      adminRemarks: remarks || ''
    });

    res.json({
      message: 'Sender ID rejected successfully',
      senderId: senderId.senderId,
      status: senderId.status
    });
  } catch (error) {
    logger.senderIdApproval.error('Sender ID rejection error', {
      error: error.message,
      requestId: req.params?.id
    });
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

module.exports = router;