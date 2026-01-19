const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const SenderId = require('../models/SenderId');
const Campaign = require('../models/Campaign');
const Transaction = require('../models/Transaction');
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

module.exports = router;