const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { auth: authLogger } = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your_very_secure_jwt_secret_here';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Log JWT configuration at startup (without exposing the secret)
authLogger.info('JWT configuration loaded', { 
  hasCustomSecret: !!process.env.JWT_SECRET,
  expiresIn: JWT_EXPIRES_IN,
  nodeEnv: process.env.NODE_ENV
});

// Generate JWT token
const generateToken = (userId, role) => {
  const token = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  // Decode token to log expiration and issued time
  const decoded = jwt.decode(token);
  authLogger.info('JWT token generated', { 
    userId, 
    role, 
    expiresIn: JWT_EXPIRES_IN,
    iat: decoded?.iat,
    exp: decoded?.exp,
    serverTime: new Date().toISOString()
  });
  return token;
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    authLogger.info('JWT token verified successfully', { 
      userId: decoded.userId, 
      role: decoded.role,
      exp: decoded.exp,
      iat: decoded.iat,
      serverTime: new Date().toISOString(),
      serverTimeUnix: Math.floor(Date.now() / 1000)
    });
    return decoded;
  } catch (error) {
    // Try to decode without verification to see token contents for debugging
    let decoded = null;
    try {
      decoded = jwt.decode(token);
    } catch (e) {
      // ignore
    }
    authLogger.warn('JWT token verification failed', { 
      error: error.message,
      tokenPreview: token ? token.substring(0, 20) + '...' : 'null',
      exp: decoded?.exp,
      iat: decoded?.iat,
      serverTime: new Date().toISOString(),
      serverTimeUnix: Math.floor(Date.now() / 1000)
    });
    return null;
  }
};

// Hash password
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

// Compare password
const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

module.exports = {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword
};