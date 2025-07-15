import * as ical from 'node-ical';
import { ChautauquaEvent, EventChange } from '../types/index';
import { format, parseISO } from 'date-fns';

export interface ICSEvent {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  url?: string;
  categories?: string[];
  lastModified?: Date;
  created?: Date;
  attach?: string;
  dtstamp?: Date;
}

export interface ParsedICSData {
  events: ICSEvent[];
  metadata: {
    calendarName?: string;
    description?: string;
    refreshInterval?: string;
    lastGenerated?: Date;
  };
}

export class ICSParserService {
  
  /**
   * Parse ICS data from string format
   */
  static parseICSData(icsData: string): ParsedICSData {
    const parsed = ical.parseICS(icsData);
    const events: ICSEvent[] = [];
    const metadata: ParsedICSData['metadata'] = {};

    // Extract calendar metadata
    Object.values(parsed).forEach((component: any) => {
      if (component.type === 'VCALENDAR') {
        metadata.calendarName = (component as any)['X-WR-CALNAME'] || (component as any)['x-wr-calname'];
        metadata.description = (component as any)['X-WR-CALDESC'] || (component as any)['x-wr-caldesc'];
        metadata.refreshInterval = (component as any)['REFRESH-INTERVAL'] || (component as any)['refresh-interval'];
      }
    });

    // If we didn't find metadata in VCALENDAR, look in the root
    if (!metadata.calendarName) {
      Object.keys(parsed).forEach((key) => {
        const component = parsed[key];
        if (component && typeof component === 'object' && (component as any).type === 'VCALENDAR') {
          metadata.calendarName = (component as any)['X-WR-CALNAME'] || (component as any)['x-wr-calname'];
          metadata.description = (component as any)['X-WR-CALDESC'] || (component as any)['x-wr-caldesc'];
          metadata.refreshInterval = (component as any)['REFRESH-INTERVAL'] || (component as any)['refresh-interval'];
        }
      });
    }

    // Extract events
    Object.values(parsed).forEach((component: any) => {
      if (component.type === 'VEVENT') {
        const event: ICSEvent = {
          uid: component.uid,
          summary: component.summary || '',
          description: component.description || '',
          start: component.start,
          end: component.end,
          location: component.location || '',
          url: component.url || '',
          categories: component.categories ? 
            (Array.isArray(component.categories) ? component.categories : component.categories.split(',').map((c: string) => c.trim())) : [],
          lastModified: component.lastmodified,
          created: component.created,
          attach: component.attach,
          dtstamp: component.dtstamp,
        };

        // Only add valid events with required fields
        if (event.uid && event.summary && event.start && event.end) {
          events.push(event);
        }
      }
    });

    return {
      events,
      metadata: {
        ...metadata,
        lastGenerated: new Date(),
      },
    };
  }

  /**
   * Convert ICS event to ChautauquaEvent format
   */
  static convertToChautauquaEvent(icsEvent: ICSEvent): ChautauquaEvent {
    // Extract venue from location
    const { venue, location } = this.parseLocationVenue(icsEvent.location || '');

    // Determine category and subcategory
    const { category, subcategory } = this.categorizeEvent(icsEvent);

    // Extract tags from categories and description
    const tags = this.extractTags(icsEvent);

    return {
      id: icsEvent.uid,
      title: icsEvent.summary,
      description: icsEvent.description,
      startDate: icsEvent.start,
      endDate: icsEvent.end,
      location,
      venue,
      tags,
      dayOfWeek: icsEvent.start.getDay(),
      category,
      subcategory,
      presenter: this.extractPresenter(icsEvent.summary),
      lastUpdated: icsEvent.lastModified || new Date(),
      dataSource: 'chautauqua-api',
      confidence: 'confirmed',
      syncStatus: 'synced',
      url: icsEvent.url,
      imageUrl: icsEvent.attach,
    };
  }

  /**
   * Compare two events and detect changes
   */
  static detectChanges(oldEvent: ChautauquaEvent, newEvent: ChautauquaEvent): EventChange[] {
    const changes: EventChange[] = [];
    const timestamp = new Date();

    // Fields to monitor for changes
    const watchFields = [
      'title', 'description', 'startDate', 'endDate', 'location', 
      'venue', 'presenter', 'category', 'subcategory', 'url', 'imageUrl'
    ];

    watchFields.forEach(field => {
      const oldValue = oldEvent[field as keyof ChautauquaEvent];
      const newValue = newEvent[field as keyof ChautauquaEvent];

      // Handle date comparisons
      if (field.includes('Date')) {
        const oldTime = oldValue instanceof Date ? oldValue.getTime() : 0;
        const newTime = newValue instanceof Date ? newValue.getTime() : 0;
        
        if (oldTime !== newTime) {
          changes.push({
            timestamp,
            field,
            oldValue: oldValue instanceof Date ? oldValue.toISOString() : oldValue,
            newValue: newValue instanceof Date ? newValue.toISOString() : newValue,
            source: 'ics-update',
          });
        }
      } else if (oldValue !== newValue) {
        changes.push({
          timestamp,
          field,
          oldValue,
          newValue,
          source: 'ics-update',
        });
      }
    });

    return changes;
  }

  /**
   * Check if event needs updating based on lastModified timestamp
   */
  static needsUpdate(existingEvent: ChautauquaEvent, icsEvent: ICSEvent): boolean {
    if (!existingEvent.lastUpdated || !icsEvent.lastModified) {
      return true; // Update if we don't have timestamps
    }

    return icsEvent.lastModified > existingEvent.lastUpdated;
  }


  /**
   * Parse location to extract venue and location details
   */
  private static parseLocationVenue(locationStr: string): { venue: string; location: string } {
    // Handle comma-separated location format
    const parts = locationStr.split(',').map(p => p.trim());
    
    if (parts.length >= 2) {
      return {
        venue: parts[0],
        location: parts[1],
      };
    }

    return {
      venue: locationStr,
      location: locationStr,
    };
  }

  /**
   * Categorize event based on categories and content
   */
  private static categorizeEvent(icsEvent: ICSEvent): { category: string; subcategory?: string } {
    const categories = icsEvent.categories || [];
    const summary = icsEvent.summary.toLowerCase();
    const description = (icsEvent.description || '').toLowerCase();

    // Priority-based categorization
    const categoryMap = [
      { keywords: ['symphony', 'orchestra', 'concert', 'music'], category: 'Music', subcategory: 'Classical' },
      { keywords: ['lecture', 'morning lecture'], category: 'Education', subcategory: 'Lectures' },
      { keywords: ['interfaith', 'chapel', 'worship', 'prayer', 'meditation'], category: 'Religion', subcategory: 'Worship' },
      { keywords: ['theater', 'theatre', 'drama', 'play'], category: 'Arts', subcategory: 'Theater' },
      { keywords: ['dance', 'ballet'], category: 'Arts', subcategory: 'Dance' },
      { keywords: ['film', 'movie', 'cinema'], category: 'Entertainment', subcategory: 'Film' },
      { keywords: ['family', 'children', 'kids'], category: 'Family', subcategory: 'Children' },
      { keywords: ['dining', 'restaurant', 'food'], category: 'Dining', subcategory: 'Restaurant' },
      { keywords: ['recreation', 'sports', 'fitness'], category: 'Recreation', subcategory: 'Sports' },
    ];

    // Check categories first
    for (const cat of categories) {
      const catLower = cat.toLowerCase();
      for (const rule of categoryMap) {
        if (rule.keywords.some(keyword => catLower.includes(keyword))) {
          return { category: rule.category, subcategory: rule.subcategory };
        }
      }
    }

    // Check summary and description
    const content = `${summary} ${description}`;
    for (const rule of categoryMap) {
      if (rule.keywords.some(keyword => content.includes(keyword))) {
        return { category: rule.category, subcategory: rule.subcategory };
      }
    }

    // Default category
    return { category: 'General', subcategory: 'Event' };
  }

  /**
   * Extract tags from categories and description
   */
  private static extractTags(icsEvent: ICSEvent): string[] {
    const tags = new Set<string>();

    // Add categories as tags
    icsEvent.categories?.forEach(category => {
      // Skip generic categories and all week-related tags
      if (!category.match(/^(Chautauqua Institution Program|Week .+)$/i)) {
        tags.add(category.toLowerCase().replace(/\s+/g, '-'));
      }
    });

    // Extract tags from description
    const description = icsEvent.description || '';
    const summary = icsEvent.summary || '';
    
    // Common tag patterns
    const tagPatterns = [
      /\b(free|ticketed|reservation required|rain location)\b/gi,
      /\b(all ages|family friendly|adult oriented)\b/gi,
      /\b(indoor|outdoor|amphitheater|hall)\b/gi,
    ];

    tagPatterns.forEach(pattern => {
      const matches = [...description.matchAll(pattern), ...summary.matchAll(pattern)];
      matches.forEach(match => {
        tags.add(match[0].toLowerCase().replace(/\s+/g, '-'));
      });
    });

    return Array.from(tags);
  }

  /**
   * Extract presenter from event summary
   */
  private static extractPresenter(summary: string): string | undefined {
    // Common presenter patterns
    const patterns = [
      /(?:with|featuring|by|presents?)\s+([^,\n]+)/i,
      /:\s*([^,\n]+)$/,  // "Event Title: Presenter"
      /^([^:]+):\s/,  // "Presenter: Event Title"
      /\s-\s([^-\n]+)$/,  // "Event Title - Presenter"
    ];

    for (const pattern of patterns) {
      const match = summary.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

}

export default ICSParserService;