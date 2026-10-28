const crypto = require('crypto');
const logger = require('./logger');

/**
 * Last time a "secret not configured" warning was logged per env var name, so
 * we log at most one warning per hour when a secret is expected but missing.
 */
const lastWarningAt = {};

/**
 * Last time a "callback rejected by secret check" warning was logged per route
 * path, so we log at most one warning per route per minute when a callback
 * fails the secret check (missing or wrong secret). The path only (no query,
 * no body) is recorded.
 */
const lastRejectionWarningAt = {};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

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
 * Log a "callback rejected by secret check" warning at most once per route per
 * minute. Only the route path is logged (no query string, no body) so a
 * mistyped secret is visible without leaking callback parameters.
 */
function logRejectionWarningOnce(routePath) {
  const now = Date.now();
  const last = lastRejectionWarningAt[routePath] || 0;
  if (now - last >= ONE_MINUTE_MS) {
    lastRejectionWarningAt[routePath] = now;
    logger.warn('callback rejected by secret check', { route: routePath });
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
 * Supported locations: header `x-webhook-secret`, query `secret`, query `token`.
 */
function getNaloWebhookCandidate(req) {
  return req.header('x-webhook-secret') || req.query.secret || req.query.token;
}

/**
 * Callback and webhook routes whose query string (e.g. ?secret=) must never be
 * written to logs or error payloads.
 */
const CALLBACK_ROUTES = [
  '/api/payments/hubtel/callback',
  '/api/hubtel/momo-callback',
  '/api/hubtel/bank-callback',
  '/api/hubtel/airtime-callback',
  '/api/hubtel/data-callback',
  '/api/hubtel/tv-callback',
  '/api/hubtel/utility-callback',
  '/api/sms/callback',
  '/api/sms/callback/nalo',
  '/api/sms/webhooks/delivery-status'
];

/**
 * True when the request targets a callback/webhook route.
 */
function isCallbackRoute(req) {
  const base = req.baseUrl || '';
  const path = req.path || '';
  const full = (base + path).replace(/\/+$/, '');
  return CALLBACK_ROUTES.includes(full);
}

/**
 * Return the request path without the query string, safe to log for any route
 * (never leaks ?secret=).
 */
function callbackPath(req) {
  return req.path || '';
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
    logRejectionWarningOnce(callbackPath(req));
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
    logRejectionWarningOnce(callbackPath(req));
    return res.status(200).json({ received: true });
  }

  next();
}

module.exports = {
  hubtelCallbackSecret,
  naloWebhookSecret,
  secretMatches,
  isCallbackRoute,
  callbackPath,
  CALLBACK_ROUTES
};
