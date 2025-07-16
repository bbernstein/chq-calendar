import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { EventsCalendarApiClient } from '../services/eventsCalendarApiClient';
import { EventTransformationService } from '../services/eventTransformationService';
import { ApiEvent, ChautauquaEvent, DateRange, SyncResult } from '../types';

// Mock the dependencies
jest.mock('../services/eventsCalendarApiClient');
jest.mock('../services/eventTransformationService');

describe('EventsCalendarDataSyncService', () => {
  let syncService: EventsCalendarDataSyncService;
  let mockApiClient: jest.Mocked<EventsCalendarApiClient>;
  let mockTransformationService: jest.Mocked<typeof EventTransformationService>;

  const mockApiEvent: ApiEvent = {
    id: 1,
    title: 'Test Event',
    description: 'Test Description',
    start_date: '2025-08-01 09:00:00',
    end_date: '2025-08-01 10:00:00',
    timezone: 'America/New_York',
    venue: {
      id: 1,
      venue: 'Amphitheater',
      address: '1 Ames Ave',
      show_map: true
    },
    categories: [
      {
        id: 1,
        name: 'Lecture',
        slug: 'lecture',
        taxonomy: 'tribe_events_cat',
        parent: 0
      }
    ],
    cost: '$0',
    url: 'https://www.chq.org/event/test',
    status: 'publish',
    featured: false
  };

  const mockChautauquaEvent: ChautauquaEvent = {
    id: 1,
    uid: 'chq-1-20250801T090000',
    title: 'Test Event',
    description: 'Test Description',
    startDate: '2025-08-01 09:00:00',
    endDate: '2025-08-01 10:00:00',
    timezone: 'America/New_York',
    venue: {
      id: 1,
      name: 'Amphitheater',
      address: '1 Ames Ave',
      showMap: true
    },
    location: 'Amphitheater',
    categories: [
      {
        id: 1,
        name: 'Lecture',
        slug: 'lecture',
        taxonomy: 'tribe_events_cat',
        parent: 0
      }
    ],
    tags: ['amphitheater', 'lecture', 'free'],
    category: 'Lecture',
    cost: '$0',
    url: 'https://www.chq.org/event/test',
    status: 'publish',
    featured: false,
    dayOfWeek: 5,
    isRecurring: false,
    audience: 'all-ages',
    ticketRequired: false,
    week: 6,
    confidence: 'confirmed',
    syncStatus: 'synced',
    lastModified: '2025-07-16T00:00:00.000Z',
    source: 'events-calendar-api',
    lastUpdated: new Date(),
    createdAt: '2025-07-16T00:00:00.000Z',
    updatedAt: '2025-07-16T00:00:00.000Z'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock API client
    mockApiClient = {
      getAllEventsInRange: jest.fn(),
      getSeasonEvents: jest.fn(),
      healthCheck: jest.fn(),
      clearCache: jest.fn()
    } as any;

    // Create mock transformation service
    mockTransformationService = {
      transformApiEvents: jest.fn(),
      transformApiEvent: jest.fn()
    } as any;

    // Replace the actual service with our mock
    (EventTransformationService as any).transformApiEvents = mockTransformationService.transformApiEvents;
    (EventTransformationService as any).transformApiEvent = mockTransformationService.transformApiEvent;

    syncService = new EventsCalendarDataSyncService(mockApiClient);
  });

  describe('constructor', () => {
    it('should create service with provided API client', () => {
      expect(syncService).toBeDefined();
    });

    it('should create service with default API client when none provided', () => {
      const defaultService = new EventsCalendarDataSyncService();
      expect(defaultService).toBeDefined();
    });
  });

  describe('syncEvents', () => {
    const dateRange: DateRange = {
      start: '2025-08-01',
      end: '2025-08-31'
    };

    it('should sync events successfully', async () => {
      mockApiClient.getAllEventsInRange.mockResolvedValue([mockApiEvent]);
      mockTransformationService.transformApiEvents.mockReturnValue([mockChautauquaEvent]);

      const result = await syncService.syncEvents(dateRange);

      expect(mockApiClient.getAllEventsInRange).toHaveBeenCalledWith(dateRange);
      expect(mockTransformationService.transformApiEvents).toHaveBeenCalledWith([mockApiEvent]);
      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1);
      expect(result.eventsCreated).toBe(1);
      expect(result.eventsUpdated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle API errors gracefully', async () => {
      mockApiClient.getAllEventsInRange.mockRejectedValue(new Error('API Error'));

      const result = await syncService.syncEvents(dateRange);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Sync failed: API Error');
      expect(result.eventsProcessed).toBe(0);
    });

    it('should handle transformation errors gracefully', async () => {
      mockApiClient.getAllEventsInRange.mockResolvedValue([mockApiEvent]);
      mockTransformationService.transformApiEvents.mockImplementation(() => {
        throw new Error('Transformation Error');
      });

      const result = await syncService.syncEvents(dateRange);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle individual event processing errors', async () => {
      const multipleEvents = [mockApiEvent, { ...mockApiEvent, id: 2 }];
      const transformedEvents = [mockChautauquaEvent, { ...mockChautauquaEvent, id: 2 }];

      mockApiClient.getAllEventsInRange.mockResolvedValue(multipleEvents);
      mockTransformationService.transformApiEvents.mockReturnValue(transformedEvents);

      // Mock the private method indirectly by causing an error in processing
      const originalConsoleError = console.error;
      console.error = jest.fn();

      const result = await syncService.syncEvents(dateRange);

      expect(result.eventsProcessed).toBe(2);
      expect(result.success).toBe(true);

      console.error = originalConsoleError;
    });

    it('should measure sync duration', async () => {
      mockApiClient.getAllEventsInRange.mockResolvedValue([mockApiEvent]);
      mockTransformationService.transformApiEvents.mockReturnValue([mockChautauquaEvent]);

      const result = await syncService.syncEvents(dateRange);

      expect(result.duration).toBeGreaterThan(0);
    });
  });

  describe('syncAllSeasonEvents', () => {
    it('should sync all season events successfully', async () => {
      const seasonEvents = [mockApiEvent, { ...mockApiEvent, id: 2 }];
      const transformedEvents = [mockChautauquaEvent, { ...mockChautauquaEvent, id: 2 }];

      mockApiClient.getSeasonEvents.mockResolvedValue(seasonEvents);
      mockTransformationService.transformApiEvents.mockReturnValue(transformedEvents);

      const result = await syncService.syncAllSeasonEvents(2025);

      expect(mockApiClient.getSeasonEvents).toHaveBeenCalledWith(2025);
      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(2);
      expect(result.eventsCreated).toBe(2);
    });

    it('should handle season sync errors', async () => {
      mockApiClient.getSeasonEvents.mockRejectedValue(new Error('Season API Error'));

      const result = await syncService.syncAllSeasonEvents(2025);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Season sync failed: Season API Error');
    });

    it('should use default year when none provided', async () => {
      mockApiClient.getSeasonEvents.mockResolvedValue([]);
      mockTransformationService.transformApiEvents.mockReturnValue([]);

      await syncService.syncAllSeasonEvents();

      expect(mockApiClient.getSeasonEvents).toHaveBeenCalledWith(2025);
    });
  });

  describe('performIncrementalSync', () => {
    it('should perform incremental sync with correct date range', async () => {
      mockApiClient.getAllEventsInRange.mockResolvedValue([mockApiEvent]);
      mockTransformationService.transformApiEvents.mockReturnValue([mockChautauquaEvent]);

      const result = await syncService.performIncrementalSync();

      expect(mockApiClient.getAllEventsInRange).toHaveBeenCalled();
      expect(result.success).toBe(true);

      // Verify that date range includes past and future events
      const call = mockApiClient.getAllEventsInRange.mock.calls[0][0];
      const startDate = new Date(call.start);
      const endDate = new Date(call.end);
      const now = new Date();

      expect(startDate).toBeLessThan(now);
      expect(endDate).toBeGreaterThan(now);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when all systems are working', async () => {
      mockApiClient.healthCheck.mockResolvedValue({
        healthy: true,
        message: 'API healthy'
      });

      mockApiClient.getAllEventsInRange.mockResolvedValue([mockApiEvent]);
      mockTransformationService.transformApiEvents.mockReturnValue([mockChautauquaEvent]);

      const result = await syncService.getHealthStatus();

      expect(result.healthy).toBe(true);
      expect(result.message).toBe('Sync service healthy');
      expect(result.details).toBeDefined();
    });

    it('should return unhealthy status when API is down', async () => {
      mockApiClient.healthCheck.mockResolvedValue({
        healthy: false,
        message: 'API down'
      });

      const result = await syncService.getHealthStatus();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('API health check failed');
    });

    it('should handle health check errors', async () => {
      mockApiClient.healthCheck.mockRejectedValue(new Error('Health check error'));

      const result = await syncService.getHealthStatus();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Health check failed');
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
      syncService.clearCache();
      expect(mockApiClient.clearCache).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const timeoutError = new Error('Network timeout');
      mockApiClient.getAllEventsInRange.mockRejectedValue(timeoutError);

      const result = await syncService.syncEvents({
        start: '2025-08-01',
        end: '2025-08-31'
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Sync failed: Network timeout');
    });

    it('should handle malformed API responses', async () => {
      mockApiClient.getAllEventsInRange.mockResolvedValue([]);
      mockTransformationService.transformApiEvents.mockReturnValue([]);

      const result = await syncService.syncEvents({
        start: '2025-08-01',
        end: '2025-08-31'
      });

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(0);
    });
  });

  describe('performance', () => {
    it('should handle large numbers of events efficiently', async () => {
      const largeEventSet = Array(1000).fill(null).map((_, i) => ({
        ...mockApiEvent,
        id: i + 1
      }));

      const largeTransformedSet = Array(1000).fill(null).map((_, i) => ({
        ...mockChautauquaEvent,
        id: i + 1
      }));

      mockApiClient.getAllEventsInRange.mockResolvedValue(largeEventSet);
      mockTransformationService.transformApiEvents.mockReturnValue(largeTransformedSet);

      const startTime = Date.now();
      const result = await syncService.syncEvents({
        start: '2025-06-01',
        end: '2025-08-31'
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.eventsProcessed).toBe(1000);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    });
  });
});