const crypto = require('crypto');

function generateApiKey() {
  const fullKey = 'ndh_live_' + crypto.randomBytes(24).toString('hex');
  const prefix = fullKey.slice(0, 16);
  const hash = crypto.createHash('sha256').update(fullKey).digest('hex');
  return { fullKey, prefix, hash };
}

function hashApiKey(fullKey) {
  return crypto.createHash('sha256').update(fullKey).digest('hex');
}

module.exports = {
  generateApiKey,
  hashApiKey
};
