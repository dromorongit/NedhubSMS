const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const Payment = require('../models/Payment');
const SmsMessage = require('../models/SmsMessage');
const Transaction = require('../models/Transaction');
const WalletService = require('../services/WalletService');
const CallbackVerificationService = require('../services/callbackVerificationService');
const logger = require('../utils/logger');

/**
 * Read the TOPUP_ENABLED kill switch. Defaults to enabled (true). The values
 * false, 0 and off (case-insensitive) disable top-ups.
 */
function isTopupEnabled() {
  const raw = process.env.TOPUP_ENABLED;
  if (raw === undefined || raw === null) return true;
  const v = String(raw).trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

// Get wallet top-up status (kill switch) - authenticated
router.get('/topup-status', authenticate, (req, res) => {
  res.json({ enabled: isTopupEnabled() });
});

// Get wallet balance with SMS balance
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get wallet balance
    let wallet = await Wallet.findByUserId(userId);
    const balance = wallet ? wallet.balance : 0;
    const availableBalance = wallet ? await WalletService.getAvailableBalance(userId) : 0;
    const reservedAmount = balance - availableBalance;
    
    // Get message stats directly from all message collections for accurate counts
    const Message = require('../models/Message');
    const SmsMessage = require('../models/SmsMessage');
    const SmsRecipient = require('../models/SmsRecipient');
    const mongoose = require('mongoose');
    
    // Ensure userId is a proper ObjectId for MongoDB matching
    const userIdObj = new mongoose.Types.ObjectId(userId);
    
    // Aggregate from Message collection - count 'sent' OR 'delivered' as total sent (like history page)
    const messageStats = await Message.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Aggregate from SmsMessage collection - count 'sent' OR 'delivered' as total sent
    const smsMessageStats = await SmsMessage.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Aggregate from SmsRecipient collection
    const recipientStats = await SmsRecipient.aggregate([
      { $match: { userId: userIdObj } },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalDelivered: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] } },
          totalFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      }
    ]);
    
    // Debug: Log the raw aggregation results
    console.log('[Wallet] Message stats:', messageStats);
    console.log('[Wallet] SmsMessage stats:', smsMessageStats);
    console.log('[Wallet] Recipient stats:', recipientStats);
    
    // Combine all sources - sum all values (messages may be in different collections)
    const messageData = messageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    const smsMessageData = smsMessageStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    const recipientData = recipientStats[0] || { totalSent: 0, totalDelivered: 0, totalFailed: 0 };
    
    console.log('[Wallet] Combined data:', { messageData, smsMessageData, recipientData });
    
    // Sum all sources to get total messages
    const totalSent = messageData.totalSent + smsMessageData.totalSent + recipientData.totalSent;
    const totalDelivered = messageData.totalDelivered + smsMessageData.totalDelivered + recipientData.totalDelivered;
    const totalFailed = messageData.totalFailed + smsMessageData.totalFailed + recipientData.totalFailed;
    
    // Calculate delivery rate
    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

    res.json({
      success: true,
      message: 'Wallet balance retrieved successfully',
      data: {
        balance,
        availableBalance,
        smsBalance: availableBalance,
        reservedAmount,
        currency: 'GHS',
        stats: {
          totalSent,
          totalDelivered,
          totalFailed,
          deliveryRate
        }
      }
    });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve wallet balance',
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          details: error.message
        }
      });
    }
});

// Credit wallet (Admin only)
router.post('/topup', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    const adminId = req.user.userId;
    
    // Validate input
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'User ID and positive amount are required',
        error: { code: 'VALIDATION_ERROR' }
      });
    }
    
    await Wallet.credit(userId, amount, description || 'Manual top-up', adminId);
    
    res.json({
      success: true,
      message: 'Wallet credited successfully',
      data: {
        amount,
        userId
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// Get transaction history
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const mongoose = require('mongoose');
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const {
      page = 1, limit = 20, search = '', type = '', status = '',
      range = '', start = '', end = '', sort = 'createdAt', order = 'desc'
    } = req.query;

    const lim = Math.min(parseInt(limit) || 20, 100);
    const pg = Math.max(parseInt(page) || 1, 1);

    const filter = { userId: userIdObj };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (search) {
      const esc = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { description: { $regex: esc, $options: 'i' } },
        { reference: { $regex: esc, $options: 'i' } }
      ];
    }
    // date range
    let startDate, endDate;
    const now = new Date();
    if (range === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 1);
    } else if (range === '7d') {
      startDate = new Date(now); startDate.setDate(startDate.getDate() - 7);
      endDate = new Date(now); endDate.setDate(endDate.getDate() + 1);
    } else if (range === '30d') {
      startDate = new Date(now); startDate.setDate(startDate.getDate() - 30);
      endDate = new Date(now); endDate.setDate(endDate.getDate() + 1);
    } else if (range === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (start || end) {
      if (start) startDate = new Date(start);
      if (end) { endDate = new Date(end); endDate.setDate(endDate.getDate() + 1); }
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = startDate;
      if (endDate) filter.createdAt.$lt = endDate;
    }

    const sortWhitelist = { createdAt: 'createdAt', type: 'type', amount: 'amount', status: 'status' };
    const sortField = sortWhitelist[sort] || 'createdAt';
    const sortDir = order === 'asc' ? 1 : -1;

    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .sort({ [sortField]: sortDir })
      .skip((pg - 1) * lim)
      .limit(lim);

    res.json({
      success: true,
      message: 'Transaction history retrieved successfully',
      data: {
        transactions: transactions.map(tx => ({
          id: tx._id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description,
          reference: tx.reference,
const buckets = require('../utils/transaction-buckets');
// inside transactions map:
          status: buckets.normalizeStatus(tx.status),
          balanceBefore: tx.balanceBefore,
          balanceAfter: tx.balanceAfter,
          createdAt: tx.createdAt
        })),
        pagination: {
          page: pg,
          limit: lim,
          total,
          totalPages: Math.ceil(total / lim)
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to retrieve transactions', error: { code: 'INTERNAL_SERVER_ERROR', details: error.message } });
  }
});

// Stats endpoint
router.get('/transactions/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const mongoose = require('mongoose');
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const { range = '30d', start = '', end = '' } = req.query;
    const now = new Date();
    let startDate, endDate;
    if (range === 'today') { startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); endDate = new Date(startDate); endDate.setDate(endDate.getDate()+1); }
    else if (range === '7d') { startDate = new Date(now); startDate.setDate(startDate.getDate()-7); endDate = new Date(now); endDate.setDate(endDate.getDate()+1); }
    else if (range === '30d') { startDate = new Date(now); startDate.setDate(startDate.getDate()-30); endDate = new Date(now); endDate.setDate(endDate.getDate()+1); }
    else if (range === 'month') { startDate = new Date(now.getFullYear(), now.getMonth(), 1); endDate = new Date(now.getFullYear(), now.getMonth()+1, 1); }
    else if (range === 'all') { startDate = null; endDate = null; }
    else if (start || end) { if (start) startDate = new Date(start); if (end) { endDate = new Date(end); endDate.setDate(endDate.getDate()+1); } }

    const match = { userId: userIdObj };
    if (startDate || endDate) { match.createdAt = {}; if (startDate) match.createdAt.$gte = startDate; if (endDate) match.createdAt.$lt = endDate; }

    const agg = await Transaction.aggregate([
      { $match: match },
      { $group: { _id: null, totalSpent: { $sum: { $cond: [{ $eq: ['$type','debit'] }, '$amount', 0] } }, totalReceived: { $sum: { $cond: [{ $eq: ['$type','credit'] }, '$amount', 0] } }, count: { $sum: 1 } } }
    ]);
    const r = agg[0] || { totalSpent: 0, totalReceived: 0, count: 0 };

    // series per day
    const bucketFmt = range === 'all' ? '%Y-%m' : '%Y-%m-%d';
    const seriesAgg = await Transaction.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: bucketFmt, date: '$createdAt' } }, spent: { $sum: { $cond: [{ $eq: ['$type','debit'] }, '$amount', 0] } }, received: { $sum: { $cond: [{ $eq: ['$type','credit'] }, '$amount', 0] } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    const series = { spent: seriesAgg.map(x=>({x:x._id,y:x.spent})), received: seriesAgg.map(x=>({x:x._id,y:x.received})), count: seriesAgg.map(x=>({x:x._id,y:x.count})) };

    // previous period
    let prevStart, prevEnd;
    if (range !== 'all' && startDate) {
      const dur = (endDate || now) - startDate;
      prevEnd = new Date(startDate);
      prevStart = new Date(startDate.getTime() - dur);
    }
    let prevMatch = null;
    if (prevStart) { prevMatch = { userId: userIdObj, createdAt: { $gte: prevStart, $lt: prevEnd } }; }
    let prev = { totalSpent:0,totalReceived:0,count:0 };
    if (prevMatch) {
      const pagg = await Transaction.aggregate([{ $match: prevMatch },{ $group: { _id:null, totalSpent:{ $sum:{ $cond:[{ $eq:['$type','debit']},'$amount',0]} }, totalReceived:{ $sum:{ $cond:[{ $eq:['$type','credit']},'$amount',0]} }, count:{ $sum:1 } } }]);
      prev = pagg[0] || prev;
    }
    res.json({ success: true, data: { totalSpent: r.totalSpent, totalReceived: r.totalReceived, count: r.count, previous: prev, series } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to retrieve stats' });
  }
});


// Reconcile pending top-up payments for the calling user (last 24h, max 10)
router.post('/reconcile', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const verificationService = new CallbackVerificationService();

    const pendingPayments = await Payment.find({
      userId,
      status: { $in: ['pending', 'processing'] },
      createdAt: { $gte: cutoff }
    })
      .sort({ createdAt: -1 })
      .limit(10);

    let credited = 0;
    for (const payment of pendingPayments) {
      try {
        const result = await verificationService.processPaymentCallback(payment.clientReference);
        if (result && result.action === 'credit' && result.applied) {
          credited += 1;
        }
      } catch (err) {
        logger.warn('[Wallet] Reconcile payment failed', { clientReference: payment.clientReference, error: err.message });
      }
    }

    res.json({
      success: true,
      data: {
        checked: pendingPayments.length,
        credited
      }
    });
  } catch (error) {
    logger.error('[Wallet] Reconcile error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to reconcile payments' });
  }
});

module.exports = router;
