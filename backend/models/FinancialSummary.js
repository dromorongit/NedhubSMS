const mongoose = require('mongoose');

/**
 * FinancialSummary Schema
 * Stores aggregated financial data for reporting and analytics
 * Updated periodically (daily/monthly) for financial tracking
 */
const financialSummarySchema = new mongoose.Schema({
  period: {
    type: String,
    required: true,
    enum: ['daily', 'monthly', 'yearly'],
    index: true
  },
  periodStart: {
    type: Date,
    required: true,
    index: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  // SMS metrics
  totalSmsSent: {
    type: Number,
    default: 0,
    min: 0
  },
  totalRecipients: {
    type: Number,
    default: 0,
    min: 0
  },
  totalSegments: {
    type: Number,
    default: 0,
    min: 0
  },
  // Financial metrics
  totalRevenue: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Total amount charged to users for SMS'
  },
  totalProviderCost: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Total cost paid to SMS provider'
  },
  totalGatewayFees: {
    type: Number,
    default: 0,
    min: 0,
    description: 'Total gateway fees paid to payment providers'
  },
  totalProfit: {
    type: Number,
    default: 0,
    description: 'Total profit (revenue - provider cost - gateway fees)'
  },
  // Optional user breakdown
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    description: 'If set, this summary is for a specific user'
  },
  // Pricing info snapshot
  pricingSnapshot: {
    sellPricePerSms: Number,
    providerCostPerSms: Number,
    currency: {
      type: String,
      default: 'GHS'
    }
  },
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Compound indexes for efficient querying
financialSummarySchema.index({ period: 1, periodStart: 1 });
financialSummarySchema.index({ userId: 1, period: 1, periodStart: -1 });

// Static method to get or create summary for a period
financialSummarySchema.statics.getOrCreateSummary = async function(period, periodStart, userId = null) {
  const periodEnd = new Date(periodStart);
  
  if (period === 'daily') {
    periodEnd.setDate(periodEnd.getDate() + 1);
  } else if (period === 'monthly') {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else if (period === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }
  
  const query = {
    period,
    periodStart,
    periodEnd: { $lte: periodEnd }
  };
  
  if (userId) {
    query.userId = userId;
  } else {
    query.userId = { $exists: false };
  }
  
  let summary = await this.findOne(query);
  
  if (!summary) {
    summary = new this({
      period,
      periodStart,
      periodEnd,
      userId,
      totalSmsSent: 0,
      totalRecipients: 0,
      totalSegments: 0,
      totalRevenue: 0,
      totalProviderCost: 0,
      totalGatewayFees: 0,
      totalProfit: 0
    });
    await summary.save();
  }
  
  return summary;
};

// Static method to update summary with new transaction data
financialSummarySchema.statics.addTransaction = async function(
  period,
  periodStart,
  userId,
  revenue = 0,
  providerCost = 0,
  gatewayFee = 0,
  smsCount = 0,
  recipientsCount = 0,
  segments = 0
) {
  const summary = await this.getOrCreateSummary(period, periodStart, userId);
  
  summary.totalSmsSent += smsCount;
  summary.totalRecipients += recipientsCount;
  summary.totalSegments += segments;
  summary.totalRevenue += revenue;
  summary.totalProviderCost += providerCost;
  summary.totalGatewayFees += gatewayFee;
  summary.totalProfit = summary.totalRevenue - summary.totalProviderCost - summary.totalGatewayFees;
  
  await summary.save();
  
  return summary;
};

// Static method to get summaries for a date range
financialSummarySchema.statics.getSummariesForRange = async function(startDate, endDate, userId = null) {
  const query = {
    periodStart: { $gte: startDate, $lte: endDate }
  };
  
  if (userId) {
    query.userId = userId;
  }
  
  return await this.find(query)
    .sort({ periodStart: -1 })
    .populate('userId', 'name email');
};

// Static method to get monthly summary
financialSummarySchema.statics.getMonthlySummary = async function(year, month, userId = null) {
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59);
  
  const query = {
    period: 'monthly',
    periodStart,
    periodEnd: { $lte: periodEnd }
  };
  
  if (userId) {
    query.userId = userId;
  }
  
  return await this.findOne(query).populate('userId', 'name email');
};

module.exports = mongoose.model('FinancialSummary', financialSummarySchema);
