const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const SmsExportService = require('../services/SmsExportService');

const router = express.Router();

// Rate limiter for export operations (stricter limits)
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 exports per 15 minutes per user
  message: {
    error: 'Too many export requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/reports/sms-campaigns - List campaigns with delivery stats
router.get('/sms-campaigns', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      status,
      deliveryStatus,
      dateFrom,
      dateTo,
      groupId,
      page = 1,
      limit = 20
    } = req.query;

    // Build query
    const query = { userId };

    // Status filter
    if (status) {
      query.status = status;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo + 'T23:59:59');
    }

    // Group filter (if provided, join with recipients)
    let groupFilter = {};
    if (groupId) {
      groupFilter = { groupIds: groupId };
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const campaignsQuery = SmsCampaign.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Execute queries
    const [campaigns, totalCount] = await Promise.all([
      campaignsQuery,
      SmsCampaign.countDocuments(query)
    ]);

    // Get delivery stats for each campaign
    const campaignsWithStats = await Promise.all(
      campaigns.map(async (campaign) => {
        const recipientStats = await SmsRecipient.aggregate([
          {
            $match: {
              campaignId: campaign._id,
              ...(groupId && { groupIds: { $in: [groupId] } })
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
              delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
              pending: { $sum: { $cond: [{ $in: ['$status', ['pending', 'processing', 'queued']] }, 1, 0] } },
              totalCost: { $sum: { $ifNull: ['$actualCost', '$estimatedCost'] } },
              totalSegments: { $sum: '$segments' }
            }
          }
        ]);

        const stats = recipientStats[0] || {
          total: 0,
          sent: 0,
          delivered: 0,
          failed: 0,
          pending: 0,
          totalCost: 0,
          totalSegments: 0
        };

        return {
          _id: campaign._id,
          title: campaign.title,
          senderId: campaign.senderId,
          status: campaign.status,
          createdAt: campaign.createdAt,
          sentAt: campaign.sentAt,
          scheduledAt: campaign.scheduledAt,
          recipientCount: campaign.recipientCount,
          validRecipientCount: campaign.validRecipientCount,
          deliveryStats: {
            total: stats.total,
            sent: stats.sent,
            delivered: stats.delivered,
            failed: stats.failed,
            pending: stats.pending,
            deliveryRate: stats.sent > 0 ? Math.round((stats.delivered / stats.sent) * 100) : 0
          },
          costStats: {
            estimatedCost: campaign.estimatedCost,
            actualCost: campaign.actualCost || stats.totalCost,
            totalSegments: campaign.totalSegments || stats.totalSegments
          },
          isPersonalized: campaign.isPersonalized,
          sendMode: campaign.sendMode
        };
      })
    );

    res.json({
      success: true,
      campaigns: campaignsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get campaigns report error:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns report: ' + error.message });
  }
});

// GET /api/reports/sms-campaigns/:id/export - Export campaign recipients to CSV/Excel
router.get('/sms-campaigns/:id/export', authenticate, exportLimiter, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user.userId;
    const { format = 'csv', status, deliveryStatus } = req.query;

    // Validate format
    if (!['csv', 'excel'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use "csv" or "excel".' });
    }

    // Verify campaign ownership
    const campaign = await SmsCampaign.findOne({ _id: campaignId, userId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Prepare filters
    const filters = {};
    if (status) filters.status = status;
    if (deliveryStatus) filters.deliveryStatus = deliveryStatus;

    // Set headers before streaming
    const filename = SmsExportService.generateFilename(campaignId, format);
    const contentType = SmsExportService.getContentType(format);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (format === 'csv') {
      await SmsExportService.exportCampaignRecipients(campaignId, userId, format, filters, res);
    } else {
      const fileBuffer = await SmsExportService.exportCampaignRecipients(
        campaignId, userId, format, filters
      );
      res.send(fileBuffer);
    }
  } catch (error) {
    console.error('Export campaign recipients error:', error);
    res.status(500).json({ error: 'Failed to export campaign recipients: ' + error.message });
  }
});

module.exports = router;