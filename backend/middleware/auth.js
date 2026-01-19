const { verifyToken } = require('../utils/auth');

const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided, authorization denied' });
  }
  
  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Token is not valid' });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};

const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};

module.exports = {
  authenticate,
  authorize
};