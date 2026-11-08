const mongoose = require('mongoose');
const logger = require('./logger');

// Set strictQuery option to avoid deprecation warning in Mongoose 7
mongoose.set('strictQuery', false);

const connectDB = async (retries = 3, delay = 1000) => {
  const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!mongoURI) {
    logger.error('MONGODB_URI is required but not set; skipping database connection');
    return null;
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 3000,
        socketTimeoutMS: 45000,
      });

      logger.info('MongoDB connected', { host: conn.connection.host });

      // Ensure model indexes (e.g. the sparse unique Transaction.reference index)
      // without crashing the server if a build fails (for example existing
      // duplicate references). One clear error is logged and startup continues.
      try {
        await ensureModelIndexes();
      } catch (indexErr) {
        logger.error('Failed to ensure model indexes (continuing without them): ' + indexErr.message);
      }

      return conn;
    } catch (error) {
      logger.error(`MongoDB connection attempt ${attempt}/${retries} failed`, { 
        error: error.message 
      });
      
      if (attempt < retries) {
        logger.info(`Retrying in ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // If all retries fail, don't exit - let the app start anyway
  // The health check will show database as disconnected
  logger.warn('MongoDB connection failed after all retries - continuing without database');
  return null;
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (error) {
    logger.error('MongoDB disconnect error', { error: error.message });
    process.exit(1);
  }
};

/**
 * Build application model indexes. Wrapped by the caller in try/catch so a
 * failed index build (for example duplicate references blocking a unique index)
 * logs one clear error and lets the server keep running.
 */
const ensureModelIndexes = async () => {
  const Transaction = require('../models/Transaction');
  try {
    await Transaction.init();
  } catch (err) {
    // Handle conflicting index definitions (e.g. sparse mismatch on an existing
    // collection) by dropping the stale index and rebuilding it once.
    if (err && /existing index/i.test(err.message || '')) {
      try {
        await Transaction.collection.dropIndex('reference_1');
        logger.warn('Dropped conflicting Transaction.reference index; rebuilding');
      } catch (dropErr) {
        logger.warn('Could not drop conflicting Transaction.reference index: ' + (dropErr && dropErr.message ? dropErr.message : dropErr));
      }
      await Transaction.init();
    } else {
      throw err;
    }
  }
  // Ensure message history indexes (userId + createdAt, userId + status) exist
  // across all three message stores so user-scoped filtered/sorted queries are indexed.
  try {
    const Message = require('../models/Message');
    const SmsMessage = require('../models/SmsMessage');
    const SmsRecipient = require('../models/SmsRecipient');
    await Message.init();
    await SmsMessage.init();
    await SmsRecipient.init();
  } catch (indexErr) {
    logger.error('Failed to ensure message history indexes (continuing without them): ' + indexErr.message);
  }
};

module.exports = {
  connectDB,
  disconnectDB,
  ensureModelIndexes
};