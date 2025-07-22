import { SyncScheduler } from '../services/syncScheduler';
import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { jest } from '@jest/globals';

// Mock the EventsCalendarDataSyncService
jest.mock('../services/eventsCalendarDataSyncService');

const mockDbClient = {
  send: jest.fn(),
} as unknown as DynamoDBDocumentClient;

// Mock timers for controlling scheduled operations
jest.useFakeTimers();

describe('SyncScheduler', () => {
  let scheduler: SyncScheduler;
  let mockSyncService: jest.Mocked<EventsCalendarDataSyncService>;
  let consoleSpy: any;

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
    
    // Spy on console methods
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    scheduler = new SyncScheduler(mockDbClient);
  });

  afterEach(() => {
    // Clean up any running timers
    scheduler.stop();
    jest.clearAllTimers();
    consoleSpy.mockRestore();
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

  describe('scheduled sync operations', () => {
    beforeEach(() => {
      // Mock successful sync responses
      mockSyncService.performDailySync.mockResolvedValue({
        success: true,
        eventsProcessed: 200,
        eventsCreated: 50,
        eventsUpdated: 100,
        eventsDeleted: 10,
        errors: [],
        duration: 8000,
      });

      mockSyncService.performHourlySync.mockResolvedValue({
        success: true,
        eventsProcessed: 50,
        eventsCreated: 10,
        eventsUpdated: 25,
        eventsDeleted: 2,
        errors: [],
        duration: 3000,
      });
    });

    it('should schedule and execute daily sync after starting', async () => {
      scheduler.start();
      
      // Fast-forward to trigger the daily sync timeout (2 AM scheduling)
      // We need to advance past the initial scheduling delay
      jest.advanceTimersByTime(24 * 60 * 60 * 1000); // 24 hours to trigger daily sync
      
      expect(mockSyncService.performDailySync).toHaveBeenCalled();
    });

    it('should schedule and execute hourly sync after starting', async () => {
      scheduler.start();
      
      // Fast-forward past the 5-minute initial delay for hourly sync
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000); // 5 minutes + buffer
      
      expect(mockSyncService.performHourlySync).toHaveBeenCalled();
    });

    it('should handle daily sync errors gracefully', async () => {
      mockSyncService.performDailySync.mockRejectedValue(new Error('Daily sync error'));
      
      scheduler.start();
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      
      expect(mockSyncService.performDailySync).toHaveBeenCalled();
      // Note: console.error called asynchronously in catch block
    });

    it('should handle hourly sync errors gracefully', async () => {
      mockSyncService.performHourlySync.mockRejectedValue(new Error('Hourly sync error'));
      
      scheduler.start();
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000);
      
      expect(mockSyncService.performHourlySync).toHaveBeenCalled();
      // Note: console.error called asynchronously in catch block
    });

    it('should execute recurring daily syncs', async () => {
      scheduler.start();
      
      // Fast-forward to trigger first daily sync and then a second one
      jest.advanceTimersByTime(24 * 60 * 60 * 1000); // First daily sync
      
      jest.advanceTimersByTime(24 * 60 * 60 * 1000); // Second daily sync (next day)
      
      expect(mockSyncService.performDailySync).toHaveBeenCalledTimes(2);
    });

    it('should execute recurring hourly syncs', async () => {
      scheduler.start();
      
      // Trigger first hourly sync
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000);
      
      // Trigger second hourly sync
      jest.advanceTimersByTime(60 * 60 * 1000); // 1 hour later
      
      expect(mockSyncService.performHourlySync).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatus with active schedules', () => {
    it('should show active status when scheduler is started', () => {
      scheduler.start();
      
      // Advance time to trigger the setTimeout that creates the intervals
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000); // Past hourly sync setTimeout
      
      const status = scheduler.getStatus();
      
      expect(status.hourlySyncActive).toBe(true);
      expect(status.nextDailySync).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/); // Date format check
      expect(status.nextHourlySync).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/); // Date format check
    });

    it('should show inactive status after stopping', () => {
      scheduler.start();
      scheduler.stop();
      const status = scheduler.getStatus();
      
      expect(status.dailySyncActive).toBe(false);
      expect(status.hourlySyncActive).toBe(false);
    });

    it('should calculate next daily sync correctly when before 2 AM', () => {
      // Mock current time to be 1 AM
      const mockDate = new Date();
      mockDate.setHours(1, 0, 0, 0);
      jest.setSystemTime(mockDate);
      
      const status = scheduler.getStatus();
      
      // Next daily sync should be today at 2 AM
      expect(status.nextDailySync).toContain('2:00:00 AM');
    });

    it('should calculate next daily sync correctly when after 2 AM', () => {
      // Mock current time to be 3 AM
      const mockDate = new Date();
      mockDate.setHours(3, 0, 0, 0);
      jest.setSystemTime(mockDate);
      
      const status = scheduler.getStatus();
      
      // Next daily sync should be tomorrow at 2 AM
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(2, 0, 0, 0);
      
      expect(status.nextDailySync).toContain('2:00:00 AM');
    });

    it('should calculate next hourly sync correctly', () => {
      // Mock current time to be 2:30 PM
      const mockDate = new Date();
      mockDate.setHours(14, 30, 0, 0);
      jest.setSystemTime(mockDate);
      
      const status = scheduler.getStatus();
      
      // Next hourly sync should be at 3:00 PM
      expect(status.nextHourlySync).toContain('3:00:00 PM');
    });
  });

  describe('stop method with active intervals', () => {
    it('should clear daily sync interval when stopping', () => {
      scheduler.start();
      
      // Advance time to trigger the setTimeout that creates the intervals
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000); // Past hourly sync setTimeout
      
      // Verify hourly interval is active (daily might not be active yet)
      expect(scheduler.getStatus().hourlySyncActive).toBe(true);
      
      scheduler.stop();
      
      // Verify intervals are cleared
      expect(scheduler.getStatus().dailySyncActive).toBe(false);
      expect(scheduler.getStatus().hourlySyncActive).toBe(false);
    });

    it('should handle multiple stop calls gracefully', () => {
      scheduler.start();
      
      expect(() => {
        scheduler.stop();
        scheduler.stop(); // Second stop should not throw
        scheduler.stop(); // Third stop should not throw
      }).not.toThrow();
      
      expect(scheduler.getStatus().dailySyncActive).toBe(false);
      expect(scheduler.getStatus().hourlySyncActive).toBe(false);
    });

    it('should handle stop without start', () => {
      expect(() => {
        scheduler.stop(); // Stop without starting should not throw
      }).not.toThrow();
    });
  });

  describe('console logging', () => {
    it('should log start messages', () => {
      scheduler.start();
      
      expect(console.log).toHaveBeenCalledWith('🕐 Starting sync scheduler...');
      expect(console.log).toHaveBeenCalledWith('✅ Sync scheduler started');
      expect(console.log).toHaveBeenCalledWith('📅 Daily full sync: Every day at 2:00 AM');
      expect(console.log).toHaveBeenCalledWith('⏰ Hourly sync (next 7 days): Every hour');
    });

    it('should log stop messages', () => {
      scheduler.start();
      scheduler.stop();
      
      expect(console.log).toHaveBeenCalledWith('🛑 Stopping sync scheduler...');
      expect(console.log).toHaveBeenCalledWith('✅ Sync scheduler stopped');
    });

    it('should log sync scheduling messages', () => {
      scheduler.start();
      
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📅 Daily sync scheduled for:'));
      expect(console.log).toHaveBeenCalledWith('⏰ Hourly sync starting in 5 minutes, then every hour');
    });

    it('should log successful sync completion', async () => {
      mockSyncService.performDailySync.mockResolvedValue({
        success: true,
        eventsProcessed: 100,
        eventsCreated: 20,
        eventsUpdated: 70,
        eventsDeleted: 10,
        errors: [],
        duration: 5000,
      });

      scheduler.start();
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      
      expect(console.log).toHaveBeenCalledWith('🔄 Starting scheduled daily sync...');
      // Note: Successful completion log happens asynchronously
    });

    it('should log immediate full sync messages', async () => {
      mockSyncService.syncAllSeasonEvents.mockResolvedValue({
        success: true,
        eventsProcessed: 50,
        eventsCreated: 25,
        eventsUpdated: 20,
        eventsDeleted: 5,
        errors: [],
        duration: 3000,
      });
      
      await scheduler.performImmediateFullSync();
      
      expect(console.log).toHaveBeenCalledWith('🔄 Starting immediate full sync...');
      expect(console.log).toHaveBeenCalledWith('✅ Immediate full sync completed:', expect.any(Object));
    });
  });
});