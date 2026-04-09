# Batch Processing Plan for SMS Campaign Recipients

## Current Memory Issues Identified

### SmsCampaignRetryService.js
- **retryFailedRecipients()**: Loads all failed recipients via `SmsRecipient.find({ campaignId, status: 'failed', retryCount: { $lt: 3 } })` (line 33)
- **duplicateCampaignWithFailed()**: Loads all failed recipients similarly (line 172)
- Both methods process recipients in memory loops, risking OOM for large campaigns

### SmsJobQueueService.js
- **processCampaign()**: Loads all campaign recipients via `SmsRecipient.findByCampaignId(campaign._id)` (line 355)
- Processes all recipients sequentially in a for loop, holding entire dataset in memory

## Proposed Batch Processing Architecture

### Core Concepts
- **Batch Size**: Configurable number of recipients processed per batch (default: 100)
- **Pagination**: Use MongoDB `.limit()` and `.skip()` for efficient data retrieval
- **Progress Tracking**: Redis-based progress storage with real-time updates
- **Failure Handling**: Batch-level retries with exponential backoff
- **Memory Management**: Process one batch at a time, garbage collect after each

### Batch Processing Flow

```mermaid
graph TD
    A[Start Campaign Processing] --> B[Initialize Progress Tracker]
    B --> C[Calculate Total Recipients]
    C --> D[Set Batch Size & Initial Offset]
    D --> E{Offset < Total Recipients?}
    E -->|Yes| F[Load Batch (limit + skip)]
    F --> G[Process Batch Recipients]
    G --> H[Update Progress in Redis]
    H --> I[Check for Failures in Batch]
    I -->|Failures Exist| J[Retry Failed Batch]
    I -->|No Failures| K[Increment Offset]
    K --> E
    J --> L{Retry Attempts Exceeded?}
    L -->|Yes| M[Mark Batch as Failed]
    L -->|No| J
    M --> K
    E -->|No| N[Finalize Campaign Status]
    N --> O[Cleanup Progress Data]
    O --> P[End Processing]
```

### Progress Tracking Mechanism

#### Redis Structure
```
campaign:progress:{campaignId} = {
  totalRecipients: number,
  processedRecipients: number,
  successfulRecipients: number,
  failedRecipients: number,
  currentBatch: number,
  totalBatches: number,
  status: 'processing' | 'completed' | 'failed',
  lastUpdated: timestamp,
  estimatedCompletion: timestamp
}
```

#### Database Updates
- Update campaign status every 10 batches or 30 seconds
- Store batch-level metrics for analytics
- Maintain recipient status in SmsRecipient collection

### Failure Handling Strategy

#### Batch-Level Failures
1. **Detection**: Track success/failure per recipient in batch
2. **Retry Logic**: Retry entire batch up to 3 times with exponential backoff
3. **Isolation**: Failed batches don't block subsequent batches
4. **Logging**: Detailed error logging for debugging

#### Individual Recipient Failures
- Mark individual recipients as failed
- Continue processing remaining batch
- Aggregate batch success metrics

### Implementation Recommendations

#### Batch Size Configuration
```javascript
const BATCH_CONFIG = {
  DEFAULT_SIZE: 100,
  MAX_SIZE: 500,
  MIN_SIZE: 10,
  ADAPTIVE_SIZING: true  // Adjust based on memory usage
};
```

#### Environment Variables
- `SMS_BATCH_SIZE`: Override default batch size
- `SMS_MAX_CONCURRENT_BATCHES`: Control parallelism
- `SMS_BATCH_RETRY_ATTEMPTS`: Max retry attempts per batch

#### Performance Considerations
- **Memory**: Monitor heap usage, adjust batch size dynamically
- **Rate Limiting**: Respect API limits (10 jobs/sec in current config)
- **Database**: Use indexes on `(campaignId, status)` for efficient pagination
- **Redis**: Set TTL on progress keys to prevent memory leaks

### Modified Service Interfaces

#### New BatchProcessorService
```javascript
class BatchProcessorService {
  async processRecipientsInBatches(campaignId, batchSize = 100, processorFn)
  async getProgress(campaignId)
  async retryFailedBatch(campaignId, batchNumber)
}
```

#### Updated SmsJobQueueService
- Replace `processCampaign()` with batch-aware version
- Integrate with BatchProcessorService
- Maintain backward compatibility

#### Updated SmsCampaignRetryService
- Use batch processing for retry operations
- Leverage existing progress tracking

### Migration Strategy
1. **Phased Rollout**: Enable batch processing for new campaigns first
2. **Backward Compatibility**: Maintain existing non-batch mode as fallback
3. **Monitoring**: Track memory usage and performance metrics during transition
4. **Rollback Plan**: Feature flag to disable batch processing if issues arise

### Success Metrics
- Memory usage reduction (>80% for large campaigns)
- Improved reliability (batch isolation prevents total failures)
- Better user experience (real-time progress updates)
- Scalability to millions of recipients

## Next Steps
1. Implement BatchProcessorService core logic
2. Update SmsJobQueueService to use batch processing
3. Add Redis progress tracking
4. Update retry services for batch compatibility
5. Add configuration management
6. Implement monitoring and alerting