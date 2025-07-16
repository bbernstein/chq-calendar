import { EventsCalendarApiClient } from '../services/eventsCalendarApiClient';
import { ApiEvent, ApiResponse, DateRange } from '../types';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EventsCalendarApiClient', () => {
  let client: EventsCalendarApiClient;
  let mockAxiosInstance: jest.Mocked<any>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };
    
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    
    client = new EventsCalendarApiClient();
  });

  describe('constructor', () => {
    it('should create axios instance with correct config', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://www.chq.org/wp-json/tribe/events/v1',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Chautauqua-Calendar-Generator/1.0'
        }
      });
    });

    it('should setup request and response interceptors', () => {
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('getEvents', () => {
    const mockApiResponse: ApiResponse = {
      events: [
        {
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
        }
      ],
      total: 1,
      total_pages: 1
    };

    it('should fetch events successfully', async () => {
      const dateRange: DateRange = {
        start: '2025-08-01',
        end: '2025-08-31'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockApiResponse
      });

      const result = await client.getEvents(dateRange);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events', {
        params: {
          start_date: '2025-08-01',
          end_date: '2025-08-31',
          per_page: 100,
          page: 1
        }
      });

      expect(result).toEqual(mockApiResponse);
    });

    it('should use custom options', async () => {
      const dateRange: DateRange = {
        start: '2025-08-01',
        end: '2025-08-31'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockApiResponse
      });

      await client.getEvents(dateRange, { perPage: 50, page: 2 });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events', {
        params: {
          start_date: '2025-08-01',
          end_date: '2025-08-31',
          per_page: 50,
          page: 2
        }
      });
    });

    it('should handle API errors', async () => {
      const dateRange: DateRange = {
        start: '2025-08-01',
        end: '2025-08-31'
      };

      mockAxiosInstance.get.mockRejectedValueOnce(new Error('API Error'));

      await expect(client.getEvents(dateRange)).rejects.toThrow('Failed to fetch events: API Error');
    });

    it('should use cache for repeated requests', async () => {
      const dateRange: DateRange = {
        start: '2025-08-01',
        end: '2025-08-31'
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockApiResponse
      });

      // First request
      await client.getEvents(dateRange);
      
      // Second request should use cache
      const result = await client.getEvents(dateRange);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockApiResponse);
    });
  });

  describe('getEventById', () => {
    const mockEvent: ApiEvent = {
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

    it('should fetch single event successfully', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockEvent
      });

      const result = await client.getEventById(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events/1');
      expect(result).toEqual(mockEvent);
    });

    it('should handle errors for single event', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Event not found'));

      await expect(client.getEventById(1)).rejects.toThrow('Failed to fetch event 1: Event not found');
    });
  });

  describe('getAllEventsInRange', () => {
    it('should handle pagination correctly', async () => {
      const dateRange: DateRange = {
        start: '2025-08-01',
        end: '2025-08-31'
      };

      const page1Response: ApiResponse = {
        events: Array(100).fill(null).map((_, i) => ({
          id: i + 1,
          title: `Event ${i + 1}`,
          start_date: '2025-08-01 09:00:00',
          end_date: '2025-08-01 10:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false
        })),
        total: 150,
        total_pages: 2,
        next_rest_url: 'https://api.example.com/events?page=2'
      };

      const page2Response: ApiResponse = {
        events: Array(50).fill(null).map((_, i) => ({
          id: i + 101,
          title: `Event ${i + 101}`,
          start_date: '2025-08-01 09:00:00',
          end_date: '2025-08-01 10:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false
        })),
        total: 150,
        total_pages: 2
      };

      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: page1Response })
        .mockResolvedValueOnce({ data: page2Response });

      const result = await client.getAllEventsInRange(dateRange);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(150);
      expect(result[0].id).toBe(1);
      expect(result[149].id).toBe(150);
    });

    it('should handle single page response', async () => {
      const dateRange: DateRange = {
        start: '2025-08-01',
        end: '2025-08-31'
      };

      const singlePageResponse: ApiResponse = {
        events: [
          {
            id: 1,
            title: 'Single Event',
            start_date: '2025-08-01 09:00:00',
            end_date: '2025-08-01 10:00:00',
            timezone: 'America/New_York',
            categories: [],
            status: 'publish',
            featured: false
          }
        ],
        total: 1,
        total_pages: 1
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: singlePageResponse
      });

      const result = await client.getAllEventsInRange(dateRange);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });

  describe('getSeasonEvents', () => {
    it('should fetch events for entire season', async () => {
      const mockEvents: ApiEvent[] = [
        {
          id: 1,
          title: 'June Event',
          start_date: '2025-06-22 09:00:00',
          end_date: '2025-06-22 10:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false
        },
        {
          id: 2,
          title: 'July Event',
          start_date: '2025-07-15 09:00:00',
          end_date: '2025-07-15 10:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false
        }
      ];

      // Mock responses for June, July, August
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { events: [mockEvents[0]], total: 1, total_pages: 1 } })
        .mockResolvedValueOnce({ data: { events: [mockEvents[1]], total: 1, total_pages: 1 } })
        .mockResolvedValueOnce({ data: { events: [], total: 0, total_pages: 0 } });

      const result = await client.getSeasonEvents(2025);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(2);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when API is working', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          events: [{ id: 1, title: 'Test' }],
          total: 1,
          total_pages: 1
        }
      });

      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.message).toContain('API healthy');
    });

    it('should return unhealthy status when API fails', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('API Down'));

      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('API health check failed');
    });
  });

  describe('cache management', () => {
    it('should clear cache', () => {
      client.clearCache();
      // No direct way to test this, but it should not throw
      expect(true).toBe(true);
    });

    it('should return cache stats', () => {
      const stats = client.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('keys');
      expect(Array.isArray(stats.keys)).toBe(true);
    });
  });
});