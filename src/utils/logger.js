// Frontend structured logger with consistent prefixes

const LogPrefix = {
  UPLOAD: '[Upload]',
  PREVIEW: '[Preview]',
  IMPORT: '[Import]',
  CONTACTS: '[Contacts]',
  RECIPIENTS: '[Recipients]',
  VALIDATION: '[Validation]',
  SEND: '[Send]',
  API: '[API]',
  UI: '[UI]',
  SENDERID: '[SenderID]'
};

class Logger {
  constructor(prefix) { this.prefix = prefix; }
  log(msg, data) { console.log(this.prefix, new Date().toISOString(), '-', msg, data || ''); }
  warn(msg, data) { console.warn(this.prefix, new Date().toISOString(), '- WARNING:', msg, data || ''); }
  error(msg, data) { console.error(this.prefix, new Date().toISOString(), '- ERROR:', msg, data || ''); }
  info(msg, data) { console.info(this.prefix, new Date().toISOString(), '- INFO:', msg, data || ''); }
}

window.loggers = {
  upload: new Logger(LogPrefix.UPLOAD),
  preview: new Logger(LogPrefix.PREVIEW),
  import: new Logger(LogPrefix.IMPORT),
  contacts: new Logger(LogPrefix.CONTACTS),
  recipients: new Logger(LogPrefix.RECIPIENTS),
  validation: new Logger(LogPrefix.VALIDATION),
  send: new Logger(LogPrefix.SEND),
  api: new Logger(LogPrefix.API),
  ui: new Logger(LogPrefix.UI),
  senderId: new Logger(LogPrefix.SENDERID)
};
window.LogPrefix = LogPrefix;