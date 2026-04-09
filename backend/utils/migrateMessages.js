const mongoose = require('mongoose');
const Message = require('../models/Message');
const SmsMessage = require('../models/SmsMessage');
const { calculateSMSCost } = require('./billing');

async function migrateMessages() {
  try {
    console.log('Starting message migration...');

    // Get all legacy messages
    const legacyMessages = await Message.find({});
    console.log(`Found ${legacyMessages.length} legacy messages to migrate`);

    let migratedCount = 0;
    let errorCount = 0;

    for (const legacy of legacyMessages) {
      try {
        // Legacy messages have recipients as array, but typically one recipient
        const recipients = Array.isArray(legacy.recipients) ? legacy.recipients : [legacy.recipients];

        // Create SmsMessage for each recipient
        for (const recipient of recipients) {
          const segments = Math.ceil(legacy.messageBody.length / 160);
          const sellPricePerSms = 0.095;
          const providerCostPerSms = 0.082;
          const totalChargedToUser = sellPricePerSms * segments;
          const totalCostToProvider = providerCostPerSms * segments;
          const profitAmount = totalChargedToUser - totalCostToProvider;

          const newMessage = new SmsMessage({
            userId: legacy.userId,
            msisdn: recipient,
            senderId: legacy.senderId,
            message: legacy.messageBody,
            provider: 'nalo',
            status: legacy.status,
            sellPricePerSms,
            providerCostPerSms,
            segments,
            recipientsCount: 1,
            totalChargedToUser,
            totalCostToProvider,
            profitAmount,
            createdAt: legacy.createdAt,
            updatedAt: legacy.createdAt // No updatedAt in legacy
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