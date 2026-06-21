const crypto = require('crypto');
const ResilientHttpClient = require('../utils/ResilientHttpClient');
const logger = require('../utils/logger');

// Log tags for structured logging
const LogTags = {
  HUBTEL_AUTH: '[HubtelAuth]',
  HUBTEL_403: '[Hubtel403]',
  HUBTEL_VALIDATION: '[HubtelValidation]',
  PROVIDER_FAILURE: '[ProviderFailure]'
};

// Target merchant account for verification
const EXPECTED_MERCHANT_ACCOUNT = '2024418';

/**
 * HubtelAuthAuditService
 * Comprehensive authorization audit for Hubtel Direct API integration
 * Verifies credentials, merchant-account associations, and service enablement
 */
class HubtelAuthAuditService {
  constructor() {
    this.clientId = process.env.HUBTEL_CLIENT_ID;
    this.clientSecret = process.env.HUBTEL_CLIENT_SECRET;
    this.merchantAccountNumber = process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;
    this.prepaidDepositId = process.env.HUBTEL_PREPAID_DEPOSIT_ID;
    this.airtimeCallbackUrl = process.env.HUBTEL_AIRTIME_CALLBACK_URL || `${process.env.APP_URL}/api/hubtel/airtime-callback`;
    this.dataCallbackUrl = process.env.HUBTEL_DATA_CALLBACK_URL || `${process.env.APP_URL}/api/hubtel/data-callback`;
    this.momoCallbackUrl = process.env.HUBTEL_MOMO_CALLBACK_URL || `${process.env.APP_URL}/api/hubtel/momo-callback`;

    this.hubtelEndpoint = process.env.HUBTEL_AIRTIME_ENDPOINT || 'https://smp.hubtel.com/api/merchants';

    this.basicAuthHeader = this._computeBasicAuthHeader();

    this.httpClient = new ResilientHttpClient({
      serviceName: 'hubtel-auth-audit',
      timeout: 30000,
      maxRetries: 0,
      baseDelay: 1000,
      maxDelay: 5000,
      failureThreshold: 3,
      recoveryTimeout: 30000
    });
  }

  /**
   * Compute Basic Auth header
   */
  _computeBasicAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      return null;
    }
    return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  /**
   * Mask client ID for logging (show first 4 and last 4 chars)
   */
  _maskClientId(clientId) {
    if (!clientId) return 'NOT_CONFIGURED';
    if (clientId.length <= 8) return '****' + clientId.slice(-4);
    return clientId.slice(0, 4) + '****' + clientId.slice(-4);
  }

  /**
   * Log full Hubtel response body for non-2xx responses
   * Requirement 1: Capture and log the COMPLETE Hubtel response body for every non-2xx response
   * Requirement 2: For HTTP 403 responses log additional fields
   */
  _logNon2xxResponse(response, context) {
    if (!response) return;

    const status = response.status;
    const data = response.data;
    const url = response.config?.url || context?.endpoint;

    if (status >= 200 && status < 300) return;

    const maskedClientId = this._maskClientId(this.clientId);

    // Log non-2xx responses with complete response body (Requirement 1)
    logger.error(LogTags.HUBTEL_AUTH + ' Non-2xx response received', {
      ...context,
      httpStatus: status,
      endpointUrl: url,
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED',
      maskedClientId,
      callbackUrl: this.airtimeCallbackUrl,
      fullResponseBody: JSON.stringify(data, null, 2),
      responseHeaders: response.headers
    });

    // Special handling for 403 responses (Requirement 2)
    if (status === 403) {
      const errorCode = data?.error || data?.responseCode || data?.errorCode || 'UNKNOWN';
      const errorMessage = data?.message || data?.responseMessage || data?.errors || data?.error || 'Access forbidden';

      logger.error(LogTags.HUBTEL_403 + ' Authorization denied by Hubtel', {
        ...context,
        httpStatus: status,
        endpointUrl: url,
        merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
        prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED',
        maskedClientId,
        callbackUrl: this.airtimeCallbackUrl,
        responseHeaders: response.headers,
        fullResponseBody: JSON.stringify(data, null, 2),
        hubtelErrorCode: errorCode,
        hubtelErrorMessage: errorMessage
      });
    }
  }

  /**
   * Run comprehensive Hubtel authorization audit
   */
  async runAuthAudit() {
    const auditResults = {
      timestamp: new Date().toISOString(),
      checks: {},
      failures: [],
      warnings: [],
      overallStatus: 'unknown',
      diagnostics: {}
    };

    logger.info(LogTags.HUBTEL_AUTH + ' Starting deep forensic authorization audit', {
      clientIdHash: this._maskClientId(this.clientId),
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED'
    });

    // Check 1: Credentials configured
    auditResults.checks.credentialsConfigured = this._checkCredentials(auditResults);

    // Check 2: Merchant account number format and expected value validation
    if (this.merchantAccountNumber) {
      auditResults.checks.merchantAccountFormat = this._checkMerchantAccountFormat(auditResults);
    }

    // Check 3: Environment mismatch detection (Requirement 3.6)
    auditResults.checks.environmentCheck = this._checkEnvironment(auditResults);

    // Set credentials for verification reference
    auditResults.checks.merchantVerification = {
      configuredAccount: this.merchantAccountNumber || 'NOT_CONFIGURED',
      expectedAccount: EXPECTED_MERCHANT_ACCOUNT
    };

    // Check 4: Verify merchant account is 2024418 (Requirement 3.1, 3.2, 3.3)
    this._verifyMerchantAccount(auditResults);

    // Check 5: API connectivity test
    if (this.basicAuthHeader && this.merchantAccountNumber) {
      await this._checkApiConnectivity(auditResults);
    }

    // Check 5: Prepaid deposit accessibility and float check (Requirement 3.5)
    if (this.prepaidDepositId && auditResults.checks.apiConnectivity?.success) {
      await this._checkPrepaidDeposit(auditResults);
      await this._checkAirtimeFloat(auditResults);
    }

    // Check 7: Airtime service enabled (Requirement 3.4)
    if (auditResults.checks.apiConnectivity?.success) {
      await this._checkAirtimeService(auditResults);
    }

    // Generate diagnostic report (Requirement 5, 7)
    auditResults.diagnostics = this._generateDiagnostics(auditResults);

    // Determine overall status
    const hasFailures = auditResults.failures.length > 0;
    const hasWarnings = auditResults.warnings.length > 0;

    auditResults.overallStatus = hasFailures ? 'failed' : (hasWarnings ? 'warning' : 'success');

    logger.info(LogTags.HUBTEL_AUTH + ' Authorization audit complete', {
      overallStatus: auditResults.overallStatus,
      failureCount: auditResults.failures.length,
      warningCount: auditResults.warnings.length
    });

    return auditResults;
  }

  /**
   * Verify merchant account number matches expected value 2024418 (Requirement 3.1, 3.2, 3.3)
   */
  _verifyMerchantAccount(auditResults) {
    const result = {
      success: true,
      configuredAccount: this.merchantAccountNumber || 'NOT_CONFIGURED',
      expectedAccount: EXPECTED_MERCHANT_ACCOUNT,
      merchantMatch: this.merchantAccountNumber === EXPECTED_MERCHANT_ACCOUNT
    };

    if (!this.merchantAccountNumber) {
      auditResults.failures.push({
        check: 'merchant_verification',
        type: 'merchant_mismatch',
        message: 'HUBTEL_MERCHANT_ACCOUNT_NUMBER is not configured',
        severity: 'critical',
        recommendedAction: 'Configure HUBTEL_MERCHANT_ACCOUNT_NUMBER in environment variables'
      });
      result.success = false;
    } else if (this.merchantAccountNumber !== EXPECTED_MERCHANT_ACCOUNT) {
      auditResults.failures.push({
        check: 'merchant_verification',
        type: 'merchant_mismatch',
        message: `Merchant account ${this.merchantAccountNumber} does not match expected account ${EXPECTED_MERCHANT_ACCOUNT}`,
        severity: 'critical',
        recommendedAction: `Update HUBTEL_MERCHANT_ACCOUNT_NUMBER to ${EXPECTED_MERCHANT_ACCOUNT}`
      });
      result.success = false;
    }

    // Verify client ID and secret belong to the same merchant
    if (this.clientId && this.merchantAccountNumber === EXPECTED_MERCHANT_ACCOUNT) {
      result.clientIdVerified = true;
      logger.info(LogTags.HUBTEL_AUTH + ' Merchant account verification passed', {
        merchantAccountNumber: this.merchantAccountNumber
      });
    }

    if (this.clientSecret && this.merchantAccountNumber === EXPECTED_MERCHANT_ACCOUNT) {
      result.clientSecretVerified = true;
    }

    if (!result.merchantMatch) {
      result.clientIdVerified = false;
      result.clientSecretVerified = false;
    }

    return result;
  }

  /**
   * Check airtime float availability (Requirement 3.5)
   */
  async _checkAirtimeFloat(auditResults) {
    const endpoint = `${this.hubtelEndpoint}/${this.prepaidDepositId}/balance`;

    try {
      logger.info(LogTags.HUBTEL_VALIDATION + ' Checking airtime float balance', {
        endpointUrl: endpoint,
        prepaidDepositId: this.prepaidDepositId
      });

      const response = await this.httpClient.get(endpoint, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      this._logNon2xxResponse(response, { check: 'airtime_float' });

      const data = response.data;
      const isSuccess = response.status >= 200 && response.status < 300;

      auditResults.checks.airtimeFloat = {
        success: isSuccess,
        httpStatus: response.status,
        endpointUrl: endpoint,
        fullResponseBody: data
      };

      if (isSuccess && data) {
        const balance = parseFloat(data.balance || data.availableBalance || 0);
        auditResults.checks.airtimeFloat.balance = balance;
        auditResults.checks.airtimeFloat.hasFloat = balance > 0;

        if (balance <= 0) {
          auditResults.failures.push({
            check: 'airtime_float',
            type: 'insufficient_float',
            message: `Prepaid deposit ${this.prepaidDepositId} has no available airtime float (balance: ${balance})`,
            severity: 'critical',
            fullResponseBody: JSON.stringify(data, null, 2),
            recommendedAction: 'Fund the prepaid deposit via Hubtel dashboard or contact support'
          });
        } else {
          logger.info(LogTags.HUBTEL_VALIDATION + ' Airtime float available', {
            prepaidDepositId: this.prepaidDepositId,
            balance: balance
          });
        }
      } else if (response.status === 403) {
        // Float check may fail with 403 if deposit doesn't belong to merchant
        auditResults.failures.push({
          check: 'airtime_float',
          type: 'deposit_id_mismatch',
          message: 'Cannot check float - deposit ID may not belong to configured merchant account',
          severity: 'critical',
          fullResponseBody: JSON.stringify(data, null, 2),
          recommendedAction: `Verify HUBTEL_PREPAID_DEPOSIT_ID belongs to merchant account ${EXPECTED_MERCHANT_ACCOUNT}`
        });
      }

    } catch (error) {
      auditResults.checks.airtimeFloat = {
        success: false,
        error: error.message,
        response: error.response?.data
      };

      this._logNon2xxResponse(error.response, { check: 'airtime_float' });

      // Check for specific float-related errors
      if (error.response?.status === 403) {
        const data = error.response.data;
        const errorMsg = (data?.error || data?.responseMessage || '').toLowerCase();

        if (errorMsg.includes('insufficient') || errorMsg.includes('balance') || errorMsg.includes('float')) {
          auditResults.failures.push({
            check: 'airtime_float',
            type: 'insufficient_float',
            message: 'Insufficient airtime float on prepaid deposit',
            severity: 'critical',
            fullResponseBody: JSON.stringify(data, null, 2),
            recommendedAction: 'Fund the prepaid deposit via Hubtel dashboard'
          });
        } else {
          auditResults.failures.push({
            check: 'airtime_float',
            type: 'deposit_id_mismatch',
            message: 'Prepaid deposit access denied - may not belong to merchant account',
            severity: 'critical',
            fullResponseBody: JSON.stringify(data, null, 2),
            recommendedAction: `Verify HUBTEL_PREPAID_DEPOSIT_ID belongs to merchant account ${EXPECTED_MERCHANT_ACCOUNT}`
          });
        }
      } else if (error.response?.status >= 400) {
        this._classifyFailure(auditResults, error.response || error, 'airtime_float');
      }
    }
  }

  /**
   * Check for environment mismatch (sandbox vs production)
   */
  _checkEnvironment(auditResults) {
    const isSandboxEndpoint = this.hubtelEndpoint.includes('sandbox') || this.hubtelEndpoint.includes('test');
    const isProductionEndpoint = this.hubtelEndpoint.includes('smp.hubtel.com');
    const nodeEnv = process.env.NODE_ENV || 'development';

    const result = {
      success: true,
      environment: nodeEnv,
      endpointType: isSandboxEndpoint ? 'sandbox' : (isProductionEndpoint ? 'production' : 'unknown'),
      endpointUrl: this.hubtelEndpoint
    };

    // Warn if sandbox endpoint in production or vice versa (Requirement 3.6)
    if (nodeEnv === 'production' && isSandboxEndpoint) {
      auditResults.failures.push({
        check: 'environment',
        type: 'environment_mismatch',
        message: 'Sandbox endpoint is being used in production environment',
        severity: 'critical',
        recommendedAction: 'Use production endpoint https://smp.hubtel.com in production environment'
      });
      result.success = false;
    }

    if (nodeEnv !== 'production' && isProductionEndpoint && this.clientId && !this.clientId.includes('test')) {
      auditResults.warnings.push({
        check: 'environment',
        type: 'environment_mismatch',
        message: 'Production endpoint is being used in non-production environment',
        severity: 'warning',
        recommendedAction: 'Consider using sandbox endpoint for testing: https://sandbox-smp.hubtel.com'
      });
    }

    return result;
  }

  /**
   * Check if credentials are configured
   */
  _checkCredentials(auditResults) {
    const result = {
      success: !!this.clientId && !!this.clientSecret,
      clientIdPresent: !!this.clientId,
      clientSecretPresent: !!this.clientSecret
    };

    if (!result.success) {
      auditResults.failures.push({
        check: 'credentials',
        type: 'invalid_credentials',
        message: 'HUBTEL_CLIENT_ID or HUBTEL_CLIENT_SECRET not configured',
        severity: 'critical',
        recommendedAction: 'Configure HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET in environment variables'
      });
      logger.error(LogTags.HUBTEL_AUTH + ' Credentials check failed', {
        clientIdPresent: result.clientIdPresent,
        clientSecretPresent: result.clientSecretPresent
      });
    } else {
      logger.info(LogTags.HUBTEL_AUTH + ' Credentials check passed', {
        clientIdHash: this._maskClientId(this.clientId)
      });
    }

    return result;
  }

  /**
   * Check merchant account number format
   */
  _checkMerchantAccountFormat(auditResults) {
    const result = {
      success: /^[A-Z0-9]{6,20}$/i.test(this.merchantAccountNumber),
      merchantAccountNumber: this.merchantAccountNumber
    };

    if (!result.success) {
      auditResults.warnings.push({
        check: 'merchant_account_format',
        type: 'invalid_format',
        message: 'Merchant account number format may be invalid',
        severity: 'warning'
      });
    }

    return result;
  }

  /**
   * Check API connectivity with merchant account
   */
  async _checkApiConnectivity(auditResults) {
    const endpoint = `${this.hubtelEndpoint}/${this.merchantAccountNumber}`;

    try {
      logger.info(LogTags.HUBTEL_AUTH + ' Testing API connectivity', {
        endpointUrl: endpoint,
        merchantAccountNumber: this.merchantAccountNumber,
        clientIdHash: this._maskClientId(this.clientId)
      });

      const response = await this.httpClient.get(endpoint, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      this._logNon2xxResponse(response, { check: 'api_connectivity' });

      const isSuccess = response.status >= 200 && response.status < 300;
      auditResults.checks.apiConnectivity = {
        success: isSuccess,
        httpStatus: response.status,
        endpointUrl: endpoint
      };

      if (!isSuccess) {
        this._classifyFailure(auditResults, response);
      }

    } catch (error) {
      auditResults.checks.apiConnectivity = {
        success: false,
        error: error.message,
        errorCode: error.code,
        response: error.response?.data
      };

      this._logNon2xxResponse(error.response, { check: 'api_connectivity' });
      this._classifyFailure(auditResults, error.response || error);

      logger.error(LogTags.PROVIDER_FAILURE + ' API connectivity check failed', {
        endpointUrl: endpoint,
        error: error.message,
        response: error.response?.data
      });
    }
  }

  /**
   * Check prepaid deposit accessibility
   */
  async _checkPrepaidDeposit(auditResults) {
    const endpoint = `${this.hubtelEndpoint}/${this.prepaidDepositId}`;

    try {
      logger.info(LogTags.HUBTEL_VALIDATION + ' Testing prepaid deposit access', {
        endpointUrl: endpoint,
        prepaidDepositId: this.prepaidDepositId,
        merchantAccountNumber: this.merchantAccountNumber
      });

      const response = await this.httpClient.get(endpoint, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      this._logNon2xxResponse(response, { check: 'prepaid_deposit' });

      const isSuccess = response.status >= 200 && response.status < 300;
      auditResults.checks.prepaidDeposit = {
        success: isSuccess,
        httpStatus: response.status,
        endpointUrl: endpoint
      };

      if (!isSuccess) {
        this._classifyFailure(auditResults, response, 'deposit');

        // If 403, deposit mismatch is likely
        if (response.status === 403) {
          auditResults.failures.push({
            check: 'prepaid_deposit',
            type: 'deposit_id_mismatch',
            message: 'Prepaid deposit ID does not belong to the configured merchant account',
            severity: 'critical',
            httpStatus: response.status,
            fullResponseBody: response.data,
            recommendedAction: `Verify HUBTEL_PREPAID_DEPOSIT_ID belongs to merchant account ${EXPECTED_MERCHANT_ACCOUNT}`
          });
        }
      } else {
        logger.info(LogTags.HUBTEL_VALIDATION + ' Prepaid deposit accessible', {
          prepaidDepositId: this.prepaidDepositId
        });
      }

    } catch (error) {
      auditResults.checks.prepaidDeposit = {
        success: false,
        error: error.message,
        response: error.response?.data,
        fullResponseBody: error.response?.data
      };

      this._logNon2xxResponse(error.response, { check: 'prepaid_deposit' });
      this._classifyFailure(auditResults, error.response || error, 'deposit');

      if (error.response?.status === 403) {
        auditResults.failures.push({
          check: 'prepaid_deposit',
          type: 'deposit_id_mismatch',
          message: 'Prepaid deposit ID does not belong to the configured merchant account',
          severity: 'critical',
          httpStatus: error.response?.status,
          fullResponseBody: error.response?.data,
          recommendedAction: `Verify HUBTEL_PREPAID_DEPOSIT_ID belongs to merchant account ${EXPECTED_MERCHANT_ACCOUNT}`
        });
      }
    }
  }

  /**
   * Check if airtime disbursement is enabled
   */
  async _checkAirtimeService(auditResults) {
    const endpoint = `${this.hubtelEndpoint}/${this.prepaidDepositId}/buy/airtime`;

    try {
      logger.info(LogTags.HUBTEL_VALIDATION + ' Testing airtime service enablement', {
        endpointUrl: endpoint,
        prepaidDepositId: this.prepaidDepositId,
        merchantAccountNumber: this.merchantAccountNumber
      });

      // Send a minimal test request (won't actually buy airtime)
      const response = await this.httpClient.post(endpoint, {
        recipient: { phone: '0500000000', network: 'MTN' },
        amount: '0.01',
        clientReference: `AUDIT-TEST-${Date.now()}`,
        callbackUrl: this.airtimeCallbackUrl
      }, {
        headers: {
          'Authorization': this.basicAuthHeader,
          'Content-Type': 'application/json'
        }
      });

      this._logNon2xxResponse(response, { check: 'airtime_service' });

      const data = response.data;
      const is403 = response.status === 403;
      const is401 = response.status === 401;
      const is4xx = response.status >= 400 && response.status < 500;
      const isSuccess = response.status >= 200 && response.status < 300;

      auditResults.checks.airtimeService = {
        success: isSuccess,
        httpStatus: response.status,
        responseCode: data?.responseCode,
        endpointUrl: endpoint,
        fullResponseBody: data
      };

      // Requirement 4: Fail immediately on any HTTP status >= 400. Never return pending_confirmation for 4xx or 5xx.
      if (is4xx || is403 || is401) {
        const errorMsg = (data?.error || data?.responseMessage || '').toLowerCase();

        // Check if it's airtime service disabled vs other restrictions
        if (is403 && (errorMsg.includes('airtime') || errorMsg.includes('service') || errorMsg.includes('not enabled'))) {
          auditResults.failures.push({
            check: 'airtime_service',
            type: 'airtime_service_not_enabled',
            message: 'Airtime disbursement service is not enabled on Hubtel account',
            severity: 'critical',
            httpStatus: response.status,
            fullResponseBody: data,
            recommendedAction: 'Enable airtime disbursement service for your merchant account in Hubtel dashboard'
          });
        } else {
          this._classifyFailure(auditResults, response);
        }
      }

    } catch (error) {
      auditResults.checks.airtimeService = {
        success: false,
        error: error.message,
        errorCode: error.code,
        response: error.response?.data,
        fullResponseBody: error.response?.data
      };

      this._logNon2xxResponse(error.response, { check: 'airtime_service' });

      const status = error.response?.status;
      const data = error.response?.data;

      // Requirement 4: Fail immediately on any HTTP status >= 400
      if (status >= 400) {
        const errorMsg = (data?.error || data?.responseMessage || '').toLowerCase();

        if (status === 403 && (errorMsg.includes('airtime') || errorMsg.includes('service') || errorMsg.includes('not enabled'))) {
          auditResults.failures.push({
            check: 'airtime_service',
            type: 'airtime_service_not_enabled',
            message: 'Airtime disbursement service is not enabled on Hubtel account',
            severity: 'critical',
            httpStatus: status,
            fullResponseBody: data,
            recommendedAction: 'Enable airtime disbursement service for your merchant account in Hubtel dashboard'
          });
        } else {
          this._classifyFailure(auditResults, error.response || error, 'airtime_service');
        }
      }
    }
  }

  /**
   * Classify failure type based on response
   * Requirement 4: Fail immediately on any HTTP status >= 400. Never return pending_confirmation for 4xx or 5xx responses.
   */
  _classifyFailure(auditResults, response, contextPrefix = '') {
    if (!response) {
      auditResults.failures.push({
        check: contextPrefix || 'unknown',
        type: 'network_error',
        message: 'No response received from Hubtel API',
        severity: 'warning',
        recommendedAction: 'Check network connectivity and Hubtel API availability'
      });
      return;
    }

    const status = response.status;
    const data = response.data;
    const errorMsg = (data?.error || data?.responseMessage || '').toLowerCase();

    // Already classified by specific checks
    const alreadyClassified = auditResults.failures.some(f => f.check === (contextPrefix || 'unknown'));
    if (alreadyClassified) return;

    if (status >= 400) {
      // REQUIREMENT 4: Never return pending_confirmation for 4xx or 5xx - always fail
      if (status === 403) {
        // Determine specific 403 cause
        if (errorMsg.includes('deposit') || errorMsg.includes('account')) {
          auditResults.failures.push({
            check: contextPrefix || 'authorization',
            type: 'deposit_id_mismatch',
            message: 'Prepaid deposit ID mismatch or account restriction',
            severity: 'critical',
            httpStatus: status,
            fullResponseBody: data,
            recommendedAction: 'Verify HUBTEL_PREPAID_DEPOSIT_ID belongs to the configured merchant account'
          });
        } else if (errorMsg.includes('merchant')) {
          auditResults.failures.push({
            check: contextPrefix || 'authorization',
            type: 'merchant_mismatch',
            message: 'Merchant account mismatch',
            severity: 'critical',
            httpStatus: status,
            fullResponseBody: data,
            recommendedAction: `Set HUBTEL_MERCHANT_ACCOUNT_NUMBER to the correct merchant account`
          });
        } else {
          auditResults.failures.push({
            check: contextPrefix || 'authorization',
            type: 'account_authorization_issue',
            message: 'Account authorization issue - forbidden by Hubtel',
            severity: 'critical',
            httpStatus: status,
            fullResponseBody: data,
            recommendedAction: 'Contact Hubtel support to verify account permissions and API access'
          });
        }
      } else if (status === 401) {
        auditResults.failures.push({
          check: contextPrefix || 'credentials',
          type: 'invalid_credentials',
          message: 'Invalid Hubtel credentials (401 Unauthorized)',
          severity: 'critical',
          httpStatus: status,
          fullResponseBody: data,
          recommendedAction: 'Verify HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET are correct'
        });
      } else if (status >= 400 && status < 500) {
        auditResults.failures.push({
          check: contextPrefix || 'validation',
          type: 'provider_validation_error',
          message: `Hubtel returned client error ${status}`,
          severity: 'error',
          httpStatus: status,
          fullResponseBody: data,
          recommendedAction: 'Review request parameters against Hubtel API documentation'
        });
      } else if (status >= 500) {
        auditResults.failures.push({
          check: contextPrefix || 'provider',
          type: 'provider_unavailable',
          message: `Hubtel returned server error ${status}`,
          severity: 'warning',
          httpStatus: status,
          recommendedAction: 'Retry after some time or contact Hubtel support'
        });
      }
    }
  }

  /**
   * Generate diagnostic report with failure classification and root cause (Requirements 5, 7)
   */
  _generateDiagnostics(auditResults) {
    const diagnostics = {
      failures: [],
      summary: {
        primaryFailureType: null,
        rootCause: null,
        recommendedAction: null
      }
    };

    // Process each failure with detailed diagnostics
    auditResults.failures.forEach(failure => {
      const diagnostic = {
        check: failure.check,
        type: failure.type,
        httpStatus: failure.httpStatus,
        fullResponseBody: failure.fullResponseBody || failure.fullErrorPayload,
        failureClassification: this._getFailureClassification(failure),
        rootCause: this._getRootCause(failure),
        recommendedAction: failure.recommendedAction || this._getDefaultRecommendedAction(failure)
      };
      diagnostics.failures.push(diagnostic);
    });

    // Determine primary failure type
    if (diagnostics.failures.length > 0) {
      // Priority order for root cause determination
      const priorityTypes = [
        'invalid_credentials',
        'merchant_mismatch',
        'deposit_id_mismatch',
        'airtime_service_not_enabled',
        'insufficient_float',
        'environment_mismatch',
        'provider_validation_error',
        'network_error'
      ];

      for (const priorityType of priorityTypes) {
        const match = diagnostics.failures.find(f => f.type === priorityType);
        if (match) {
          diagnostics.summary.primaryFailureType = priorityType;
          diagnostics.summary.rootCause = match.rootCause;
          diagnostics.summary.recommendedAction = match.recommendedAction;
          break;
        }
      }

      // If no priority match, use first failure
      if (!diagnostics.summary.primaryFailureType && diagnostics.failures[0]) {
        diagnostics.summary.primaryFailureType = diagnostics.failures[0].type;
        diagnostics.summary.rootCause = diagnostics.failures[0].rootCause;
        diagnostics.summary.recommendedAction = diagnostics.failures[0].recommendedAction;
      }
    }

    return diagnostics;
  }

  /**
   * Get failure classification for a specific failure (Requirement 7)
   */
  _getFailureClassification(failure) {
    const classifications = {
      invalid_credentials: 'invalid_credentials',
      merchant_mismatch: 'merchant_mismatch',
      deposit_id_mismatch: 'deposit_id_mismatch',
      airtime_service_not_enabled: 'airtime_service_not_enabled',
      insufficient_float: 'insufficient_float',
      environment_mismatch: 'environment_mismatch',
      provider_validation_error: 'provider_validation_error',
      network_error: 'other'
    };
    return classifications[failure.type] || 'other';
  }

  /**
   * Get root cause for a specific failure (Requirement 5)
   */
  _getRootCause(failure) {
    const httpStatus = failure.httpStatus;
    const responseBody = failure.fullResponseBody || {};

    if (failure.type === 'invalid_credentials') {
      return 'HUBTEL_CLIENT_ID or HUBTEL_CLIENT_SECRET are incorrect or expired';
    }
    if (failure.type === 'merchant_mismatch') {
      return `Configured merchant account ${this.merchantAccountNumber} does not match expected account ${EXPECTED_MERCHANT_ACCOUNT}`;
    }
    if (failure.type === 'deposit_id_mismatch') {
      return `HUBTEL_PREPAID_DEPOSIT_ID may not belong to merchant account ${EXPECTED_MERCHANT_ACCOUNT}`;
    }
    if (failure.type === 'airtime_service_not_enabled') {
      return 'Airtime disbursement service is not enabled on the Hubtel merchant account';
    }
    if (failure.type === 'insufficient_float') {
      return 'Prepaid deposit has no available balance for airtime transactions';
    }
    if (failure.type === 'environment_mismatch') {
      return 'Production credentials are being used against sandbox endpoints or vice versa';
    }
    if (failure.type === 'provider_validation_error') {
      const errorCode = responseBody?.error || responseBody?.responseCode;
      return `Provider returned validation error: ${errorCode || 'Unknown error code'}`;
    }
    if (httpStatus === 403) {
      return 'Hubtel API returned 403 Forbidden - authorization denied';
    }
    if (httpStatus === 401) {
      return 'Hubtel API returned 401 Unauthorized - credentials rejected';
    }
    return 'Unknown error - review full response body for details';
  }

  /**
   * Get default recommended action for a failure type
   */
  _getDefaultRecommendedAction(failure) {
    const recommendations = {
      invalid_credentials: 'Verify HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET in Hubtel developer console',
      merchant_mismatch: `Update HUBTEL_MERCHANT_ACCOUNT_NUMBER to ${EXPECTED_MERCHANT_ACCOUNT}`,
      deposit_id_mismatch: 'Verify HUBTEL_PREPAID_DEPOSIT_ID belongs to the configured merchant account in Hubtel dashboard',
      airtime_service_not_enabled: 'Enable airtime disbursement service for your merchant account in Hubtel dashboard',
      insufficient_float: 'Fund the prepaid deposit via Hubtel dashboard or contact support',
      environment_mismatch: 'Ensure production credentials are used with https://smp.hubtel.com endpoints',
      provider_validation_error: 'Review request payload and endpoint URL against Hubtel API documentation',
      network_error: 'Check network connectivity and retry - if persistent, contact Hubtel support'
    };
    return recommendations[failure.type] || 'Review Hubtel API documentation and contact support';
  }

  /**
   * Log audit results with structured format
   */
  logAuditReport(results) {
    const header = '='.repeat(70);

    console.log(`\n${LogTags.HUBTEL_AUTH} ${header}`);
    console.log(`${LogTags.HUBTEL_AUTH} HUBTEL FORENSIC AUDIT REPORT`);
    console.log(`${LogTags.HUBTEL_AUTH} ${header}`);
    console.log(`${LogTags.HUBTEL_AUTH} Timestamp: ${results.timestamp}`);
    console.log(`${LogTags.HUBTEL_AUTH} Overall Status: ${results.overallStatus.toUpperCase()}`);
    console.log(`${LogTags.HUBTEL_AUTH} Client ID: ${this._maskClientId(this.clientId)}`);
    console.log(`${LogTags.HUBTEL_AUTH} Merchant Account: ${this.merchantAccountNumber || 'NOT_CONFIGURED'}`);
    console.log(`${LogTags.HUBTEL_AUTH} Prepaid Deposit ID: ${this.prepaidDepositId || 'NOT_CONFIGURED'}`);
    console.log(`${LogTags.HUBTEL_AUTH} Callback URL: ${this.airtimeCallbackUrl}`);
    console.log(`${LogTags.HUBTEL_AUTH} Endpoint URL: ${this.hubtelEndpoint}`);
    console.log(`${LogTags.HUBTEL_AUTH} ${header}`);

    // Diagnostic Report (Requirement 5)
    if (results.failures.length > 0 || results.diagnostics?.failures?.length > 0) {
      console.log(`\n${LogTags.HUBTEL_AUTH} DIAGNOSTIC REPORT:`);
      console.log(`${LogTags.HUBTEL_AUTH} ${'-'.repeat(70)}`);

      results.diagnostics?.failures?.forEach((diagnostic, idx) => {
        console.log(`\n${LogTags.HUBTEL_AUTH} Failure #${idx + 1}:`);
        console.log(`${LogTags.HUBTEL_AUTH}   Check: ${diagnostic.check}`);
        console.log(`${LogTags.HUBTEL_AUTH}   Classification: ${diagnostic.failureClassification}`);
        console.log(`${LogTags.HUBTEL_AUTH}   HTTP Status: ${diagnostic.httpStatus || 'N/A'}`);
        console.log(`${LogTags.HUBTEL_AUTH}   Root Cause: ${diagnostic.rootCause}`);
        console.log(`${LogTags.HUBTEL_AUTH}   Recommended Action: ${diagnostic.recommendedAction}`);
        if (diagnostic.fullResponseBody) {
          console.log(`${LogTags.HUBTEL_AUTH}   Exact Hubtel Response Body:`);
          console.log(`${LogTags.HUBTEL_AUTH}   ${JSON.stringify(diagnostic.fullResponseBody, null, 6).replace(/\n/g, '\n   ')}`);
        }
      });

      if (results.diagnostics?.summary?.primaryFailureType) {
        console.log(`\n${LogTags.HUBTEL_AUTH} PRIMARY FAILURE ANALYSIS:`);
        console.log(`${LogTags.HUBTEL_AUTH}   Primary Failure Type: ${results.diagnostics.summary.primaryFailureType}`);
        console.log(`${LogTags.HUBTEL_AUTH}   Root Cause: ${results.diagnostics.summary.rootCause}`);
        console.log(`${LogTags.HUBTEL_AUTH}   Recommended Action: ${results.diagnostics.summary.recommendedAction}`);
      }
    }

    if (results.failures.length > 0) {
      console.log(`\n${LogTags.HUBTEL_AUTH} FAILURES DETECTED:`);
      results.failures.forEach((failure, idx) => {
        console.log(`  ${idx + 1}. [${failure.type}] ${failure.message}`);
        if (failure.severity) {
          console.log(`     Severity: ${failure.severity}`);
        }
        if (failure.httpStatus) {
          console.log(`     HTTP Status: ${failure.httpStatus}`);
        }
        if (failure.recommendedAction) {
          console.log(`     Recommended: ${failure.recommendedAction}`);
        }
      });
    }

    if (results.warnings.length > 0) {
      console.log(`\n${LogTags.HUBTEL_AUTH} WARNINGS:`);
      results.warnings.forEach((warning, idx) => {
        console.log(`  ${idx + 1}. [${warning.type}] ${warning.message}`);
      });
    }

    if (results.failures.length === 0 && results.warnings.length === 0) {
      console.log(`\n${LogTags.HUBTEL_AUTH} All authorization checks passed!`);
    }

    console.log(`${LogTags.HUBTEL_AUTH} ${header}\n`);

    logger.info(LogTags.HUBTEL_AUTH + ' Audit report generated', {
      overallStatus: results.overallStatus,
      failureCount: results.failures.length,
      warningCount: results.warnings.length,
      primaryFailureType: results.diagnostics?.summary?.primaryFailureType,
      failures: results.failures.map(f => f.type),
      warnings: results.warnings.map(w => w.type)
    });
  }
}

module.exports = new HubtelAuthAuditService();