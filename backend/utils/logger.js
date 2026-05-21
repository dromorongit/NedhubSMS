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
  VALIDATION: '[Validation]',
  MESSAGESTATUS: '[MessageStatus]',
  DELIVERYWEBHOOK: '[DeliveryWebhook]',
  MESSAGEHISTORY: '[MessageHistory]',
  STATUSMAPPING: '[StatusMapping]',
  RESENDLOGIC: '[ResendLogic]',
  STATUSREPAIR: '[StatusRepair]',
  HUBTEL_REQUEST: '[HubtelRequest]',
  HUBTEL_RESPONSE: '[HubtelResponse]',
  HUBTEL_TIMEOUT: '[HubtelTimeout]',
  HUBTEL_CALLBACK: '[HubtelCallback]',
  TRANSACTION_LIFECYCLE: '[TransactionLifecycle]',
  PROVIDER_PROMISE: '[ProviderPromise]',
  PROVIDER_CATCH: '[ProviderCatch]',
  POLLING: '[Polling]',
  AIRTIME_EXECUTION: '[AirtimeExecution]',
  DATA_EXECUTION: '[DataExecution]'
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

// Add tagged loggers as properties on the logger instance
logger.tags = LogTags;
logger.api = createTaggedLogger(LogTags.API);
logger.ratelimit = createTaggedLogger(LogTags.RATELIMIT);
logger.responseParser = createTaggedLogger(LogTags.RESPONSEPARSER);
logger.smsSend = createTaggedLogger(LogTags.SMSSEND);
logger.backendError = createTaggedLogger(LogTags.BACKENDERROR);
logger.auth = createTaggedLogger(LogTags.AUTH);
logger.campaign = createTaggedLogger(LogTags.CAMPAIGN);
logger.wallet = createTaggedLogger(LogTags.WALLET);
logger.schedule = createTaggedLogger(LogTags.SCHEDULE);
logger.retry = createTaggedLogger(LogTags.RETRY);
logger.webhook = createTaggedLogger(LogTags.WEBHOOK);
logger.bullmq = createTaggedLogger(LogTags.BULLMQ);
logger.validation = createTaggedLogger(LogTags.VALIDATION);
logger.messageStatus = createTaggedLogger(LogTags.MESSAGESTATUS);
logger.deliveryWebhook = createTaggedLogger(LogTags.DELIVERYWEBHOOK);
logger.messageHistory = createTaggedLogger(LogTags.MESSAGEHISTORY);
logger.statusMapping = createTaggedLogger(LogTags.STATUSMAPPING);
logger.resendLogic = createTaggedLogger(LogTags.RESENDLOGIC);
logger.statusRepair = createTaggedLogger(LogTags.STATUSREPAIR);
logger.hubtelRequest = createTaggedLogger(LogTags.HUBTEL_REQUEST);
logger.hubtelResponse = createTaggedLogger(LogTags.HUBTEL_RESPONSE);
logger.hubtelTimeout = createTaggedLogger(LogTags.HUBTEL_TIMEOUT);
logger.hubtelCallback = createTaggedLogger(LogTags.HUBTEL_CALLBACK);
logger.transactionLifecycle = createTaggedLogger(LogTags.TRANSACTION_LIFECYCLE);
logger.providerPromise = createTaggedLogger(LogTags.PROVIDER_PROMISE);
logger.providerCatch = createTaggedLogger(LogTags.PROVIDER_CATCH);
logger.polling = createTaggedLogger(LogTags.POLLING);
logger.airtimeExecution = createTaggedLogger(LogTags.AIRTIME_EXECUTION);
logger.dataExecution = createTaggedLogger(LogTags.DATA_EXECUTION);

module.exports = logger;