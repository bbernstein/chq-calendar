import { EventTransformationService } from '../services/eventTransformationService';
import { ApiEvent } from '../types/index';

describe('EventTransformationService', () => {
  describe('transformApiEvent', () => {
    it('should transform basic API event to ChautauquaEvent', () => {
      const apiEvent: ApiEvent = {
        id: 123,
        title: 'Test Concert',
        description: 'A wonderful musical performance',
        start_date: '2025-07-01T19:30:00',
        end_date: '2025-07-01T21:00:00',
        timezone: 'America/New_York',
        venue: {
          id: 1,
          venue: 'Amphitheater',
          address: '123 Main St, Chautauqua, NY',
          show_map: true,
        },
        categories: [
          {
            id: 1,
            name: 'Music',
            slug: 'music',
            taxonomy: 'event-category',
            parent: 0,
          },
          {
            id: 2,
            name: 'Week Two (June 28–July 5)',
            slug: 'week-two',
            taxonomy: 'event-week',
            parent: 0,
          },
        ],
        cost: '$25',
        url: 'https://www.chq.org/event/test-concert',
        status: 'publish',
        featured: true,
        image: {
          url: 'https://example.com/image.jpg',
          alt: 'Concert image',
          sizes: {
            thumbnail: 'https://example.com/thumb.jpg',
            medium: 'https://example.com/medium.jpg',
            large: 'https://example.com/large.jpg',
          },
        },
      };

      const result = EventTransformationService.transformApiEvent(apiEvent);

      expect(result.id).toBe(123);
      expect(result.uid).toMatch(/^chq-123-/);
      expect(result.title).toBe('Test Concert');
      expect(result.description).toBe('A wonderful musical performance');
      expect(result.startDate).toBe('2025-07-01T19:30:00');
      expect(result.endDate).toBe('2025-07-01T21:00:00');
      expect(result.timezone).toBe('America/New_York');
      expect(result.venue).toEqual({
        id: 1,
        name: 'Amphitheater',
        address: '123 Main St, Chautauqua, NY',
        showMap: true,
      });
      expect(result.categories).toHaveLength(2);
      expect(result.category).toBe('Music');
      expect(result.tags).toContain('music');
      expect(result.week).toBe(2);
      expect(result.cost).toBe('$25');
      expect(result.url).toBe('https://www.chq.org/event/test-concert');
      expect(result.status).toBe('publish');
      expect(result.featured).toBe(true);
      expect(result.image).toEqual({
        url: 'https://example.com/image.jpg',
        alt: 'Concert image',
        sizes: {
          thumbnail: 'https://example.com/thumb.jpg',
          medium: 'https://example.com/medium.jpg',
          large: 'https://example.com/large.jpg',
        },
      });
      expect(result.confidence).toBe('confirmed');
      expect(result.syncStatus).toBe('synced');
      expect(result.source).toBe('events-calendar-api');
      expect(result.lastUpdated).toBeInstanceOf(Date);
    });

    it('should handle minimal API event', () => {
      const apiEvent: ApiEvent = {
        id: 456,
        title: 'Simple Event',
        start_date: '2025-07-15T10:00:00',
        end_date: '2025-07-15T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        status: 'publish',
        featured: false,
      };

      const result = EventTransformationService.transformApiEvent(apiEvent);

      expect(result.id).toBe(456);
      expect(result.uid).toMatch(/^chq-456-/);
      expect(result.title).toBe('Simple Event');
      expect(result.startDate).toBe('2025-07-15T10:00:00');
      expect(result.endDate).toBe('2025-07-15T11:00:00');
      expect(result.timezone).toBe('America/New_York');
      expect(result.categories).toHaveLength(0);
      expect(result.tags).toHaveLength(0);
      expect(result.category).toBe('General');
      expect(result.week).toBe(4); // July 15 is in week 4
      expect(result.venue).toBeUndefined();
      expect(result.cost).toBeUndefined();
      expect(result.url).toBeUndefined();
      expect(result.image).toBeUndefined();
      expect(result.description).toBeUndefined();
    });

    it('should extract week number from date', () => {
      const testCases = [
        { date: '2025-06-28T10:00:00', expectedWeek: 1 },
        { date: '2025-07-05T10:00:00', expectedWeek: 2 },
        { date: '2025-07-12T10:00:00', expectedWeek: 3 },
        { date: '2025-07-19T10:00:00', expectedWeek: 4 },
        { date: '2025-07-26T10:00:00', expectedWeek: 5 },
        { date: '2025-08-02T10:00:00', expectedWeek: 6 },
        { date: '2025-08-09T10:00:00', expectedWeek: 7 },
        { date: '2025-08-16T10:00:00', expectedWeek: 8 },
        { date: '2025-08-23T10:00:00', expectedWeek: 9 },
      ];

      testCases.forEach(({ date, expectedWeek }) => {
        const apiEvent: ApiEvent = {
          id: 1,
          title: 'Test Event',
          start_date: date,
          end_date: date,
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        };

        const result = EventTransformationService.transformApiEvent(apiEvent);
        expect(result.week).toBe(expectedWeek);
      });
    });

    it('should calculate day of week correctly', () => {
      const testCases = [
        { date: '2025-06-30T10:00:00', expectedDayOfWeek: 1 }, // Monday
        { date: '2025-07-01T10:00:00', expectedDayOfWeek: 2 }, // Tuesday
        { date: '2025-07-02T10:00:00', expectedDayOfWeek: 3 }, // Wednesday
        { date: '2025-07-03T10:00:00', expectedDayOfWeek: 4 }, // Thursday
        { date: '2025-07-04T10:00:00', expectedDayOfWeek: 5 }, // Friday
        { date: '2025-07-05T10:00:00', expectedDayOfWeek: 6 }, // Saturday
        { date: '2025-07-06T10:00:00', expectedDayOfWeek: 0 }, // Sunday
      ];

      testCases.forEach(({ date, expectedDayOfWeek }) => {
        const apiEvent: ApiEvent = {
          id: 1,
          title: 'Test Event',
          start_date: date,
          end_date: date,
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        };

        const result = EventTransformationService.transformApiEvent(apiEvent);
        expect(result.dayOfWeek).toBe(expectedDayOfWeek);
      });
    });

    it('should extract primary category from categories array', () => {
      const apiEvent: ApiEvent = {
        id: 1,
        title: 'Test Event',
        start_date: '2025-07-01T10:00:00',
        end_date: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [
          {
            id: 1,
            name: 'Music',
            slug: 'music',
            taxonomy: 'event-category',
            parent: 0,
          },
          {
            id: 2,
            name: 'Classical',
            slug: 'classical',
            taxonomy: 'event-subcategory',
            parent: 1,
          },
        ],
        status: 'publish',
        featured: false,
      };

      const result = EventTransformationService.transformApiEvent(apiEvent);
      expect(result.category).toBe('Music');
    });

    it('should generate tags from categories', () => {
      const apiEvent: ApiEvent = {
        id: 1,
        title: 'Test Event',
        start_date: '2025-07-01T10:00:00',
        end_date: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [
          {
            id: 1,
            name: 'Music',
            slug: 'music',
            taxonomy: 'event-category',
            parent: 0,
          },
          {
            id: 2,
            name: 'Classical',
            slug: 'classical',
            taxonomy: 'event-subcategory',
            parent: 1,
          },
        ],
        status: 'publish',
        featured: false,
      };

      const result = EventTransformationService.transformApiEvent(apiEvent);
      expect(result.tags).toContain('music');
      expect(result.tags).toContain('classical');
    });

    it('should handle events outside season dates', () => {
      const apiEvent: ApiEvent = {
        id: 1,
        title: 'Off Season Event',
        start_date: '2025-05-01T10:00:00',
        end_date: '2025-05-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        status: 'publish',
        featured: false,
      };

      const result = EventTransformationService.transformApiEvent(apiEvent);
      expect(result.week).toBe(1); // May 1st falls within season calculation
    });

    it('should set lastModified from current timestamp', () => {
      const beforeTransform = new Date();
      
      const apiEvent: ApiEvent = {
        id: 1,
        title: 'Test Event',
        start_date: '2025-07-01T10:00:00',
        end_date: '2025-07-01T11:00:00',
        timezone: 'America/New_York',
        categories: [],
        status: 'publish',
        featured: false,
      };

      const result = EventTransformationService.transformApiEvent(apiEvent);
      
      const afterTransform = new Date();
      const resultDate = new Date(result.lastModified);
      
      expect(resultDate.getTime()).toBeGreaterThanOrEqual(beforeTransform.getTime());
      expect(resultDate.getTime()).toBeLessThanOrEqual(afterTransform.getTime());
    });
  });

  describe('transformApiEvents', () => {
    it('should transform multiple API events', () => {
      const apiEvents: ApiEvent[] = [
        {
          id: 1,
          title: 'Event 1',
          start_date: '2025-07-01T10:00:00',
          end_date: '2025-07-01T11:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: false,
        },
        {
          id: 2,
          title: 'Event 2',
          start_date: '2025-07-02T14:00:00',
          end_date: '2025-07-02T15:00:00',
          timezone: 'America/New_York',
          categories: [],
          status: 'publish',
          featured: true,
        },
      ];

      const result = EventTransformationService.transformApiEvents(apiEvents);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[0].title).toBe('Event 1');
      expect(result[1].id).toBe(2);
      expect(result[1].title).toBe('Event 2');
    });

    it('should handle empty array', () => {
      const result = EventTransformationService.transformApiEvents([]);
      expect(result).toHaveLength(0);
    });
  });
});