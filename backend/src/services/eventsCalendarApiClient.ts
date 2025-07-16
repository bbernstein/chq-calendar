import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ApiEvent, ApiResponse, DateRange, ApiOptions, SyncResult } from '../types';

export class EventsCalendarApiClient {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private requestCache: Map<string, { response: ApiResponse; timestamp: number }>;
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

  constructor(baseUrl: string = 'https://www.chq.org/wp-json/tribe/events/v1') {
    this.baseUrl = baseUrl;
    this.requestCache = new Map();
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Chautauqua-Calendar-Generator/1.0'
      }
    });

    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        console.log(`Making API request to: ${config.url}`);
        return config;
      },
      (error) => {
        console.error('Request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 429) {
          console.warn('Rate limit exceeded, implementing backoff');
          // Implement exponential backoff
          return this.retryWithBackoff(error.config, 3);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get events for a specific date range
   */
  async getEvents(dateRange: DateRange, options: ApiOptions = {}): Promise<ApiResponse> {
    const cacheKey = `${dateRange.start}-${dateRange.end}-${options.page || 1}-${options.perPage || 100}`;
    
    // Check cache first
    const cached = this.requestCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`Returning cached response for ${cacheKey}`);
      return cached.response;
    }

    try {
      const params = {
        start_date: dateRange.start,
        end_date: dateRange.end,
        per_page: options.perPage || 100,
        page: options.page || 1
      };

      const response: AxiosResponse<ApiResponse> = await this.axiosInstance.get('/events', { params });
      
      // Cache the response
      this.requestCache.set(cacheKey, {
        response: response.data,
        timestamp: Date.now()
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching events:', error);
      throw new Error(`Failed to fetch events: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a single event by ID
   */
  async getEventById(id: number): Promise<ApiEvent> {
    try {
      const response: AxiosResponse<ApiEvent> = await this.axiosInstance.get(`/events/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching event ${id}:`, error);
      throw new Error(`Failed to fetch event ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all events in a date range, handling pagination automatically
   */
  async getAllEventsInRange(dateRange: DateRange): Promise<ApiEvent[]> {
    const allEvents: ApiEvent[] = [];
    let page = 1;
    let hasMore = true;
    const perPage = 100; // Maximum allowed by API

    console.log(`Fetching all events from ${dateRange.start} to ${dateRange.end}`);

    while (hasMore) {
      try {
        const response = await this.getEvents(dateRange, { page, perPage });
        
        if (response.events && response.events.length > 0) {
          allEvents.push(...response.events);
          console.log(`Fetched page ${page}: ${response.events.length} events (total: ${allEvents.length})`);
        }

        // Check if there are more pages
        console.log(`Page ${page} - Events: ${response.events.length}, Total: ${response.total}, Next URL: ${response.next_rest_url ? 'Yes' : 'No'}`);
        hasMore = response.next_rest_url !== undefined && response.next_rest_url !== null;
        page++;

        // Add delay between requests to be respectful
        if (hasMore) {
          await this.delay(100); // 100ms delay
        }
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error);
        throw error;
      }
    }

    console.log(`Total events fetched: ${allEvents.length}`);
    return allEvents;
  }

  /**
   * Get events for the entire Chautauqua season
   */
  async getSeasonEvents(year: number = 2025): Promise<ApiEvent[]> {
    const seasonDates = this.getChautauquaSeasonDates(year);
    
    console.log(`Fetching full season events from ${seasonDates.start.toISOString().split('T')[0]} to ${seasonDates.end.toISOString().split('T')[0]}`);
    
    // Use exact season dates instead of full months
    const seasonRange: DateRange = {
      start: seasonDates.start.toISOString().split('T')[0],
      end: seasonDates.end.toISOString().split('T')[0]
    };

    // For large date ranges, split into weekly chunks for better performance
    const weeklyRanges = this.splitIntoWeeklyRanges(seasonDates.start, seasonDates.end);
    const allEvents: ApiEvent[] = [];

    console.log(`Splitting season into ${weeklyRanges.length} weekly chunks for efficient loading`);

    for (const [index, range] of weeklyRanges.entries()) {
      try {
        console.log(`Fetching week ${index + 1}/${weeklyRanges.length}: ${range.start} to ${range.end}`);
        const weekEvents = await this.getAllEventsInRange(range);
        allEvents.push(...weekEvents);
        
        // Add delay between weeks to be respectful to the API
        if (index < weeklyRanges.length - 1) {
          await this.delay(200); // 200ms delay between weeks
        }
      } catch (error) {
        console.error(`Error fetching events for week ${index + 1} (${range.start} to ${range.end}):`, error);
        // Continue with other weeks even if one fails
      }
    }

    console.log(`Total events fetched for season: ${allEvents.length}`);
    return allEvents;
  }

  /**
   * Split a date range into weekly chunks for efficient loading
   */
  private splitIntoWeeklyRanges(startDate: Date, endDate: Date): DateRange[] {
    const ranges: DateRange[] = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const weekStart = new Date(current);
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6); // Add 6 days to get a full week
      
      // Don't exceed the end date
      if (weekEnd > endDate) {
        weekEnd.setTime(endDate.getTime());
      }
      
      ranges.push({
        start: weekStart.toISOString().split('T')[0],
        end: weekEnd.toISOString().split('T')[0]
      });
      
      // Move to next week
      current.setDate(current.getDate() + 7);
    }
    
    return ranges;
  }

  /**
   * Get events for the next 7 days (for hourly updates)
   */
  async getNext7DaysEvents(): Promise<ApiEvent[]> {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    
    const dateRange: DateRange = {
      start: today.toISOString().split('T')[0],
      end: nextWeek.toISOString().split('T')[0]
    };
    
    console.log(`Fetching events for next 7 days: ${dateRange.start} to ${dateRange.end}`);
    return await this.getAllEventsInRange(dateRange);
  }

  /**
   * Get events for today (for immediate updates)
   */
  async getTodayEvents(): Promise<ApiEvent[]> {
    const today = new Date();
    const dateRange: DateRange = {
      start: today.toISOString().split('T')[0],
      end: today.toISOString().split('T')[0]
    };
    
    console.log(`Fetching events for today: ${dateRange.start}`);
    return await this.getAllEventsInRange(dateRange);
  }

  /**
   * Get events for a specific date range with automatic chunking for large ranges
   */
  async getEventsWithChunking(startDate: string, endDate: string): Promise<ApiEvent[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    
    // For ranges longer than 14 days, use weekly chunking
    if (daysDiff > 14) {
      console.log(`Large date range detected (${daysDiff} days), using weekly chunking`);
      const weeklyRanges = this.splitIntoWeeklyRanges(start, end);
      const allEvents: ApiEvent[] = [];
      
      for (const [index, range] of weeklyRanges.entries()) {
        try {
          console.log(`Fetching chunk ${index + 1}/${weeklyRanges.length}: ${range.start} to ${range.end}`);
          const chunkEvents = await this.getAllEventsInRange(range);
          allEvents.push(...chunkEvents);
          
          // Add delay between chunks
          if (index < weeklyRanges.length - 1) {
            await this.delay(150);
          }
        } catch (error) {
          console.error(`Error fetching chunk ${index + 1}:`, error);
        }
      }
      
      return allEvents;
    } else {
      // For shorter ranges, fetch directly
      return await this.getAllEventsInRange({ start: startDate, end: endDate });
    }
  }

  /**
   * Clear the request cache
   */
  clearCache(): void {
    this.requestCache.clear();
    console.log('API cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.requestCache.size,
      keys: Array.from(this.requestCache.keys())
    };
  }

  /**
   * Implement exponential backoff retry logic
   */
  private async retryWithBackoff(config: any, maxRetries: number): Promise<AxiosResponse> {
    for (let i = 0; i < maxRetries; i++) {
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      console.log(`Retrying request in ${delay}ms (attempt ${i + 1}/${maxRetries})`);
      
      await this.delay(delay);
      
      try {
        return await this.axiosInstance(config);
      } catch (error) {
        if (i === maxRetries - 1) throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Helper method to add delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get Chautauqua season dates for a given year
   */
  private getChautauquaSeasonDates(year: number): { start: Date; end: Date } {
    // Find the 4th Sunday of June
    const june1 = new Date(year, 5, 1); // Month is 0-indexed
    const current = new Date(june1);
    let sundayCount = 0;
    let fourthSunday: Date | null = null;

    while (current.getMonth() === 5) { // June
      if (current.getDay() === 0) { // Sunday
        sundayCount++;
        if (sundayCount === 4) {
          fourthSunday = new Date(current);
          break;
        }
      }
      current.setDate(current.getDate() + 1);
    }

    if (!fourthSunday) {
      throw new Error(`Could not find 4th Sunday of June ${year}`);
    }

    // Season is 9 weeks from the 4th Sunday
    const seasonEnd = new Date(fourthSunday);
    seasonEnd.setDate(fourthSunday.getDate() + (9 * 7) - 1);

    return {
      start: fourthSunday,
      end: seasonEnd
    };
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const testRange: DateRange = {
        start: '2025-08-01',
        end: '2025-08-02'
      };
      
      const response = await this.getEvents(testRange, { perPage: 1 });
      
      return {
        healthy: true,
        message: `API healthy - returned ${response.events.length} events`
      };
    } catch (error) {
      return {
        healthy: false,
        message: `API health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}

export default EventsCalendarApiClient;