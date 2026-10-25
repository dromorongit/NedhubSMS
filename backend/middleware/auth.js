const { verifyToken } = require('../utils/auth');
const { hashApiKey } = require('../utils/apiKeys');
const { auth: authLogger } = require('../utils/logger');
const User = require('../models/User');
const RateLimiterService = require('../services/RateLimiterService');

let rateLimiterReady = null;

function isAccountActive(user) {
  if (!user) return false;
  if (user.deletedAt || user.isDeleted || user.deleted) return false;
  if (user.active === false || user.isActive === false) return false;
  if (user.status && user.status !== 'active' && user.status !== 'pending') return false;
  return true;
}

const authenticate = async (req, res, next) => {
  const apiKeyHeader = req.header('X-API-Key');
  const authHeader = req.header('Authorization');
  const bearerToken = authHeader?.replace('Bearer ', '');
  const token = apiKeyHeader || bearerToken;

  if (!token) {
    authLogger.warn('Authentication failed - no token provided');
    return res.status(401).json({
      success: false,
      message: 'No token provided, authorization denied',
      error: { code: 'UNAUTHORIZED' }
    });
  }

  if (token.startsWith('ndh_live_')) {
    (async () => {
      try {
        const hash = hashApiKey(token);
        const user = await User.findOne({ 'apiKeys.keyHash': hash });

        const matchedKey = user ? user.apiKeys.find(k => k.keyHash === hash) : null;

        if (!user || !matchedKey || matchedKey.revoked) {
          authLogger.warn('Authentication failed - invalid or revoked API key');
          return res.status(401).json({
            success: false,
            message: 'Invalid or revoked API key',
            error: { code: 'INVALID_API_KEY' }
          });
        }

        if (matchedKey.expiresAt && new Date(matchedKey.expiresAt) < new Date()) {
          authLogger.warn('Authentication failed - expired API key');
          return res.status(401).json({
            success: false,
            message: 'Invalid or revoked API key',
            error: { code: 'INVALID_API_KEY' }
          });
        }

        if (!isAccountActive(user)) {
          authLogger.warn('Authentication failed - account not active');
          return res.status(401).json({
            success: false,
            message: 'Token is not valid',
            error: { code: 'INVALID_TOKEN' }
          });
        }

        authLogger.info('API key authentication successful', {
          userId: user._id.toString(),
          role: user.role,
          keyId: matchedKey.keyId
        });

        req.user = { userId: user._id.toString(), role: user.role };
        req.authMethod = 'apiKey';
        req.apiKeyId = matchedKey.keyId;

        if (!rateLimiterReady) {
          rateLimiterReady = RateLimiterService.initialize().catch(err => {
            authLogger.warn('RateLimiterService initialization failed, allowing request through', {
              error: err.message
            });
            rateLimiterReady = null;
            return null;
          });
        }

        const initResult = await rateLimiterReady;

        if (initResult !== null) {
          const windowMs = Number(process.env.API_KEY_RATE_LIMIT_WINDOW_MS) || 60000;
          const maxRequests = Number(process.env.API_KEY_RATE_LIMIT_MAX) || 60;
          const limitKey = `apikey:${matchedKey.keyId}`;

          try {
            const result = await RateLimiterService.checkLimit(limitKey, windowMs, maxRequests);

            if (!result.allowed) {
              const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
              res.set('Retry-After', String(retryAfter));
              return res.status(429).json({
                success: false,
                message: 'API key rate limit exceeded',
                error: { code: 'RATE_LIMITED' }
              });
            }
          } catch (error) {
            authLogger.warn('RateLimiterService checkLimit threw unexpectedly, allowing request through', {
              error: error.message,
              keyId: matchedKey.keyId
            });
          }
        }

        next();

        User.findOneAndUpdate(
          { _id: user._id.toString(), 'apiKeys.keyId': matchedKey.keyId },
          { $set: { 'apiKeys.$.lastUsedAt': new Date() } },
          { runValidators: false }
        ).catch(err => {
          authLogger.warn('Failed to update API key lastUsedAt', {
            error: err.message,
            keyId: matchedKey.keyId,
            userId: user._id.toString()
          });
        });
      } catch (error) {
        authLogger.warn('Authentication failed - API key lookup error', { error: error.message });
        return res.status(401).json({
          success: false,
          message: 'Invalid or revoked API key',
          error: { code: 'INVALID_API_KEY' }
        });
      }
    })();
    return;
  }

  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      authLogger.warn('Authentication failed - invalid token');
      return res.status(401).json({
        success: false,
        message: 'Token is not valid',
        error: { code: 'INVALID_TOKEN' }
      });
    }

    const user = await User.findById(decoded.userId).select('_id role status active isActive isDeleted deleted deletedAt passwordChangedAt');

    if (!user || !isAccountActive(user)) {
      authLogger.warn('Authentication failed - user not found or inactive');
      return res.status(401).json({
        success: false,
        message: 'Token is not valid',
        error: { code: 'INVALID_TOKEN' }
      });
    }

    if (user.passwordChangedAt && decoded.iat) {
      const changedAt = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if (decoded.iat < changedAt) {
        authLogger.warn('Authentication failed - token issued before password change');
        return res.status(401).json({
          success: false,
          message: 'Token is not valid',
          error: { code: 'INVALID_TOKEN' }
        });
      }
    }

    req.user = { userId: user._id.toString(), role: user.role };
    req.authMethod = 'jwt';
    next();
  } catch (error) {
    authLogger.warn('Authentication failed - token verification error');
    return res.status(401).json({
      success: false,
      message: 'Token is not valid',
      error: { code: 'INVALID_TOKEN' }
    });
  }
};

const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: { code: 'FORBIDDEN' }
      });
    }
    next();
  };
};

module.exports = {
  authenticate,
  authorize
};
