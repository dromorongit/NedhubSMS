# Nedhub SMS Production Readiness Checklist

## Overview

This comprehensive checklist validates all hardening improvements implemented for production deployment. It covers monitoring and logging systems, Redis persistence configuration, wallet consistency improvements, batch processing enhancements, authentication security, and backup/recovery capabilities.

## Pre-Deployment Checks

### Environment Configuration

- [ ] **Railway Project Setup**
  - [ ] Verify Railway account has appropriate plan for production workload
  - [ ] Confirm MongoDB and Redis services are added to project
  - [ ] Validate all required environment variables are configured:
    - [ ] `MONGODB_URI` - Production MongoDB connection string
    - [ ] `JWT_SECRET` - 256-bit secure random secret (different from staging)
    - [ ] `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - Redis connection details
    - [ ] `SENTRY_DSN` - Sentry error tracking DSN
    - [ ] Email service credentials (`BREVO_API_KEY` or `RESEND_API_KEY`)
    - [ ] Payment service credentials (`HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`)
    - [ ] SMS service credentials (`NALO_API_KEY`)

- [ ] **Redis Persistence Configuration**
  - [ ] Verify Railway Redis variables are set:
    ```bash
    REDIS_AOF_ENABLED=true
    REDIS_AOF_FSYNC=everysec
    REDIS_MAXMEMORY_POLICY=noeviction
    REDIS_MAXMEMORY=512mb
    ```
  - [ ] Confirm Redis persistence settings via CLI:
    ```bash
    redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD CONFIG GET appendonly
    # Expected: "appendonly" "yes"
    redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD CONFIG GET appendfsync
    # Expected: "appendfsync" "everysec"
    ```

- [ ] **MongoDB Connection**
  - [ ] Test MongoDB connectivity:
    ```bash
    mongosh $MONGODB_URI --eval "db.adminCommand('ping')"
    # Expected: { "ok": 1 }
    ```
  - [ ] Verify database user has appropriate permissions for transactions

### Code and Dependencies

- [ ] **Winston Logging Setup**
  - [ ] Confirm `winston` and `winston-transport` are installed in `backend/package.json`
  - [ ] Verify `backend/utils/logger.js` exists with proper Winston configuration
  - [ ] Check Railway-specific log format configuration in logger

- [ ] **Sentry Error Tracking**
  - [ ] Confirm `@sentry/node` and `@sentry/profiling-node` are installed
  - [ ] Verify `backend/utils/sentry.js` exists with proper configuration
  - [ ] Validate `SENTRY_DSN` environment variable is set

- [ ] **Wallet Consistency Features**
  - [ ] Confirm optimistic locking: `version` field added to `Wallet` model
  - [ ] Verify MongoDB transaction support in `WalletService.js`
  - [ ] Check reservation methods exist: `reserveFunds()`, `captureReservation()`, `releaseReservation()`
  - [ ] Validate transaction-wrapped operations in `PaymentController.js`

- [ ] **Batch Processing Configuration**
  - [ ] Verify `BatchProcessorService.js` exists with batch processing logic
  - [ ] Check environment variables for batch configuration:
    ```bash
    SMS_BATCH_SIZE=100
    SMS_MAX_CONCURRENT_BATCHES=5
    SMS_BATCH_RETRY_ATTEMPTS=3
    ```

- [ ] **Authentication Security**
  - [ ] Confirm bcrypt is installed for password/OTP hashing
  - [ ] Verify OTP model has TTL index (15 minutes expiration)
  - [ ] Check rate limiting is configured in authentication routes
  - [ ] Validate email service configuration (Brevo/Resend)

### Infrastructure Readiness

- [ ] **Railway Configuration**
  - [ ] Verify `railway.json` has correct build and deploy settings
  - [ ] Confirm health check endpoint is configured: `/api/health`
  - [ ] Validate restart policy: `ON_FAILURE` with max retries

- [ ] **Domain and SSL**
  - [ ] Custom domain configured in Railway (if applicable)
  - [ ] SSL certificate automatically provisioned by Railway
  - [ ] Callback URLs updated with production domain:
    - [ ] `HUBTEL_CALLBACK_URL`
    - [ ] `HUBTEL_RETURN_URL`
    - [ ] `HUBTEL_CANCELLATION_URL`

## Deployment Verification

### Application Deployment

- [ ] **Successful Railway Deployment**
  - [ ] `railway up` command completes without errors
  - [ ] Application logs show successful startup in Railway dashboard
  - [ ] Health check endpoint responds:
    ```bash
    curl https://your-app.railway.app/api/health
    # Expected: {"status":"healthy","timestamp":"...","uptime":...,"version":"1.0.0"}
    ```

- [ ] **Database Migrations**
  - [ ] Run migrations before deployment:
    ```bash
    railway shell
    cd backend
    node utils/runMigrations.js
    ```
  - [ ] Verify migration completion in logs
  - [ ] Confirm no migration errors in Railway dashboard

- [ ] **Service Initialization**
  - [ ] SMS Scheduler Service starts automatically
  - [ ] Email Service initializes with correct provider
  - [ ] Rate Limiting Service connects to Redis
  - [ ] BullMQ worker processes start successfully

### External Service Integration

- [ ] **Redis Connectivity**
  - [ ] Application connects to Railway Redis:
    ```bash
    curl https://your-app.railway.app/api/health/detailed
    # Verify: services.redis.status == "up"
    ```
  - [ ] Queue statistics endpoint works:
    ```bash
    curl https://your-app.railway.app/api/queue/stats
    # Expected: Valid JSON with queue information
    ```

- [ ] **MongoDB Connectivity**
  - [ ] Application connects to Railway MongoDB:
    ```bash
    curl https://your-app.railway.app/api/health/detailed
    # Verify: services.database.status == "up"
    ```

- [ ] **External API Connectivity**
  - [ ] Nalo SMS API connectivity verified in health check
  - [ ] Hubtel Payment API connectivity verified in health check
  - [ ] Email service provider connectivity confirmed

## Post-Deployment Testing

### Functional Testing

- [ ] **Authentication Flow**
  - [ ] User registration with email verification OTP
  - [ ] Email verification process completes successfully
  - [ ] Password reset OTP delivery and verification
  - [ ] Login/logout functionality works correctly

- [ ] **Payment Processing**
  - [ ] Hubtel payment initiation (test with small amount)
  - [ ] Payment callback handling verified
  - [ ] Wallet credit applied atomically
  - [ ] Transaction rollback tested on failures

- [ ] **SMS Functionality**
  - [ ] Single SMS sending works
  - [ ] Campaign creation and scheduling
  - [ ] Batch processing for large recipient lists
  - [ ] SMS delivery status tracking

- [ ] **Wallet Operations**
  - [ ] Fund reservations work correctly
  - [ ] Atomic credit/debit operations
  - [ ] Optimistic locking prevents race conditions
  - [ ] Transaction rollback on failures

### Performance and Load Testing

- [ ] **Queue Performance**
  - [ ] Test campaign processing with 1000+ recipients
  - [ ] Verify batch processing memory usage stays within limits
  - [ ] Monitor Redis memory usage during load
  - [ ] Check queue statistics during processing

- [ ] **Concurrent Operations**
  - [ ] Multiple payment operations simultaneously
  - [ ] Concurrent SMS campaigns
  - [ ] Wallet balance updates under load
  - [ ] Rate limiting effectiveness

- [ ] **Memory and Resource Usage**
  - [ ] Monitor Railway application memory usage
  - [ ] Verify Redis memory policy prevents eviction
  - [ ] Check MongoDB connection pool health
  - [ ] Validate no memory leaks in batch processing

### Error Handling and Recovery

- [ ] **Transaction Rollback**
  - [ ] Simulate payment failures and verify rollback
  - [ ] Test wallet operation failures with compensation
  - [ ] Verify reservation cleanup on failures

- [ ] **Queue Recovery**
  - [ ] Test job retry mechanisms
  - [ ] Verify dead letter queue handling
  - [ ] Check queue persistence across restarts

- [ ] **Error Logging**
  - [ ] Confirm errors are logged to Winston
  - [ ] Verify Sentry error capture
  - [ ] Check structured logging in Railway dashboard

## Ongoing Monitoring Requirements

### Health Monitoring

- [ ] **Automated Health Checks**
  - [ ] Railway health check endpoint monitored every 5 minutes
  - [ ] Detailed health check validates all services
  - [ ] Alert on any service degradation

- [ ] **Service Availability**
  - [ ] MongoDB connection monitoring
  - [ ] Redis connectivity and persistence health
  - [ ] External API availability (Nalo, Hubtel, Email)
  - [ ] Queue worker process health

### Performance Monitoring

- [ ] **Application Metrics**
  - [ ] Access metrics endpoint regularly:
    ```bash
    curl https://your-app.railway.app/api/metrics
    ```
  - [ ] Monitor API request/response times
  - [ ] Track payment callback success rates
  - [ ] Monitor SMS delivery success rates

- [ ] **Queue Performance**
  - [ ] Monitor queue statistics:
    ```bash
    curl https://your-app.railway.app/api/queue/stats
    ```
  - [ ] Track job processing rates
  - [ ] Monitor queue depth and processing times
  - [ ] Alert on queue failures or delays

- [ ] **Resource Usage**
  - [ ] Railway dashboard monitoring for CPU/memory
  - [ ] Redis memory usage monitoring
  - [ ] MongoDB performance metrics
  - [ ] Network usage and latency

### Error and Incident Monitoring

- [ ] **Log Aggregation**
  - [ ] Structured logs visible in Railway dashboard
  - [ ] Error logs trigger alerts for critical issues
  - [ ] Winston log levels configured appropriately

- [ ] **Sentry Monitoring**
  - [ ] Error tracking active and capturing exceptions
  - [ ] Performance profiling enabled
  - [ ] User context and breadcrumbs in error reports

- [ ] **Alert Configuration**
  - [ ] Critical errors trigger immediate alerts
  - [ ] Queue failures generate notifications
  - [ ] Payment processing failures alerted
  - [ ] Memory usage thresholds configured

### Backup and Recovery Monitoring

- [ ] **Backup Verification**
  - [ ] Railway automated backups complete successfully
  - [ ] Backup retention periods maintained
  - [ ] Point-in-time recovery capability tested monthly

- [ ] **Recovery Testing**
  - [ ] Quarterly disaster recovery drills
  - [ ] Point-in-time recovery testing
  - [ ] Data integrity validation after restores

- [ ] **Redis Persistence**
  - [ ] AOF file size monitoring
  - [ ] RDB snapshot success verification
  - [ ] Persistence health checks in application

### Maintenance Tasks

#### Daily
- [ ] Review error logs and Sentry issues
- [ ] Monitor queue statistics and performance
- [ ] Check application health status

#### Weekly
- [ ] Review Redis memory usage and persistence
- [ ] Monitor MongoDB performance metrics
- [ ] Validate backup completion status

#### Monthly
- [ ] Test backup recovery procedures
- [ ] Review and optimize Redis configuration
- [ ] Update API keys and security settings
- [ ] Performance benchmark testing

#### Quarterly
- [ ] Full disaster recovery simulation
- [ ] Security audit and penetration testing
- [ ] Compliance review (if applicable)

### Scaling and Optimization

- [ ] **Performance Optimization**
  - [ ] Query optimization and MongoDB indexing review
  - [ ] Redis configuration tuning based on usage patterns
  - [ ] Batch processing parameter optimization

- [ ] **Cost Monitoring**
  - [ ] Railway usage costs within budget
  - [ ] Redis memory usage optimization
  - [ ] Backup storage cost monitoring

- [ ] **Capacity Planning**
  - [ ] Monitor application growth metrics
  - [ ] Plan infrastructure upgrades proactively
  - [ ] Database sharding considerations for scale

## Emergency Procedures

### Service Outage Response
1. Check Railway dashboard for service status
2. Review application logs for error patterns
3. Restart affected services if needed
4. Contact Railway support for infrastructure issues
5. Communicate with stakeholders on status

### Data Recovery
1. Assess data loss scope and business impact
2. Use Railway backup restoration capabilities
3. Run integrity checks post-recovery
4. Test application functionality thoroughly
5. Update stakeholders on recovery status

### Security Incident Response
1. Isolate affected systems immediately
2. Review access logs and audit trails
3. Rotate compromised credentials
4. Implement additional security measures
5. Report incident according to compliance requirements

## Sign-off Requirements

### Pre-Production Sign-off
- [ ] All pre-deployment checks completed
- [ ] Environment configuration verified
- [ ] Code review completed for hardening features
- [ ] Infrastructure readiness confirmed

### Post-Deployment Sign-off
- [ ] Deployment verification completed
- [ ] Functional testing passed
- [ ] Performance testing validated
- [ ] Monitoring systems operational

### Ongoing Compliance
- [ ] Monthly maintenance tasks completed
- [ ] Quarterly testing performed
- [ ] Incident response procedures documented
- [ ] Backup recovery tested regularly

---

**Note**: This checklist should be used as a living document. Update it as new hardening improvements are implemented or requirements change. All critical items must be completed before production deployment.