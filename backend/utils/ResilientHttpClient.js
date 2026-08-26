const axios = require('axios');
const logger = require('./logger');

/**
 * ResilientHttpClient - Enhanced HTTP client with resilience patterns
 * Features: retries with exponential backoff, circuit breaker, error categorization
 */
class ResilientHttpClient {
  constructor(options = {}) {
    this.serviceName = options.serviceName || 'unknown';
    this.baseURL = options.baseURL || '';
    this.timeout = options.timeout || 30000;
    this.retryConfig = {
      maxRetries: options.maxRetries || 3,
      baseDelay: options.baseDelay || 1000,
      maxDelay: options.maxDelay || 10000,
      backoffMultiplier: options.backoffMultiplier || 2,
      ...options.retryConfig
    };

    // Circuit breaker configuration
    this.circuitBreaker = {
      failureThreshold: options.failureThreshold || 5,
      recoveryTimeout: options.recoveryTimeout || 30000,
      monitoringPeriod: options.monitoringPeriod || 60000,
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      failures: 0,
      lastFailureTime: null,
      nextAttemptTime: null,
      inFlight: false
    };

    // Create axios instance
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      validateStatus: (status) => status < 500 // Don't throw on 4xx, handle in interceptors
    });

    // Add request/response interceptors
    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for logging and error handling
   */
  setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`${this.serviceName.toUpperCase()}_REQUEST`, {
          method: config.method?.toUpperCase(),
          url: config.url,
          timeout: config.timeout
        });
        return config;
      },
      (error) => {
        logger.error(`${this.serviceName.toUpperCase()}_REQUEST_ERROR`, {
          error: error.message
        });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`${this.serviceName.toUpperCase()}_RESPONSE`, {
          status: response.status,
          duration: response.config.metadata?.startTime ?
            Date.now() - response.config.metadata.startTime : null
        });
        return response;
      },
      (error) => {
        logger.error(`${this.serviceName.toUpperCase()}_RESPONSE_ERROR`, {
          status: error.response?.status,
          error: error.message,
          duration: error.config?.metadata?.startTime ?
            Date.now() - error.config.metadata.startTime : null
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Categorize errors for retry decisions
   * Categories: transient, rate_limited, permanent, recipient_error, sender_id_error, account_error, unknown
   */
  categorizeError(error) {
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
    if (isTimeout) {
      logger.debug('HubtelTimeout', {
        service: this.serviceName,
        error: error.message,
        code: error.code,
        url: error.config?.url
      });
    }

    if (!error.response) {
      // Network errors, timeouts
      return 'transient';
    }

    const status = error.response.status;

    if (status >= 500) {
      return 'transient';
    }

    if (status === 429) {
      return 'rate_limited';
    }

    if (status >= 400 && status < 500) {
      // Check response body for provider-specific error codes
      const body = error.response.data;
      if (body && typeof body === 'object') {
        const errorCode = String(body.status || body.error_code || '');
        
        // Recipient-specific errors - should not trip global breaker
        if (['1706', '1027'].includes(errorCode)) {
          return 'recipient_error';
        }
        
        // Sender-ID-specific errors - should not trip global breaker
        if (['1707'].includes(errorCode)) {
          return 'sender_id_error';
        }
        
        // Account/provider configuration errors - should trip breaker
        if (['1704', '1705', '1703', '1025'].includes(errorCode)) {
          return 'account_error';
        }
      }
      
      return 'permanent';
    }

    return 'unknown';
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error) {
    const category = this.categorizeError(error);
    return category === 'transient' || category === 'rate_limited';
  }

  /**
   * Calculate delay for retry with exponential backoff and jitter
   */
  calculateDelay(attempt) {
    const baseDelay = this.retryConfig.baseDelay;
    const multiplier = Math.pow(this.retryConfig.backoffMultiplier, attempt);
    const delay = Math.min(baseDelay * multiplier, this.retryConfig.maxDelay);

    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(100, delay + jitter);
  }

  /**
   * Check if a failure category should count toward the circuit breaker
   */
  shouldCountForBreaker(category) {
    return ['transient', 'rate_limited', 'system'].includes(category);
  }

  /**
   * Check circuit breaker state and transition if needed
   * @throws {Error} 'Circuit breaker is OPEN' if state is OPEN and recovery timeout not expired
   * @throws {Error} 'Circuit breaker is HALF_OPEN (probe in progress)' if HALF_OPEN and request already in flight
   */
  checkCircuitBreaker() {
    const now = Date.now();

    // Reset stale failures outside the monitoring period when CLOSED
    if (this.circuitBreaker.state === 'CLOSED' &&
        this.circuitBreaker.lastFailureTime &&
        (now - this.circuitBreaker.lastFailureTime > this.circuitBreaker.monitoringPeriod)) {
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.lastFailureTime = null;
      logger.debug(`[CircuitBreaker:${this.serviceName}] Stale failures cleared`);
    }

    switch (this.circuitBreaker.state) {
      case 'OPEN':
        if (now >= this.circuitBreaker.nextAttemptTime) {
          this.circuitBreaker.state = 'HALF_OPEN';
          this.circuitBreaker.inFlight = false;
          logger.debug(`[CircuitBreaker:${this.serviceName}] State: OPEN -> HALF_OPEN`);
        } else {
          const waitMs = this.circuitBreaker.nextAttemptTime - now;
          logger.debug(`[CircuitBreaker:${this.serviceName}] Request rejected - state=OPEN, nextAttemptIn=${waitMs}ms`);
          throw new Error('Circuit breaker is OPEN');
        }
        break;

      case 'HALF_OPEN':
        // Allow only one request through at a time for probe
        if (this.circuitBreaker.inFlight) {
          logger.debug(`[CircuitBreaker:${this.serviceName}] Request rejected - state=HALF_OPEN, probe in progress`);
          throw new Error('Circuit breaker is HALF_OPEN (probe in progress)');
        }
        this.circuitBreaker.inFlight = true;
        logger.debug(`[CircuitBreaker:${this.serviceName}] State: HALF_OPEN - probe request allowed`);
        break;

      case 'CLOSED':
        // Allow requests
        break;
    }
  }

  /**
   * Report a failure from external (non-HTTP) source, e.g., Nalo application-level error.
   * Only counts if category should trip the breaker.
   * @param {string} category - Failure category
   */
  reportExternalFailure(category = 'default') {
    if (!this.shouldCountForBreaker(category)) {
      logger.debug(`[CircuitBreaker:${this.serviceName}] External failure not counted for breaker (category=${category})`);
      return;
    }

    const now = Date.now();
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = now;

    logger.debug(`[CircuitBreaker:${this.serviceName}] External failure recorded (category=${category}, count=${this.circuitBreaker.failures}/${this.circuitBreaker.failureThreshold})`);

    if (this.circuitBreaker.failures >= this.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.nextAttemptTime = now + this.circuitBreaker.recoveryTimeout;
      this.circuitBreaker.inFlight = false;
      logger.debug(`[CircuitBreaker:${this.serviceName}] State: CLOSED -> OPEN (${this.circuitBreaker.failures} failures)`);
    }
  }

  /**
   * Record circuit breaker failure from HTTP request
   */
  recordFailure(category = 'default') {
    const now = Date.now();
    
    // Only count failures that should trip the breaker
    if (!this.shouldCountForBreaker(category)) {
      logger.debug(`[CircuitBreaker:${this.serviceName}] Failure not counted for breaker (category=${category})`);
      return;
    }

    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = now;

    logger.debug(`[CircuitBreaker:${this.serviceName}] Failure recorded (category=${category}, count=${this.circuitBreaker.failures}/${this.circuitBreaker.failureThreshold})`);

    // Check if we should open the circuit
    if (this.circuitBreaker.failures >= this.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.nextAttemptTime = now + this.circuitBreaker.recoveryTimeout;
      this.circuitBreaker.inFlight = false;
      logger.debug(`[CircuitBreaker:${this.serviceName}] State: CLOSED -> OPEN (${this.circuitBreaker.failures} failures)`);
    }
  }

  /**
   * Record circuit breaker success
   */
  recordSuccess() {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'CLOSED';
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.lastFailureTime = null;
      this.circuitBreaker.inFlight = false;
      logger.debug(`[CircuitBreaker:${this.serviceName}] State: HALF_OPEN -> CLOSED`);
    } else if (this.circuitBreaker.state === 'CLOSED') {
      // Reset failure count on success in closed state
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.lastFailureTime = null;
    }
  }

  /**
   * Revert a failure recording (used when error is categorized as non-breaking)
   */
  revertFailure() {
    if (this.circuitBreaker.failures > 0) {
      this.circuitBreaker.failures--;
    }
  }

  /**
   * Execute request with retries and circuit breaker
   */
  async executeRequest(config, attempt = 0, failureCategory = 'default') {
    // Check circuit breaker
    this.checkCircuitBreaker();

    try {
      // Add metadata for timing
      config.metadata = { startTime: Date.now(), attempt };

      const response = await this.client.request(config);

      // Record success
      this.recordSuccess();

      return response;

    } catch (error) {
      const category = failureCategory !== 'default' ? failureCategory : this.categorizeError(error);

      // Log error details
      logger.error(`${this.serviceName.toUpperCase()}_ERROR`, {
        attempt,
        errorCategory: category,
        status: error.response?.status,
        message: error.message
      });

      // Record failure for circuit breaker (category-aware)
      this.recordFailure(category);

      // Check if we should retry
      if (attempt < this.retryConfig.maxRetries && this.isRetryable(error)) {
        const delay = this.calculateDelay(attempt);
        logger.debug(`[${this.serviceName}] Retrying in ${delay}ms (attempt ${attempt + 1}/${this.retryConfig.maxRetries})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeRequest(config, attempt + 1, category);
      }

      // No more retries or not retryable
      throw error;
    }
  }

  /**
   * GET request
   */
  async get(url, config = {}, failureCategory = 'default') {
    return this.executeRequest({ ...config, method: 'get', url }, 0, failureCategory);
  }

  /**
   * POST request
   */
  async post(url, data, config = {}, failureCategory = 'default') {
    return this.executeRequest({ ...config, method: 'post', url, data }, 0, failureCategory);
  }

  /**
   * PUT request
   */
  async put(url, data, config = {}, failureCategory = 'default') {
    return this.executeRequest({ ...config, method: 'put', url, data }, 0, failureCategory);
  }

  /**
   * DELETE request
   */
  async delete(url, config = {}, failureCategory = 'default') {
    return this.executeRequest({ ...config, method: 'delete', url }, 0, failureCategory);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return {
      state: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
      lastFailureTime: this.circuitBreaker.lastFailureTime,
      nextAttemptTime: this.circuitBreaker.nextAttemptTime,
      inFlight: this.circuitBreaker.inFlight
    };
  }

  /**
   * Reset circuit breaker (for testing/admin purposes only)
   * NOT intended for pre-campaign resets
   */
  resetCircuitBreaker() {
    this.circuitBreaker.state = 'CLOSED';
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.lastFailureTime = null;
    this.circuitBreaker.nextAttemptTime = null;
    this.circuitBreaker.inFlight = false;
    logger.debug(`[CircuitBreaker:${this.serviceName}] Manually reset to CLOSED`);
  }
}

module.exports = ResilientHttpClient;
