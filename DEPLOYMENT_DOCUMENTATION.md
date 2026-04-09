# NedhubSMS Production Deployment Documentation

## Overview

This document provides comprehensive deployment instructions for the NedhubSMS platform on Railway production environment. It covers all required environment variables, service configuration, worker processes, database migrations, and post-deployment verification steps.

## Table of Contents

1. [Environment Variables](#environment-variables)
2. [Service Configuration](#service-configuration)
3. [Worker Processes](#worker-processes)
4. [Database Migrations](#database-migrations)
5. [Deployment Steps](#deployment-steps)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Hardening Improvements](#hardening-improvements)
8. [Monitoring and Maintenance](#monitoring-and-maintenance)

## Environment Variables

### Required Production Environment Variables

#### Database Configuration
```env
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/nedhub_production?retryWrites=true&w=majority
```

#### Authentication & Security
```env
JWT_SECRET=your_256_bit_secure_random_jwt_secret_here_change_in_production
JWT_EXPIRES_IN=7d
```

#### Email Configuration
```env
EMAIL_PROVIDER=brevo
BREVO_API_KEY=your_brevo_api_key_here
EMAIL_FROM=support@nedhubgh.com
EMAIL_FROM_NAME=Nedhub Support
ADMIN_NOTIFICATION_EMAIL=info@nedhubgh.com
FRONTEND_URL=https://app.nedhubgh.com
APP_BASE_URL=https://nedhubgh.com
```

#### Redis Configuration (Railway Redis)
```env
REDIS_HOST=containers-us-west-1.railway.app
REDIS_PORT=6379
REDIS_PASSWORD=your_railway_redis_password
REDIS_DB=0
REDIS_USERNAME=
```

#### SMS Service Configuration
```env
NALO_API_KEY=your_nalo_sms_api_key
```

#### Payment Service Configuration (Hubtel)
```env
HUBTEL_CLIENT_ID=your_hubtel_client_id
HUBTEL_CLIENT_SECRET=your_hubtel_client_secret
HUBTEL_MERCHANT_ACCOUNT_NUMBER=your_merchant_account_number
HUBTEL_PREPAID_DEPOSIT_ID=your_deposit_id
HUBTEL_CALLBACK_URL=https://your-railway-app.railway.app/api/hubtel/callback
HUBTEL_RETURN_URL=https://your-railway-app.railway.app/payment/return
HUBTEL_CANCELLATION_URL=https://your-railway-app.railway.app/payment/cancelled
HUBTEL_INITIATE_ENDPOINT=https://payproxyapi.hubtel.com/items/initiate
HUBTEL_STATUS_ENDPOINT=https://api-txnstatus.hubtel.com/transactions
HUBTEL_MOMO_ENDPOINT=https://smp.hubtel.com/api/merchants
HUBTEL_BANK_ENDPOINT=https://smp.hubtel.com/api/merchants
HUBTEL_AIRTIME_ENDPOINT=https://smp.hubtel.com/api/merchants
HUBTEL_DATA_ENDPOINT=https://smp.hubtel.com/api/merchants
HUBTEL_COMMISSION_BASE_URL=https://cs.hubtel.com/commissionservices
```

#### Application Configuration
```env
PORT=3000
NODE_ENV=production
RAILWAY_ENVIRONMENT=production
LOG_LEVEL=info
SENTRY_DSN=your_sentry_dsn_here
BACKEND_URL=https://your-railway-app.railway.app
```

#### Queue and Batch Processing
```env
SMS_BATCH_SIZE=100
SMS_MAX_CONCURRENT_BATCHES=5
SMS_BATCH_RETRY_ATTEMPTS=3
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
MAX_AIRTIME_AMOUNT=500
```

## Service Configuration

### Railway Configuration (railway.json)

```json
{
  "$schema": "https://railway.app/schema.json",
  "build": {
    "builder": "NIXPACKS",
    "options": {
      "nodeJs": {
        "packageManager": "npm"
      }
    }
  },
  "deploy": {
    "startCommand": "node server/index.js",
    "rootDirectory": ".",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Application Services

#### 1. Main Express Server (`server/index.js`)
- **Port**: Configurable via `PORT` env var (default: 3000)
- **Middleware**: CORS, rate limiting, static file serving
- **Routes**: API endpoints, payment callbacks, static frontend
- **Health Check**: `/api/health` and `/api/health/detailed`
- **Graceful Shutdown**: Handles SIGTERM/SIGINT with service cleanup

#### 2. SMS Scheduler Service (`SmsSchedulerService`)
- **Purpose**: Manages scheduled SMS campaigns
- **Initialization**: Starts automatically on server startup
- **Dependencies**: Redis for job queue management
- **Shutdown**: Gracefully stops on server shutdown

#### 3. Email Service (`EmailService`)
- **Providers**: Brevo (Railway-compatible) or Resend
- **Configuration**: Provider-specific API keys and settings
- **Templates**: Admin notifications, user verification emails

#### 4. Rate Limiting Service (`RateLimiterService`)
- **Backend**: Redis-based distributed rate limiting
- **Configuration**: Window size and max requests via env vars
- **Scope**: Per IP address with trust proxy support

## Worker Processes

### BullMQ Queue Workers

#### SMS Campaign Worker (`SmsJobQueueService`)
- **Queue**: `sms-campaigns`
- **Worker Function**: `processJob()` in `SmsJobQueueService.js`
- **Responsibilities**:
  - Process SMS campaign sending jobs
  - Handle batch processing of recipients
  - Manage job retries and dead letter queue
- **Configuration**:
  - Redis connection for job persistence
  - Job attempts: Configurable (default: 3)
  - Dead letter queue: `sms-dead-letter`
- **Monitoring**: Queue statistics available via `/api/queue/stats`

#### Queue Scheduler
- **Purpose**: Handles delayed and scheduled jobs
- **Integration**: Built into BullMQ worker setup
- **Redis Persistence**: Jobs survive restarts

### Batch Processing Workers

#### Batch Processor Service (`BatchProcessorService`)
- **Purpose**: Processes SMS recipients in configurable batches
- **Configuration**:
  - `SMS_BATCH_SIZE`: Default 100 recipients per batch
  - `SMS_MAX_CONCURRENT_BATCHES`: Default 5 concurrent batches
  - `SMS_BATCH_RETRY_ATTEMPTS`: Default 3 retry attempts
- **Progress Tracking**: Redis-based progress tracking with TTL
- **Memory Management**: Garbage collection between batches

## Database Migrations

### Migration Scripts

#### Core Migrations (`backend/utils/runMigrations.js`)
```javascript
// Run all migrations in sequence
await migrateCampaigns();
await migrateMessages();
```

#### Available Migrations

1. **Campaigns Migration** (`migrateCampaigns.js`)
   - Migrates campaign data structures
   - Updates campaign status and metadata

2. **Messages Migration** (`migrateMessages.js`)
   - Migrates SMS message records
   - Updates message status and delivery tracking

3. **Wallet Migration** (`migrateWallet.js`)
   - Migrates wallet balance data
   - Updates transaction records and audit trails

4. **SMS Campaigns Migration** (`migrateSmsCampaigns.js`)
   - Migrates SMS campaign data
   - Updates recipient status tracking

### Migration Execution

#### Manual Migration
```bash
# Run migrations before deployment
cd backend
node utils/runMigrations.js
```

#### Production Migration Strategy
1. Backup database before migration
2. Run migrations in staging environment first
3. Deploy application code
4. Run migrations on production database
5. Verify data integrity
6. Monitor application logs for issues

## Deployment Steps

### Prerequisites
1. Railway account with appropriate plan
2. MongoDB Atlas cluster (or Railway MongoDB)
3. Redis instance (Railway Redis)
4. API keys for external services (Hubtel, Nalo, Brevo/Resend)

### Railway Deployment

#### 1. Create Railway Project
```bash
railway login
railway init nedhub-sms
cd nedhub-sms
```

#### 2. Add Services
```bash
# Add Redis
railway add redis

# Add MongoDB (if not using Atlas)
railway add mongodb
```

#### 3. Configure Environment Variables
```bash
# Set all required environment variables
railway variables set MONGODB_URI="your_mongodb_uri"
railway variables set JWT_SECRET="your_secure_jwt_secret"
# ... set all other variables listed above
```

#### 4. Configure Redis Persistence
```bash
railway variables set REDIS_AOF_ENABLED=true
railway variables set REDIS_AOF_FSYNC=everysec
railway variables set REDIS_MAXMEMORY_POLICY=noeviction
railway variables set REDIS_MAXMEMORY=512mb
```

#### 5. Deploy Application
```bash
railway up
```

#### 6. Run Database Migrations
```bash
# Connect to Railway service
railway shell

# Run migrations
cd backend
node utils/runMigrations.js
```

#### 7. Seed Admin User (if needed)
```bash
node seed-admin.js
```

### Post-Deployment Configuration

#### 1. Update Callback URLs
Update Hubtel callback URLs with actual Railway domain:
- `HUBTEL_CALLBACK_URL=https://your-app.railway.app/api/hubtel/callback`
- `HUBTEL_RETURN_URL=https://your-app.railway.app/payment/return`
- `HUBTEL_CANCELLATION_URL=https://your-app.railway.app/payment/cancelled`

#### 2. Configure Domain (Optional)
```bash
railway domain
# Follow prompts to add custom domain
```

## Post-Deployment Verification

### Health Checks

#### 1. Application Health
```bash
curl https://your-app.railway.app/api/health
# Expected: {"status":"healthy","timestamp":"...","uptime":...,"version":"1.0.0"}
```

#### 2. Detailed Health Check
```bash
curl https://your-app.railway.app/api/health/detailed
# Should show healthy status for database, redis, and external services
```

#### 3. Service-Specific Checks
- **Database**: Connection and ping test
- **Redis**: Queue service health check
- **External APIs**: Nalo SMS and Hubtel API connectivity

### Functional Testing

#### 1. Authentication Flow
- User registration and login
- Email verification process
- Password reset functionality

#### 2. Payment Processing
- Hubtel payment initiation
- Callback handling verification
- Wallet credit confirmation

#### 3. SMS Functionality
- Single SMS sending
- Campaign creation and scheduling
- Batch processing verification

#### 4. Queue Operations
- Check queue statistics: `/api/queue/stats`
- Verify worker processing jobs
- Monitor Redis persistence

### Performance Verification

#### 1. Load Testing
- Test concurrent user operations
- Monitor response times
- Check memory and CPU usage

#### 2. Queue Performance
- Test campaign processing under load
- Verify batch processing efficiency
- Monitor Redis memory usage

## Hardening Improvements

### 1. Monitoring and Logging System

#### Winston Structured Logging
- JSON-formatted logs for Railway aggregation
- Environment-specific log levels
- Centralized logging utility (`backend/utils/logger.js`)

#### Sentry Error Tracking
- Real-time error monitoring
- Performance profiling
- User context and breadcrumbs

#### Health Check Endpoints
- Basic health: `/api/health`
- Detailed health: `/api/health/detailed`
- Service-specific status monitoring

#### Metrics Collection (`backend/services/MetricsService.js`)
- Queue job processing metrics
- API request/response tracking
- Payment callback monitoring
- SMS delivery status tracking

### 2. Redis Persistence Configuration

#### AOF Persistence
- `appendfsync everysec` for durability-performance balance
- Automatic AOF rewrites for size management
- RDB snapshots for point-in-time recovery

#### Memory Management
- `maxmemory-policy noeviction` for job queue integrity
- Configurable memory limits based on usage patterns

#### Monitoring Integration
- Persistence health checks in application
- Railway dashboard monitoring
- Alert configuration for Redis issues

### 3. Wallet Consistency Improvements

#### MongoDB Transactions
- Atomic wallet balance updates
- Transaction-wrapped payment processing
- Rollback on operation failures

#### Optimistic Locking
- Version fields prevent concurrent modification conflicts
- Pre-save hooks increment version numbers

#### Reservation System
- Fund reservation for campaigns
- Capture/release mechanisms
- Prevents over-charging scenarios

#### Error Handling and Compensation
- Transaction-level rollback strategies
- Application-level compensation logic
- Idempotency keys for payment operations

## Monitoring and Maintenance

### Railway Dashboard Monitoring
- Application logs and error aggregation
- Service health and resource usage
- Alert configuration for failures

### Application Metrics
- Access metrics endpoint: `/api/metrics`
- Queue statistics: `/api/queue/stats`
- Health status monitoring

### Maintenance Procedures

#### Weekly Tasks
- Review error logs and Sentry issues
- Monitor Redis memory usage and persistence
- Check database performance metrics

#### Monthly Tasks
- Review and optimize Redis configuration
- Test backup recovery procedures
- Update API keys and security settings

#### Database Maintenance
- Monitor MongoDB Atlas metrics
- Review and optimize queries
- Plan capacity upgrades as needed

### Backup and Recovery

#### Railway Backups
- Automatic Redis data backups
- Point-in-time recovery capability
- Database backup integration

#### Manual Backup Procedures
- Database exports for critical data
- Configuration backups
- Application code versioning

### Scaling Considerations

#### Horizontal Scaling
- Railway service replication
- Redis cluster configuration
- Load balancer setup

#### Performance Optimization
- Query optimization and indexing
- Caching strategy implementation
- CDN integration for static assets

---

## Emergency Procedures

### Service Outage Response
1. Check Railway dashboard for service status
2. Review application logs for error patterns
3. Restart affected services if needed
4. Contact Railway support for infrastructure issues

### Data Recovery
1. Assess data loss scope
2. Use Railway backup restoration
3. Run integrity checks post-recovery
4. Update stakeholders on recovery status

### Security Incident Response
1. Isolate affected systems
2. Review access logs and audit trails
3. Rotate compromised credentials
4. Implement additional security measures

---

This deployment documentation ensures reliable, secure, and maintainable operation of the NedhubSMS platform in production. Regular reviews and updates to this document are recommended as the system evolves.