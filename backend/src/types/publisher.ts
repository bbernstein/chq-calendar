import type { FeedEvent, PublisherInfo } from '@chq-calendar/publisher-format';

export type TrustLevel = 'auto' | 'review' | 'flagged';
export type SourceType = 'json' | 'html';
export type FetchStatus = 'ok' | 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';

export interface PublisherRecord {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: SourceType;
  trustLevel: TrustLevel;
  enabled: boolean;
  createdAt: string;
  lastFetchedAt?: string;
  lastFetchStatus?: FetchStatus;
  lastFetchMessage?: string;
  pendingThresholdHalt?: {
    detectedAt: string;
    incomingFeed: { events: FeedEvent[]; publisher: PublisherInfo };
  };
}

export interface StoredPublisherEvent {
  publisherId: string;
  eventId: string;
  startDate: string;
  endDate: string;
  lastModified: string;
  payload: FeedEvent & { sourcePublisherId: string; sourcePublisherName: string };
  state: 'published' | 'pending';
  updatedAt: string;
}

export interface ReconcileDiff {
  inserts: StoredPublisherEvent[];
  updates: StoredPublisherEvent[];
  removals: StoredPublisherEvent[];
  unchanged: number;
}

export interface ReconcileResult {
  applied: boolean;
  diff: ReconcileDiff;
  haltedByThreshold?: { reason: string };
}
