import { SyncScheduler } from '../services/syncScheduler';
import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { jest } from '@jest/globals';

// Mock the EventsCalendarDataSyncService
jest.mock('../services/eventsCalendarDataSyncService');

const mockDbClient = {
  send: jest.fn(),
} as unknown as DynamoDBDocumentClient;

describe('SyncScheduler', () => {
  let scheduler: SyncScheduler;
  let mockSyncService: jest.Mocked<EventsCalendarDataSyncService>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a mock sync service
    mockSyncService = {
      syncAllSeasonEvents: jest.fn(),
      performDailySync: jest.fn(),
      performHourlySync: jest.fn(),
      syncEvents: jest.fn(),
      getHealthStatus: jest.fn(),
      clearCache: jest.fn(),
    } as any;
    
    // Mock the constructor
    (EventsCalendarDataSyncService as jest.MockedClass<typeof EventsCalendarDataSyncService>).mockImplementation(() => mockSyncService);
    
    scheduler = new SyncScheduler(mockDbClient);
  });

  describe('constructor', () => {
    it('should create sync scheduler with database client', () => {
      expect(scheduler).toBeDefined();
      expect(EventsCalendarDataSyncService).toHaveBeenCalledWith(undefined, mockDbClient);
    });
  });

  describe('start', () => {
    it('should start scheduler without throwing', () => {
      expect(() => scheduler.start()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop scheduler without throwing', () => {
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should return scheduler status', () => {
      const status = scheduler.getStatus();
      
      expect(status).toHaveProperty('dailySyncActive');
      expect(status).toHaveProperty('hourlySyncActive');
      expect(status).toHaveProperty('nextDailySync');
      expect(status).toHaveProperty('nextHourlySync');
      expect(typeof status.dailySyncActive).toBe('boolean');
      expect(typeof status.hourlySyncActive).toBe('boolean');
      expect(typeof status.nextDailySync).toBe('string');
      expect(typeof status.nextHourlySync).toBe('string');
    });

    it('should show inactive status when stopped', () => {
      const status = scheduler.getStatus();
      
      expect(status.dailySyncActive).toBe(false);
      expect(status.hourlySyncActive).toBe(false);
    });
  });

  describe('performImmediateFullSync', () => {
    it('should perform immediate full sync', async () => {
      mockSyncService.syncAllSeasonEvents.mockResolvedValue({
        success: true,
        eventsProcessed: 100,
        eventsCreated: 50,
        eventsUpdated: 30,
        eventsDeleted: 20,
        errors: [],
        duration: 5000,
      });

      await scheduler.performImmediateFullSync();

      expect(mockSyncService.syncAllSeasonEvents).toHaveBeenCalled();
    });

    it('should handle sync failures', async () => {
      mockSyncService.syncAllSeasonEvents.mockRejectedValue(new Error('Sync failed'));

      await scheduler.performImmediateFullSync();

      expect(mockSyncService.syncAllSeasonEvents).toHaveBeenCalled();
    });
  });

  describe('start/stop lifecycle', () => {
    it('should handle start and stop sequence', () => {
      expect(() => {
        scheduler.start();
        scheduler.stop();
      }).not.toThrow();
    });
  });
});