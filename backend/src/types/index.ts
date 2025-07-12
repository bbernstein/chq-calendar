export interface ChautauquaEvent {
  id: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  location: string;
  venue: string;
  tags: string[];
  week: number;
  dayOfWeek: number;
  isRecurring?: boolean;
  recurrencePattern?: string;
  audience?: 'all-ages' | 'family-friendly' | 'adult-oriented' | 'children';
  ticketRequired?: boolean;
  category: string;
  subcategory?: string;
  series?: string;
  presenter?: string;
  discipline?: string;

  // Dynamic data tracking
  lastUpdated: Date;
  dataSource: 'chautauqua-api' | 'web-scraper' | 'manual' | 'fallback';
  confidence: 'confirmed' | 'tentative' | 'placeholder' | 'tba';
  changeLog?: EventChange[];
  syncStatus: 'synced' | 'pending' | 'error' | 'outdated';
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
