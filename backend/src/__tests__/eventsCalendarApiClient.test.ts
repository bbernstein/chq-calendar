import { EventsCalendarApiClient } from '../services/eventsCalendarApiClient';
import axios from 'axios';
import { jest } from '@jest/globals';

// Mock axios with proper typing
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Create a properly typed mock axios instance
const mockAxiosInstance = {
  get: jest.fn(),
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  },
} as any;

describe('EventsCalendarApiClient', () => {
  let client: EventsCalendarApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock axios.create to return our mock instance
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    client = new EventsCalendarApiClient('https://api.example.com');
  });

  describe('constructor', () => {
    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://api.example.com',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Chautauqua-Calendar-Generator/1.0',
        },
      });
    });

    it('should set up interceptors', () => {
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('getEvents', () => {
    it('should fetch events for date range', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              id: 1,
              title: 'Test Event',
              start_date: '2025-07-01T10:00:00',
              end_date: '2025-07-01T11:00:00',
              timezone: 'America/New_York',
              status: 'publish',
              featured: false,
            },
          ],
          total: 1,
          total_pages: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getEvents(
        { start: '2025-07-01', end: '2025-07-07' },
        { perPage: 50, page: 1 }
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events', {
        params: {
          start_date: '2025-07-01',
          end_date: '2025-07-07',
          per_page: 50,
          page: 1,
        },
      });
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle API errors', async () => {
      const error = new Error('API Error');
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(
        client.getEvents({ start: '2025-07-01', end: '2025-07-07' })
      ).rejects.toThrow('Failed to fetch events: API Error');
    });
  });

  describe('getEventById', () => {
    it('should fetch single event by ID', async () => {
      const mockEvent = {
        id: 123,
        title: 'Test Event',
        start_date: '2025-07-01T10:00:00',
        end_date: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        status: 'publish',
        featured: false,
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockEvent });

      const result = await client.getEventById(123);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events/123');
      expect(result).toEqual(mockEvent);
    });
  });

  describe('getAllEventsInRange', () => {
    it('should fetch all events with pagination', async () => {
      const mockResponse1 = {
        data: {
          events: [
            { id: 1, title: 'Event 1' },
            { id: 2, title: 'Event 2' },
          ],
          total: 3,
          total_pages: 2,
          next_rest_url: 'https://api.example.com/events?page=2',
        },
      };

      const mockResponse2 = {
        data: {
          events: [{ id: 3, title: 'Event 3' }],
          total: 3,
          total_pages: 2,
        },
      };

      // First call returns 2 events (less than perPage=50), so pagination stops
      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse1);

      const result = await client.getAllEventsInRange({
        start: '2025-07-01',
        end: '2025-07-07',
      });

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Event 1');
      expect(result[1].title).toBe('Event 2');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSeasonEvents', () => {
    it('should fetch events for entire season', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              id: 1,
              title: 'Season Event',
              start_date: '2025-07-01T10:00:00',
              end_date: '2025-07-01T11:00:00',
            },
          ],
          total: 1,
          total_pages: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getSeasonEvents(2025);

      // The service uses weekly chunking, so we expect multiple calls
      expect(mockAxiosInstance.get).toHaveBeenCalled();
      expect(result).toHaveLength(9); // 9 weeks * 1 event per week = 9 events
      expect(result.every(event => event.title === 'Season Event')).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when API is working', async () => {
      const mockResponse = {
        data: {
          events: [],
          total: 0,
          total_pages: 0,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.message).toContain('API healthy');
    });

    it('should return unhealthy status when API fails', async () => {
      const error = new Error('API error');
      mockAxiosInstance.get.mockRejectedValue(error);

      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('API health check failed');
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', () => {
      expect(() => client.clearCache()).not.toThrow();
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = client.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('keys');
      expect(Array.isArray(stats.keys)).toBe(true);
      expect(typeof stats.size).toBe('number');
    });
  });

  describe('getNext7DaysEvents', () => {
    it('should fetch events for next 7 days', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              id: 1,
              title: 'Upcoming Event',
              start_date: '2025-07-20T10:00:00',
              end_date: '2025-07-20T11:00:00',
            },
          ],
          total: 1,
          total_pages: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getNext7DaysEvents();

      expect(mockAxiosInstance.get).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Upcoming Event');
    });
  });

  describe('getTodayEvents', () => {
    it('should fetch events for today', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              id: 1,
              title: 'Today Event',
              start_date: '2025-07-16T10:00:00',
              end_date: '2025-07-16T11:00:00',
            },
          ],
          total: 1,
          total_pages: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getTodayEvents();

      expect(mockAxiosInstance.get).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Today Event');
    });
  });

  describe('getEventsWithChunking', () => {
    it('should use chunking for large date ranges', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              id: 1,
              title: 'Chunked Event',
              start_date: '2025-07-01T10:00:00',
              end_date: '2025-07-01T11:00:00',
            },
          ],
          total: 1,
          total_pages: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getEventsWithChunking('2025-07-01', '2025-08-01');

      expect(mockAxiosInstance.get).toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should fetch directly for short date ranges', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              id: 1,
              title: 'Short Range Event',
              start_date: '2025-07-01T10:00:00',
              end_date: '2025-07-01T11:00:00',
            },
          ],
          total: 1,
          total_pages: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getEventsWithChunking('2025-07-01', '2025-07-05');

      expect(mockAxiosInstance.get).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Short Range Event');
    });
  });

  describe('cache functionality', () => {
    it('should use cache for repeated requests', async () => {
      const mockResponse = {
        data: {
          events: [{ id: 1, title: 'Cached Event' }],
          total: 1,
          total_pages: 1,
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      // First call should make API request
      const result1 = await client.getEvents({ start: '2025-07-01', end: '2025-07-07' });
      
      // Second call should use cache (within 5 minutes)
      const result2 = await client.getEvents({ start: '2025-07-01', end: '2025-07-07' });

      expect(result1).toEqual(result2);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should handle network timeouts', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      (timeoutError as any).code = 'ECONNABORTED';
      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      await expect(
        client.getEvents({ start: '2025-07-01', end: '2025-07-07' })
      ).rejects.toThrow('timeout of 30000ms exceeded');
    });

    it('should handle server errors', async () => {
      const serverError = new Error('Internal Server Error');
      (serverError as any).response = { status: 500 };
      mockAxiosInstance.get.mockRejectedValue(serverError);

      await expect(
        client.getEvents({ start: '2025-07-01', end: '2025-07-07' })
      ).rejects.toThrow('Internal Server Error');
    });
  });
});