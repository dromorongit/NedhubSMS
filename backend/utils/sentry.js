const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.RAILWAY_ENVIRONMENT || 'development',
  integrations: [
    Sentry.httpIntegration({ tracing: true }),
  ],
  tracesSampleRate: 1.0,
});

module.exports = Sentry;