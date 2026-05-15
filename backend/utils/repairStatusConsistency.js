const mongoose = require('mongoose');
const logger = require('./logger').createTaggedLogger('[StatusRepair]');
const SmsMessage = require('../models/SmsMessage');
const SmsRecipient = require('../models/SmsRecipient');
const SmsCampaign = require('../models/SmsCampaign');

async function repairStatusConsistency() {
  logger.info('Starting status consistency repair...');
  
  const repairLog = {
    smsMessageFixed: 0,
    smsRecipientFixed: 0,
    campaignFixed: 0,
    details: []
  };

  try {
    // === 1. Fix SmsMessage records ===
    
    // a) failed -> sent where jobId exists (provider accepted but status incorrectly set to failed)
    // Exclude dummy jobIds that start with 'failed-' as those indicate actual failures
    const failedWithJobId = await SmsMessage.find({
      status: 'failed',
      jobId: { $ne: null, $not: /^failed-/ }
    });
    
    for (const msg of failedWithJobId) {
      // Only fix if the record appears to never have been updated after creation.
      // This ensures we don't override a legitimate delivery failure that was set via webhook.
      const updateDiffMs = msg.updatedAt - msg.createdAt;
      if (updateDiffMs > 5000) {
        // This record was updated after creation, likely due to a webhook change; skip to avoid corrupting legitimate failures.
        continue;
      }
      
      const oldStatus = msg.status;
      msg.status = 'sent';
      // Clear error fields since it was actually successful
      msg.errorCode = null;
      msg.errorMessage = null;
      await msg.save();
      
      repairLog.smsMessageFixed++;
      repairLog.details.push({
        collection: 'SmsMessage',
        id: msg._id,
        oldStatus,
        newStatus: 'sent',
        reason: 'had jobId but status was failed'
      });
      logger.info('Fixed SmsMessage: failed->sent', {
        messageId: msg._id,
        jobId: msg.jobId,
        phoneNumber: msg.phoneNumber
      });
    }
    
    // b) pending -> queued
    const pendingMessages = await SmsMessage.find({ status: 'pending' });
    for (const msg of pendingMessages) {
      const oldStatus = msg.status;
      msg.status = 'queued';
      await msg.save();
      
      repairLog.smsMessageFixed++;
      repairLog.details.push({
        collection: 'SmsMessage',
        id: msg._id,
        oldStatus,
        newStatus: 'queued',
        reason: 'legacy pending status'
      });
      logger.info('Fixed SmsMessage: pending->queued', {
        messageId: msg._id,
        phoneNumber: msg.phoneNumber
      });
    }
    
    // === 2. Fix SmsRecipient records ===
    
    // Track affected campaigns for later recount
    const affectedCampaignIds = new Set();
    
    // a) failed with providerMessageId but never sent -> sent (provider accepted but status incorrectly set to failed)
    const failedRecipientsWithId = await SmsRecipient.find({
      status: 'failed',
      providerMessageId: { $ne: null },
      sentAt: null // never transitioned to sent
    });
    
    for (const rec of failedRecipientsWithId) {
      const oldStatus = rec.status;
      rec.status = 'sent';
      rec.errorMessage = null;
      await rec.save();
      
      if (rec.campaignId) affectedCampaignIds.add(rec.campaignId.toString());
      
      repairLog.smsRecipientFixed++;
      repairLog.details.push({
        collection: 'SmsRecipient',
        id: rec._id,
        oldStatus,
        newStatus: 'sent',
        reason: 'had providerMessageId but status was failed'
      });
      logger.info('Fixed SmsRecipient: failed->sent', {
        recipientId: rec._id,
        providerMessageId: rec.providerMessageId,
        phoneNumber: rec.phoneNumber,
        campaignId: rec.campaignId
      });
    }
    
    // b) pending -> queued
    const pendingRecipients = await SmsRecipient.find({ status: 'pending' });
    for (const rec of pendingRecipients) {
      const oldStatus = rec.status;
      rec.status = 'queued';
      await rec.save();
      
      if (rec.campaignId) affectedCampaignIds.add(rec.campaignId.toString());
      
      repairLog.smsRecipientFixed++;
      repairLog.details.push({
        collection: 'SmsRecipient',
        id: rec._id,
        oldStatus,
        newStatus: 'queued',
        reason: 'legacy pending status'
      });
      logger.info('Fixed SmsRecipient: pending->queued', {
        recipientId: rec._id,
        phoneNumber: rec.phoneNumber,
        campaignId: rec.campaignId
      });
    }
    
    // === 2a. Recalculate campaign counts for affected campaigns ===
    if (affectedCampaignIds.size > 0) {
      logger.info('Recalculating campaign counts for consistency', {
        affectedCampaignCount: affectedCampaignIds.size
      });
      
      for (const campaignId of affectedCampaignIds) {
        try {
          // Aggregate recipient statuses for this campaign
          const stats = await SmsRecipient.aggregate([
            { $match: { campaignId: new mongoose.Types.ObjectId(campaignId) } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ]);
          
          const statusCounts = {};
          stats.forEach(s => {
            statusCounts[s._id] = s.count;
          });
          
          // Build update object with all canonical count fields
          const updates = {
            queuedCount: statusCounts.queued || 0,
            processingCount: statusCounts.processing || 0,
            sentCount: statusCounts.sent || 0,
            deliveredCount: statusCounts.delivered || 0,
            failedCount: statusCounts.failed || 0,
            cancelledCount: statusCounts.cancelled || 0,
            // Ensure pendingCount is zero (deprecated)
            pendingCount: 0
          };
          
          await SmsCampaign.findByIdAndUpdate(campaignId, updates);
          
          logger.info('Campaign counts recalculated', {
            campaignId,
            ...updates
          });
        } catch (err) {
          logger.error('Error recalculating campaign counts', {
            campaignId,
            error: err.message
          });
        }
      }
    }
    
    // === 3. Fix SmsCampaign records ===
    
    // a) status: completed -> sent
    const completedCampaigns = await SmsCampaign.find({ status: 'completed' });
    for (const camp of completedCampaigns) {
      const oldStatus = camp.status;
      camp.status = 'sent';
      await camp.save();
      
      repairLog.campaignFixed++;
      repairLog.details.push({
        collection: 'SmsCampaign',
        id: camp._id,
        oldStatus,
        newStatus: 'sent',
        reason: 'legacy completed status'
      });
      logger.info('Fixed SmsCampaign: completed->sent', {
        campaignId: camp._id,
        title: camp.title
      });
    }
    
    // b) scheduleStatus fixes: pending->queued, executing->processing, completed->sent
    const scheduleFixMap = {
      'pending': 'queued',
      'executing': 'processing',
      'completed': 'sent'
    };
    
    for (const [oldVal, newVal] of Object.entries(scheduleFixMap)) {
      const campaigns = await SmsCampaign.find({ scheduleStatus: oldVal });
      for (const camp of campaigns) {
        camp.scheduleStatus = newVal;
        await camp.save();
        
        repairLog.campaignFixed++;
        repairLog.details.push({
          collection: 'SmsCampaign',
          id: camp._id,
          field: 'scheduleStatus',
          oldStatus: oldVal,
          newStatus: newVal,
          reason: `legacy scheduleStatus ${oldVal}`
        });
        logger.info('Fixed SmsCampaign scheduleStatus', {
          campaignId: camp._id,
          oldStatus: oldVal,
          newStatus: newVal
        });
      }
    }
    
    // c) Migrate pendingCount field to queuedCount
    const campaignsWithPendingCount = await SmsCampaign.find({ 
      pendingCount: { $exists: true } 
    });
    
    for (const camp of campaignsWithPendingCount) {
      const pendingVal = camp.pendingCount || 0;
      camp.queuedCount = pendingVal;
      // Optionally we could delete pendingCount, but leaving it doesn't hurt
      // delete camp.pendingCount;
      await camp.save();
      
      repairLog.campaignFixed++;
      repairLog.details.push({
        collection: 'SmsCampaign',
        id: camp._id,
        action: 'migrateField',
        from: 'pendingCount',
        to: 'queuedCount',
        value: pendingVal
      });
      logger.info('Migrated pendingCount to queuedCount', {
        campaignId: camp._id,
        pendingCount: pendingVal,
        queuedCount: camp.queuedCount
      });
    }
    
    // === Summary ===
    logger.info('Status repair completed', {
      smsMessageFixed: repairLog.smsMessageFixed,
      smsRecipientFixed: repairLog.smsRecipientFixed,
      campaignFixed: repairLog.campaignFixed,
      totalFixed: repairLog.smsMessageFixed + repairLog.smsRecipientFixed + repairLog.campaignFixed
    });
    
    console.log('\n========== STATUS REPAIR SUMMARY ==========');
    console.log(`SmsMessage records fixed: ${repairLog.smsMessageFixed}`);
    console.log(`SmsRecipient records fixed: ${repairLog.smsRecipientFixed}`);
    console.log(`SmsCampaign records fixed: ${repairLog.campaignFixed}`);
    console.log(`Total records fixed: ${repairLog.smsMessageFixed + repairLog.smsRecipientFixed + repairLog.campaignFixed}`);
    console.log('============================================\n');
    
    return repairLog;
    
  } catch (error) {
    logger.error('Status repair failed with error', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  // Connect to DB
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nedhub-sms';
  
  mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => {
    console.log('[StatusRepair] Connected to MongoDB');
    return repairStatusConsistency();
  })
  .then(() => {
    console.log('[StatusRepair] Done. Closing connection...');
    return mongoose.connection.close();
  })
  .catch(err => {
    console.error('[StatusRepair] Error:', err);
    process.exit(1);
  });
}

module.exports = { repairStatusConsistency };
