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
   */
  _logNon2xxResponse(response, context) {
    const status = response?.status;
    const data = response?.data;
    const url = response?.config?.url;

    if (status >= 200 && status < 300) return;

    const maskedClientId = this._maskClientId(this.clientId);

    logger.error(LogTags.HUBTEL_AUTH + ' Non-2xx response received', {
      ...context,
      httpStatus: status,
      endpointUrl: url,
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED',
      clientIdHash: maskedClientId,
      callbackUrl: this.airtimeCallbackUrl,
      fullResponseBody: JSON.stringify(data, null, 2),
      responseHeaders: response?.headers
    });

    // Special handling for 403 responses
    if (status === 403) {
      logger.error(LogTags.HUBTEL_403 + ' Authorization denied by Hubtel', {
        ...context,
        endpointUrl: url,
        merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
        prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED',
        clientIdHash: maskedClientId,
        callbackUrl: this.airtimeCallbackUrl,
        fullErrorPayload: JSON.stringify(data, null, 2),
        errorCode: data?.error || data?.responseCode || 'UNKNOWN',
        errorMessage: data?.message || data?.responseMessage || data?.error || 'Access forbidden'
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
      overallStatus: 'unknown'
    };

    logger.info(LogTags.HUBTEL_AUTH + ' Starting authorization audit', {
      clientIdHash: this._maskClientId(this.clientId),
      merchantAccountNumber: this.merchantAccountNumber || 'NOT_CONFIGURED',
      prepaidDepositId: this.prepaidDepositId || 'NOT_CONFIGURED'
    });

    // Check 1: Credentials configured
    auditResults.checks.credentialsConfigured = this._checkCredentials(auditResults);

    // Check 2: Merchant account number format validation
    if (this.merchantAccountNumber) {
      auditResults.checks.merchantAccountFormat = this._checkMerchantAccountFormat(auditResults);
    }

    // Check 3: Environment mismatch detection
    auditResults.checks.environmentCheck = this._checkEnvironment(auditResults);

    // Check 4: API connectivity test
    if (this.basicAuthHeader && this.merchantAccountNumber) {
      await this._checkApiConnectivity(auditResults);
    }

    // Check 5: Prepaid deposit accessibility
    if (this.prepaidDepositId && auditResults.checks.apiConnectivity?.success) {
      await this._checkPrepaidDeposit(auditResults);
    }

    // Check 6: Airtime service enabled
    if (auditResults.checks.apiConnectivity?.success) {
      await this._checkAirtimeService(auditResults);
    }

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

    // Warn if sandbox endpoint in production or vice versa
    if (nodeEnv === 'production' && isSandboxEndpoint) {
      auditResults.failures.push({
        check: 'environment',
        type: 'environment_mismatch',
        message: 'Sandbox endpoint is being used in production environment',
        severity: 'critical'
      });
      result.success = false;
    }

    if (nodeEnv !== 'production' && isProductionEndpoint && this.clientId && !this.clientId.includes('test')) {
      auditResults.warnings.push({
        check: 'environment',
        type: 'environment_mismatch',
        message: 'Production endpoint is being used in non-production environment',
        severity: 'warning'
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
        severity: 'critical'
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
            details: {
              prepaidDepositId: this.prepaidDepositId,
              merchantAccountNumber: this.merchantAccountNumber
            }
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
        response: error.response?.data
      };

      this._logNon2xxResponse(error.response, { check: 'prepaid_deposit' });
      this._classifyFailure(auditResults, error.response || error, 'deposit');

      if (error.response?.status === 403) {
        auditResults.failures.push({
          check: 'prepaid_deposit',
          type: 'deposit_id_mismatch',
          message: 'Prepaid deposit ID does not belong to the configured merchant account',
          severity: 'critical'
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
      const isSuccess = response.status >= 200 && response.status < 300;

      auditResults.checks.airtimeService = {
        success: isSuccess,
        httpStatus: response.status,
        responseCode: data?.responseCode,
        endpointUrl: endpoint
      };

      if (!isSuccess) {
        if (is403) {
          const errorMsg = data?.error || data?.responseMessage || '';

          // Check if it's airtime service disabled vs other restrictions
          if (errorMsg.toLowerCase().includes('airtime') || 
              errorMsg.toLowerCase().includes('service') ||
              errorMsg.toLowerCase().includes('not enabled')) {
            auditResults.failures.push({
              check: 'airtime_service',
              type: 'airtime_service_not_enabled',
              message: 'Airtime disbursement service is not enabled on Hubtel account',
              severity: 'critical',
              fullErrorPayload: data
            });
          } else {
            this._classifyFailure(auditResults, response);
          }
        } else {
          this._classifyFailure(auditResults, response);
        }
      }

    } catch (error) {
      auditResults.checks.airtimeService = {
        success: false,
        error: error.message,
        errorCode: error.code,
        response: error.response?.data
      };

      this._logNon2xxResponse(error.response, { check: 'airtime_service' });
      this._classifyFailure(auditResults, error.response || error);

      if (error.response?.status === 403) {
        auditResults.failures.push({
          check: 'airtime_service',
          type: 'airtime_service_not_enabled',
          message: 'Airtime disbursement service is not enabled on Hubtel account',
          severity: 'critical',
          fullErrorPayload: error.response?.data
        });
      }
    }
  }

  /**
   * Classify failure type based on response
   */
  _classifyFailure(auditResults, response, contextPrefix = '') {
    if (!response) {
      auditResults.failures.push({
        check: contextPrefix || 'unknown',
        type: 'network_error',
        message: 'No response received from Hubtel API',
        severity: 'warning'
      });
      return;
    }

    const status = response.status;
    const data = response.data;
    const errorMsg = (data?.error || data?.responseMessage || '').toLowerCase();

    // Already classified by specific checks
    const alreadyClassified = auditResults.failures.some(f => f.check === (contextPrefix || 'unknown'));
    if (alreadyClassified) return;

    if (status === 403) {
      // Determine specific 403 cause
      if (errorMsg.includes('deposit') || errorMsg.includes('account')) {
        auditResults.failures.push({
          check: contextPrefix || 'authorization',
          type: 'deposit_id_mismatch',
          message: 'Prepaid deposit ID mismatch or account restriction',
          severity: 'critical',
          httpStatus: status,
          fullErrorPayload: data
        });
      } else if (errorMsg.includes('merchant')) {
        auditResults.failures.push({
          check: contextPrefix || 'authorization',
          type: 'merchant_mismatch',
          message: 'Merchant account mismatch',
          severity: 'critical',
          httpStatus: status,
          fullErrorPayload: data
        });
      } else {
        auditResults.failures.push({
          check: contextPrefix || 'authorization',
          type: 'account_authorization_issue',
          message: 'Account authorization issue - forbidden by Hubtel',
          severity: 'critical',
          httpStatus: status,
          fullErrorPayload: data
        });
      }
    } else if (status === 401) {
      auditResults.failures.push({
        check: contextPrefix || 'credentials',
        type: 'invalid_credentials',
        message: 'Invalid Hubtel credentials (401 Unauthorized)',
        severity: 'critical',
        httpStatus: status,
        fullErrorPayload: data
      });
    } else if (status >= 400 && status < 500) {
      auditResults.failures.push({
        check: contextPrefix || 'validation',
        type: 'provider_validation_error',
        message: `Hubtel returned client error ${status}`,
        severity: 'error',
        httpStatus: status,
        fullErrorPayload: data
      });
    } else if (status >= 500) {
      auditResults.failures.push({
        check: contextPrefix || 'provider',
        type: 'provider_unavailable',
        message: `Hubtel returned server error ${status}`,
        severity: 'warning',
        httpStatus: status
      });
    }
  }

  /**
   * Log audit results with structured format
   */
  logAuditReport(results) {
    const header = '='.repeat(60);
    
    console.log(`\n${LogTags.HUBTEL_AUTH} ${header}`);
    console.log(`${LogTags.HUBTEL_AUTH} HUBTEL AUTHORIZATION AUDIT REPORT`);
    console.log(`${LogTags.HUBTEL_AUTH} ${header}`);
    console.log(`${LogTags.HUBTEL_AUTH} Timestamp: ${results.timestamp}`);
    console.log(`${LogTags.HUBTEL_AUTH} Overall Status: ${results.overallStatus.toUpperCase()}`);
    console.log(`${LogTags.HUBTEL_AUTH} Client ID: ${this._maskClientId(this.clientId)}`);
    console.log(`${LogTags.HUBTEL_AUTH} Merchant Account: ${this.merchantAccountNumber || 'NOT_CONFIGURED'}`);
    console.log(`${LogTags.HUBTEL_AUTH} Prepaid Deposit ID: ${this.prepaidDepositId || 'NOT_CONFIGURED'}`);
    console.log(`${LogTags.HUBTEL_AUTH} Callback URL: ${this.airtimeCallbackUrl}`);
    console.log(`${LogTags.HUBTEL_AUTH} ${header}`);

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
        if (failure.fullErrorPayload) {
          console.log(`     Full Error Payload: ${JSON.stringify(failure.fullErrorPayload)}`);
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
      failures: results.failures.map(f => f.type),
      warnings: results.warnings.map(w => w.type)
    });
  }
}

module.exports = new HubtelAuthAuditService();