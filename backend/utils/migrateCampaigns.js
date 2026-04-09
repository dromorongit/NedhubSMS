const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const SmsCampaign = require('../models/SmsCampaign');
const SmsRecipient = require('../models/SmsRecipient');
const Template = require('../models/Template');

async function migrateCampaigns() {
  try {
    console.log('Starting campaign migration...');

    // Get all legacy campaigns
    const legacyCampaigns = await Campaign.find({}).populate('templateId');
    console.log(`Found ${legacyCampaigns.length} legacy campaigns to migrate`);

    let migratedCount = 0;
    let errorCount = 0;

    for (const legacy of legacyCampaigns) {
      try {
        // Determine message body
        let messageBody = legacy.customMessage;
        if (legacy.templateId && legacy.templateId.content) {
          messageBody = legacy.templateId.content;
        }

        // Map status
        const statusMap = {
          'draft': 'draft',
          'scheduled': 'scheduled',
          'sent': 'sent',
          'failed': 'failed'
        };

        // Create new SmsCampaign
        const newCampaign = new SmsCampaign({
          userId: legacy.userId,
          title: legacy.name,
          senderId: legacy.senderId,
          messageBody: messageBody || '',
          sendMode: legacy.scheduledAt ? 'scheduled' : 'immediate',
          scheduledAt: legacy.scheduledAt,
          status: statusMap[legacy.status] || 'draft',
          recipientCount: legacy.recipients ? legacy.recipients.length : 0,
          createdAt: legacy.createdAt,
          updatedAt: legacy.updatedAt
        });

        await newCampaign.save();

        // Create SmsRecipient for each recipient
        if (legacy.recipients && Array.isArray(legacy.recipients)) {
          const recipients = [];
          for (const phoneNumber of legacy.recipients) {
            const recipient = new SmsRecipient({
              campaignId: newCampaign._id,
              userId: legacy.userId,
              recipientName: phoneNumber, // Use phone number as name for now
              phoneNumber: phoneNumber,
              personalizedMessage: messageBody || '',
              status: statusMap[legacy.status] === 'sent' ? 'sent' : 'pending',
              sentAt: legacy.sentAt,
              createdAt: legacy.createdAt,
              updatedAt: legacy.updatedAt
            });
            recipients.push(recipient.save());
          }
          await Promise.all(recipients);
        }

        console.log(`Migrated campaign: ${legacy.name} (${legacy.recipients ? legacy.recipients.length : 0} recipients)`);
        migratedCount++;
      } catch (error) {
        console.error(`Error migrating campaign ${legacy._id}:`, error);
        errorCount++;
      }
    }

    console.log(`Campaign migration completed: ${migratedCount} migrated, ${errorCount} errors`);
    return { migratedCount, errorCount };
  } catch (error) {
    console.error('Campaign migration failed:', error);
    throw error;
  }
}

module.exports = { migrateCampaigns };