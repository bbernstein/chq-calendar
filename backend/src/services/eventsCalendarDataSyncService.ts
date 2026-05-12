import { EventsCalendarApiClient } from './eventsCalendarApiClient';
import { EventTransformationService } from './eventTransformationService';
import { MultiLayerCacheService } from './multiLayerCacheService';
import { SyncStatusService } from './syncStatusService';
import { ChautauquaEvent, SyncResult, DateRange } from '../types';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

export class EventsCalendarDataSyncService {
  private apiClient: EventsCalendarApiClient;
  private transformationService: typeof EventTransformationService;
  private dbClient: DynamoDBDocumentClient;
  private tableName: string;
  private cacheService: MultiLayerCacheService;
  private statusService: SyncStatusService;

  // AWS service limits
  private static readonly DYNAMODB_BATCH_WRITE_LIMIT = 25;
  private static readonly DYNAMODB_BATCH_GET_LIMIT = 100;

  /**
   * Compute the default year using the Oct 1 turnover rule:
   * If current month is October or later, default to next year; otherwise current year.
   */
  private getDefaultYear(): number {
    const now = new Date();
    return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  }

  constructor(apiClient?: EventsCalendarApiClient, dbClient?: DynamoDBDocumentClient) {
    // Configure API client with parallelization settings from environment
    const maxConcurrentRequests = parseInt(process.env.API_MAX_CONCURRENT_REQUESTS || '10');
    const requestDelayMs = parseInt(process.env.API_REQUEST_DELAY_MS || '100');

    this.apiClient = apiClient || new EventsCalendarApiClient(
      'https://www.chq.org/wp-json/tribe/events/v1',
      { maxConcurrentRequests, requestDelayMs }
    );
    this.transformationService = EventTransformationService;
    this.dbClient = dbClient || (() => {
      // This will be injected from server.ts
      throw new Error('Database client not provided');
    })();
    this.tableName = process.env.EVENTS_TABLE_NAME || 'chautauqua-calendar-events';

    // Initialize cache service for cache warming
    this.cacheService = new MultiLayerCacheService({
      memoryTtlMinutes: parseInt(process.env.CACHE_MEMORY_TTL_MINUTES || '60'),
      s3TtlMinutes: parseInt(process.env.CACHE_S3_TTL_MINUTES || '60'),
      s3BucketName: process.env.CACHE_S3_BUCKET || 'chautauqua-calendar-cache',
      s3KeyPrefix: process.env.CACHE_S3_KEY_PREFIX || 'calendar-cache'
    });

    // Initialize sync status service
    this.statusService = new SyncStatusService(this.dbClient);
  }

  /**
   * Sync events for a specific date range
   */
  async syncEvents(dateRange: DateRange): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      eventsProcessed: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      eventsDeleted: 0,
      errors: [],
      duration: 0
    };

    try {
      console.log(`Starting sync for date range: ${dateRange.start} to ${dateRange.end}`);

      // Fetch events from API
      const apiEvents = await this.apiClient.getAllEventsInRange(dateRange);
      console.log(`Fetched ${apiEvents.length} events from API`);

      // Transform events
      const transformedEvents = this.transformationService.transformApiEvents(apiEvents);
      console.log(`Transformed ${transformedEvents.length} events`);

      // Process events in bulk for better performance
      const processedEvents = await this.bulkProcessEvents(transformedEvents);
      result.eventsProcessed = processedEvents.processed;
      result.eventsCreated = processedEvents.created;
      result.eventsUpdated = processedEvents.updated;
      result.errors.push(...processedEvents.errors);

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Sync completed in ${result.duration}ms:`, {
        processed: result.eventsProcessed,
        created: result.eventsCreated,
        updated: result.eventsUpdated,
        deleted: result.eventsDeleted,
        errors: result.errors.length
      });

      // Warm S3 cache after successful sync
      if (result.success) {
        const hasDataChanges = result.eventsCreated > 0 || result.eventsUpdated > 0 || result.eventsDeleted > 0;
        await this.warmCacheAfterSync(hasDataChanges, this.getDefaultYear());
      }

      return result;
    } catch (error) {
      const errorMessage = `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMessage);

      result.errors.push(errorMessage);
      result.duration = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Sync all events for the entire year (including off-season)
   */
  async syncFullYearEvents(year: number = this.getDefaultYear()): Promise<SyncResult> {
    console.log(`Starting full year sync for ${year}`);

    try {
      const apiEvents = await this.apiClient.getFullYearEvents(year);
      console.log(`Fetched ${apiEvents.length} events for year ${year}`);

      const transformedEvents = this.transformationService.transformApiEvents(apiEvents);

      const result: SyncResult = {
        success: false,
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [],
        duration: 0
      };

      const startTime = Date.now();

      // Process events in bulk
      const processedEvents = await this.bulkProcessEvents(transformedEvents);

      result.eventsProcessed = processedEvents.processed;
      result.eventsCreated = processedEvents.created;
      result.eventsUpdated = processedEvents.updated;
      result.success = processedEvents.errors.length === 0;
      result.errors = processedEvents.errors;
      result.duration = Date.now() - startTime;

      // Warm the cache with year-specific key
      if (result.success || result.errors.length < 5) {
        await this.warmCacheAfterSync(true, year);
      }

      // Record sync completion status
      try {
        const syncId = await this.statusService.createSyncStatus('full', undefined, { year });
        await this.statusService.startSync(syncId);

        if (result.success) {
          await this.statusService.completeSyncSuccess(syncId, {
            eventsProcessed: result.eventsProcessed,
            eventsCreated: result.eventsCreated,
            eventsUpdated: result.eventsUpdated,
            eventsDeleted: result.eventsDeleted,
            eventsSkipped: 0,
            errors: result.errors
          });
        } else {
          await this.statusService.completeSyncFailure(
            syncId,
            result.errors.join('; '),
            {
              eventsProcessed: result.eventsProcessed,
              eventsCreated: result.eventsCreated,
              eventsUpdated: result.eventsUpdated,
              eventsDeleted: result.eventsDeleted,
              eventsSkipped: 0,
              errors: result.errors
            }
          );
        }
      } catch (error) {
        console.warn('Failed to record sync status:', error.message);
      }

      console.log(`Year sync completed for ${year}:`, result);
      return result;

    } catch (error) {
      console.error(`Error syncing year ${year}:`, error);
      throw error;
    }
  }

  /**
   * Sync all events for the Chautauqua season
   */
  async syncAllSeasonEvents(year: number = this.getDefaultYear()): Promise<SyncResult> {
    console.log(`Starting full season sync for ${year}`);

    try {
      const apiEvents = await this.apiClient.getSeasonEvents(year);
      console.log(`Fetched ${apiEvents.length} events for season ${year}`);

      const transformedEvents = this.transformationService.transformApiEvents(apiEvents);

      const result: SyncResult = {
        success: false,
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [],
        duration: 0
      };

      const startTime = Date.now();

      // Process events in bulk for better performance
      const processedEvents = await this.bulkProcessEvents(transformedEvents);
      result.eventsProcessed = processedEvents.processed;
      result.eventsCreated = processedEvents.created;
      result.eventsUpdated = processedEvents.updated;
      result.errors.push(...processedEvents.errors);

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Season sync completed:`, result);

      // Warm S3 cache after successful sync
      if (result.success) {
        const hasDataChanges = result.eventsCreated > 0 || result.eventsUpdated > 0 || result.eventsDeleted > 0;
        await this.warmCacheAfterSync(hasDataChanges, this.getDefaultYear());
      }

      return result;
    } catch (error) {
      const errorMessage = `Season sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMessage);

      return {
        success: false,
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [errorMessage],
        duration: 0
      };
    }
  }

  /**
   * Perform incremental sync (only recent changes)
   */
  async performIncrementalSync(): Promise<SyncResult> {
    console.log('Starting incremental sync');

    // Get date range for incremental sync (back 1 day to next 7 days)
    const now = new Date();
    const startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const dateRange: DateRange = {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    };

    return this.syncEvents(dateRange);
  }

  /**
   * Perform hourly sync (next 7 days only)
   */
  async performHourlySync(): Promise<SyncResult> {
    console.log('Starting hourly sync for next 7 days');

    try {
      const apiEvents = await this.apiClient.getNext7DaysEvents();
      console.log(`Fetched ${apiEvents.length} events for next 7 days`);

      const transformedEvents = this.transformationService.transformApiEvents(apiEvents);

      const result: SyncResult = {
        success: false,
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [],
        duration: 0
      };

      const startTime = Date.now();

      // Process events in bulk for better performance
      const processedEvents = await this.bulkProcessEvents(transformedEvents);
      result.eventsProcessed = processedEvents.processed;
      result.eventsCreated = processedEvents.created;
      result.eventsUpdated = processedEvents.updated;
      result.errors.push(...processedEvents.errors);

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Hourly sync completed:`, result);

      // Warm S3 cache after successful sync
      if (result.success) {
        const hasDataChanges = result.eventsCreated > 0 || result.eventsUpdated > 0 || result.eventsDeleted > 0;
        await this.warmCacheAfterSync(hasDataChanges, this.getDefaultYear());
      }

      return result;
    } catch (error) {
      const errorMessage = `Hourly sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMessage);

      return {
        success: false,
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [errorMessage],
        duration: 0
      };
    }
  }

  /**
   * Perform daily sync (full season refresh)
   */
  async performDailySync(year: number = this.getDefaultYear()): Promise<SyncResult> {
    console.log('Starting daily full sync');
    return this.syncAllSeasonEvents(year);
  }

  /**
   * Sync events for a custom date range with automatic chunking
   */
  async syncDateRange(startDate: string, endDate: string): Promise<SyncResult> {
    console.log(`Starting sync for date range: ${startDate} to ${endDate}`);

    try {
      const apiEvents =  await this.apiClient.getAllEventsInRange({ start: startDate, end: endDate });
console.log(`Fetched ${apiEvents.length} events for date range`);

      const transformedEvents = this.transformationService.transformApiEvents(apiEvents);

      const result: SyncResult = {
        success: false,
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [],
        duration: 0
      };

      const startTime = Date.now();

      // Process events in bulk for better performance
      const processedEvents = await this.bulkProcessEvents(transformedEvents);
      result.eventsProcessed = processedEvents.processed;
      result.eventsCreated = processedEvents.created;
      result.eventsUpdated = processedEvents.updated;
      result.errors.push(...processedEvents.errors);

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Date range sync completed:`, result);

      // Warm S3 cache after successful sync
      if (result.success) {
        const hasDataChanges = result.eventsCreated > 0 || result.eventsUpdated > 0 || result.eventsDeleted > 0;
        await this.warmCacheAfterSync(hasDataChanges, this.getDefaultYear());
      }

      return result;
    } catch (error) {
      const errorMessage = `Date range sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMessage);

      return {
        success: false,
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [errorMessage],
        duration: 0
      };
    }
  }

  /**
   * Get health status of the sync service
   */
  async getHealthStatus(): Promise<{ healthy: boolean; message: string; details?: any }> {
    try {
      const apiHealth = await this.apiClient.healthCheck();

      if (!apiHealth.healthy) {
        return {
          healthy: false,
          message: `API health check failed: ${apiHealth.message}`
        };
      }

      // Test a small sync
      const testRange: DateRange = {
        start: '2026-08-01',
        end: '2026-08-02'
      };

      const testResult = await this.syncEvents(testRange);

      return {
        healthy: testResult.success,
        message: testResult.success ? 'Sync service healthy' : 'Sync service has issues',
        details: {
          apiHealth,
          testSyncResult: testResult
        }
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Process events in bulk with batch operations for better performance
   */
  private async bulkProcessEvents(events: ChautauquaEvent[]): Promise<{
    processed: number;
    created: number;
    updated: number;
    errors: string[];
  }> {
    const batchSize = EventsCalendarDataSyncService.DYNAMODB_BATCH_WRITE_LIMIT;
    const errors: string[] = [];
    let processed = 0;
    let created = 0;
    let updated = 0;

    // First, get all existing events in bulk
    const existingEventsMap = await this.getExistingEventsInBulk(events.map(e => e.id));

    // Process events in batches
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);

      try {
        const batchResult = await this.processBatch(batch, existingEventsMap);
        processed += batchResult.processed;
        created += batchResult.created;
        updated += batchResult.updated;
        errors.push(...batchResult.errors);
      } catch (error) {
        const errorMessage = `Error processing batch ${Math.floor(i / batchSize) + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMessage);
        errors.push(errorMessage);
      }
    }

    return { processed, created, updated, errors };
  }

  /**
   * Get multiple existing events in bulk
   */
  private async getExistingEventsInBulk(eventIds: number[]): Promise<Map<string, ChautauquaEvent>> {
    const existingEvents = new Map<string, ChautauquaEvent>();

    // Process in batches using DynamoDB BatchGet limit
    const batchSize = EventsCalendarDataSyncService.DYNAMODB_BATCH_GET_LIMIT;

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);

      try {
        // Use individual GetCommand calls in parallel instead of BatchGetCommand
        // This is more reliable and simpler to implement
        const promises = batch.map(async (eventId) => {
          try {
            const command = new GetCommand({
              TableName: this.tableName,
              Key: { id: eventId.toString() }
            });

            const response = await this.dbClient.send(command);
            if (response.Item) {
              return { id: eventId.toString(), event: response.Item as ChautauquaEvent };
            }
            return null;
          } catch (error) {
            console.error(`Error getting event ${eventId}:`, error);
            return null;
          }
        });

        const results = await Promise.all(promises);

        // Add successful results to the map
        results.forEach(result => {
          if (result) {
            existingEvents.set(result.id, result.event);
          }
        });
      } catch (error) {
        console.error(`Error in bulk get batch:`, error);
      }
    }

    return existingEvents;
  }

  /**
   * Process a batch of events using batch write
   */
  private async processBatch(events: ChautauquaEvent[], existingEventsMap: Map<string, ChautauquaEvent>): Promise<{
    processed: number;
    created: number;
    updated: number;
    errors: string[];
  }> {
    const writeRequests: Array<{
      PutRequest?: {
        Item: any;
      };
      DeleteRequest?: {
        Key: any;
      };
    }> = [];
    const errors: string[] = [];
    let created = 0;
    let updated = 0;

    // Prepare write requests for this batch
    for (const event of events) {
      try {
        const eventId = event.id.toString();
        const existingEvent = existingEventsMap.get(eventId);

        if (existingEvent) {
          // Check if update is needed
          const hasChanges = this.detectChanges(existingEvent, event);
          if (hasChanges) {
            writeRequests.push({
              PutRequest: {
                Item: {
                  ...event,
                  id: eventId,
                  lastUpdated: event.lastUpdated.toISOString(),
                  createdAt: existingEvent.createdAt, // Preserve creation time
                  updatedAt: new Date().toISOString()
                }
              }
            });
            updated++;
          }
        } else {
          // New event
          writeRequests.push({
            PutRequest: {
              Item: {
                ...event,
                id: eventId,
                lastUpdated: event.lastUpdated.toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            }
          });
          created++;
        }
      } catch (error) {
        const errorMessage = `Error preparing event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMessage);
        errors.push(errorMessage);
      }
    }

    // Execute batch write if there are requests
    if (writeRequests.length > 0) {
      try {
        const command = new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: writeRequests
          }
        });

        const response = await this.dbClient.send(command);

        // Handle unprocessed items (retry logic could be added here)
        if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
          console.warn(`Some items were not processed in batch write:`, response.UnprocessedItems);
          // For now, we'll count these as errors
          const unprocessedCount = response.UnprocessedItems[this.tableName]?.length || 0;
          errors.push(`${unprocessedCount} items were not processed in batch write`);
        }

        console.log(`Batch processed: ${created} created, ${updated} updated`);
      } catch (error) {
        const errorMessage = `Batch write failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMessage);
        errors.push(errorMessage);
      }
    }

    return {
      processed: events.length,
      created,
      updated,
      errors
    };
  }

  /**
   * Get existing event from database
   */
  private async getExistingEvent(eventId: number): Promise<ChautauquaEvent | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { id: eventId.toString() }
      });

      const response = await this.dbClient.send(command);
      return response.Item as ChautauquaEvent | null;
    } catch (error) {
      console.error(`Error getting existing event ${eventId}:`, error);
      return null;
    }
  }

  /**
   * Create new event in database
   */
  private async createEvent(event: ChautauquaEvent): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          ...event,
          id: event.id.toString(), // Ensure ID is a string for DynamoDB
          lastUpdated: event.lastUpdated.toISOString(), // Convert Date to string
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });

      await this.dbClient.send(command);
      console.log(`Created new event: ${event.title} (ID: ${event.id})`);
    } catch (error) {
      console.error(`Error creating event ${event.id}:`, error);
      throw error;
    }
  }

  /**
   * Update existing event in database
   */
  private async updateEvent(existingEvent: ChautauquaEvent, newEvent: ChautauquaEvent): Promise<boolean> {
    try {
      // Compare events and update if needed
      const hasChanges = this.detectChanges(existingEvent, newEvent);

      if (hasChanges) {
        const command = new PutCommand({
          TableName: this.tableName,
          Item: {
            ...newEvent,
            id: newEvent.id.toString(), // Ensure ID is a string for DynamoDB
            lastUpdated: newEvent.lastUpdated.toISOString(), // Convert Date to string
            createdAt: existingEvent.createdAt, // Preserve creation time
            updatedAt: new Date().toISOString()
          }
        });

        await this.dbClient.send(command);
        console.log(`Updated event: ${newEvent.title} (ID: ${newEvent.id})`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`Error updating event ${newEvent.id}:`, error);
      throw error;
    }
  }

  /**
   * Detect changes between events
   */
  private detectChanges(existingEvent: ChautauquaEvent, newEvent: ChautauquaEvent): boolean {
    // Compare key fields that might change
    const fieldsToCompare = [
      'title', 'description', 'startDate', 'endDate',
      'location', 'cost', 'status', 'featured'
    ];

    for (const field of fieldsToCompare) {
      if (existingEvent[field as keyof ChautauquaEvent] !== newEvent[field as keyof ChautauquaEvent]) {
        return true;
      }
    }

    // Compare categories
    if (JSON.stringify(existingEvent.categories) !== JSON.stringify(newEvent.categories)) {
      return true;
    }

    // Compare tags
    if (JSON.stringify(existingEvent.tags.sort()) !== JSON.stringify(newEvent.tags.sort())) {
      return true;
    }

    return false;
  }

  /**
   * Warm S3 cache with common calendar queries after data updates
   * This ensures CloudFront can serve from S3 cache without invoking Lambda
   */
  private async warmCacheAfterSync(hasDataChanges: boolean, year?: number): Promise<void> {
    const activeYear = year || this.getDefaultYear();
    console.log(`Starting cache warming for year ${activeYear} - hasDataChanges: ${hasDataChanges}`);

    try {
      // Common cache keys that API requests use
      // Using predictable cache keys for direct CloudFront access
      const commonCacheKeys = [
        // All events for specific year (no filters) - most common request
        // This will generate cache key: "all-events-2026"
        { filters: {}, year: activeYear },
        // Legacy all events (for backward compatibility)
        // This will generate cache key: "all-events"
        { filters: {}, year: undefined },

        // Today's events
        // This will generate cache key: "events-YYYY-MM-DD"
        {
          filters: {
            dateRange: {
              start: new Date().toISOString().split('T')[0],
              end: new Date().toISOString().split('T')[0]
            }
          },
          year: undefined
        },

        // This week's events (next 7 days)
        // This will generate cache key: "events-YYYY-MM-DD-to-YYYY-MM-DD"
        {
          filters: {
            dateRange: {
              start: new Date().toISOString().split('T')[0],
              end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            }
          },
          year: undefined
        }
      ];

      for (const cacheKey of commonCacheKeys) {
        try {
          if (hasDataChanges) {
            // Data changed - fetch fresh data and warm cache
            console.log('Data changes detected - fetching fresh events for cache warming');
            const events = await this.queryEventsForCacheWarming(cacheKey.filters, cacheKey.year);
            await this.cacheService.set(cacheKey, events);
            console.log(`Cache warmed for key: ${JSON.stringify(cacheKey.filters)} - ${events.length} events`);
          } else {
            // No data changes - just refresh cache timestamp to extend TTL
            const existingData = await this.cacheService.get(cacheKey);
            if (existingData) {
              await this.cacheService.set(cacheKey, existingData);
              console.log(`Cache timestamp refreshed for key: ${JSON.stringify(cacheKey.filters)}`);
            } else {
              // Cache was empty, fetch and populate
              console.log('Cache was empty - fetching events for cache warming');
              const events = await this.queryEventsForCacheWarming(cacheKey.filters, cacheKey.year);
              await this.cacheService.set(cacheKey, events);
              console.log(`Cache populated for key: ${JSON.stringify(cacheKey.filters)} - ${events.length} events`);
            }
          }
        } catch (error) {
          console.error(`Failed to warm cache for key ${JSON.stringify(cacheKey.filters)}:`, error);
          // Continue with next cache key even if one fails
        }
      }

      // Generate years manifest after cache warming
      await this.generateYearsManifest();

      console.log('Cache warming completed successfully');
    } catch (error) {
      console.error('Cache warming failed:', error);
      // Don't throw - cache warming is optional optimization
    }
  }

  /**
   * Query events for cache warming (mirrors calendar handler logic)
   */
  private async queryEventsForCacheWarming(filters?: any, year?: number): Promise<any[]> {
    console.log(`[CACHE_WARMING_DEBUG] queryEventsForCacheWarming called with year=${year}, filters=${JSON.stringify(filters)}`);
    try {
      // Use scan command to get all events (simplified version of calendar handler logic)
      const allEvents: any[] = [];
      let lastEvaluatedKey: any = undefined;

      // Paginate through all results to handle DynamoDB 1MB scan limit
      do {
        // Build filter expression based on whether year is provided
        let filterExpression = '#status = :status';
        const expressionAttributeNames: any = {
          '#status': 'status'
        };
        const expressionAttributeValues: any = {
          ':status': 'publish'
        };

        // Add year filter if provided to reduce data scanned
        if (year) {
          // Filter by year in the startDate field (YYYY-MM-DD format)
          filterExpression += ' AND begins_with(#startDate, :yearPrefix)';
          expressionAttributeNames['#startDate'] = 'startDate';
          expressionAttributeValues[':yearPrefix'] = `${year}-`;
          console.log(`[CACHE_WARMING_DEBUG] Adding year filter for year ${year} with prefix '${year}-'`);
        } else {
          console.log(`[CACHE_WARMING_DEBUG] No year filter applied - will fetch all events`);
        }

        console.log(`[CACHE_WARMING_DEBUG] Final FilterExpression: ${filterExpression}`);
        console.log(`[CACHE_WARMING_DEBUG] ExpressionAttributeValues:`, expressionAttributeValues);

        const command = new ScanCommand({
          TableName: this.tableName,
          FilterExpression: filterExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ExclusiveStartKey: lastEvaluatedKey
        });

        const response = await this.dbClient.send(command);

        if (response.Items) {
          allEvents.push(...response.Items);
        }

        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      console.log(`Cache warming: Retrieved ${allEvents.length} events from DynamoDB${year ? ` for year ${year}` : ''}`);
      let events = allEvents;

      // Note: Year filtering is now done at the database level using begins_with filter
      // This additional filtering is kept as a safety check for edge cases
      if (year && allEvents.length > 0) {
        // Verify all events are from the correct year (safety check)
        const incorrectYearEvents = events.filter(event => {
          if (!event.startDate) return true;

          // Robustly extract year from startDate (supports ISO and "YYYY-MM-DD HH:MM:SS" formats)
          const dateObj = new Date(event.startDate);
          if (isNaN(dateObj.getTime())) return true; // Invalid date - filter out
          const eventYear = dateObj.getFullYear();

          return eventYear !== year;
        });

        if (incorrectYearEvents.length > 0) {
          console.warn(`Found ${incorrectYearEvents.length} events from incorrect years - filtering them out`);
          events = events.filter(event => {
            if (!event.startDate) return false;

            // Robustly extract year from startDate
            const dateObj = new Date(event.startDate);
            if (isNaN(dateObj.getTime())) return false; // Invalid date
            const eventYear = dateObj.getFullYear();

            return eventYear === year;
          });
        }
      }

      // Apply basic filtering similar to calendar handler
      if (filters?.dateRange) {
        const startDate = new Date(filters.dateRange.start);
        const endDate = new Date(filters.dateRange.end);
        events = events.filter(event => {
          const eventDate = new Date(event.startDate);
          return eventDate >= startDate && eventDate <= endDate;
        });
      }

      if (filters?.categories?.length > 0) {
        events = events.filter(event =>
          event.categories && event.categories.some((cat: any) =>
            filters.categories.includes(cat.name) || filters.categories.includes(cat.slug)
          )
        );
      }

      // Transform to match API response format
      return events.map(event => ({
        id: event.id,
        uid: event.uid,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        timezone: event.timezone || 'America/New_York',
        venue: event.venue,
        location: event.location,
        categories: event.categories || [],
        tags: event.tags || [],
        category: event.category,
        cost: event.cost,
        url: event.url,
        image: event.image,
        status: event.status,
        featured: event.featured || false,
        week: event.week,
        confidence: event.confidence,
        source: event.source
      }));
    } catch (error) {
      console.error('Error querying events for cache warming:', error);
      return [];
    }
  }

  /**
   * Sync near-term events: 7 days in the past through 14 days ahead.
   * Used for hourly sync during the summer season (June-August).
   */
  async syncNearTerm(year: number): Promise<SyncResult> {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const end = new Date(now);
    end.setDate(end.getDate() + 14);

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    console.log(`Performing near-term sync (year: ${year}) for ${startStr} to ${endStr}`);
    return this.syncDateRange(startStr, endStr);
  }

  /**
   * Sync distant future events for current year (full year) and all of next year.
   * Used for daily sync.
   */
  async syncDistantFuture(currentYear: number, nextYear: number): Promise<{
    currentYear: SyncResult;
    nextYear: SyncResult;
  }> {
    console.log(`Performing distant future sync: current year ${currentYear}, next year ${nextYear}`);
    const currentResult = await this.syncFullYearEvents(currentYear);
    const nextResult = await this.syncFullYearEvents(nextYear);

    return {
      currentYear: currentResult,
      nextYear: nextResult,
    };
  }

  /**
   * Generate a years.json manifest listing which years have cached event data.
   * Written to S3 so the frontend can discover available years.
   */
  private async generateYearsManifest(): Promise<void> {
    const now = new Date();
    const defaultYear = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();

    // Check which years have data using HeadObject (cheaper than fetching full cache)
    const bucket = process.env.CACHE_S3_BUCKET;
    const prefix = process.env.CACHE_S3_KEY_PREFIX || 'cache/calendar-cache';
    const potentialYears: number[] = [];
    for (let year = 2025; year <= defaultYear + 1; year++) {
      potentialYears.push(year);
    }

    const availableYears: number[] = [];
    if (bucket) {
      const s3Client = this.cacheService.getS3Client();
      for (const year of potentialYears) {
        try {
          await s3Client.send(new HeadObjectCommand({
            Bucket: bucket,
            Key: `${prefix}/all-events-${year}.json`,
          }));
          availableYears.push(year);
        } catch {
          // Year doesn't have cached data
        }
      }
    }

    if (availableYears.length === 0) {
      availableYears.push(defaultYear);
    }

    const manifest = {
      years: availableYears.sort((a, b) => a - b),
      defaultYear,
      generated: new Date().toISOString(),
    };

    // Write manifest to S3
    if (bucket) {
      try {
        const s3Client = this.cacheService.getS3Client();
        await s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/years.json`,
          Body: JSON.stringify(manifest),
          ContentType: 'application/json',
          CacheControl: 'public, max-age=3600',
        }));
        console.log(`Years manifest written: ${JSON.stringify(manifest)}`);
      } catch (error) {
        console.error('Failed to write years manifest:', error);
      }
    }
  }

  /**
   * Clear API cache
   */
  clearCache(): void {
    this.apiClient.clearCache();
  }
}