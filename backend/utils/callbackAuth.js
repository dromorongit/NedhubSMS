const crypto = require('crypto');
const logger = require('./logger');

/**
 * Last time a "secret not configured" warning was logged per env var name, so
 * we log at most one warning per hour when a secret is expected but missing.
 */
const lastWarningAt = {};

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Constant-time string comparison to avoid timing side-channels.
 * Returns false (never throws) when the inputs differ in length.
 */
function secretMatches(a, b) {
  if (!a || !b) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (err) {
    // Length mismatch or invalid input - not a match
    return false;
  }
}

/**
 * Log a "secret not configured" warning at most once per hour per env var.
 */
function logSecretMissingOnce(envVarName) {
  const now = Date.now();
  const last = lastWarningAt[envVarName] || 0;
  if (now - last >= ONE_HOUR_MS) {
    lastWarningAt[envVarName] = now;
    logger.warn('[CallbackSecret] Callback secret not configured', {
      envVar: envVarName,
      message: `Accepting callbacks without secret verification. Set ${envVarName} to require a secret in the callback URL or header.`
    });
  }
}

/**
 * Extract the caller-provided secret from a request. Supported locations:
 *   - header `x-callback-secret`
 *   - query parameter `secret` (i.e. part of the callback URL)
 */
function getHubtelCallbackCandidate(req) {
  return req.header('x-callback-secret') || req.query.secret;
}

/**
 * Extract the caller-provided secret from a Nalo request.
 * Supported location: header `x-webhook-secret`.
 */
function getNaloWebhookCandidate(req) {
  return req.header('x-webhook-secret') || req.query.secret || req.query.token;
}

/**
 * Middleware factory for Hubtel callbacks (payment, MoMo, bank, airtime, data,
 * TV, utility).
 *
 * - If HUBTEL_CALLBACK_SECRET is not set: callbacks are accepted as today, with
 *   one warning logged per hour.
 * - If it is set: the secret must match the value sent in the header or the
 *   callback URL query string, compared in constant time.
 * - A missing or wrong secret: logged, answered with HTTP 200, and the request
 *   is NOT processed. The reconcile script picks the transaction up later.
 */
function hubtelCallbackSecret(req, res, next) {
  const secret = process.env.HUBTEL_CALLBACK_SECRET;

  if (!secret) {
    logSecretMissingOnce('HUBTEL_CALLBACK_SECRET');
    return next();
  }

  const candidate = getHubtelCallbackCandidate(req);

  if (!candidate || !secretMatches(candidate, secret)) {
    logger.warn('[CallbackSecret] Rejected Hubtel callback - invalid secret', {
      route: req.originalUrl,
      envVar: 'HUBTEL_CALLBACK_SECRET'
    });
    return res.status(200).json({ received: true });
  }

  next();
}

/**
 * Middleware factory for Nalo callbacks and webhooks (/api/sms/callback,
 * /api/sms/callback/nalo, /api/sms/webhooks/delivery-status).
 *
 * - If NALO_WEBHOOK_SECRET is not set: accepted as today, one warning per hour.
 * - If set: header `x-webhook-secret` must match (constant time).
 * - Missing/wrong secret: logged, HTTP 200, not processed.
 */
function naloWebhookSecret(req, res, next) {
  const secret = process.env.NALO_WEBHOOK_SECRET;

  if (!secret) {
    logSecretMissingOnce('NALO_WEBHOOK_SECRET');
    return next();
  }

  const candidate = getNaloWebhookCandidate(req);

  if (!candidate || !secretMatches(candidate, secret)) {
    logger.warn('[CallbackSecret] Rejected Nalo callback/webhook - invalid secret', {
      route: req.originalUrl,
      envVar: 'NALO_WEBHOOK_SECRET'
    });
    return res.status(200).json({ received: true });
  }

  next();
}

module.exports = {
  hubtelCallbackSecret,
  naloWebhookSecret,
  secretMatches
};
