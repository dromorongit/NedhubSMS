const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const SenderId = require('../models/SenderId');
const Campaign = require('../models/Campaign');
const Transaction = require('../models/Transaction');
const SmsMessage = require('../models/SmsMessage');
const FinancialSummary = require('../models/FinancialSummary');
const CostCalculatorService = require('../services/CostCalculatorService');
const { logAction } = require('../utils/audit');

const router = express.Router();

// All admin routes require authentication and admin/super_admin role
router.use(authenticate);

// User Management Routes
router.get('/users', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role, status } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (role) query.role = role;
    if (status) query.status = status;

    const users = await User.find(query)
      .select('-password')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.patch('/users/:id/status', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logAction(req.user.id, 'update_user_status', 'user', user._id, { status });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

router.patch('/users/:id/role', authorize(['super_admin']), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logAction(req.user.id, 'update_user_role', 'user', user._id, { role });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Wallet Management Routes
router.get('/wallets', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const query = {};

    if (search) {
      // Search by user email or name
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      query.userId = { $in: users.map(u => u._id) };
    }

    const wallets = await Wallet.find(query)
      .populate('userId', 'name email')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ updatedAt: -1 });

    const total = await Wallet.countDocuments(query);

    res.json({
      wallets,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
});

router.patch('/wallets/:id', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { balance, frozen } = req.body;
    const update = {};

    if (typeof balance === 'number') update.balance = balance;
    if (typeof frozen === 'boolean') update.frozen = frozen;

    const wallet = await Wallet.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    ).populate('userId', 'name email');

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    await logAction(req.user.id, 'update_wallet', 'wallet', wallet._id, update);

    res.json(wallet);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update wallet' });
  }
});

// Sender ID Management Routes
router.get('/sender-ids', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = {};

    if (status) query.status = status;

    const senderIds = await SenderId.find(query)
      .populate('userId', 'name email')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await SenderId.countDocuments(query);

    res.json({
      senderIds,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sender IDs' });
  }
});

router.patch('/sender-ids/:id', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { status, remarks } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const update = { status };
    if (remarks !== undefined) update.remarks = remarks;

    const senderId = await SenderId.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    ).populate('userId', 'name email');

    if (!senderId) {
      return res.status(404).json({ error: 'Sender ID not found' });
    }

    await logAction(req.user.id, 'update_sender_id', 'sender_id', senderId._id, update);

    res.json(senderId);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update sender ID' });
  }
});

// Campaign Management Routes
router.get('/campaigns', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = {};

    if (status) query.status = status;

    const campaigns = await Campaign.find(query)
      .populate('userId', 'name email')
      .populate('templateId', 'name')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Campaign.countDocuments(query);

    res.json({
      campaigns,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// SMS Traffic Monitoring
router.get('/sms-traffic', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const now = new Date();
    let startDate;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    const messages = await Transaction.find({
      createdAt: { $gte: startDate }
    }).populate('userId', 'name email');

    const totalVolume = messages.length;
    const totalCost = messages.reduce((sum, msg) => sum + msg.cost, 0);

    res.json({
      period,
      totalVolume,
      totalCost,
      messages: messages.slice(0, 100) // Last 100 messages
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch SMS traffic' });
  }
});

// ==================== Pricing & Financial Management ====================

// Get current pricing configuration
router.get('/pricing', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const sellPricePerSms = await CostCalculatorService.getSellPricePerSms();
    const providerCostTiers = CostCalculatorService.getProviderCostTiers();
    
    res.json({
      sellPricePerSms,
      providerCostTiers,
      currency: 'GHS'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pricing configuration' });
  }
});

// Update sell price per SMS
router.patch('/pricing/sell-price', authorize(['super_admin']), async (req, res) => {
  try {
    const { sellPricePerSms } = req.body;
    
    if (!sellPricePerSms || typeof sellPricePerSms !== 'number' || sellPricePerSms <= 0) {
      return res.status(400).json({ error: 'Valid sell price per SMS is required' });
    }
    
    CostCalculatorService.setSellPricePerSms(sellPricePerSms);
    
    await logAction(
      req.user.id, 
      'update_sell_price', 
      'system', 
      null, 
      { sellPricePerSms }
    );
    
    res.json({
      success: true,
      sellPricePerSms,
      message: 'Sell price updated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update sell price' });
  }
});

// Update provider cost tier
router.patch('/pricing/provider-cost', authorize(['super_admin']), async (req, res) => {
  try {
    const { tierNumber, cost } = req.body;
    
    if (!tierNumber || !cost || cost <= 0) {
      return res.status(400).json({ error: 'Valid tier number and cost are required' });
    }
    
    CostCalculatorService.updateProviderCostTier(tierNumber, cost);
    
    await logAction(
      req.user.id, 
      'update_provider_cost_tier', 
      'system', 
      null, 
      { tierNumber, cost }
    );
    
    res.json({
      success: true,
      tierNumber,
      cost,
      providerCostTiers: CostCalculatorService.getProviderCostTiers(),
      message: 'Provider cost tier updated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update provider cost tier' });
  }
});

// Get financial summary
router.get('/financials/summary', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { period = 'monthly', year, month } = req.query;
    const now = new Date();
    
    let summary;
    
    if (period === 'today') {
      summary = await CostCalculatorService.getTodayFinancialSummary();
    } else if (period === 'monthly' && year && month) {
      summary = await CostCalculatorService.getMonthlyFinancialSummary(
        parseInt(year), 
        parseInt(month)
      );
    } else {
      // Default to current month
      summary = await CostCalculatorService.getMonthlyFinancialSummary(
        now.getFullYear(), 
        now.getMonth() + 1
      );
    }
    
    res.json({
      period,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch financial summary' });
  }
});

// Get financial summary for a specific user
router.get('/financials/user/:userId', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;
    const now = new Date();
    
    let summary;
    
    if (year && month) {
      summary = await CostCalculatorService.getMonthlyFinancialSummary(
        parseInt(year), 
        parseInt(month),
        userId
      );
    } else {
      summary = await CostCalculatorService.getMonthlyFinancialSummary(
        now.getFullYear(), 
        now.getMonth() + 1,
        userId
      );
    }
    
    res.json({
      userId,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user financial summary' });
  }
});

// Get profit breakdown by period
router.get('/financials/profit', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }
    
    const summary = await CostCalculatorService.calculateFinancialSummary(
      new Date(startDate),
      new Date(endDate)
    );
    
    res.json({
      startDate,
      endDate,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profit breakdown' });
  }
});

// Get provider tier information
router.get('/pricing/tiers', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const tiers = CostCalculatorService.getProviderCostTiers();
    
    res.json({
      tiers
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch provider tiers' });
  }
});

// Get monthly SMS volume for tier calculation
router.get('/sms-volume/monthly', authorize(['admin', 'super_admin']), async (req, res) => {
  try {
    const { userId } = req.query;
    const monthlyVolume = userId 
      ? await CostCalculatorService.getMonthlyVolume(userId)
      : await SmsMessage.countDocuments({
          status: { $in: ['sent', 'delivered'] },
          createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
        });
    
    const currentTier = CostCalculatorService.getCurrentTierInfo(monthlyVolume);
    
    res.json({
      monthlyVolume,
      currentTier,
      currency: 'GHS'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch monthly SMS volume' });
  }
});

module.exports = router;