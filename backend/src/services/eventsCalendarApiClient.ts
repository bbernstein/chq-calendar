import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ApiEvent, ApiResponse, DateRange, ApiOptions } from '../types';

/**
 * Compute the default year using the Oct 1 turnover rule:
 * If current month is October or later, default to next year; otherwise current year.
 */
function getDefaultYear(): number {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

export class EventsCalendarApiClient {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private requestCache: Map<string, { response: ApiResponse; timestamp: number }>;
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes
  private maxConcurrentRequests: number = 10; // Configurable parallelization
  private requestDelayMs: number = 100; // Delay between batches

  // Configuration constants
  private static readonly MIN_CONCURRENT_REQUESTS = 1;
  private static readonly MAX_CONCURRENT_REQUESTS = 20;
  private static readonly MAX_PAGES_SAFETY_LIMIT = 100;
  private static readonly INITIAL_BATCH_LIMIT = 20;

  constructor(baseUrl: string = 'https://www.chq.org/wp-json/tribe/events/v1', options: {
    maxConcurrentRequests?: number;
    requestDelayMs?: number;
  } = {}) {
    this.baseUrl = baseUrl;
    this.requestCache = new Map();
    this.maxConcurrentRequests = options.maxConcurrentRequests || 10;
    this.requestDelayMs = options.requestDelayMs || 100;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Chautauqua-Calendar/1.0'
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
      // Handle expected pagination 404s more quietly
      if (this.isPaginationEndError(error)) {
        throw new Error(`Pagination end: ${error instanceof Error ? error.message : 'Page not found'}`);
      } else {
        console.error('Error fetching events:', error);
        throw new Error(`Failed to fetch events: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
   * Get all events in a date range, handling pagination automatically with parallel requests
   */
  async getAllEventsInRange(dateRange: DateRange): Promise<ApiEvent[]> {
    const allEvents: ApiEvent[] = [];
    const perPage = 50; // Use 50 per page to match what API actually returns

    console.log(`Fetching all events from ${dateRange.start} to ${dateRange.end} with up to ${this.maxConcurrentRequests} parallel requests`);

    // First, make a single request to determine total pages needed
    const firstResponse = await this.getEvents(dateRange, { page: 1, perPage });

    if (!firstResponse.events || firstResponse.events.length === 0) {
      console.log('No events found in date range');
      return allEvents;
    }

    allEvents.push(...firstResponse.events);
    console.log(`First page fetched: ${firstResponse.events.length} events`);

    // If we got less than a full page, we're done
    if (firstResponse.events.length < perPage) {
      console.log(`Total events fetched: ${allEvents.length}`);
      return allEvents;
    }

    // Estimate total pages needed based on first response
    // We'll fetch additional pages until we get less than a full page
    const pagesToFetch: number[] = [];
    let currentPage = 2;
    let consecutiveEmptyPages = 0;
    const maxPages = EventsCalendarApiClient.MAX_PAGES_SAFETY_LIMIT;

    // Generate page numbers to fetch
    while (currentPage <= maxPages && consecutiveEmptyPages < 3) {
      pagesToFetch.push(currentPage);
      currentPage++;

      // We'll break out of this when we process the results
      if (pagesToFetch.length >= EventsCalendarApiClient.INITIAL_BATCH_LIMIT) {
        break;
      }
    }

    // Process pages in parallel batches
    while (pagesToFetch.length > 0) {
      const currentBatch = pagesToFetch.splice(0, this.maxConcurrentRequests);

      try {
        console.log(`Fetching batch of ${currentBatch.length} pages: ${currentBatch.join(', ')}`);

        // Make parallel requests for this batch
        const batchPromises = currentBatch.map(page =>
          this.getEvents(dateRange, { page, perPage })
            .catch(error => {
              // Handle expected pagination 404s more quietly
              if (this.isPaginationEndError(error) || error.message?.includes('Pagination end:')) {
                console.log(`Page ${page}: No more events (end of pagination)`);
              } else {
                console.error(`Error fetching page ${page}:`, error);
              }
              return null; // Return null for failed requests
            })
        );

        const batchResponses = await Promise.all(batchPromises);

        let foundIncompletePages = false;

        // Process results from this batch
        for (let i = 0; i < batchResponses.length; i++) {
          const response = batchResponses[i];
          const pageNumber = currentBatch[i];

          if (response && response.events && response.events.length > 0) {
            allEvents.push(...response.events);
            console.log(`Page ${pageNumber}: ${response.events.length} events (total: ${allEvents.length})`);

            // If this page had fewer events than expected, we're near the end
            if (response.events.length < perPage) {
              foundIncompletePages = true;
            }

            consecutiveEmptyPages = 0;
          } else {
            console.log(`Page ${pageNumber}: No events or error`);
            consecutiveEmptyPages++;
          }
        }

        // If we found incomplete pages or too many empty pages, stop fetching more
        if (foundIncompletePages || consecutiveEmptyPages >= 3) {
          console.log(`Stopping pagination - found incomplete pages or too many empty pages`);
          break;
        }

        // Add more pages to fetch if we haven't hit our limits
        if (pagesToFetch.length === 0 && currentPage <= maxPages) {
          const additionalPages = Math.min(10, maxPages - currentPage + 1);
          for (let i = 0; i < additionalPages; i++) {
            if (currentPage <= maxPages) {
              pagesToFetch.push(currentPage++);
            }
          }
        }

        // Add delay between batches to be respectful to the API
        if (pagesToFetch.length > 0) {
          await this.delay(this.requestDelayMs);
        }

      } catch (error) {
        console.error(`Error in batch processing:`, error);
        // Continue with remaining batches even if one fails
      }
    }

    console.log(`Total events fetched: ${allEvents.length}`);
    return allEvents;
  }

  /**
   * Get events for the entire Chautauqua season
   */
  async getSeasonEvents(year: number = getDefaultYear()): Promise<ApiEvent[]> {
    const seasonDates = this.getChautauquaSeasonDates(year);

    console.log(`Fetching full season events from ${seasonDates.start.toISOString().split('T')[0]} to ${seasonDates.end.toISOString().split('T')[0]}`);

    // Use exact season dates instead of full months
    const seasonRange: DateRange = {
      start: seasonDates.start.toISOString().split('T')[0],
      end: seasonDates.end.toISOString().split('T')[0]
    };

    // Fetch all events for the entire season using pagination (50 events per page)
    console.log(`Fetching all events for season: ${seasonRange.start} to ${seasonRange.end}`);
    const allEvents = await this.getAllEventsInRange(seasonRange);

    console.log(`Total events fetched for season: ${allEvents.length}`);
    return allEvents;
  }


  /**
   * Get events for the entire year (including pre-season and post-season)
   */
  async getFullYearEvents(year: number = getDefaultYear()): Promise<ApiEvent[]> {
    const yearStart = new Date(year, 0, 1); // January 1st
    const yearEnd = new Date(year, 11, 31); // December 31st

    console.log(`Fetching full year events for ${year}: ${yearStart.toISOString().split('T')[0]} to ${yearEnd.toISOString().split('T')[0]}`);

    const yearRange: DateRange = {
      start: yearStart.toISOString().split('T')[0],
      end: yearEnd.toISOString().split('T')[0]
    };

    // Fetch all events for the entire year
    console.log(`Fetching all events for year ${year}`);
    const allEvents = await this.getAllEventsInRange(yearRange);

    console.log(`Total events fetched for year ${year}: ${allEvents.length}`);
    return allEvents;
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
   * Update parallelization settings
   */
  updateParallelizationSettings(maxConcurrentRequests: number, requestDelayMs: number = 100): void {
    this.maxConcurrentRequests = Math.max(
      EventsCalendarApiClient.MIN_CONCURRENT_REQUESTS,
      Math.min(EventsCalendarApiClient.MAX_CONCURRENT_REQUESTS, maxConcurrentRequests)
    );
    this.requestDelayMs = Math.max(0, requestDelayMs);
    console.log(`Updated parallelization: ${this.maxConcurrentRequests} concurrent requests, ${this.requestDelayMs}ms delay`);
  }

  /**
   * Get current parallelization settings
   */
  getParallelizationSettings(): { maxConcurrentRequests: number; requestDelayMs: number } {
    return {
      maxConcurrentRequests: this.maxConcurrentRequests,
      requestDelayMs: this.requestDelayMs
    };
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
   * Check if an error is an expected pagination end (404 page not found)
   */
  private isPaginationEndError(error: any): boolean {
    // Check if it's a 404 error with the specific pagination error code
    return error?.response?.status === 404 &&
           error?.response?.data?.code === 'event-archive-page-not-found';
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
        start: '2026-08-01',
        end: '2026-08-02'
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
