import { ApiEvent, ChautauquaEvent, EventVenue, EventCategory, EventImage } from '../types';

export class EventTransformationService {
  /**
   * Transform an API event to ChautauquaEvent format
   */
  static transformApiEvent(apiEvent: ApiEvent): ChautauquaEvent {
    const startDate = new Date(apiEvent.start_date);
    const endDate = new Date(apiEvent.end_date);
    
    return {
      // Core identifiers
      id: apiEvent.id,
      uid: this.generateBackwardCompatibleUid(apiEvent),
      
      // Event details
      title: apiEvent.title,
      description: apiEvent.description ? this.stripHtml(apiEvent.description) : undefined,
      startDate: apiEvent.start_date,
      endDate: apiEvent.end_date,
      timezone: apiEvent.timezone,
      
      // Location information
      venue: apiEvent.venue ? this.transformVenue(apiEvent.venue) : undefined,
      location: apiEvent.venue?.venue || 'TBD',
      
      // Classification
      categories: apiEvent.categories.map(cat => this.transformCategory(cat)),
      tags: this.generateTags(apiEvent),
      category: this.extractPrimaryCategory(apiEvent),
      
      // Metadata
      cost: apiEvent.cost || undefined,
      url: apiEvent.url || undefined,
      image: apiEvent.image ? this.transformImage(apiEvent.image) : undefined,
      status: apiEvent.status as 'publish' | 'draft' | 'private',
      featured: apiEvent.featured,
      
      // Legacy fields for backward compatibility
      dayOfWeek: startDate.getDay(),
      isRecurring: false, // Would need additional logic to detect
      recurrencePattern: undefined,
      audience: this.inferAudience(apiEvent),
      ticketRequired: this.inferTicketRequired(apiEvent),
      subcategory: this.extractSubcategory(apiEvent),
      series: this.extractSeries(apiEvent),
      presenter: this.extractPresenter(apiEvent),
      discipline: this.extractDiscipline(apiEvent),
      
      // System fields
      week: this.calculateWeek(startDate),
      confidence: this.assessConfidence(apiEvent),
      syncStatus: 'synced',
      lastModified: new Date().toISOString(),
      source: 'events-calendar-api',
      
      // Dynamic data tracking
      lastUpdated: new Date(),
      changeLog: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Transform multiple API events
   */
  static transformApiEvents(apiEvents: ApiEvent[]): ChautauquaEvent[] {
    return apiEvents.map(event => this.transformApiEvent(event));
  }

  /**
   * Generate backward compatible UID
   */
  private static generateBackwardCompatibleUid(apiEvent: ApiEvent): string {
    // Create a consistent UID format that matches existing system
    const date = new Date(apiEvent.start_date);
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = date.toISOString().split('T')[1].replace(/[:.]/g, '').substring(0, 6);
    
    return `chq-${apiEvent.id}-${dateStr}T${timeStr}`;
  }

  /**
   * Transform venue object
   */
  private static transformVenue(venue: ApiEvent['venue']): EventVenue | undefined {
    if (!venue) return undefined;
    
    return {
      id: venue.id,
      name: venue.venue,
      address: venue.address,
      showMap: venue.show_map
    };
  }

  /**
   * Transform category object
   */
  private static transformCategory(category: ApiEvent['categories'][0]): EventCategory {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      taxonomy: category.taxonomy,
      parent: category.parent
    };
  }

  /**
   * Transform image object
   */
  private static transformImage(image: ApiEvent['image']): EventImage | undefined {
    if (!image) return undefined;
    
    return {
      url: image.url,
      alt: image.alt,
      sizes: image.sizes
    };
  }

  /**
   * Generate tags from event data
   */
  private static generateTags(apiEvent: ApiEvent): string[] {
    const tags: Set<string> = new Set();
    
    // Add venue as tag
    if (apiEvent.venue?.venue) {
      tags.add(apiEvent.venue.venue.toLowerCase());
    }
    
    // Add categories as tags
    apiEvent.categories.forEach(cat => {
      tags.add(cat.slug);
      tags.add(cat.name.toLowerCase());
    });
    
    // Extract tags from title
    const titleTags = this.extractTagsFromText(apiEvent.title);
    titleTags.forEach(tag => tags.add(tag));
    
    // Extract tags from description
    if (apiEvent.description) {
      const descTags = this.extractTagsFromText(apiEvent.description);
      descTags.forEach(tag => tags.add(tag));
    }
    
    // Add cost-related tags
    if (apiEvent.cost) {
      if (apiEvent.cost.includes('$0') || apiEvent.cost.toLowerCase().includes('free')) {
        tags.add('free');
      } else {
        tags.add('ticketed');
      }
    }
    
    return Array.from(tags).filter(tag => tag.length > 2); // Filter out very short tags
  }

  /**
   * Extract tags from text using common patterns
   */
  private static extractTagsFromText(text: string): string[] {
    const tags: string[] = [];
    const cleanText = this.stripHtml(text).toLowerCase();
    
    // Common venue abbreviations
    const venueMap: { [key: string]: string } = {
      'amp': 'amphitheater',
      'cso': 'chautauqua symphony orchestra',
      'ctc': 'chautauqua theater company',
      'clsc': 'chautauqua literary and scientific circle',
      'ciwl': 'chautauqua institution womens league',
      'hop': 'hall of philosophy',
      'hoc': 'hall of christ'
    };
    
    Object.entries(venueMap).forEach(([abbr, full]) => {
      if (cleanText.includes(abbr)) {
        tags.push(full);
      }
    });
    
    // Common event types
    const eventTypes = [
      'lecture', 'concert', 'recital', 'performance', 'workshop',
      'service', 'class', 'meeting', 'exhibition', 'tour',
      'discussion', 'presentation', 'ceremony', 'festival'
    ];
    
    eventTypes.forEach(type => {
      if (cleanText.includes(type)) {
        tags.push(type);
      }
    });
    
    return tags;
  }

  /**
   * Extract primary category for backward compatibility
   */
  private static extractPrimaryCategory(apiEvent: ApiEvent): string {
    if (apiEvent.categories.length === 0) return 'General';
    
    // Priority order for category selection
    const priorityCategories = [
      'Interfaith Lecture Series',
      'Morning Lecture',
      'Chautauqua Symphony Orchestra',
      'Chautauqua Theater Company',
      'Visual Arts',
      'Recreation',
      'Special Events'
    ];
    
    for (const priority of priorityCategories) {
      const found = apiEvent.categories.find(cat => 
        cat.name.toLowerCase().includes(priority.toLowerCase())
      );
      if (found) return found.name;
    }
    
    return apiEvent.categories[0].name;
  }

  /**
   * Extract subcategory
   */
  private static extractSubcategory(apiEvent: ApiEvent): string | undefined {
    const childCategories = apiEvent.categories.filter(cat => cat.parent > 0);
    return childCategories.length > 0 ? childCategories[0].name : undefined;
  }

  /**
   * Extract series information
   */
  private static extractSeries(apiEvent: ApiEvent): string | undefined {
    const title = apiEvent.title.toLowerCase();
    const description = apiEvent.description?.toLowerCase() || '';
    
    // Common series patterns
    const seriesPatterns = [
      'morning lecture',
      'interfaith lecture',
      'porch discussion',
      'master class',
      'symphony concert',
      'chamber music',
      'sunday service'
    ];
    
    for (const pattern of seriesPatterns) {
      if (title.includes(pattern) || description.includes(pattern)) {
        return pattern.replace(/\b\w/g, l => l.toUpperCase()); // Title case
      }
    }
    
    return undefined;
  }

  /**
   * Extract presenter information
   */
  private static extractPresenter(apiEvent: ApiEvent): string | undefined {
    const title = apiEvent.title;
    
    // Common presenter patterns
    const patterns = [
      /with\s+([^,\n]+)/i,
      /by\s+([^,\n]+)/i,
      /featuring\s+([^,\n]+)/i,
      /presenter:\s*([^,\n]+)/i,
      /speaker:\s*([^,\n]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return undefined;
  }

  /**
   * Extract discipline information
   */
  private static extractDiscipline(apiEvent: ApiEvent): string | undefined {
    const categories = apiEvent.categories.map(cat => cat.name.toLowerCase());
    
    const disciplineMap: { [key: string]: string } = {
      'music': 'Music',
      'theater': 'Theater',
      'lecture': 'Education',
      'visual arts': 'Visual Arts',
      'dance': 'Dance',
      'literature': 'Literature',
      'religion': 'Religion',
      'philosophy': 'Philosophy',
      'science': 'Science'
    };
    
    for (const [key, value] of Object.entries(disciplineMap)) {
      if (categories.some(cat => cat.includes(key))) {
        return value;
      }
    }
    
    return undefined;
  }

  /**
   * Infer audience type
   */
  private static inferAudience(apiEvent: ApiEvent): ChautauquaEvent['audience'] {
    const title = apiEvent.title.toLowerCase();
    const description = apiEvent.description?.toLowerCase() || '';
    const text = `${title} ${description}`;
    
    if (text.includes('children') || text.includes('kids') || text.includes('youth')) {
      return 'children';
    }
    
    if (text.includes('family')) {
      return 'family-friendly';
    }
    
    if (text.includes('adult') || text.includes('mature')) {
      return 'adult-oriented';
    }
    
    return 'all-ages';
  }

  /**
   * Infer if ticket is required
   */
  private static inferTicketRequired(apiEvent: ApiEvent): boolean {
    if (!apiEvent.cost) return false;
    
    const cost = apiEvent.cost.toLowerCase();
    return !(cost.includes('$0') || cost.includes('free') || cost.includes('no charge'));
  }

  /**
   * Calculate Chautauqua week number
   */
  private static calculateWeek(eventDate: Date): number {
    const year = eventDate.getFullYear();
    
    // Find the 4th Sunday of June
    const june1 = new Date(year, 5, 1);
    const current = new Date(june1);
    let sundayCount = 0;
    let fourthSunday: Date | null = null;

    while (current.getMonth() === 5) {
      if (current.getDay() === 0) {
        sundayCount++;
        if (sundayCount === 4) {
          fourthSunday = new Date(current);
          break;
        }
      }
      current.setDate(current.getDate() + 1);
    }

    if (!fourthSunday) {
      console.warn(`Could not find 4th Sunday of June ${year}`);
      return 1;
    }

    // Calculate week number
    const timeDiff = eventDate.getTime() - fourthSunday.getTime();
    const weekNumber = Math.floor(timeDiff / (7 * 24 * 60 * 60 * 1000)) + 1;
    
    return Math.max(1, Math.min(9, weekNumber));
  }

  /**
   * Assess confidence level
   */
  private static assessConfidence(apiEvent: ApiEvent): ChautauquaEvent['confidence'] {
    const title = apiEvent.title.toLowerCase();
    const description = apiEvent.description?.toLowerCase() || '';
    
    if (title.includes('tba') || title.includes('to be announced') || 
        description.includes('tba') || description.includes('to be announced')) {
      return 'TBA';
    }
    
    if (title.includes('tentative') || description.includes('tentative')) {
      return 'tentative';
    }
    
    if (title.includes('placeholder') || description.includes('placeholder')) {
      return 'placeholder';
    }
    
    return 'confirmed';
  }

  /**
   * Strip HTML tags from text
   */
  private static stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }
}

export default EventTransformationService;