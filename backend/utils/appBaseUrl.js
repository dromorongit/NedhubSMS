const logger = require('./logger');

const DEFAULT_APP_BASE_URL = 'https://app.nedhubgh.com';

function normalizeOrigin(origin) {
  if (!origin) return '';
  return String(origin).trim().replace(/\/+$/, '');
}

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_APP_ORIGINS;
  const list = (raw || DEFAULT_APP_BASE_URL)
    .split(',')
    .map((s) => String(s).trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return list.length ? list : [DEFAULT_APP_BASE_URL];
}

function getPrimaryAppOrigin() {
  return getAllowedOrigins()[0];
}

function isAllowedOrigin(origin) {
  return getAllowedOrigins().includes(normalizeOrigin(origin));
}

/**
 * Single source of truth for the public frontend base URL.
 * Returns the primary origin (first entry of ALLOWED_APP_ORIGINS, default
 * https://app.nedhubgh.com). APP_BASE_URL is honored ONLY when it is present
 * in ALLOWED_APP_ORIGINS; otherwise a warning is logged and the primary
 * origin is used. Never derived from the request host or the Railway domain.
 */
function getAppBaseUrl() {
  const raw = process.env.APP_BASE_URL;
  if (raw && String(raw).trim()) {
    const url = normalizeOrigin(raw);
    if (getAllowedOrigins().includes(url)) {
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd && !/^https:\/\//i.test(url)) {
        try { logger.error('[AppBaseUrl] APP_BASE_URL must be https in production', { value: url }); } catch (e) { console.error('[AppBaseUrl] APP_BASE_URL must be https in production'); }
      }
      return url;
    }
    try { logger.warn('[AppBaseUrl] APP_BASE_URL not in ALLOWED_APP_ORIGINS; using primary origin', { value: url }); } catch (e) { console.warn('[AppBaseUrl] APP_BASE_URL not in ALLOWED_APP_ORIGINS; using primary origin'); }
  }
  return getPrimaryAppOrigin();
}

module.exports = { getAppBaseUrl, getPrimaryAppOrigin, isAllowedOrigin, getAllowedOrigins, normalizeOrigin };
module.exports.getAppBaseUrl = getAppBaseUrl;
module.exports.getPrimaryAppOrigin = getPrimaryAppOrigin;
module.exports.isAllowedOrigin = isAllowedOrigin;
module.exports.getAllowedOrigins = getAllowedOrigins;
module.exports.default = getAppBaseUrl;
