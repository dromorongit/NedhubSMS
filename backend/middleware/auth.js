const { verifyToken } = require('../utils/auth');
const { auth: authLogger } = require('../utils/logger');

const authenticate = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
   
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