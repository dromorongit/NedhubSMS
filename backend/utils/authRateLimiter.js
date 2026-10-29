const mongoose = require('mongoose');
const logger = require('./logger');

const WINDOW_MS = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5; // 5 attempts per window
const TTL_SECONDS = Math.ceil(WINDOW_MS / 1000) * 2; // keep records longer than the window

const recordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true },
    count: { type: Number, default: 0 },
    windowStart: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + TTL_SECONDS * 1000) }
  },
  { collection: 'authRateLimits' }
);
recordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

let AuthRateLimit;
try {
  AuthRateLimit = mongoose.model('AuthRateLimit');
} catch (e) {
  AuthRateLimit = mongoose.model('AuthRateLimit', recordSchema);
}

// In-memory fallback used when MongoDB is unavailable. It does not survive
// restarts and is not shared across server instances: each instance tracks its
// own attempts, so the effective limit is (max per instance).
const memoryStore = new Map();

function memoryCleanup() {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.expiresAt) {
      memoryStore.delete(key);
    }
  }
}

async function mongoConnected() {
  return mongoose.connection.readyState === 1;
}

// Increments the counter for `key` within the current fixed window and
// returns { count, resetTime }. Starts a new window when the previous one
// expired.
async function increment(key) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const expiresAt = new Date(now + TTL_SECONDS * 1000);
  const resetTime = now + WINDOW_MS;

  if (await mongoConnected()) {
    try {
      // Atomic increment: a single findOneAndUpdate with $inc so concurrent
      // requests cannot both read the same count and both slip through.
      const record = await AuthRateLimit.findOneAndUpdate(
        { key, windowStart: { $gte: windowStart } },
        { $inc: { count: 1 }, $set: { expiresAt } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      if (record && record.windowStart >= windowStart) {
        return {
          count: record.count,
          resetTime: new Date(record.windowStart.getTime() + WINDOW_MS).getTime()
        };
      }
      // Upserted document began a fresh window (windowStart defaults to now).
      return { count: record ? record.count : 1, resetTime };
    } catch (err) {
      logger.warn('[AuthRateLimiter] Mongo increment failed, using in-memory fallback', {
        error: err.message
      });
    }
  }

  memoryCleanup();
  const record = memoryStore.get(key);
  if (record && record.windowStart >= windowStart) {
    record.count += 1;
    record.expiresAt = expiresAt;
    return { count: record.count, resetTime: record.windowStart + WINDOW_MS };
  }
  memoryStore.set(key, { count: 1, windowStart: now, expiresAt });
  return { count: 1, resetTime };
}

async function getCount(key) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  if (await mongoConnected()) {
    try {
      const record = await AuthRateLimit.findOne({ key, windowStart: { $gte: windowStart } });
      return record ? record.count : 0;
    } catch (err) {
      logger.warn('[AuthRateLimiter] Mongo count failed, using in-memory fallback', {
        error: err.message
      });
    }
  }

  memoryCleanup();
  const record = memoryStore.get(key);
  if (!record || record.windowStart < windowStart) return 0;
  return record.count;
}

async function clearKey(key) {
  if (await mongoConnected()) {
    try {
      await AuthRateLimit.deleteOne({ key });
      return;
    } catch (err) {
      logger.warn('[AuthRateLimiter] Mongo clear failed, using in-memory fallback', {
        error: err.message
      });
    }
  }
  memoryStore.delete(key);
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.toLowerCase().trim();
}

// Express middleware: limits each auth route by IP AND by account identifier (email).
// Returns HTTP 429 with a Retry-After header and a generic message when exceeded.
function authRateLimiter(options = {}) {
  const windowMs = options.windowMs || WINDOW_MS;
  const max = options.max !== undefined ? options.max : MAX_ATTEMPTS;

  return async (req, res, next) => {
    console.log('[ARL-MW] entry', req.method, req.originalUrl, 'readyState', mongoose.connection.readyState);
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    console.log('[ARL-MW] readyState', mongoose.connection.readyState, 'email?', !!req.body?.email);
    const email = normalizeEmail(req.body && req.body.email);

    const keys = [`ip:${ip}`];
    if (email) keys.push(`email:${email}`);

    const results = await Promise.all(keys.map((key) => increment(key)));

    const rejected = results.find((result) => result.count > max);
    if (rejected) {
      const retryAfter = Math.ceil((rejected.resetTime - Date.now()) / 1000);
      res.set('Retry-After', String(Math.max(retryAfter, 1)));
      logger.ratelimit.warn('Auth rate limit exceeded', {
        ip,
        email: email ? '[redacted]' : undefined,
        url: req.url,
        method: req.method
      });
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        error: { code: 'RATE_LIMIT_EXCEEDED' }
      });
    }

    next();
  };
}

module.exports = {
  authRateLimiter,
  increment,
  getCount,
  clearKey,
  normalizeEmail,
  WINDOW_MS,
  MAX_ATTEMPTS,
  memoryStore
};
