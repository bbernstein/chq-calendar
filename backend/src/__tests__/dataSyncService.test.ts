import { DataSyncService } from '../services/dataSyncService';
import { ChautauquaEvent } from '../types/index';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { jest } from '@jest/globals';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Mock DynamoDB client
const mockDynamoClient = {
  send: jest.fn(),
} as any;

describe('DataSyncService', () => {
  let dataSyncService: DataSyncService;
  const mockICSData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chautauqua Institution
X-WR-CALNAME:Chautauqua Institution
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20250701T074500
DTEND;TZID=America/New_York:20250701T074500
DTSTAMP:20250713T103809
CREATED:20250410T221512Z
LAST-MODIFIED:20250410T221512Z
UID:test-event-123@www.chq.org
SUMMARY:Test Event
DESCRIPTION:Test description
URL:https://www.chq.org/event/test/
LOCATION:Test Location
CATEGORIES:Music,Week Two (June 28–July 5)
END:VEVENT
END:VCALENDAR`;

  beforeEach(() => {
    jest.clearAllMocks();
    dataSyncService = new DataSyncService(mockDynamoClient, 'test-events-table');
  });

  describe('syncEventData', () => {
    it('should sync events for multiple months successfully', async () => {
      // Mock fetch to return ICS data
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockICSData),
      } as Response);

      // Mock DynamoDB responses
      mockDynamoClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null }); // No existing event
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await dataSyncService.syncEventData({
        monthsToSync: 2,
        forceUpdate: false,
      });

      expect(result.success).toBe(true);
      expect(result.eventsAdded).toBeGreaterThan(0);
      expect(result.eventsUpdated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.lastSyncTime).toBeInstanceOf(Date);
    });

    it('should handle fetch errors gracefully', async () => {
      // Mock fetch to fail
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error('Network error'));

      const result = await dataSyncService.syncEventData({
        monthsToSync: 1,
      });

      expect(result.success).toBe(false);
      expect(result.eventsAdded).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      // Mock fetch to succeed
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockICSData),
      } as Response);

      // Mock DynamoDB to fail
      mockDynamoClient.send.mockRejectedValue(new Error('DynamoDB error'));

      const result = await dataSyncService.syncEventData({
        monthsToSync: 1,
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('syncMonth', () => {
    it('should sync events for a specific month', async () => {
      // Mock fetch
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockICSData),
      } as Response);

      // Mock DynamoDB - no existing event
      mockDynamoClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: null });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await dataSyncService.syncMonth(new Date('2025-07-01'), false);

      expect(result.success).toBe(true);
      expect(result.eventsAdded).toBe(1);
      expect(result.eventsUpdated).toBe(0);
      expect(result.eventsSkipped).toBe(0);
    });

    it('should update existing events when needed', async () => {
      const existingEvent: ChautauquaEvent = {
        id: 'test-event-123@www.chq.org',
        title: 'Old Title',
        startDate: new Date('2025-07-01T07:45:00'),
        endDate: new Date('2025-07-01T07:45:00'),
        location: 'Old Location',
        venue: 'Old Venue',
        tags: [],
        week: 2,
        dayOfWeek: 2,
        category: 'Music',
        lastUpdated: new Date('2025-06-01T10:00:00'),
        dataSource: 'chautauqua-api',
        confidence: 'confirmed',
        syncStatus: 'synced',
      };

      // Mock fetch
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockICSData),
      } as Response);

      // Mock DynamoDB - return existing event
      mockDynamoClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: existingEvent });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await dataSyncService.syncMonth(new Date('2025-07-01'), false);

      expect(result.success).toBe(true);
      expect(result.eventsAdded).toBe(0);
      expect(result.eventsUpdated).toBe(1);
      expect(result.eventsSkipped).toBe(0);
    });

    it('should skip events that do not need updating', async () => {
      const existingEvent: ChautauquaEvent = {
        id: 'test-event-123@www.chq.org',
        title: 'Test Event',
        startDate: new Date('2025-07-01T07:45:00'),
        endDate: new Date('2025-07-01T07:45:00'),
        location: 'Test Location',
        venue: 'Test Location',
        tags: [],
        week: 2,
        dayOfWeek: 2,
        category: 'Music',
        lastUpdated: new Date('2025-06-01T12:00:00'), // Later than ICS lastModified
        dataSource: 'chautauqua-api',
        confidence: 'confirmed',
        syncStatus: 'synced',
      };

      // Mock fetch
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockICSData),
      } as Response);

      // Mock DynamoDB - return existing event
      mockDynamoClient.send.mockImplementation((command: any) => {
        if (command instanceof GetCommand) {
          return Promise.resolve({ Item: existingEvent });
        }
        return Promise.resolve({});
      });

      const result = await dataSyncService.syncMonth(new Date('2025-07-01'), false);

      expect(result.success).toBe(true);
      expect(result.eventsAdded).toBe(0);
      expect(result.eventsUpdated).toBe(0);
      expect(result.eventsSkipped).toBe(1);
    });
  });

  describe('getSyncFrequency', () => {
    it('should return correct sync frequency based on event proximity', () => {
      const now = new Date();
      
      // Event today
      const eventToday = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours from now
      expect(DataSyncService.getSyncFrequency(eventToday)).toBe(30);

      // Event this week
      const eventThisWeek = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days from now
      expect(DataSyncService.getSyncFrequency(eventThisWeek)).toBe(120);

      // Event this month
      const eventThisMonth = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 days from now
      expect(DataSyncService.getSyncFrequency(eventThisMonth)).toBe(360);

      // Future event
      const futureEvent = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days from now
      expect(DataSyncService.getSyncFrequency(futureEvent)).toBe(1440);
    });
  });

  describe('getEventsNeedingSync', () => {
    it('should return events that need syncing', async () => {
      const mockEvents: ChautauquaEvent[] = [
        {
          id: 'event-1',
          title: 'Event 1',
          startDate: new Date(),
          endDate: new Date(),
          location: 'Location 1',
          venue: 'Venue 1',
          tags: [],
          week: 1,
          dayOfWeek: 1,
          category: 'Music',
          lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
          dataSource: 'chautauqua-api',
          confidence: 'confirmed',
          syncStatus: 'outdated',
        },
        {
          id: 'event-2',
          title: 'Event 2',
          startDate: new Date(),
          endDate: new Date(),
          location: 'Location 2',
          venue: 'Venue 2',
          tags: [],
          week: 1,
          dayOfWeek: 1,
          category: 'Music',
          lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
          dataSource: 'chautauqua-api',
          confidence: 'confirmed',
          syncStatus: 'synced',
        },
      ];

      mockDynamoClient.send.mockImplementation((command: any) => {
        if (command instanceof ScanCommand) {
          return Promise.resolve({ Items: mockEvents });
        }
        return Promise.resolve({});
      });

      const result = await dataSyncService.getEventsNeedingSync();
      
      expect(result).toHaveLength(2);
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-events-table',
            FilterExpression: 'syncStatus = :status OR lastUpdated < :threshold',
          }),
        })
      );
    });

    it('should handle DynamoDB errors', async () => {
      mockDynamoClient.send.mockRejectedValue(new Error('DynamoDB error'));

      await expect(dataSyncService.getEventsNeedingSync()).rejects.toThrow('DynamoDB error');
    });
  });

  describe('error handling', () => {
    it('should handle HTTP errors when fetching ICS data', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      const result = await dataSyncService.syncMonth(new Date('2025-07-01'), false);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('HTTP 404');
    });

    it('should handle network errors when fetching ICS data', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error('Network error'));

      const result = await dataSyncService.syncMonth(new Date('2025-07-01'), false);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle invalid ICS data gracefully', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('INVALID ICS DATA'),
      } as Response);

      const result = await dataSyncService.syncMonth(new Date('2025-07-01'), false);

      expect(result.success).toBe(true); // Should succeed with 0 events
      expect(result.eventsAdded).toBe(0);
      expect(result.eventsUpdated).toBe(0);
      expect(result.eventsSkipped).toBe(0);
    });
  });
});