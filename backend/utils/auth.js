const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { auth: authLogger } = require('../utils/logger');

const PLACEHOLDER_SECRETS = new Set([
  'your-secret-key',
  'your_jwt_secret_here',
  'your_very_secure_jwt_secret_here',
  'your_jwt_secret_key_here_change_this_in_production',
  'secret',
  'changeme',
  'change-me',
  'password',
  'jwt_secret',
  'your_256_bit_secure_random_jwt_secret_here_change_in_production'
]);

const JWT_SECRET = process.env.JWT_SECRET;

function validateJwtSecret(secret) {
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  if (PLACEHOLDER_SECRETS.has(String(secret).toLowerCase().trim())) {
    throw new Error('JWT_SECRET must not be a known placeholder');
  }
}

try {
  validateJwtSecret(JWT_SECRET);
} catch (err) {
  console.error('JWT_SECRET validation failed: ' + err.message);
  throw err;
}

const JWT_EXPIRES_IN = '24h';

// Generate JWT token
const generateToken = (userId, role) => {
  const token = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
  return token;
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return decoded;
  } catch (error) {
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
  comparePassword,
  validateJwtSecret
};
