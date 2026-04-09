const mongoose = require('mongoose');
const logger = require('./logger');

// Set strictQuery option to avoid deprecation warning in Mongoose 7
mongoose.set('strictQuery', false);

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nedhub_bulk_messaging';
    
    const conn = await mongoose.connect(mongoURI);

    logger.info('MongoDB connected', { host: conn.connection.host });
    
    return conn;
  } catch (error) {
    logger.error('MongoDB connection error', { error: error.message });
    process.exit(1);
  }
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