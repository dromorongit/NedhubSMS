const mongoose = require('mongoose');
const Message = require('../models/Message');
const SmsMessage = require('../models/SmsMessage');
const CostCalculatorService = require('../services/CostCalculatorService');

const costCalculator = new CostCalculatorService();

async function migrateMessages() {
  try {
    console.log('Starting message migration...');

    const legacyMessages = await Message.find({});
    console.log(`Found ${legacyMessages.length} legacy messages to migrate`);

    let migratedCount = 0;
    let errorCount = 0;

    const sellPricePerSms = await costCalculator.getSellPricePerSms();

    for (const legacy of legacyMessages) {
      try {
        const recipients = Array.isArray(legacy.recipients) ? legacy.recipients : [legacy.recipients];

        const statusMap = {
          'pending': 'queued',
          'queued': 'queued',
          'processing': 'processing',
          'sent': 'sent',
          'delivered': 'delivered',
          'failed': 'failed',
          'scheduled': 'scheduled',
          'cancelled': 'cancelled'
        };
        const canonicalStatus = statusMap[legacy.status] || 'queued';

        for (const recipient of recipients) {
          const segmentResult = costCalculator.calculateSegments(legacy.messageBody);
          const segments = segmentResult.segments;
          const providerCostPerSms = costCalculator.getProviderCostPerSms(0);
          const totalChargedToUser = sellPricePerSms * segments;
          const totalCostToProvider = providerCostPerSms * segments;
          const profitAmount = totalChargedToUser - totalCostToProvider;

          const newMessage = new SmsMessage({
            userId: legacy.userId,
            phoneNumber: recipient,
            senderId: legacy.senderId,
            message: legacy.messageBody,
            provider: 'nalo',
            status: canonicalStatus,
            sellPricePerSms,
            providerCostPerSms,
            segments,
            recipientsCount: 1,
            totalChargedToUser,
            totalCostToProvider,
            profitAmount,
            createdAt: legacy.createdAt,
            updatedAt: legacy.createdAt
          });

          await newMessage.save();
        }

        console.log(`Migrated message for ${recipients.length} recipients`);
        migratedCount++;
      } catch (error) {
        console.error(`Error migrating message ${legacy._id}:`, error);
        errorCount++;
      }
    }

    console.log(`Message migration completed: ${migratedCount} migrated, ${errorCount} errors`);
    return { migratedCount, errorCount };
  } catch (error) {
    console.error('Message migration failed:', error);
    throw error;
  }
}

module.exports = { migrateMessages };