const IORedis = require('ioredis');

class RateLimiterService {
  constructor() {
    this.redis = null;
    this.isInitialized = false;
  }

  /**
   * Initialize Redis connection for rate limiting
   */
  async initialize(redisConnection = null) {
    if (this.isInitialized) return;

    try {
      this.isSharedConnection = !!redisConnection;
      if (redisConnection) {
        // Use existing Redis connection (e.g., from SmsJobQueueService)
        this.redis = redisConnection;
      } else {
        // Create new Redis connection
        this.redis = new IORedis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          db: parseInt(process.env.REDIS_DB) || 0,
          username: process.env.REDIS_USERNAME || undefined,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        });
      }

      if (!redisConnection) {
        await this.redis.connect();
      }

      this.isInitialized = true;
      console.log('[RateLimiterService] Initialized successfully');
    } catch (error) {
      console.error('[RateLimiterService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Check if request is within rate limits using sliding window algorithm
   * @param {string} key - Unique identifier (e.g., email, IP)
   * @param {number} windowMs - Window size in milliseconds
   * @param {number} maxRequests - Maximum requests allowed in the window
   * @returns {Promise<{allowed: boolean, remaining: number, resetTime: number}>}
   */
  async checkLimit(key, windowMs, maxRequests) {
    if (!this.isInitialized) {
      throw new Error('RateLimiterService not initialized');
    }

    const now = Date.now();
    const windowStart = now - windowMs;
    const zsetKey = `ratelimit:${key}`;

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Remove old entries outside the sliding window
      pipeline.zremrangebyscore(zsetKey, '-inf', windowStart);

      // Count remaining entries in the window
      pipeline.zcard(zsetKey);

      // Add current request timestamp
      pipeline.zadd(zsetKey, now, `${now}:${Math.random()}`);

      // Set expiration on the key (cleanup old keys)
      pipeline.pexpire(zsetKey, windowMs * 2); // Keep key alive longer than window for cleanup

      const results = await pipeline.exec();

      if (!results || results.length < 3) {
        throw new Error('Pipeline execution failed');
      }

      const count = results[1][1]; // zcard result
      const isAllowed = count < maxRequests;

      // Calculate remaining requests and reset time
      const remaining = Math.max(0, maxRequests - count);
      const resetTime = now + windowMs;

      return {
        allowed: isAllowed,
        remaining: remaining,
        resetTime: resetTime
      };
    } catch (error) {
      console.error('[RateLimiterService] Error checking rate limit:', error);
      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: now + windowMs
      };
    }
  }

  /**
   * Get current rate limit status for a key
   * @param {string} key - Unique identifier
   * @param {number} windowMs - Window size in milliseconds
   * @param {number} maxRequests - Maximum requests allowed
   * @returns {Promise<{count: number, resetTime: number, remaining: number}>}
   */
  async getStatus(key, windowMs, maxRequests) {
    if (!this.isInitialized) {
      throw new Error('RateLimiterService not initialized');
    }

    const now = Date.now();
    const windowStart = now - windowMs;
    const zsetKey = `ratelimit:${key}`;

    try {
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(zsetKey, '-inf', windowStart);
      pipeline.zcard(zsetKey);

      const results = await pipeline.exec();
      const count = results[1][1] || 0;

      return {
        count: count,
        resetTime: now + windowMs,
        remaining: Math.max(0, maxRequests - count)
      };
    } catch (error) {
      console.error('[RateLimiterService] Error getting status:', error);
      return {
        count: 0,
        resetTime: now + windowMs,
        remaining: maxRequests
      };
    }
  }

  /**
   * Clear rate limit data for a key
   * @param {string} key - Unique identifier
   */
  async clear(key) {
    if (!this.isInitialized) return;

    try {
      await this.redis.del(`ratelimit:${key}`);
    } catch (error) {
      console.error('[RateLimiterService] Error clearing rate limit:', error);
    }
  }

  /**
   * Express middleware for rate limiting
   * @param {Object} options - Configuration options
   * @param {Function} keyGenerator - Function to generate the rate limit key
   * @param {number} windowMs - Window size in milliseconds
   * @param {number} maxRequests - Maximum requests allowed
   * @param {string} message - Error message for rate limit exceeded
   */
  middleware(options = {}) {
    const {
      keyGenerator = (req) => req.ip,
      windowMs = 15 * 60 * 1000, // 15 minutes
      maxRequests = 100,
      message = 'Too many requests, please try again later.',
      skipSuccessfulRequests = false,
      skipFailedRequests = false,
    } = options;

    return async (req, res, next) => {
      try {
        const key = keyGenerator(req);

        if (!key) {
          return next();
        }

        const result = await this.checkLimit(key, windowMs, maxRequests);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': result.remaining,
          'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000),
        });

        if (!result.allowed) {
          const resetInSeconds = Math.ceil((result.resetTime - Date.now()) / 1000);

          return res.status(429).json({
            error: message,
            retryAfter: resetInSeconds,
            resetTime: new Date(result.resetTime).toISOString()
          });
        }

        // Add success/failure handlers if configured
        if (skipSuccessfulRequests || skipFailedRequests) {
          const originalJson = res.json;
          const originalStatus = res.status;

          res.json = function(data) {
            // Check if response indicates success or failure
            const isSuccess = res.statusCode < 400;

            if ((skipSuccessfulRequests && isSuccess) || (skipFailedRequests && !isSuccess)) {
              // Don't count this request
              return originalJson.call(this, data);
            }

            return originalJson.call(this, data);
          };

          res.status = function(code) {
            // Track status for json method
            res.statusCode = code;
            return originalStatus.call(this, code);
          };
        }

        next();
      } catch (error) {
        console.error('[RateLimiterService] Middleware error:', error);
        // Fail open
        next();
      }
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    if (this.redis && !this.isSharedConnection) {
      this.redis.disconnect();
    }
    this.isInitialized = false;
  }
}

module.exports = new RateLimiterService();