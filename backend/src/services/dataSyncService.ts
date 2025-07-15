import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChautauquaEvent, EventChange } from '../types/index';
import { ICSParserService, ParsedICSData } from './icsParser';
import { format, addMonths, startOfMonth, endOfMonth, differenceInHours } from 'date-fns';

export interface SyncOptions {
  forceUpdate?: boolean;
  monthsToSync?: number;
  baseUrl?: string;
}

export interface SyncResult {
  success: boolean;
  eventsAdded: number;
  eventsUpdated: number;
  eventsSkipped: number;
  errors: string[];
  lastSyncTime: Date;
}

export class DataSyncService {
  private dynamoClient: DynamoDBDocumentClient;
  private eventsTableName: string;
  private baseUrl: string;

  constructor(
    dynamoClient?: DynamoDBDocumentClient,
    eventsTableName?: string,
    baseUrl?: string
  ) {
    this.dynamoClient = dynamoClient || DynamoDBDocumentClient.from(new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
      }),
    }), {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
    this.eventsTableName = eventsTableName || process.env.EVENTS_TABLE_NAME || 'chq-calendar-events';
    this.baseUrl = baseUrl || 'https://www.chq.org/events/month/';
  }

  /**
   * Sync events for multiple months based on proximity
   */
  async syncEventData(options: SyncOptions = {}): Promise<SyncResult> {
    const {
      forceUpdate = false,
      monthsToSync = 3,
      baseUrl = this.baseUrl
    } = options;

    let eventsAdded = 0;
    let eventsUpdated = 0;
    let eventsSkipped = 0;
    const errors: string[] = [];

    try {
      // Generate months to sync - for Chautauqua, sync June, July, August
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const monthsToProcess = [];
      
      // Chautauqua season months: June, July, August
      const chautauquaMonths = [6, 7, 8]; // June, July, August
      
      if (monthsToSync === 1) {
        // If syncing only 1 month, sync current month if it's in season, otherwise sync July
        const currentMonth = currentDate.getMonth() + 1; // getMonth() is 0-based
        if (chautauquaMonths.includes(currentMonth)) {
          monthsToProcess.push(new Date(currentYear, currentMonth - 1, 1));
        } else {
          monthsToProcess.push(new Date(currentYear, 6, 1)); // July
        }
      } else {
        // Sync all requested months from the Chautauqua season
        const monthsToInclude = chautauquaMonths.slice(0, Math.min(monthsToSync, 3));
        for (const month of monthsToInclude) {
          monthsToProcess.push(new Date(currentYear, month - 1, 1));
        }
      }

      // Process each month
      for (const monthDate of monthsToProcess) {
        try {
          const monthResult = await this.syncMonth(monthDate, forceUpdate);
          eventsAdded += monthResult.eventsAdded;
          eventsUpdated += monthResult.eventsUpdated;
          eventsSkipped += monthResult.eventsSkipped;
          
          if (monthResult.errors.length > 0) {
            errors.push(...monthResult.errors);
          }
        } catch (error) {
          const errorMsg = `Failed to sync month ${format(monthDate, 'yyyy-MM')}: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      return {
        success: errors.length === 0,
        eventsAdded,
        eventsUpdated,
        eventsSkipped,
        errors,
        lastSyncTime: new Date(),
      };

    } catch (error) {
      console.error('Error in syncEventData:', error);
      return {
        success: false,
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsSkipped: 0,
        errors: [`Sync failed: ${error}`],
        lastSyncTime: new Date(),
      };
    }
  }

  /**
   * Sync events for a specific month
   */
  async syncMonth(monthDate: Date, forceUpdate: boolean = false): Promise<SyncResult> {
    const monthStr = format(monthDate, 'yyyy-MM');
    
    // Always use the full month format to get all events for the month
    const icsUrl = `${this.baseUrl}${monthStr}/?ical=1`;
    console.log(`Fetching ICS data for ${monthStr} from: ${icsUrl}`);
    
    let eventsAdded = 0;
    let eventsUpdated = 0;
    let eventsSkipped = 0;
    const errors: string[] = [];

    try {
      // Fetch ICS data
      const icsData = await this.fetchICSData(icsUrl);
      
      // Parse ICS data
      const parsedData = ICSParserService.parseICSData(icsData);
      console.log(`Parsed ${parsedData.events.length} events for ${monthStr}`);

      // Process each event
      for (const icsEvent of parsedData.events) {
        try {
          const result = await this.processEvent(icsEvent, forceUpdate);
          
          if (result.action === 'added') {
            eventsAdded++;
          } else if (result.action === 'updated') {
            eventsUpdated++;
          } else {
            eventsSkipped++;
          }
        } catch (error) {
          const errorMsg = `Failed to process event ${icsEvent.uid}: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      return {
        success: errors.length === 0,
        eventsAdded,
        eventsUpdated,
        eventsSkipped,
        errors,
        lastSyncTime: new Date(),
      };

    } catch (error) {
      console.error(`Error syncing month ${monthStr}:`, error);
      return {
        success: false,
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsSkipped: 0,
        errors: [`Failed to sync month ${monthStr}: ${error}`],
        lastSyncTime: new Date(),
      };
    }
  }

  /**
   * Process a single event (add, update, or skip)
   */
  private async processEvent(icsEvent: any, forceUpdate: boolean): Promise<{ action: 'added' | 'updated' | 'skipped' }> {
    const eventId = icsEvent.uid;
    
    // Check if event already exists
    const existingEvent = await this.getExistingEvent(eventId);
    
    if (!existingEvent) {
      // Add new event
      const chautauquaEvent = ICSParserService.convertToChautauquaEvent(icsEvent);
      await this.saveEvent(chautauquaEvent);
      console.log(`Added new event: ${chautauquaEvent.title}`);
      return { action: 'added' };
    }

    // Check if update is needed
    if (!forceUpdate && !ICSParserService.needsUpdate(existingEvent, icsEvent)) {
      return { action: 'skipped' };
    }

    // Update existing event
    const newEvent = ICSParserService.convertToChautauquaEvent(icsEvent);
    const changes = ICSParserService.detectChanges(existingEvent, newEvent);
    
    if (changes.length > 0) {
      // Update event with change log
      const updatedEvent: ChautauquaEvent = {
        ...newEvent,
        changeLog: [...(existingEvent.changeLog || []), ...changes],
        lastUpdated: new Date(),
        syncStatus: 'synced',
      };
      
      await this.saveEvent(updatedEvent);
      console.log(`Updated event: ${updatedEvent.title} (${changes.length} changes)`);
      return { action: 'updated' };
    }

    return { action: 'skipped' };
  }

  /**
   * Fetch ICS data from URL
   */
  private async fetchICSData(url: string): Promise<string> {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * Get existing event from database
   */
  private async getExistingEvent(eventId: string): Promise<ChautauquaEvent | null> {
    try {
      const command = new GetCommand({
        TableName: this.eventsTableName,
        Key: { id: eventId },
      });

      const result = await this.dynamoClient.send(command);
      return result.Item as ChautauquaEvent || null;
    } catch (error) {
      console.error(`Error getting existing event ${eventId}:`, error);
      return null;
    }
  }

  /**
   * Save event to database
   */
  private async saveEvent(event: ChautauquaEvent): Promise<void> {
    // Remove undefined values from the event object
    const cleanEvent = Object.fromEntries(
      Object.entries(event).filter(([_, value]) => value !== undefined)
    );

    const command = new PutCommand({
      TableName: this.eventsTableName,
      Item: {
        ...cleanEvent,
        // Convert dates to ISO strings for DynamoDB
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        lastUpdated: event.lastUpdated.toISOString(),
        createdAt: event.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Convert changeLog dates to ISO strings if they exist
        changeLog: event.changeLog?.map(change => ({
          ...change,
          timestamp: change.timestamp instanceof Date ? change.timestamp.toISOString() : change.timestamp,
        })),
      },
    });

    await this.dynamoClient.send(command);
  }

  /**
   * Determine sync frequency based on event proximity
   */
  static getSyncFrequency(eventDate: Date): number {
    const now = new Date();
    const hoursUntilEvent = differenceInHours(eventDate, now);

    if (hoursUntilEvent <= 24) {
      return 30; // 30 minutes for events today
    } else if (hoursUntilEvent <= 168) { // 7 days
      return 120; // 2 hours for events this week
    } else if (hoursUntilEvent <= 720) { // 30 days
      return 360; // 6 hours for events this month
    } else {
      return 1440; // 24 hours for future events
    }
  }

  /**
   * Get events that need syncing based on their proximity
   */
  async getEventsNeedingSync(): Promise<ChautauquaEvent[]> {
    const command = new ScanCommand({
      TableName: this.eventsTableName,
      FilterExpression: 'syncStatus = :status OR lastUpdated < :threshold',
      ExpressionAttributeValues: {
        ':status': 'outdated',
        ':threshold': new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
      },
    });

    const result = await this.dynamoClient.send(command);
    return (result.Items as ChautauquaEvent[]) || [];
  }
}

export default DataSyncService;