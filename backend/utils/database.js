const mongoose = require('mongoose');
const logger = require('./logger');

// Set strictQuery option to avoid deprecation warning in Mongoose 7
mongoose.set('strictQuery', false);

const connectDB = async (retries = 3, delay = 1000) => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nedhub_bulk_messaging';
  
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
  await Transaction.init();
};

module.exports = {
  connectDB,
  disconnectDB,
  ensureModelIndexes
};