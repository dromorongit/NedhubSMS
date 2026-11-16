const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const BlacklistedNumber = require('../models/BlacklistedNumber');
const SmsRecipientService = require('../services/SmsRecipientService');
const AuditLog = require('../models/AuditLog');

// POST /api/blacklist - Add number to blacklist
router.post('/', authenticate, async (req, res) => {
  try {
    const { phoneNumber, reason, source = 'user' } = req.body;
    const userId = req.user.userId;

     if (!phoneNumber || !reason) {
       return res.status(400).json({
         success: false,
         message: 'Phone number and reason are required',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Normalize phone number
     const normalizedPhoneNumber = SmsRecipientService.normalizePhoneNumber(phoneNumber);

     if (!normalizedPhoneNumber) {
       return res.status(400).json({
         success: false,
         message: 'Invalid phone number format',
         error: { code: 'VALIDATION_ERROR' }
       });
     }

     // Check if already blacklisted
     const existing = await BlacklistedNumber.isBlacklisted(userId, normalizedPhoneNumber);
     if (existing) {
       return res.status(409).json({
         success: false,
         message: 'Phone number is already blacklisted',
         error: { code: 'ALREADY_BLACKLISTED' }
       });
     }

    // Create blacklisted number
    const blacklistedNumber = new BlacklistedNumber({
      userId,
      phoneNumber,
      normalizedPhoneNumber,
      reason,
      source
    });

    await blacklistedNumber.save();

    // Log audit
    await AuditLog.log({
      userId,
      action: 'CREATE',
      resourceType: 'BlacklistedNumber',
      resourceId: blacklistedNumber._id,
      details: `Added phone number ${phoneNumber} to blacklist`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      blacklistedNumber
    });

  } catch (error) {
    console.error('Add to blacklist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add number to blacklist',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// GET /api/blacklist - List blacklisted numbers
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 50, search = '' } = req.query;

    const query = { userId };

    // Add search filter
    if (search) {
      query.$or = [
        { phoneNumber: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await BlacklistedNumber.countDocuments(query);
    const blacklistedNumbers = await BlacklistedNumber.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      blacklistedNumbers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasNext: skip + parseInt(limit) < total,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('List blacklist error:', error);
    res.status(500).json({ error: 'Failed to fetch blacklisted numbers: ' + error.message });
  }
});

// DELETE /api/blacklist/:id - Remove from blacklist
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const blacklistedNumber = await BlacklistedNumber.findOne({ _id: id, userId });

    if (!blacklistedNumber) {
      return res.status(404).json({ error: 'Blacklisted number not found' });
    }

    const phoneNumber = blacklistedNumber.phoneNumber;

    await blacklistedNumber.deleteOne();

    // Log audit
    await AuditLog.log({
      userId,
      action: 'DELETE',
      resourceType: 'BlacklistedNumber',
      resourceId: id,
      details: `Removed phone number ${phoneNumber} from blacklist`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Number removed from blacklist successfully'
    });

  } catch (error) {
    console.error('Remove from blacklist error:', error);
    res.status(500).json({ error: 'Failed to remove number from blacklist: ' + error.message });
  }
});

// GET /api/blacklist/check/:phoneNumber - Check if phone number is blacklisted
router.get('/check/:phoneNumber', authenticate, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const userId = req.user.userId;

    const normalizedPhoneNumber = SmsRecipientService.normalizePhoneNumber(phoneNumber);

    if (!normalizedPhoneNumber) {
      return res.status(400).json({
        error: 'Invalid phone number format'
      });
    }

    const isBlacklisted = await BlacklistedNumber.isBlacklisted(userId, normalizedPhoneNumber);

    res.json({
      success: true,
      phoneNumber,
      normalizedPhoneNumber,
      isBlacklisted
    });

  } catch (error) {
    console.error('Check blacklist error:', error);
    res.status(500).json({ error: 'Failed to check blacklist status: ' + error.message });
  }
});

module.exports = router;