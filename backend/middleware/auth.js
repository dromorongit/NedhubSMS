const { verifyToken } = require('../utils/auth');

const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
   
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token provided, authorization denied',
      error: { code: 'UNAUTHORIZED' }
    });
  }
   
  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid',
        error: { code: 'INVALID_TOKEN' }
      });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
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