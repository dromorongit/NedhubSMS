const mongoose = require('mongoose');
const logger = require('./logger');

const FAILURE_THRESHOLD = 10; // failed logins within the window before lockout
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const TTL_SECONDS = Math.ceil(LOCKOUT_WINDOW_MS / 1000) * 2; // keep records longer than the window

const attemptSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now, expires: TTL_SECONDS }
  },
  { collection: 'loginAttempts' }
);
attemptSchema.index({ email: 1, createdAt: -1 });

let LoginAttempt;
try {
  LoginAttempt = mongoose.model('LoginAttempt');
} catch (e) {
  LoginAttempt = mongoose.model('LoginAttempt', attemptSchema);
}

// In-memory fallback used when MongoDB is unavailable. It does not survive
// restarts and is not shared across server instances.
const memoryStore = new Map(); // email => [{ createdAt }]

function memoryCleanup() {
  const now = Date.now();
  const cutoff = now - LOCKOUT_WINDOW_MS;
  for (const [email, attempts] of memoryStore.entries()) {
    const filtered = attempts.filter((a) => a.createdAt > cutoff);
    if (filtered.length === 0) {
      memoryStore.delete(email);
    } else {
      memoryStore.set(email, filtered);
    }
  }
}

async function mongoConnected() {
  return mongoose.connection.readyState === 1;
}

// Records a failed login attempt for `email` (normalized, lower-case).
// Only real accounts should be recorded; callers should verify the user
// exists first so the absence of an account is never revealed.
async function recordFailedAttempt(email) {
  const normalized = email.toLowerCase().trim();
  const now = Date.now();
  const expiresAt = new Date(now + TTL_SECONDS * 1000);

  if (await mongoConnected()) {
    try {
      await LoginAttempt.create({ email: normalized, createdAt: new Date(now) });
      return;
    } catch (err) {
      logger.warn('[AccountLockout] Mongo record failed, using in-memory fallback', {
        error: err.message
      });
    }
  }

  memoryCleanup();
  const attempts = memoryStore.get(normalized) || [];
  attempts.push({ createdAt: now });
  memoryStore.set(normalized, attempts);
}

// Returns { locked: boolean, resetTime: number|null, attempts: number }.
// A locked account must wait `resetTime` before login attempts are allowed again.
// This never reveals whether an account exists: callers must return the same
// generic 'Invalid credentials' response whether or not the account is locked.
async function isAccountLocked(email) {
  const normalized = email.toLowerCase().trim();
  const now = Date.now();
  const windowStart = now - LOCKOUT_WINDOW_MS;

  if (await mongoConnected()) {
    try {
      const attempts = await LoginAttempt.find({
        email: normalized,
        createdAt: { $gte: new Date(windowStart) }
      }).sort({ createdAt: 1 });
      const count = attempts.length;
      if (count >= FAILURE_THRESHOLD && attempts.length > 0) {
        const resetTime = new Date(attempts[0].createdAt.getTime() + LOCKOUT_WINDOW_MS).getTime();
        return { locked: true, resetTime, attempts: count };
      }
      return { locked: false, resetTime: null, attempts: count };
    } catch (err) {
      logger.warn('[AccountLockout] Mongo lockout check failed, using in-memory fallback', {
        error: err.message
      });
    }
  }

  memoryCleanup();
  const attempts = (memoryStore.get(normalized) || []).filter((a) => a.createdAt > windowStart);
  const count = attempts.length;
  if (count >= FAILURE_THRESHOLD && attempts.length > 0) {
    const resetTime = attempts[0].createdAt + LOCKOUT_WINDOW_MS;
    return { locked: true, resetTime, attempts: count };
  }
  return { locked: false, resetTime: null, attempts: count };
}

// Clears all failure records for `email` (e.g. after a successful login).
async function resetAttempts(email) {
  const normalized = email.toLowerCase().trim();
  if (await mongoConnected()) {
    try {
      await LoginAttempt.deleteMany({ email: normalized });
      return;
    } catch (err) {
      logger.warn('[AccountLockout] Mongo reset failed, using in-memory fallback', {
        error: err.message
      });
    }
  }
  memoryStore.delete(normalized);
}

module.exports = {
  recordFailedAttempt,
  isAccountLocked,
  resetAttempts,
  FAILURE_THRESHOLD,
  LOCKOUT_WINDOW_MS
};
