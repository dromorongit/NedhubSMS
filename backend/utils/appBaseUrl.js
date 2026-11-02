const logger = require('./logger');

const DEFAULT_APP_BASE_URL = 'https://app.nedhubgh.com';

/**
 * Single source of truth for the public frontend base URL.
 * Reads APP_BASE_URL (expected https://app.nedhubgh.com), strips a trailing
 * slash, validates https in production, and falls back to the app domain when
 * unset in production so checkout redirects never break. Never derived from
 * the request host or the Railway domain.
 */
function getAppBaseUrl() {
  const raw = process.env.APP_BASE_URL;
  if (!raw || !String(raw).trim()) {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      try { logger.warn('[AppBaseUrl] APP_BASE_URL is not set; using default https://app.nedhubgh.com'); } catch (e) { console.warn('[AppBaseUrl] APP_BASE_URL is not set; using default https://app.nedhubgh.com'); }
      return DEFAULT_APP_BASE_URL;
    }
    try { logger.error('[AppBaseUrl] APP_BASE_URL is not set'); } catch (e) { console.error('[AppBaseUrl] APP_BASE_URL is not set'); }
    return '';
  }
  const url = String(raw).trim().replace(/\/+$/, '');
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !/^https:\/\//i.test(url)) {
    try { logger.error('[AppBaseUrl] APP_BASE_URL must be https in production', { value: url }); } catch (e) { console.error('[AppBaseUrl] APP_BASE_URL must be https in production'); }
  }
  return url;
}

module.exports = getAppBaseUrl;
module.exports.getAppBaseUrl = getAppBaseUrl;
module.exports.default = getAppBaseUrl;
