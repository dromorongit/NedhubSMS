const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const SmsAnalyticsService = require('../services/SmsAnalyticsService');

// GET /api/analytics/sms-summary - Overall stats
router.get('/sms-summary', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate } = req.query;

    const summary = await SmsAnalyticsService.getSmsSummary(userId, startDate, endDate);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Analytics summary error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

// GET /api/analytics/campaigns - Campaign list with performance
router.get('/campaigns', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate, limit = 10 } = req.query;

    const campaigns = await SmsAnalyticsService.getCampaignsAnalytics(userId, startDate, endDate, parseInt(limit));

    res.json({
      success: true,
      data: campaigns
    });
  } catch (error) {
    console.error('Campaigns analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns analytics' });
  }
});

// GET /api/analytics/charts - Chart data for visualizations
router.get('/charts', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate } = req.query;

    const chartData = await SmsAnalyticsService.getChartData(userId, startDate, endDate);

    res.json({
      success: true,
      data: chartData
    });
  } catch (error) {
    console.error('Charts analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

module.exports = router;