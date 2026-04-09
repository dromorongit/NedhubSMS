const SmsCampaign = require('../models/SmsCampaign');
const SmsMessage = require('../models/SmsMessage');
const SmsRecipient = require('../models/SmsRecipient');

class SmsAnalyticsService {
  // Get overall SMS analytics summary
  async getSmsSummary(userId, startDate = null, endDate = null) {
    const matchConditions = { userId };

    if (startDate || endDate) {
      matchConditions.sentAt = {};
      if (startDate) matchConditions.sentAt.$gte = new Date(startDate);
      if (endDate) matchConditions.sentAt.$lte = new Date(endDate);
    }

    // Aggregate from SmsCampaign
    const campaignStats = await SmsCampaign.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          totalRecipients: { $sum: '$recipientCount' },
          totalSent: { $sum: '$sentCount' },
          totalDelivered: { $sum: '$deliveredCount' },
          totalFailed: { $sum: '$failedCount' },
          totalSegments: { $sum: '$totalSegments' },
          totalEstimatedCost: { $sum: '$estimatedCost' },
          totalActualCost: { $sum: '$actualCost' }
        }
      }
    ]);

    const stats = campaignStats[0] || {
      totalCampaigns: 0,
      totalRecipients: 0,
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalSegments: 0,
      totalEstimatedCost: 0,
      totalActualCost: 0
    };

    // Calculate rates
    const deliveryRate = stats.totalSent > 0 ? (stats.totalDelivered / stats.totalSent) * 100 : 0;
    const failureRate = stats.totalSent > 0 ? (stats.totalFailed / stats.totalSent) * 100 : 0;

    return {
      totalCampaigns: stats.totalCampaigns,
      totalRecipients: stats.totalRecipients,
      totalSent: stats.totalSent,
      totalDelivered: stats.totalDelivered,
      totalFailed: stats.totalFailed,
      deliveryRate: Math.round(deliveryRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      totalSegments: stats.totalSegments,
      totalEstimatedCost: Math.round(stats.totalEstimatedCost * 100) / 100,
      totalActualCost: Math.round(stats.totalActualCost * 100) / 100
    };
  }

  // Get analytics by date range (for filtering)
  async getAnalyticsByDateRange(userId, startDate, endDate) {
    return await this.getSmsSummary(userId, startDate, endDate);
  }

  // Get recent and top-performing campaigns
  async getCampaignsAnalytics(userId, startDate = null, endDate = null, limit = 10) {
    const matchConditions = { userId };

    if (startDate || endDate) {
      matchConditions.sentAt = {};
      if (startDate) matchConditions.sentAt.$gte = new Date(startDate);
      if (endDate) matchConditions.sentAt.$lte = new Date(endDate);
    }

    // Recent campaigns
    const recentCampaigns = await SmsCampaign.find(matchConditions)
      .sort({ sentAt: -1 })
      .limit(limit)
      .select('title sentAt status sentCount deliveredCount failedCount actualCost deliveryRate')
      .lean();

    // Top-performing campaigns (by delivery rate)
    const topCampaigns = await SmsCampaign.find({
      ...matchConditions,
      sentCount: { $gt: 0 }
    })
      .sort({ deliveredCount: -1, sentCount: -1 })
      .limit(limit)
      .select('title sentAt status sentCount deliveredCount failedCount actualCost deliveryRate')
      .lean();

    return {
      recent: recentCampaigns,
      topPerforming: topCampaigns
    };
  }

  // Get chart data for visualizations
  async getChartData(userId, startDate = null, endDate = null) {
    const matchConditions = { userId };

    if (startDate || endDate) {
      matchConditions.sentAt = {};
      if (startDate) matchConditions.sentAt.$gte = new Date(startDate);
      if (endDate) matchConditions.sentAt.$lte = new Date(endDate);
    }

    // Sends over time (daily)
    const sendsOverTime = await SmsCampaign.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$sentAt' }
          },
          sent: { $sum: '$sentCount' },
          delivered: { $sum: '$deliveredCount' },
          failed: { $sum: '$failedCount' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Delivery success rate over time
    const deliverySuccessRate = sendsOverTime.map(day => ({
      date: day._id,
      rate: day.sent > 0 ? (day.delivered / day.sent) * 100 : 0
    }));

    // Cost trends over time
    const costTrends = await SmsCampaign.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$sentAt' }
          },
          estimatedCost: { $sum: '$estimatedCost' },
          actualCost: { $sum: '$actualCost' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    return {
      sendsOverTime: sendsOverTime.map(day => ({
        date: day._id,
        sent: day.sent,
        delivered: day.delivered,
        failed: day.failed
      })),
      deliverySuccessRate,
      costTrends: costTrends.map(day => ({
        date: day._id,
        estimated: day.estimatedCost,
        actual: day.actualCost
      }))
    };
  }
}

module.exports = new SmsAnalyticsService();