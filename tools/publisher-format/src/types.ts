export type IsoDateTimeWithOffset = string;

export interface PublisherInfo {
  id: string;
  name: string;
  contactEmail: string;
  url?: string;
}

export interface VenueRef {
  name: string;
  address?: string;
  url?: string;
}

export interface FeedAttachment {
  url: string;
  type: string;
  isImage: boolean;
}

export type FeedEventStatus = 'scheduled' | 'cancelled' | 'rescheduled';

export interface FeedEvent {
  id: string;
  title: string;
  startDate: IsoDateTimeWithOffset;
  endDate: IsoDateTimeWithOffset;
  category: string;
  lastModified: IsoDateTimeWithOffset;
  status?: FeedEventStatus;
  description?: string;
  venueId?: string;
  venue?: VenueRef;
  tags?: string[];
  presenter?: string;
  url?: string;
  cost?: string;
  attachments?: FeedAttachment[];
}

export interface FeedDocument {
  formatVersion: string;
  publisher: PublisherInfo;
  events: FeedEvent[];
}

export interface ValidationIssue {
  path: string;
  message: string;
  code?: string;
}

export interface ValidationReport {
  ok: boolean;
  feed?: FeedDocument;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
