const { verifyToken } = require('../utils/auth');
const { hashApiKey } = require('../utils/apiKeys');
const { auth: authLogger } = require('../utils/logger');
const User = require('../models/User');

const authenticate = (req, res, next) => {
  const apiKeyHeader = req.header('X-API-Key');
  const authHeader = req.header('Authorization');
  const bearerToken = authHeader?.replace('Bearer ', '');
  const token = apiKeyHeader || bearerToken;

  if (!token) {
    authLogger.warn('Authentication failed - no token provided', { 
      hasAuthHeader: !!authHeader,
      authHeaderPreview: authHeader ? authHeader.substring(0, 30) + '...' : 'none'
    });
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
        const user = await User.findOne({
          'apiKeys': {
            $elemMatch: {
              keyHash: hash,
              revoked: false
            }
          }
        });

        if (!user) {
          authLogger.warn('Authentication failed - invalid or revoked API key', {
            tokenPreview: token.substring(0, 20) + '...',
            tokenLength: token.length
          });
          return res.status(401).json({
            success: false,
            message: 'Invalid or revoked API key',
            error: { code: 'INVALID_API_KEY' }
          });
        }

        const matchedKey = user.apiKeys.find(k => k.keyHash === hash && !k.revoked);
        if (!matchedKey) {
          authLogger.warn('Authentication failed - invalid or revoked API key', {
            tokenPreview: token.substring(0, 20) + '...',
            tokenLength: token.length
          });
          return res.status(401).json({
            success: false,
            message: 'Invalid or revoked API key',
            error: { code: 'INVALID_API_KEY' }
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
        next();

        matchedKey.lastUsedAt = new Date();
        user.save().catch(err => {
          authLogger.warn('Failed to update API key lastUsedAt', {
            error: err.message,
            keyId: matchedKey.keyId,
            userId: user._id.toString()
          });
        });
      } catch (error) {
        authLogger.warn('Authentication failed - API key lookup error', { error: error.message });
        return res.status(500).json({
          success: false,
          message: 'Something went wrong!',
          error: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    })();
    return;
  }

  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      authLogger.warn('Authentication failed - invalid token', { 
        tokenPreview: token.substring(0, 20) + '...',
        tokenLength: token.length
      });
      return res.status(401).json({
        success: false,
        message: 'Token is not valid',
        error: { code: 'INVALID_TOKEN' }
      });
    }
    
    authLogger.info('Authentication successful', { userId: decoded.userId, role: decoded.role });
    req.user = decoded;
    next();
  } catch (error) {
    authLogger.warn('Authentication failed - token verification error', { error: error.message });
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