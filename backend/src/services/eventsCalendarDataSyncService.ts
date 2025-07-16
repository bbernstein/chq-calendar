import { EventsCalendarApiClient } from './eventsCalendarApiClient';
import { EventTransformationService } from './eventTransformationService';
import { ChautauquaEvent, SyncResult, DateRange } from '../types';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

export class EventsCalendarDataSyncService {
  private apiClient: EventsCalendarApiClient;
  private transformationService: typeof EventTransformationService;
  private dbClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(apiClient?: EventsCalendarApiClient, dbClient?: DynamoDBDocumentClient) {
    this.apiClient = apiClient || new EventsCalendarApiClient();
    this.transformationService = EventTransformationService;
    this.dbClient = dbClient || (() => {
      // This will be injected from server.ts
      throw new Error('Database client not provided');
    })();
    this.tableName = process.env.EVENTS_TABLE_NAME || 'chq-calendar-events';
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

      // Process each event
      for (const event of transformedEvents) {
        try {
          // Check if event already exists
          const existingEvent = await this.getExistingEvent(event.id);
          
          if (existingEvent) {
            // Update existing event
            const updated = await this.updateEvent(existingEvent, event);
            if (updated) {
              result.eventsUpdated++;
            }
          } else {
            // Create new event
            await this.createEvent(event);
            result.eventsCreated++;
          }
          
          result.eventsProcessed++;
        } catch (error) {
          const errorMessage = `Error processing event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMessage);
          result.errors.push(errorMessage);
        }
      }

      // Clean up old events that are no longer in the API
      const deletedCount = await this.cleanupOldEvents(dateRange, transformedEvents);
      result.eventsDeleted = deletedCount;

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Sync completed in ${result.duration}ms:`, {
        processed: result.eventsProcessed,
        created: result.eventsCreated,
        updated: result.eventsUpdated,
        deleted: result.eventsDeleted,
        errors: result.errors.length
      });

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
   * Sync all events for the Chautauqua season
   */
  async syncAllSeasonEvents(year: number = 2025): Promise<SyncResult> {
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

      // Process all events
      for (const event of transformedEvents) {
        try {
          const existingEvent = await this.getExistingEvent(event.id);
          
          if (existingEvent) {
            const updated = await this.updateEvent(existingEvent, event);
            if (updated) result.eventsUpdated++;
          } else {
            await this.createEvent(event);
            result.eventsCreated++;
          }
          
          result.eventsProcessed++;
        } catch (error) {
          const errorMessage = `Error processing event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMessage);
          result.errors.push(errorMessage);
        }
      }

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Season sync completed:`, result);
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
    
    // Get date range for incremental sync (last 7 days to next 30 days)
    const now = new Date();
    const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
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

      // Process all events
      for (const event of transformedEvents) {
        try {
          const existingEvent = await this.getExistingEvent(event.id);
          
          if (existingEvent) {
            const updated = await this.updateEvent(existingEvent, event);
            if (updated) result.eventsUpdated++;
          } else {
            await this.createEvent(event);
            result.eventsCreated++;
          }
          
          result.eventsProcessed++;
        } catch (error) {
          const errorMessage = `Error processing event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMessage);
          result.errors.push(errorMessage);
        }
      }

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Hourly sync completed:`, result);
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
  async performDailySync(year: number = 2025): Promise<SyncResult> {
    console.log('Starting daily full sync');
    return this.syncAllSeasonEvents(year);
  }

  /**
   * Sync events for a custom date range with automatic chunking
   */
  async syncDateRange(startDate: string, endDate: string): Promise<SyncResult> {
    console.log(`Starting sync for date range: ${startDate} to ${endDate}`);
    
    try {
      const apiEvents = await this.apiClient.getEventsWithChunking(startDate, endDate);
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

      // Process all events
      for (const event of transformedEvents) {
        try {
          const existingEvent = await this.getExistingEvent(event.id);
          
          if (existingEvent) {
            const updated = await this.updateEvent(existingEvent, event);
            if (updated) result.eventsUpdated++;
          } else {
            await this.createEvent(event);
            result.eventsCreated++;
          }
          
          result.eventsProcessed++;
        } catch (error) {
          const errorMessage = `Error processing event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMessage);
          result.errors.push(errorMessage);
        }
      }

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      console.log(`Date range sync completed:`, result);
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
        start: '2025-08-01',
        end: '2025-08-02'
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
   * Clean up old events that are no longer in the API
   */
  private async cleanupOldEvents(dateRange: DateRange, currentEvents: ChautauquaEvent[]): Promise<number> {
    try {
      // This would typically:
      // 1. Query all events in the date range from database
      // 2. Compare with current events
      // 3. Delete events that are no longer in the API
      // TODO: Implement actual cleanup logic
      console.log(`Cleaning up old events for range ${dateRange.start} to ${dateRange.end}`);
      return 0;
    } catch (error) {
      console.error('Error cleaning up old events:', error);
      return 0;
    }
  }

  /**
   * Get sync statistics
   */
  async getSyncStatistics(): Promise<{
    lastSyncTime?: string;
    totalEvents: number;
    eventsByWeek: { [week: number]: number };
    eventsByCategory: { [category: string]: number };
    syncHistory: SyncResult[];
  }> {
    // TODO: Implement actual statistics gathering
    return {
      totalEvents: 0,
      eventsByWeek: {},
      eventsByCategory: {},
      syncHistory: []
    };
  }

  /**
   * Clear API cache
   */
  clearCache(): void {
    this.apiClient.clearCache();
  }
}

export default EventsCalendarDataSyncService;