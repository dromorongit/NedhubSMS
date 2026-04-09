const mongoose = require('mongoose');
const SmsCampaign = require('../models/SmsCampaign');
const SmsJobQueueService = require('../services/SmsJobQueueService');

async function migrateSmsCampaigns() {
  console.log('[MigrateSmsCampaigns] Starting migration of existing scheduled campaigns to BullMQ...');

  try {
    // Connect to database if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('[MigrateSmsCampaigns] Connected to MongoDB');
    }

    // Initialize the queue service
    await SmsJobQueueService.initialize();

    // Find all scheduled campaigns that are in the future
    const scheduledCampaigns = await SmsCampaign.find({
      status: 'scheduled',
      scheduledAt: { $gt: new Date() },
      jobId: { $exists: false } // Only migrate those without jobId
    });

    console.log(`[MigrateSmsCampaigns] Found ${scheduledCampaigns.length} campaigns to migrate`);

    let migratedCount = 0;
    let failedCount = 0;

    for (const campaign of scheduledCampaigns) {
      try {
        console.log(`[MigrateSmsCampaigns] Migrating campaign: ${campaign.title} (${campaign._id})`);

        // Add scheduled job
        const job = await SmsJobQueueService.addScheduledJob(campaign._id, campaign.scheduledAt);

        // Update campaign with jobId
        campaign.jobId = job.id;
        await campaign.save();

        console.log(`[MigrateSmsCampaigns] Successfully migrated campaign ${campaign._id} with job ID ${job.id}`);
        migratedCount++;

      } catch (error) {
        console.error(`[MigrateSmsCampaigns] Failed to migrate campaign ${campaign._id}:`, error);
        failedCount++;
      }
    }

    // Handle campaigns that are past due (should have been sent but weren't due to old system)
    const pastDueCampaigns = await SmsCampaign.find({
      status: 'scheduled',
      scheduledAt: { $lte: new Date() },
      jobId: { $exists: false }
    });

    console.log(`[MigrateSmsCampaigns] Found ${pastDueCampaigns.length} past-due campaigns`);

    for (const campaign of pastDueCampaigns) {
      try {
        console.log(`[MigrateSmsCampaigns] Processing past-due campaign: ${campaign.title} (${campaign._id})`);

        // Add immediate job for past-due campaigns
        const job = await SmsJobQueueService.addImmediateJob(campaign._id);

        // Update campaign with jobId
        campaign.jobId = job.id;
        await campaign.save();

        console.log(`[MigrateSmsCampaigns] Queued past-due campaign ${campaign._id} for immediate processing`);
        migratedCount++;

      } catch (error) {
        console.error(`[MigrateSmsCampaigns] Failed to queue past-due campaign ${campaign._id}:`, error);
        failedCount++;
      }
    }

    console.log(`[MigrateSmsCampaigns] Migration completed: ${migratedCount} migrated, ${failedCount} failed`);

    // Graceful shutdown
    await SmsJobQueueService.shutdown();

    return {
      success: true,
      migrated: migratedCount,
      failed: failedCount
    };

  } catch (error) {
    console.error('[MigrateSmsCampaigns] Migration failed:', error);
    throw error;
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  require('dotenv').config();

  migrateSmsCampaigns()
    .then((result) => {
      console.log('[MigrateSmsCampaigns] Migration result:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('[MigrateSmsCampaigns] Migration error:', error);
      process.exit(1);
    });
}

module.exports = migrateSmsCampaigns;