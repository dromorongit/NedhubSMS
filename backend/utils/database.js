const mongoose = require('mongoose');
const logger = require('./logger');

// Set strictQuery option to avoid deprecation warning in Mongoose 7
mongoose.set('strictQuery', false);

const connectDB = async (retries = 5, delay = 5000) => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nedhub_bulk_messaging';
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      logger.info('MongoDB connected', { host: conn.connection.host });
      
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

module.exports = {
  connectDB,
  disconnectDB
};