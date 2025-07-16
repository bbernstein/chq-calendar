import { EventTransformationService } from '../services/eventTransformationService';
import { ApiEvent, ChautauquaEvent } from '../types';

describe('EventTransformationService', () => {
  const mockApiEvent: ApiEvent = {
    id: 12345,
    title: 'Morning Lecture: The Future of AI with Dr. Jane Smith',
    description: '<p>Join us for an enlightening discussion about artificial intelligence and its impact on society. This <strong>lecture</strong> will explore the latest developments in AI technology.</p>',
    start_date: '2025-08-01 09:00:00',
    end_date: '2025-08-01 10:00:00',
    timezone: 'America/New_York',
    venue: {
      id: 789,
      venue: 'Amphitheater',
      address: '1 Ames Ave, Chautauqua, NY 14722',
      show_map: true
    },
    categories: [
      {
        id: 12,
        name: 'Interfaith Lecture Series',
        slug: 'interfaith-lecture-series',
        taxonomy: 'tribe_events_cat',
        parent: 0
      },
      {
        id: 13,
        name: 'Morning Lectures',
        slug: 'morning-lectures',
        taxonomy: 'tribe_events_cat',
        parent: 12
      }
    ],
    image: {
      url: 'https://www.chq.org/wp-content/uploads/event-image.jpg',
      alt: 'Dr. Jane Smith speaking',
      sizes: {
        thumbnail: 'https://www.chq.org/wp-content/uploads/event-image-thumb.jpg',
        medium: 'https://www.chq.org/wp-content/uploads/event-image-medium.jpg',
        large: 'https://www.chq.org/wp-content/uploads/event-image-large.jpg'
      }
    },
    cost: '$0',
    url: 'https://www.chq.org/events/morning-lecture-ai/',
    status: 'publish',
    featured: true
  };

  describe('transformApiEvent', () => {
    let transformedEvent: ChautauquaEvent;

    beforeEach(() => {
      transformedEvent = EventTransformationService.transformApiEvent(mockApiEvent);
    });

    it('should transform core identifiers correctly', () => {
      expect(transformedEvent.id).toBe(12345);
      expect(transformedEvent.uid).toMatch(/^chq-12345-\d{8}T\d{6}$/);
    });

    it('should transform event details correctly', () => {
      expect(transformedEvent.title).toBe('Morning Lecture: The Future of AI with Dr. Jane Smith');
      expect(transformedEvent.description).toBe('Join us for an enlightening discussion about artificial intelligence and its impact on society. This lecture will explore the latest developments in AI technology.');
      expect(transformedEvent.startDate).toBe('2025-08-01 09:00:00');
      expect(transformedEvent.endDate).toBe('2025-08-01 10:00:00');
      expect(transformedEvent.timezone).toBe('America/New_York');
    });

    it('should transform venue information correctly', () => {
      expect(transformedEvent.venue).toEqual({
        id: 789,
        name: 'Amphitheater',
        address: '1 Ames Ave, Chautauqua, NY 14722',
        showMap: true
      });
      expect(transformedEvent.location).toBe('Amphitheater');
    });

    it('should transform categories correctly', () => {
      expect(transformedEvent.categories).toHaveLength(2);
      expect(transformedEvent.categories[0]).toEqual({
        id: 12,
        name: 'Interfaith Lecture Series',
        slug: 'interfaith-lecture-series',
        taxonomy: 'tribe_events_cat',
        parent: 0
      });
      expect(transformedEvent.category).toBe('Interfaith Lecture Series');
    });

    it('should generate tags correctly', () => {
      expect(transformedEvent.tags).toContain('amphitheater');
      expect(transformedEvent.tags).toContain('lecture');
      expect(transformedEvent.tags).toContain('interfaith-lecture-series');
      expect(transformedEvent.tags).toContain('free');
    });

    it('should transform metadata correctly', () => {
      expect(transformedEvent.cost).toBe('$0');
      expect(transformedEvent.url).toBe('https://www.chq.org/events/morning-lecture-ai/');
      expect(transformedEvent.status).toBe('publish');
      expect(transformedEvent.featured).toBe(true);
    });

    it('should transform image correctly', () => {
      expect(transformedEvent.image).toEqual({
        url: 'https://www.chq.org/wp-content/uploads/event-image.jpg',
        alt: 'Dr. Jane Smith speaking',
        sizes: {
          thumbnail: 'https://www.chq.org/wp-content/uploads/event-image-thumb.jpg',
          medium: 'https://www.chq.org/wp-content/uploads/event-image-medium.jpg',
          large: 'https://www.chq.org/wp-content/uploads/event-image-large.jpg'
        }
      });
    });

    it('should calculate legacy fields correctly', () => {
      expect(transformedEvent.dayOfWeek).toBe(5); // Friday
      expect(transformedEvent.presenter).toBe('Dr. Jane Smith');
      expect(transformedEvent.series).toBe('Morning Lecture');
      expect(transformedEvent.audience).toBe('all-ages');
      expect(transformedEvent.ticketRequired).toBe(false);
    });

    it('should calculate system fields correctly', () => {
      expect(transformedEvent.week).toBeGreaterThan(0);
      expect(transformedEvent.week).toBeLessThanOrEqual(9);
      expect(transformedEvent.confidence).toBe('confirmed');
      expect(transformedEvent.syncStatus).toBe('synced');
      expect(transformedEvent.source).toBe('events-calendar-api');
    });
  });

  describe('transformApiEvents', () => {
    it('should transform multiple events', () => {
      const mockEvents: ApiEvent[] = [
        mockApiEvent,
        { ...mockApiEvent, id: 67890, title: 'Second Event' }
      ];

      const result = EventTransformationService.transformApiEvents(mockEvents);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(12345);
      expect(result[1].id).toBe(67890);
      expect(result[1].title).toBe('Second Event');
    });

    it('should handle empty array', () => {
      const result = EventTransformationService.transformApiEvents([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('tag generation', () => {
    it('should generate venue tags', () => {
      const eventWithVenue: ApiEvent = {
        ...mockApiEvent,
        venue: {
          id: 1,
          venue: 'Hall of Philosophy',
          address: '',
          show_map: false
        }
      };

      const result = EventTransformationService.transformApiEvent(eventWithVenue);
      expect(result.tags).toContain('hall of philosophy');
    });

    it('should generate tags from common abbreviations', () => {
      const eventWithAbbr: ApiEvent = {
        ...mockApiEvent,
        title: 'CSO Concert at the Amp',
        description: 'Join the Chautauqua Symphony Orchestra'
      };

      const result = EventTransformationService.transformApiEvent(eventWithAbbr);
      expect(result.tags).toContain('chautauqua symphony orchestra');
      expect(result.tags).toContain('amphitheater');
    });

    it('should generate cost-related tags', () => {
      const freeEvent: ApiEvent = { ...mockApiEvent, cost: '$0' };
      const paidEvent: ApiEvent = { ...mockApiEvent, cost: '$25' };

      const freeResult = EventTransformationService.transformApiEvent(freeEvent);
      const paidResult = EventTransformationService.transformApiEvent(paidEvent);

      expect(freeResult.tags).toContain('free');
      expect(paidResult.tags).toContain('ticketed');
    });
  });

  describe('presenter extraction', () => {
    it('should extract presenter from "with" pattern', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Evening Concert with John Doe'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.presenter).toBe('John Doe');
    });

    it('should extract presenter from "by" pattern', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Lecture by Professor Smith'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.presenter).toBe('Professor Smith');
    });

    it('should extract presenter from "featuring" pattern', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Concert featuring Maria Garcia'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.presenter).toBe('Maria Garcia');
    });

    it('should handle no presenter pattern', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'General Assembly Meeting'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.presenter).toBeUndefined();
    });
  });

  describe('series extraction', () => {
    it('should extract morning lecture series', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Morning Lecture: Topic Here'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.series).toBe('Morning Lecture');
    });

    it('should extract interfaith lecture series', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        description: 'Part of the interfaith lecture series'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.series).toBe('Interfaith Lecture');
    });

    it('should extract symphony concert series', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Symphony Concert: Beethoven'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.series).toBe('Symphony Concert');
    });
  });

  describe('audience inference', () => {
    it('should infer children audience', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Children\'s Story Time'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.audience).toBe('children');
    });

    it('should infer family-friendly audience', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        description: 'A family-friendly event for all ages'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.audience).toBe('family-friendly');
    });

    it('should infer adult-oriented audience', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        description: 'An adult discussion on complex topics'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.audience).toBe('adult-oriented');
    });

    it('should default to all-ages', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'General Event',
        description: 'A general event description'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.audience).toBe('all-ages');
    });
  });

  describe('confidence assessment', () => {
    it('should detect TBA events', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Morning Lecture: TBA'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.confidence).toBe('TBA');
    });

    it('should detect tentative events', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        description: 'This event is tentative and may change'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.confidence).toBe('tentative');
    });

    it('should detect placeholder events', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        title: 'Placeholder Event'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.confidence).toBe('placeholder');
    });

    it('should default to confirmed', () => {
      const result = EventTransformationService.transformApiEvent(mockApiEvent);
      expect(result.confidence).toBe('confirmed');
    });
  });

  describe('week calculation', () => {
    it('should calculate correct week for season start', () => {
      // 4th Sunday of June 2025 is June 22nd
      const event: ApiEvent = {
        ...mockApiEvent,
        start_date: '2025-06-22 09:00:00'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.week).toBe(1);
    });

    it('should calculate correct week for mid-season', () => {
      // Week 5 would be around July 20th
      const event: ApiEvent = {
        ...mockApiEvent,
        start_date: '2025-07-20 09:00:00'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.week).toBe(5);
    });

    it('should handle events outside season bounds', () => {
      const earlyEvent: ApiEvent = {
        ...mockApiEvent,
        start_date: '2025-05-01 09:00:00'
      };

      const lateEvent: ApiEvent = {
        ...mockApiEvent,
        start_date: '2025-10-01 09:00:00'
      };

      const earlyResult = EventTransformationService.transformApiEvent(earlyEvent);
      const lateResult = EventTransformationService.transformApiEvent(lateEvent);

      expect(earlyResult.week).toBe(1); // Clamped to minimum
      expect(lateResult.week).toBe(9); // Clamped to maximum
    });
  });

  describe('edge cases', () => {
    it('should handle event with no venue', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        venue: undefined
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.venue).toBeUndefined();
      expect(result.location).toBe('TBD');
    });

    it('should handle event with no categories', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        categories: []
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.categories).toHaveLength(0);
      expect(result.category).toBe('General');
    });

    it('should handle event with no description', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        description: undefined
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.description).toBeUndefined();
    });

    it('should handle event with no image', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        image: undefined
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.image).toBeUndefined();
    });

    it('should strip HTML from description', () => {
      const event: ApiEvent = {
        ...mockApiEvent,
        description: '<p>Test <strong>description</strong> with <em>HTML</em></p>'
      };

      const result = EventTransformationService.transformApiEvent(event);
      expect(result.description).toBe('Test description with HTML');
    });
  });
});