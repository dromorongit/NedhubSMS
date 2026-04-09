const axios = require('axios');

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
      nextAttemptTime: null
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
        const timestamp = new Date().toISOString();
        console.log(JSON.stringify({
          label: `${this.serviceName.toUpperCase()}_REQUEST`,
          timestamp,
          method: config.method?.toUpperCase(),
          url: config.url,
          timeout: config.timeout
        }, null, 2));
        return config;
      },
      (error) => {
        console.error(JSON.stringify({
          label: `${this.serviceName.toUpperCase()}_REQUEST_ERROR`,
          timestamp: new Date().toISOString(),
          error: error.message
        }, null, 2));
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const timestamp = new Date().toISOString();
        console.log(JSON.stringify({
          label: `${this.serviceName.toUpperCase()}_RESPONSE`,
          timestamp,
          status: response.status,
          duration: response.config.metadata?.startTime ?
            Date.now() - response.config.metadata.startTime : null
        }, null, 2));
        return response;
      },
      (error) => {
        const timestamp = new Date().toISOString();
        console.error(JSON.stringify({
          label: `${this.serviceName.toUpperCase()}_RESPONSE_ERROR`,
          timestamp,
          status: error.response?.status,
          error: error.message,
          duration: error.config?.metadata?.startTime ?
            Date.now() - error.config.metadata.startTime : null
        }, null, 2));
        return Promise.reject(error);
      }
    );
  }

  /**
   * Categorize errors for retry decisions
   */
  categorizeError(error) {
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
   * Check circuit breaker state
   */
  checkCircuitBreaker() {
    const now = Date.now();

    switch (this.circuitBreaker.state) {
      case 'OPEN':
        if (now >= this.circuitBreaker.nextAttemptTime) {
          this.circuitBreaker.state = 'HALF_OPEN';
          console.log(`[CircuitBreaker:${this.serviceName}] State: OPEN -> HALF_OPEN`);
        } else {
          throw new Error('Circuit breaker is OPEN');
        }
        break;

      case 'HALF_OPEN':
        // Allow one request through
        break;

      case 'CLOSED':
        // Allow requests
        break;
    }
  }

  /**
   * Record circuit breaker failure
   */
  recordFailure() {
    const now = Date.now();
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = now;

    // Check if we should open the circuit
    if (this.circuitBreaker.failures >= this.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.nextAttemptTime = now + this.circuitBreaker.recoveryTimeout;
      console.log(`[CircuitBreaker:${this.serviceName}] State: CLOSED -> OPEN (${this.circuitBreaker.failures} failures)`);
    }
  }

  /**
   * Record circuit breaker success
   */
  recordSuccess() {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'CLOSED';
      this.circuitBreaker.failures = 0;
      console.log(`[CircuitBreaker:${this.serviceName}] State: HALF_OPEN -> CLOSED`);
    } else if (this.circuitBreaker.state === 'CLOSED') {
      // Reset failure count on success in closed state
      this.circuitBreaker.failures = 0;
    }
  }

  /**
   * Execute request with retries and circuit breaker
   */
  async executeRequest(config, attempt = 0) {
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
      const category = this.categorizeError(error);

      // Log error details
      console.error(JSON.stringify({
        label: `${this.serviceName.toUpperCase()}_ERROR`,
        timestamp: new Date().toISOString(),
        attempt,
        errorCategory: category,
        status: error.response?.status,
        message: error.message
      }, null, 2));

      // Record failure for circuit breaker
      this.recordFailure();

      // Check if we should retry
      if (attempt < this.retryConfig.maxRetries && this.isRetryable(error)) {
        const delay = this.calculateDelay(attempt);
        console.log(`[${this.serviceName}] Retrying in ${delay}ms (attempt ${attempt + 1}/${this.retryConfig.maxRetries})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeRequest(config, attempt + 1);
      }

      // No more retries or not retryable
      throw error;
    }
  }

  /**
   * GET request
   */
  async get(url, config = {}) {
    return this.executeRequest({ ...config, method: 'get', url });
  }

  /**
   * POST request
   */
  async post(url, data, config = {}) {
    return this.executeRequest({ ...config, method: 'post', url, data });
  }

  /**
   * PUT request
   */
  async put(url, data, config = {}) {
    return this.executeRequest({ ...config, method: 'put', url, data });
  }

  /**
   * DELETE request
   */
  async delete(url, config = {}) {
    return this.executeRequest({ ...config, method: 'delete', url });
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return {
      state: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
      lastFailureTime: this.circuitBreaker.lastFailureTime,
      nextAttemptTime: this.circuitBreaker.nextAttemptTime
    };
  }

  /**
   * Reset circuit breaker (for testing/admin purposes)
   */
  resetCircuitBreaker() {
    this.circuitBreaker.state = 'CLOSED';
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.lastFailureTime = null;
    this.circuitBreaker.nextAttemptTime = null;
    console.log(`[CircuitBreaker:${this.serviceName}] Manually reset to CLOSED`);
  }
}

module.exports = ResilientHttpClient;