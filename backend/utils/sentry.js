const Sentry = require('@sentry/node');
try {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.RAILWAY_ENVIRONMENT || 'development',
      integrations: [Sentry.httpIntegration({ tracing: true })],
      tracesSampleRate: 1.0,
    });
  }
} catch (e) {
  console.error('Sentry init failed:', e.message);
}
module.exports = Sentry;
