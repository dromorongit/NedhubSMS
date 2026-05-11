const SmsCampaign = require('../models/SmsCampaign');
const SmsMessage = require('../models/SmsMessage');
const SmsRecipient = require('../models/SmsRecipient');
const Message = require('../models/Message');
const logger = require('../utils/logger');

class SmsAnalyticsService {
  // Get overall SMS analytics summary
  async getSmsSummary(userId, startDate = null, endDate = null) {
    logger.info('[Analytics] Getting SMS summary', { userId, startDate, endDate });

    const campaignMatchConditions = { userId };
    const recipientMatchConditions = { userId };
    const messageMatchConditions = { userId };
    const smsMessageMatchConditions = { userId };

    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      
      campaignMatchConditions.sentAt = {};
      if (start) campaignMatchConditions.sentAt.$gte = start;
      if (end) campaignMatchConditions.sentAt.$lte = end;
      
      recipientMatchConditions.createdAt = {};
      if (start) recipientMatchConditions.createdAt.$gte = start;
      if (end) recipientMatchConditions.createdAt.$lte = end;
      
      messageMatchConditions.createdAt = {};
      if (start) messageMatchConditions.createdAt.$gte = start;
      if (end) messageMatchConditions.createdAt.$lte = end;
      
      smsMessageMatchConditions.createdAt = {};
      if (start) smsMessageMatchConditions.createdAt.$gte = start;
      if (end) smsMessageMatchConditions.createdAt.$lte = end;
    }

    // Aggregate from SmsCampaign for campaign-level stats
    const campaignStats = await SmsCampaign.aggregate([
      { $match: campaignMatchConditions },
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

    // Get counts from SmsRecipient collection
    const recipientStats = await SmsRecipient.aggregate([
      { $match: recipientMatchConditions },
      {
        $group: {
          _id: null,
          actualSent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          actualDelivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          actualFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          totalRecipients: { $sum: 1 }
        }
      }
    ]);

    // Get counts from Message collection (legacy single messages)
    const messageStats = await Message.aggregate([
      { $match: messageMatchConditions },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          totalMessages: { $sum: 1 }
        }
      }
    ]);

    // Get counts from SmsMessage collection
    const smsMessageStats = await SmsMessage.aggregate([
      { $match: smsMessageMatchConditions },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          totalMessages: { $sum: 1 }
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

    const recipientData = recipientStats[0] || { actualSent: 0, actualDelivered: 0, actualFailed: 0 };
    const messageData = messageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    const smsMessageData = smsMessageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };

    // Combine all sources - use max values to avoid double counting
    const totalSent = Math.max(
      stats.totalSent,
      recipientData.actualSent,
      messageData.totalSent,
      smsMessageData.totalSent
    );
    
    const totalDelivered = Math.max(
      stats.totalDelivered,
      recipientData.actualDelivered,
      messageData.totalDelivered,
      smsMessageData.totalDelivered
    );
    
    const totalFailed = Math.max(
      stats.totalFailed,
      recipientData.actualFailed,
      messageData.totalFailed,
      smsMessageData.totalFailed
    );

    // Calculate rates
    const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;
    const failureRate = totalSent > 0 ? (totalFailed / totalSent) * 100 : 0;

    return {
      totalCampaigns: stats.totalCampaigns,
      totalRecipients: stats.totalRecipients || recipientData.totalRecipients,
      totalSent,
      totalDelivered,
      totalFailed,
      deliveryRate: Math.round(deliveryRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      totalSegments: stats.totalSegments,
      totalEstimatedCost: Math.round(stats.totalEstimatedCost * 100) / 100,
      totalActualCost: Math.round(stats.totalActualCost * 100) / 100
    };
  }

  // Get analytics by date range (for filtering)
  async getAnalyticsByDateRange(userId, startDate, endDate) {
    logger.info('[Analytics] Getting analytics by date range', { userId, startDate, endDate });
    return await this.getSmsSummary(userId, startDate, endDate);
  }

  // Get recent and top-performing campaigns
  async getCampaignsAnalytics(userId, startDate = null, endDate = null, limit = 10) {
    logger.info('[Analytics] Getting campaigns analytics', { userId, startDate, endDate, limit });
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
      .select('title sentAt status sentCount deliveredCount failedCount actualCost deliveryRate scheduledAt scheduledTimezone scheduleStatus jobId')
      .lean();

    // Top-performing campaigns (by delivery rate)
    const topCampaigns = await SmsCampaign.find({
      ...matchConditions,
      sentCount: { $gt: 0 }
    })
      .sort({ deliveredCount: -1, sentCount: -1 })
      .limit(limit)
      .select('title sentAt status sentCount deliveredCount failedCount actualCost deliveryRate scheduledAt scheduledTimezone scheduleStatus jobId')
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