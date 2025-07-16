export interface ChautauquaEvent {
  // Core identifiers
  id: number;                     // API event ID
  uid: string;                    // Generated UID for backward compatibility
  
  // Event details
  title: string;
  description?: string;           // HTML content
  startDate: string;              // ISO 8601 datetime
  endDate: string;                // ISO 8601 datetime
  timezone: string;               // e.g., "America/New_York"
  
  // Location information
  venue?: EventVenue;
  location?: string;              // Backward compatibility
  
  // Classification
  categories: EventCategory[];
  tags: string[];                 // Generated from categories and content
  category: string;               // Primary category for backward compatibility
  
  // Metadata
  cost?: string;
  url?: string;
  image?: EventImage;
  status: 'publish' | 'draft' | 'private';
  featured: boolean;
  
  // Legacy fields for backward compatibility
  dayOfWeek: number;
  isRecurring?: boolean;
  recurrencePattern?: string;
  audience?: 'all-ages' | 'family-friendly' | 'adult-oriented' | 'children';
  ticketRequired?: boolean;
  subcategory?: string;
  series?: string;
  presenter?: string;
  discipline?: string;
  
  // System fields
  week: number;                   // Chautauqua season week (1-9)
  confidence: 'confirmed' | 'tentative' | 'placeholder' | 'TBA';
  syncStatus: 'synced' | 'pending' | 'error' | 'outdated';
  lastModified: string;           // ISO 8601 datetime
  source: 'events-calendar-api' | 'chautauqua-api' | 'web-scraper' | 'manual' | 'fallback';
  
  // Dynamic data tracking
  lastUpdated: Date;
  changeLog?: EventChange[];
  createdAt?: string;
  updatedAt?: string;
}

export interface EventVenue {
  id: number;
  name: string;
  address?: string;
  showMap: boolean;
}

export interface EventCategory {
  id: number;
  name: string;
  slug: string;
  taxonomy: string;
  parent: number;
}

export interface EventImage {
  url: string;
  alt?: string;
  sizes: {
    thumbnail?: string;
    medium?: string;
    large?: string;
  };
}

// API response interfaces
export interface ApiEvent {
  id: number;
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
  timezone: string;
  venue?: {
    id: number;
    venue: string;
    address?: string;
    show_map: boolean;
  };
  categories: {
    id: number;
    name: string;
    slug: string;
    taxonomy: string;
    parent: number;
  }[];
  image?: {
    url: string;
    alt?: string;
    sizes: {
      thumbnail?: string;
      medium?: string;
      large?: string;
    };
  };
  cost?: string;
  url?: string;
  status: string;
  featured: boolean;
}

export interface ApiResponse {
  events: ApiEvent[];
  total: number;
  total_pages: number;
  next_rest_url?: string;
}

export interface DateRange {
  start: string;   // YYYY-MM-DD format
  end: string;     // YYYY-MM-DD format
}

export interface ApiOptions {
  perPage?: number;
  page?: number;
}

export interface SyncResult {
  success: boolean;
  eventsProcessed: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
  errors: string[];
  duration: number;
}

export interface EventChange {
  timestamp: Date;
  field: string;
  oldValue: any;
  newValue: any;
  source: string;
}

export interface FilterDimension {
  id: string;
  label: string;
  description: string;
  type: 'single' | 'multi' | 'range' | 'boolean';
  options?: FilterOption[];
  defaultValue?: any;
}

export interface FilterOption {
  value: string;
  label: string;
  description?: string;
  count?: number;
}

export interface EventFilter {
  venue?: string[];
  timeOfDay?: string[];
  dayOfWeek?: number[];
  category?: string[];
  tags?: string[];
  series?: string[];
  discipline?: string[];
  audience?: string[];
  duration?: { min: number; max: number };
  ticketRequired?: boolean;
  week?: number[];
  presenter?: string[];
  location?: string[];
}

export interface CalendarRequest {
  filters: EventFilter;
  format: 'ics' | 'google' | 'outlook';
  timezone?: string;
  includeSeries?: boolean;
}

export interface CalendarResponse {
  success: boolean;
  data?: string;
  downloadUrl?: string;
  error?: string;
}
