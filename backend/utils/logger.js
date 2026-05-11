const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log tags/prefixes
const LogTags = {
  API: '[API]',
  RATELIMIT: '[RateLimit]',
  RESPONSEPARSER: '[ResponseParser]',
  SMSSEND: '[SmsSend]',
  BACKENDERROR: '[BackendError]',
  AUTH: '[Auth]',
  CAMPAIGN: '[Campaign]',
  WALLET: '[Wallet]',
  SCHEDULE: '[Schedule]',
  RETRY: '[Retry]',
  WEBHOOK: '[Webhook]',
  BULLMQ: '[BullMQ]',
  VALIDATION: '[Validation]'
};

// Custom format to add tag
const withTag = winston.format((info) => {
  if (info.tag) {
    info.message = `${info.tag} ${info.message}`;
  }
  return info;
});

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  withTag(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log')
    })
  ]
});

// Railway log aggregation - ensure JSON format for structured parsing
if (process.env.RAILWAY_ENVIRONMENT) {
  logger.add(new winston.transports.Console({
    format: logFormat
  }));
}

// Helper functions for tagged logging
const createTaggedLogger = (tag) => {
  return {
    info: (msg, meta = {}) => logger.info(msg, { ...meta, tag }),
    warn: (msg, meta = {}) => logger.warn(msg, { ...meta, tag }),
    error: (msg, meta = {}) => logger.error(msg, { ...meta, tag }),
    debug: (msg, meta = {}) => logger.debug(msg, { ...meta, tag }),
    log: (level, msg, meta = {}) => logger.log(level, msg, { ...meta, tag })
  };
};

module.exports = {
  ...logger,
  tags: LogTags,
  api: createTaggedLogger(LogTags.API),
  ratelimit: createTaggedLogger(LogTags.RATELIMIT),
  responseParser: createTaggedLogger(LogTags.RESPONSEPARSER),
  smsSend: createTaggedLogger(LogTags.SMSSEND),
  backendError: createTaggedLogger(LogTags.BACKENDERROR),
  auth: createTaggedLogger(LogTags.AUTH),
  campaign: createTaggedLogger(LogTags.CAMPAIGN),
  wallet: createTaggedLogger(LogTags.WALLET),
  schedule: createTaggedLogger(LogTags.SCHEDULE),
  retry: createTaggedLogger(LogTags.RETRY),
  webhook: createTaggedLogger(LogTags.WEBHOOK),
  bullmq: createTaggedLogger(LogTags.BULLMQ),
  validation: createTaggedLogger(LogTags.VALIDATION)
};