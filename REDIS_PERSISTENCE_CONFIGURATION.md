# Redis Persistence Configuration for Nedhub SMS - Railway Production Deployment

## Overview

This document outlines the Redis persistence configuration for the Nedhub SMS application deployed on Railway. The Redis instance is used for BullMQ job queues managing SMS campaign processing, making data durability critical to prevent job loss.

## Current Redis Usage

The application uses Redis for:
- **BullMQ Job Queues**: Managing SMS campaign sending jobs
- **Job Scheduling**: Delayed and scheduled SMS campaigns
- **Queue Persistence**: Ensuring campaigns are not lost during restarts

### Current Configuration
- **Library**: ioredis v5.3.2 with BullMQ v5.1.2
- **Connection**: Environment variables (REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, etc.)
- **Persistence**: Relies on Railway Redis defaults (no application-level configuration)

## Recommended Persistence Settings for Railway

### Primary Persistence Strategy: AOF (Append Only File)

For SMS job queues, we recommend **AOF persistence with fsync every second** as the primary durability mechanism.

#### AOF Configuration
```redis.conf
# Enable AOF persistence
appendonly yes

# AOF fsync policy - balance durability and performance
appendfsync everysec

# AOF rewrite settings
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# AOF compression
aof-use-rdb-preamble yes
```

**Why everysec?**
- **Durability**: Data is written to disk every second, minimizing loss risk
- **Performance**: Much faster than `always` (fsync on every write)
- **Risk**: Maximum 1 second of data loss in case of crash

### Secondary Persistence Strategy: RDB Snapshots

RDB snapshots provide point-in-time backups and faster recovery.

#### RDB Configuration
```redis.conf
# Snapshot triggers
save 900 1     # Save after 15 minutes if at least 1 key changed
save 300 10    # Save after 5 minutes if at least 10 keys changed
save 60 10000  # Save after 1 minute if at least 10000 keys changed

# RDB compression
rdbcompression yes

# RDB checksum
rdbchecksum yes
```

### Memory Management

```redis.conf
# Max memory policy - never evict keys (critical for job queues)
maxmemory-policy noeviction

# Max memory - set based on Railway plan and expected load
maxmemory 512mb  # Adjust based on usage patterns
```

## Railway-Specific Setup Instructions

### 1. Create Redis Service in Railway

```bash
# Using Railway CLI
railway add redis

# Or create via Railway dashboard
# Project Dashboard -> Add Service -> Redis
```

### 2. Configure Persistence Settings

#### Option A: Railway Dashboard Configuration
1. Navigate to your Redis service in Railway dashboard
2. Go to "Settings" tab
3. Add the following environment variables or configuration overrides:

```
REDIS_AOF_ENABLED=true
REDIS_AOF_FSYNC=everysec
REDIS_RDB_SAVE_900_1=true
REDIS_RDB_SAVE_300_10=true
REDIS_RDB_SAVE_60_10000=true
REDIS_MAXMEMORY_POLICY=noeviction
REDIS_MAXMEMORY=512mb
```

#### Option B: Using Railway CLI
```bash
# Set persistence configuration
railway variables set REDIS_AOF_ENABLED=true
railway variables set REDIS_AOF_FSYNC=everysec
railway variables set REDIS_MAXMEMORY_POLICY=noeviction
railway variables set REDIS_MAXMEMORY=512mb
```

### 3. Environment Variables for Application

Update your `backend/.env` file:

```env
# Redis Configuration for Railway
REDIS_HOST=containers-us-west-1.railway.app
REDIS_PORT=6379
REDIS_PASSWORD=your_railway_redis_password
REDIS_DB=0
REDIS_USERNAME=
```

### 4. Verify Configuration

Connect to your Redis instance and verify settings:

```bash
# Connect to Railway Redis
redis-cli -h containers-us-west-1.railway.app -p 6379 -a your_password

# Check persistence settings
127.0.0.1:6379> CONFIG GET appendonly
127.0.0.1:6379> CONFIG GET appendfsync
127.0.0.1:6379> CONFIG GET save
127.0.0.1:6379> CONFIG GET maxmemory-policy
```

## Performance Considerations

### Trade-offs Analysis

| Setting | Durability | Performance | Storage Cost | Use Case |
|---------|------------|-------------|--------------|----------|
| `appendfsync always` | Highest | Lowest | Medium | Critical financial data |
| `appendfsync everysec` | High | High | Medium | **Recommended for SMS queues** |
| `appendfsync no` | Low | Highest | Medium | Cache-only scenarios |
| RDB Only | Medium | High | Low | Periodic snapshots |

### Expected Performance Impact
- **AOF everysec**: ~5-10% performance degradation vs no persistence
- **RDB snapshots**: Minimal impact during normal operation
- **Memory usage**: Monitor and adjust maxmemory based on queue load

## Monitoring Recommendations

### Key Metrics to Monitor

#### 1. Persistence Health
```bash
# Check AOF status
redis-cli INFO persistence

# Monitor AOF size growth
redis-cli --stat  # Shows commands/sec and AOF size
```

#### 2. Memory Usage
```bash
# Memory info
redis-cli INFO memory

# Key space hits/misses
redis-cli INFO stats
```

#### 3. Queue Health
```bash
# BullMQ queue statistics (via application endpoint)
GET /api/queue/stats
```

### Railway Monitoring

1. **Railway Dashboard**: Monitor Redis CPU, Memory, and Network usage
2. **Logs**: Check for persistence-related errors in Railway logs
3. **Alerts**: Set up alerts for:
   - Memory usage > 80%
   - Redis connection failures
   - AOF rewrite failures

### Application-Level Monitoring

Add health checks in your application:

```javascript
// In SmsJobQueueService.js - add to isHealthy method
async isHealthy() {
  if (!this.isInitialized) return false;

  try {
    await this.redisConnection.ping();

    // Check persistence status
    const info = await this.redisConnection.info('persistence');
    const isAofEnabled = info.includes('aof_enabled:1');

    return isAofEnabled;
  } catch (error) {
    console.error('[SmsJobQueueService] Health check failed:', error);
    return false;
  }
}
```

## Cost Optimization

### Storage Considerations
- **AOF files**: Grow over time, consider periodic compaction
- **RDB files**: Smaller, compressed snapshots
- **Railway pricing**: Based on memory and storage usage

### Memory Sizing Guidelines
- **Small campaigns**: 256MB sufficient
- **Medium load**: 512MB recommended
- **High volume**: 1GB or more
- **Monitor usage**: Adjust based on actual patterns

## Backup and Recovery

### Railway Backups
- Railway automatically backs up Redis data
- Point-in-time recovery available
- Backup frequency depends on plan

### Manual Backup Strategy
```bash
# Create RDB snapshot
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD --rdb backup.rdb

# Backup AOF file (if accessible)
# Note: May not be available in managed Railway Redis
```

## Troubleshooting

### Common Issues

#### 1. High Memory Usage
```bash
# Check largest keys
redis-cli --bigkeys

# Monitor queue growth
redis-cli KEYS "bull:*" | wc -l
```

#### 2. AOF Rewrite Blocking
- Monitor `aof_rewrite_in_progress`
- Consider increasing `auto-aof-rewrite-min-size`

#### 3. Performance Degradation
```bash
# Check slow logs
redis-cli SLOWLOG GET 10

# Monitor latency
redis-cli --latency
```

### Emergency Procedures

1. **If Redis becomes unresponsive**:
   - Check Railway service status
   - Restart Redis service via Railway dashboard
   - Monitor queue recovery

2. **Data loss scenarios**:
   - Check Railway backup availability
   - Review persistence configuration
   - Implement job retry mechanisms in application code

## Environment-Specific Considerations

### Development
```redis.conf
# Relaxed settings for development
appendonly yes
appendfsync everysec
save 300 1  # More frequent snapshots for testing
maxmemory-policy allkeys-lru  # Allow eviction in dev
```

### Staging
```redis.conf
# Mirror production settings
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
```

### Production
```redis.conf
# Strict durability settings
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
tcp-keepalive 300
timeout 300
```

## Maintenance Procedures

### Monthly Tasks
1. Review memory usage trends
2. Check persistence file sizes
3. Update Redis configuration if needed
4. Test backup recovery procedures

### AOF Maintenance
```bash
# Manual AOF rewrite (if needed)
redis-cli BGREWRITEAOF

# Check AOF size
redis-cli INFO persistence | grep aof_
```

## Conclusion

The recommended Redis persistence configuration balances durability, performance, and cost for SMS job queue operations on Railway. Regular monitoring and periodic review of settings will ensure optimal performance as your application scales.

## References

- [Redis Persistence Documentation](https://redis.io/docs/management/persistence/)
- [BullMQ Redis Best Practices](https://docs.bullmq.io/)
- [Railway Redis Documentation](https://docs.railway.app/databases/redis)