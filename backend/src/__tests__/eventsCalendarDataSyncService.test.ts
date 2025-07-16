import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { EventsCalendarApiClient } from '../services/eventsCalendarApiClient';
import { EventTransformationService } from '../services/eventTransformationService';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('../services/eventsCalendarApiClient');
jest.mock('../services/eventTransformationService');

const mockApiClient = {
  getAllEventsInRange: jest.fn(),
  getSeasonEvents: jest.fn(),
  getNext7DaysEvents: jest.fn(),
  getEventsWithChunking: jest.fn(),
  healthCheck: jest.fn(),
  clearCache: jest.fn(),
} as any;

const mockDbClient = {
  send: jest.fn(),
} as any;

describe('EventsCalendarDataSyncService', () => {
  let syncService: EventsCalendarDataSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock the constructor calls
    (EventsCalendarApiClient as any).mockImplementation(() => mockApiClient);
    
    // Mock static methods
    (EventTransformationService.transformApiEvents as jest.Mock) = jest.fn();
    (EventTransformationService.transformApiEvent as jest.Mock) = jest.fn();
    
    syncService = new EventsCalendarDataSyncService(mockApiClient, mockDbClient);
  });

  describe('syncEvents', () => {
    it('should sync events for a date range successfully', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Test Event 1',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
        {
          id: 2,
          title: 'Test Event 2',
          start_date: '2025-07-02T14:00:00',
          end_date: '2025-07-02T15:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: true,
        },
      ];

      const mockTransformedEvents = [
        {
          id: 1,
          uid: 'event-1',
          title: 'Test Event 1',
          startDate: '2025-07-01T10:00:00',
          endDate: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          tags: [],
          category: 'General',
          week: 1,
          dayOfWeek: 1,
          confidence: 'confirmed',
          syncStatus: 'synced',
          lastModified: '2025-07-01T10:00:00',
          source: 'events-calendar-api',
          status: 'publish',
          featured: false,
          lastUpdated: new Date(),
        },
        {
          id: 2,
          uid: 'event-2',
          title: 'Test Event 2',
          startDate: '2025-07-02T14:00:00',
          endDate: '2025-07-02T15:00:00',
          timezone: 'America/New_York',
          categories: [],
          tags: [],
          category: 'General',
          week: 1,
          dayOfWeek: 2,
          confidence: 'confirmed',
          syncStatus: 'synced',
          lastModified: '2025-07-02T14:00:00',
          source: 'events-calendar-api',
          status: 'publish',
          featured: true,
          lastUpdated: new Date(),
        },
      ];

      mockApiClient.getAllEventsInRange.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue(mockTransformedEvents);

      // Mock DynamoDB responses for checking existing events
      mockDbClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null }); // No existing events
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await syncService.syncEvents({
        start: '2025-07-01',
        end: '2025-07-07',
      });

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(2);
      expect(result.eventsCreated).toBe(2);
      expect(result.eventsUpdated).toBe(0);
      expect(result.eventsDeleted).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.duration).toBeGreaterThan(0);
      expect(mockApiClient.getAllEventsInRange).toHaveBeenCalledWith({
        start: '2025-07-01',
        end: '2025-07-07',
      });
      expect(EventTransformationService.transformApiEvents).toHaveBeenCalledWith(mockApiEvents);
    });

    it('should handle API errors gracefully', async () => {
      mockApiClient.getAllEventsInRange.mockRejectedValue(new Error('API error'));

      const result = await syncService.syncEvents({
        start: '2025-07-01',
        end: '2025-07-07',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Sync failed: API error');
      expect(result.eventsProcessed).toBe(0);
    });

    it('should update existing events when they have changed', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Updated Event',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
      ];

      const mockTransformedEvent = {
        id: 1,
        uid: 'event-1',
        title: 'Updated Event',
        startDate: '2025-07-01T10:00:00',
        endDate: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        tags: [],
        category: 'General',
        week: 1,
        dayOfWeek: 1,
        confidence: 'confirmed',
        syncStatus: 'synced',
        lastModified: '2025-07-01T12:00:00',
        source: 'events-calendar-api',
        status: 'publish',
        featured: false,
        lastUpdated: new Date(),
      };

      const existingEvent = {
        id: 1,
        uid: 'event-1',
        title: 'Old Event',
        startDate: '2025-07-01T10:00:00',
        endDate: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        lastModified: '2025-07-01T10:00:00', // Older than transformed event
        source: 'events-calendar-api',
        confidence: 'confirmed',
        syncStatus: 'synced',
        status: 'publish',
        featured: false,
        lastUpdated: new Date('2025-07-01T10:00:00'),
      };

      mockApiClient.getAllEventsInRange.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([mockTransformedEvent]);

      // Mock DynamoDB to return existing event
      mockDbClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: existingEvent });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await syncService.syncEvents({
        start: '2025-07-01',
        end: '2025-07-07',
      });

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsCreated).toBe(0);
      expect(result.eventsUpdated).toBe(1);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Test Event',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
      ];

      mockApiClient.getAllEventsInRange.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([
        {
          id: 1,
          uid: 'event-1',
          title: 'Test Event',
          startDate: '2025-07-01T10:00:00',
          endDate: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          tags: [],
          category: 'General',
          week: 1,
          dayOfWeek: 1,
          confidence: 'confirmed',
          syncStatus: 'synced',
          lastModified: '2025-07-01T10:00:00',
          source: 'events-calendar-api',
          status: 'publish',
          featured: false,
          lastUpdated: new Date(),
        },
      ]);

      // Mock DynamoDB to fail
      mockDbClient.send.mockRejectedValue(new Error('DynamoDB error'));

      const result = await syncService.syncEvents({
        start: '2025-07-01',
        end: '2025-07-07',
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(error => error.includes('DynamoDB error'))).toBe(true);
    });

    it('should handle empty API response', async () => {
      mockApiClient.getAllEventsInRange.mockResolvedValue([]);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([]);

      const result = await syncService.syncEvents({
        start: '2025-07-01',
        end: '2025-07-07',
      });

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(0);
      expect(result.eventsCreated).toBe(0);
      expect(result.eventsUpdated).toBe(0);
    });
  });

  describe('syncAllSeasonEvents', () => {
    it('should sync events for entire season', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Season Event',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
      ];

      const mockTransformedEvent = {
        id: 1,
        uid: 'season-event-1',
        title: 'Season Event',
        startDate: '2025-07-01T10:00:00',
        endDate: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        tags: [],
        category: 'General',
        week: 1,
        dayOfWeek: 1,
        confidence: 'confirmed',
        syncStatus: 'synced',
        lastModified: '2025-07-01T10:00:00',
        source: 'events-calendar-api',
        status: 'publish',
        featured: false,
        lastUpdated: new Date(),
      };

      mockApiClient.getSeasonEvents.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([mockTransformedEvent]);

      // Mock DynamoDB responses
      mockDbClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null }); // No existing events
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await syncService.syncAllSeasonEvents(2025);

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsCreated).toBe(1);
      expect(mockApiClient.getSeasonEvents).toHaveBeenCalledWith(2025);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when API is working', async () => {
      mockApiClient.healthCheck.mockResolvedValue({
        healthy: true,
        message: 'API is healthy',
      });

      mockApiClient.getAllEventsInRange.mockResolvedValue([]);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([]);

      const result = await syncService.getHealthStatus();

      expect(result.healthy).toBe(true);
      expect(result.message).toContain('Sync service healthy');
    });

    it('should return unhealthy status when API fails', async () => {
      mockApiClient.healthCheck.mockResolvedValue({
        healthy: false,
        message: 'API is down',
      });

      const result = await syncService.getHealthStatus();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('API is down');
    });
  });

  describe('performIncrementalSync', () => {
    it('should perform incremental sync for date range', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Incremental Event',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
      ];

      const mockTransformedEvent = {
        id: 1,
        uid: 'incremental-event-1',
        title: 'Incremental Event',
        startDate: '2025-07-01T10:00:00',
        endDate: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        tags: [],
        category: 'General',
        week: 1,
        dayOfWeek: 1,
        confidence: 'confirmed',
        syncStatus: 'synced',
        lastModified: '2025-07-01T10:00:00',
        source: 'events-calendar-api',
        status: 'publish',
        featured: false,
        lastUpdated: new Date(),
      };

      mockApiClient.getAllEventsInRange.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([mockTransformedEvent]);

      mockDbClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await syncService.performIncrementalSync();

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsCreated).toBe(1);
      expect(mockApiClient.getAllEventsInRange).toHaveBeenCalled();
    });
  });

  describe('performHourlySync', () => {
    it('should perform hourly sync for next 7 days', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Hourly Event',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
      ];

      const mockTransformedEvent = {
        id: 1,
        uid: 'hourly-event-1',
        title: 'Hourly Event',
        startDate: '2025-07-01T10:00:00',
        endDate: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        tags: [],
        category: 'General',
        week: 1,
        dayOfWeek: 1,
        confidence: 'confirmed',
        syncStatus: 'synced',
        lastModified: '2025-07-01T10:00:00',
        source: 'events-calendar-api',
        status: 'publish',
        featured: false,
        lastUpdated: new Date(),
      };

      mockApiClient.getNext7DaysEvents.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([mockTransformedEvent]);

      mockDbClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await syncService.performHourlySync();

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsCreated).toBe(1);
      expect(mockApiClient.getNext7DaysEvents).toHaveBeenCalled();
    });

    it('should handle errors during hourly sync', async () => {
      mockApiClient.getNext7DaysEvents.mockRejectedValue(new Error('API error'));

      const result = await syncService.performHourlySync();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Hourly sync failed: API error');
    });
  });

  describe('performDailySync', () => {
    it('should perform daily sync', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Daily Event',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
      ];

      const mockTransformedEvent = {
        id: 1,
        uid: 'daily-event-1',
        title: 'Daily Event',
        startDate: '2025-07-01T10:00:00',
        endDate: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        tags: [],
        category: 'General',
        week: 1,
        dayOfWeek: 1,
        confidence: 'confirmed',
        syncStatus: 'synced',
        lastModified: '2025-07-01T10:00:00',
        source: 'events-calendar-api',
        status: 'publish',
        featured: false,
        lastUpdated: new Date(),
      };

      mockApiClient.getSeasonEvents.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([mockTransformedEvent]);

      mockDbClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await syncService.performDailySync();

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsCreated).toBe(1);
    });
  });

  describe('syncDateRange', () => {
    it('should sync events for custom date range', async () => {
      const mockApiEvents = [
        {
          id: 1,
          title: 'Range Event',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
      ];

      const mockTransformedEvent = {
        id: 1,
        uid: 'range-event-1',
        title: 'Range Event',
        startDate: '2025-07-01T10:00:00',
        endDate: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        tags: [],
        category: 'General',
        week: 1,
        dayOfWeek: 1,
        confidence: 'confirmed',
        syncStatus: 'synced',
        lastModified: '2025-07-01T10:00:00',
        source: 'events-calendar-api',
        status: 'publish',
        featured: false,
        lastUpdated: new Date(),
      };

      mockApiClient.getEventsWithChunking.mockResolvedValue(mockApiEvents);
      (EventTransformationService.transformApiEvents as jest.Mock).mockReturnValue([mockTransformedEvent]);

      mockDbClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await syncService.syncDateRange('2025-07-01', '2025-07-31');

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsCreated).toBe(1);
      expect(mockApiClient.getEventsWithChunking).toHaveBeenCalledWith('2025-07-01', '2025-07-31');
    });

    it('should handle sync date range errors', async () => {
      mockApiClient.getEventsWithChunking.mockRejectedValue(new Error('Range error'));

      const result = await syncService.syncDateRange('2025-07-01', '2025-07-31');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Date range sync failed: Range error');
    });
  });

  describe('getSyncStatistics', () => {
    it('should return sync statistics', async () => {
      const stats = await syncService.getSyncStatistics();

      expect(stats).toHaveProperty('totalEvents');
      expect(stats).toHaveProperty('eventsByWeek');
      expect(stats).toHaveProperty('eventsByCategory');
      expect(stats).toHaveProperty('syncHistory');
      expect(typeof stats.totalEvents).toBe('number');
      expect(typeof stats.eventsByWeek).toBe('object');
      expect(typeof stats.eventsByCategory).toBe('object');
      expect(Array.isArray(stats.syncHistory)).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('should clear API cache', () => {
      expect(() => syncService.clearCache()).not.toThrow();
      expect(mockApiClient.clearCache).toHaveBeenCalled();
    });
  });

  describe('constructor', () => {
    it('should create service with provided dependencies', () => {
      const service = new EventsCalendarDataSyncService(mockApiClient, mockDbClient);
      expect(service).toBeDefined();
    });

    it('should throw error when no database client provided', () => {
      expect(() => {
        new EventsCalendarDataSyncService(mockApiClient);
      }).toThrow('Database client not provided');
    });
  });
});