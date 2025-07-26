# Multi-Layer Caching Architecture

The Chautauqua Calendar application implements a comprehensive 4-layer caching system to minimize database queries, reduce API response times, and provide the best user experience possible.

## Cache Layers Overview

```
User Request → Layer 1 (Browser) → Layer 2 (CloudFront CDN) → Layer 3 (Lambda Memory) → Layer 4 (S3 File) → DynamoDB
```

### Layer 1: Browser Cache (Client-Side)
- **Location**: End user's browser
- **Duration**: 1 hour (configurable via `Cache-Control` headers)
- **Purpose**: Eliminate redundant requests for the same calendar data
- **Implementation**: HTTP cache headers set by Lambda responses
- **Headers**: 
  - `Cache-Control: public, max-age=3600` 
  - `Expires: <timestamp>`

### Layer 2: CloudFront CDN Cache
- **Location**: AWS CloudFront edge locations worldwide
- **Duration**: 1 hour (configurable in Terraform)
- **Purpose**: Serve cached responses from edge locations closest to users
- **Configuration**: 
  - `default_ttl = 3600` (1 hour)
  - `max_ttl = 86400` (24 hours)
  - Only caches GET requests for `/api/*` paths

### Layer 3: Lambda Memory Cache
- **Location**: Lambda function memory (in-process)
- **Duration**: 1 hour (configurable via `CACHE_MEMORY_TTL_MINUTES`)
- **Purpose**: Fastest cache layer, eliminates S3 and DynamoDB calls within same Lambda instance
- **Implementation**: `Map<string, CachedData>` with expiration timestamps
- **Key Generation**: SHA-256 hash of filter parameters
- **Cleanup**: Automatic cleanup of expired entries

### Layer 4: S3 File Cache
- **Location**: Dedicated S3 bucket (`chautauqua-calendar-cache`)
- **Duration**: 1 hour (configurable via `CACHE_S3_TTL_MINUTES`)
- **Purpose**: Persistent cache that survives Lambda cold starts and is shared across Lambda instances
- **File Format**: JSON files with metadata (timestamp, expiry, cache key)
- **Lifecycle**: Automatic cleanup of files older than 7 days

## Cache Flow

### Cache Hit Flow
1. **Memory Check**: Lambda checks in-memory cache first
2. **S3 Check**: If memory miss, check S3 for cached file
3. **Memory Population**: If S3 hit, populate memory cache and return data
4. **Headers**: Return with appropriate caching headers for Layers 1 & 2

### Cache Miss Flow
1. **Database Query**: Execute optimized DynamoDB query
2. **Cache Population**: Store results in both memory and S3 caches
3. **Response**: Return data with caching headers

## Configuration

### Environment Variables

```bash
# Cache durations (in minutes)
CACHE_MEMORY_TTL_MINUTES=60      # Layer 3: Lambda memory cache
CACHE_S3_TTL_MINUTES=60          # Layer 4: S3 file cache

# S3 Cache Configuration
CACHE_S3_BUCKET=chautauqua-calendar-cache-xxxxxxxx
CACHE_S3_KEY_PREFIX=calendar-cache
```

### Terraform Configuration

```hcl
# CloudFront API caching (Layer 2)
ordered_cache_behavior {
  path_pattern = "/api/*"
  min_ttl     = 0
  default_ttl = 3600   # 1 hour
  max_ttl     = 86400  # 24 hours
}

# S3 Cache Bucket (Layer 4)
resource "aws_s3_bucket" "cache_bucket" {
  bucket = "chautauqua-calendar-cache-${random_string.bucket_suffix.result}"
}
```

## Cache Invalidation

### Automatic Invalidation
- **Time-based**: All caches expire after their configured TTL
- **S3 Lifecycle**: Files older than 7 days are automatically deleted

### Manual Invalidation (Future Enhancement)
- CloudFront distribution invalidation via API
- S3 cache clearing endpoint
- Memory cache clearing via Lambda restart

## Performance Benefits

### Expected Performance Improvements

| Scenario | Before Caching | After Caching | Improvement |
|----------|----------------|---------------|-------------|
| Same user, same filters | ~2000ms DynamoDB scan | ~50ms browser cache | **40x faster** |
| Different user, same filters | ~2000ms DynamoDB scan | ~100ms CloudFront edge | **20x faster** |
| Lambda warm, same filters | ~2000ms DynamoDB scan | ~5ms memory cache | **400x faster** |
| Lambda cold, same filters | ~2000ms DynamoDB scan | ~200ms S3 cache | **10x faster** |

### Cost Benefits
- **Reduced DynamoDB Costs**: Fewer read capacity units consumed
- **Reduced Lambda Costs**: Shorter execution times
- **Improved User Experience**: Faster page loads, better perceived performance

## Implementation Details

### Cache Key Generation
```typescript
// Predictable keys for common queries
if (keyParams.filters !== undefined && Object.keys(keyParams.filters).length === 0) {
  return 'all-events';
}

// Date range queries
if (keyParams.filters?.dateRange) {
  const { start, end } = keyParams.filters.dateRange;
  return start === end ? `events-${start}` : `events-${start}-to-${end}`;
}

// Category-specific queries
if (keyParams.filters?.categories && keyParams.filters.categories.length === 1) {
  return `category-${keyParams.filters.categories[0].toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

// Complex queries use hashed keys
const hashedKey = crypto.createHash('sha256')
  .update(JSON.stringify(sortedParams))
  .digest('hex')
  .substring(0, 16);
```

### Multi-Layer Cache Service
The `MultiLayerCacheService` class handles:
- Cache key generation and normalization
- Expiration logic across all layers
- Fallback mechanisms (memory → S3 → database)
- Error handling (cache failures don't break main functionality)

### Cache Headers
```typescript
const cacheHeaders = {
  'Cache-Control': 'public, max-age=3600',
  'Expires': new Date(Date.now() + 60 * 60 * 1000).toUTCString()
};
```

## Monitoring & Observability

### Cache Status Endpoint
- **URL**: `/api/cache/status`
- **Purpose**: Monitor cache performance and statistics
- **Data**: Memory cache size, configuration, timestamps

### CloudWatch Metrics (Future)
- Cache hit/miss ratios
- Cache response times
- S3 cache file counts
- DynamoDB query reduction

## Security Considerations

### S3 Bucket Security
- **Encryption**: AES-256 server-side encryption
- **Access**: Limited to Lambda execution role only
- **Versioning**: Enabled with automatic cleanup

### Data Privacy
- Cache keys are hashed to prevent data leakage
- No sensitive user data is cached
- Public data only (calendar events)

## Future Enhancements

### Cache Warming
- Proactive cache population for common queries
- Scheduled Lambda to refresh popular cache entries

### Intelligent Invalidation
- Event-driven cache invalidation on data updates
- Selective cache clearing by filter patterns

### Advanced Analytics
- Cache effectiveness reporting
- Performance optimization recommendations
- Automated cache tuning based on usage patterns

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Check memory cache size via `/api/cache/status`
2. **S3 Access Errors**: Verify Lambda IAM permissions
3. **Cache Not Working**: Check TTL configuration and timestamps
4. **Performance Issues**: Monitor cache hit ratios and adjust TTL values

### Debug Endpoints
- `/api/cache/status` - View cache statistics
- `/api/health` - Overall system health

### Logs
All cache operations are logged with:
- Cache HIT/MISS indicators
- Cache layer information (Memory, S3, Database)
- Performance timing data