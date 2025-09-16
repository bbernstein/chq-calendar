import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

export interface CacheConfig {
  memoryTtlMinutes: number;
  s3TtlMinutes: number;
  s3BucketName: string;
  s3KeyPrefix: string;
}

export interface CachedData<T> {
  data: T;
  timestamp: number;
  expiry: number;
  cacheKey: string;
}

// Singleton S3Client to reuse across Lambda invocations
let s3ClientInstance: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const config: any = {
      region: process.env.AWS_REGION || 'us-east-1',
    };

    // Only add custom endpoint configuration if S3_ENDPOINT is set (for local development)
    if (process.env.S3_ENDPOINT) {
      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set when using custom S3_ENDPOINT');
      }

      config.endpoint = process.env.S3_ENDPOINT;
      config.forcePathStyle = true;
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    // For AWS Lambda, credentials are automatically provided by IAM roles

    s3ClientInstance = new S3Client(config);
  }
  return s3ClientInstance;
}

export class MultiLayerCacheService<T = any> {
  private memoryCache = new Map<string, CachedData<T>>();
  private s3Client: S3Client;
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
    this.s3Client = getS3Client();
  }

  /**
   * Generate a cache key based on the input parameters
   * Uses predictable names for common queries
   */
  private generateCacheKey(keyParams: Record<string, any>): string {
    // Handle predictable cache keys for common requests
    if (keyParams.predictableKey) {
      return keyParams.predictableKey;
    }

    // Special case: empty filters = all events
    if (keyParams.filters !== undefined && Object.keys(keyParams.filters).length === 0) {
      // Include year in the cache key if provided
      if (keyParams.year) {
        return `all-events-${keyParams.year}`;
      }
      return 'all-events';
    }

    // Special case: specific date range
    if (keyParams.filters?.dateRange) {
      const { start, end } = keyParams.filters.dateRange;
      if (start === end) {
        // Single day
        return `events-${start}`;
      } else {
        // Date range
        return `events-${start}-to-${end}`;
      }
    }

    // Special case: category filter
    if (keyParams.filters?.categories && keyParams.filters.categories.length === 1) {
      return `category-${keyParams.filters.categories[0].toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    }

    // Default: use hash for complex queries
    const sortedParams = Object.keys(keyParams)
      .sort()
      .reduce((result, key) => {
        result[key] = keyParams[key];
        return result;
      }, {} as Record<string, any>);

    const paramString = JSON.stringify(sortedParams);
    return crypto.createHash('sha256').update(paramString).digest('hex').substring(0, 16);
  }

  /**
   * Check if cached data is still valid
   */
  private isDataValid(cachedData: CachedData<T>): boolean {
    return Date.now() < cachedData.expiry;
  }

  /**
   * Check memory cache (Layer 3)
   */
  private getFromMemoryCache(cacheKey: string): T | null {
    const cached = this.memoryCache.get(cacheKey);
    if (cached && this.isDataValid(cached)) {
      console.log(`Cache HIT: Memory cache for key ${cacheKey}`);
      return cached.data;
    }

    if (cached) {
      // Remove expired data
      this.memoryCache.delete(cacheKey);
      console.log(`Cache EXPIRED: Memory cache for key ${cacheKey}`);
    } else {
      console.log(`Cache MISS: Memory cache for key ${cacheKey}`);
    }

    return null;
  }

  /**
   * Store data in memory cache (Layer 3)
   */
  private setMemoryCache(cacheKey: string, data: T): void {
    const cached: CachedData<T> = {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + (this.config.memoryTtlMinutes * 60 * 1000),
      cacheKey
    };

    this.memoryCache.set(cacheKey, cached);
    console.log(`Cache SET: Memory cache for key ${cacheKey}, expires in ${this.config.memoryTtlMinutes} minutes`);

    // Clean up expired entries periodically
    this.cleanupMemoryCache();
  }

  /**
   * Clean up expired entries from memory cache
   */
  private cleanupMemoryCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, cached] of this.memoryCache.entries()) {
      if (now >= cached.expiry) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.memoryCache.delete(key);
    }

    if (keysToDelete.length > 0) {
      console.log(`Cleaned up ${keysToDelete.length} expired entries from memory cache`);
    }
  }

  /**
   * Get data from S3 cache (Layer 4)
   */
  private async getFromS3Cache(cacheKey: string): Promise<T | null> {
    try {
      const s3Key = `${this.config.s3KeyPrefix}/${cacheKey}.json`;

      const command = new GetObjectCommand({
        Bucket: this.config.s3BucketName,
        Key: s3Key
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        console.log(`Cache MISS: S3 cache for key ${cacheKey} (no body)`);
        return null;
      }

      const bodyText = await response.Body.transformToString();
      const cached: CachedData<T> = JSON.parse(bodyText);

      if (this.isDataValid(cached)) {
        console.log(`Cache HIT: S3 cache for key ${cacheKey}`);

        // Populate memory cache with this data
        this.setMemoryCache(cacheKey, cached.data);

        return cached.data;
      } else {
        console.log(`Cache EXPIRED: S3 cache for key ${cacheKey}`);
        return null;
      }

    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        console.log(`Cache MISS: S3 cache for key ${cacheKey} (not found)`);
      } else {
        console.error(`Cache ERROR: S3 cache for key ${cacheKey}:`, error.message);
      }
      return null;
    }
  }

  /**
   * Store data in S3 cache (Layer 4)
   */
  private async setS3Cache(cacheKey: string, data: T): Promise<void> {
    try {
      const cached: CachedData<T> = {
        data,
        timestamp: Date.now(),
        expiry: Date.now() + (this.config.s3TtlMinutes * 60 * 1000),
        cacheKey
      };

      const s3Key = `${this.config.s3KeyPrefix}/${cacheKey}.json`;

      const command = new PutObjectCommand({
        Bucket: this.config.s3BucketName,
        Key: s3Key,
        Body: JSON.stringify(cached),
        ContentType: 'application/json',
        Metadata: {
          'cache-key': cacheKey,
          'created-at': new Date().toISOString(),
          'expires-at': new Date(cached.expiry).toISOString()
        }
      });

      await this.s3Client.send(command);
      console.log(`Cache SET: S3 cache for key ${cacheKey}, expires in ${this.config.s3TtlMinutes} minutes`);

    } catch (error: any) {
      console.error(`Cache ERROR: Failed to set S3 cache for key ${cacheKey}:`, error.message);
      // Don't throw - caching failures shouldn't break the main functionality
    }
  }

  /**
   * Get data from cache with multi-layer fallback
   * Layer 3: Memory cache -> Layer 4: S3 cache -> null (cache miss)
   */
  async get(keyParams: Record<string, any>): Promise<T | null> {
    const cacheKey = this.generateCacheKey(keyParams);

    // Layer 3: Check memory cache first
    const memoryResult = this.getFromMemoryCache(cacheKey);
    if (memoryResult !== null) {
      return memoryResult;
    }

    // Layer 4: Check S3 cache
    const s3Result = await this.getFromS3Cache(cacheKey);
    if (s3Result !== null) {
      return s3Result;
    }

    return null;
  }

  /**
   * Set data in all cache layers
   */
  async set(keyParams: Record<string, any>, data: T): Promise<void> {
    const cacheKey = this.generateCacheKey(keyParams);

    // Set in memory cache (Layer 3)
    this.setMemoryCache(cacheKey, data);

    // Set in S3 cache (Layer 4) - don't wait for it
    this.setS3Cache(cacheKey, data).catch(error => {
      console.error(`Background S3 cache set failed for key ${cacheKey}:`, error);
    });
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): {
    memoryCacheSize: number;
    memoryCacheKeys: string[];
    config: CacheConfig;
  } {
    return {
      memoryCacheSize: this.memoryCache.size,
      memoryCacheKeys: Array.from(this.memoryCache.keys()),
      config: this.config
    };
  }

  /**
   * Clear all caches (useful for testing)
   */
  clearAll(): void {
    this.memoryCache.clear();
    console.log('All memory caches cleared');
  }
}
