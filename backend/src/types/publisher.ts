import type { FeedEvent } from '@chq-calendar/publisher-format';

export type TrustLevel = 'auto' | 'review' | 'flagged';
export type SourceType = 'json' | 'html';
export type FetchStatus = 'ok' | 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface PublisherRecord {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: SourceType;
  trustLevel: TrustLevel;
  enabled: boolean;
  // When true, the publisher is enabled but the ingest loop skips fetching
  // its feed. Existing events remain in the store and stay visible. Distinct
  // from `enabled = false`, which retracts (hard-deletes) all events on the
  // next ingest run. Optional/defaulted-undefined; absence means "not paused".
  paused?: boolean;
  // Single opt-out switch for the publisher-observability email notifications
  // (ingest-failure, ingest-recovery, event-rejected). Operational emails
  // (magic link, email-change verify, self-disable confirmation) are unaffected.
  // Absent → treated as true (default-on for legacy rows).
  notificationsEnabled?: boolean;
  // Identity-version counter. Bumped on email change verify and self-disable.
  // Issued JWTs include this; mismatch with the row's current value → 401.
  // Defaults to 0 for legacy rows that were created before this field existed.
  tokenVersion?: number;
  // Set when the publisher pauses themselves (vs admin-paused). Distinguishing
  // these is purely informational for the admin dashboard.
  selfPausedAt?: string;
  // Set when the publisher self-disables. Reversible only by an admin.
  selfDisabledAt?: string;
  // Phase 4 (publisher email change). When the old-address one-shot cancel
  // link is clicked, this timestamp is written 24h in the future. While
  // `now < emailChangeLockedUntil` the initiate path returns 423. The lock
  // auto-expires by passing the timestamp; no cleanup needed. ISO 8601.
  emailChangeLockedUntil?: string;
  createdAt: string;
  lastFetchedAt?: string;
  lastFetchStatus?: FetchStatus;
  lastFetchMessage?: string;
  pendingThresholdHalt?: {
    detectedAt: string;
    incomingFeed: { eventCount: number; publisherId: string };
  };
  // Phase B (publisher portal — apply flow). All optional. Existing rows
  // pre-dating Phase B have no applicationStatus and are treated as approved
  // by callers (`isApproved` helper below).
  applicationStatus?: ApplicationStatus;
  appliedAt?: string;
  reviewedAt?: string;
  reviewerEmail?: string;
  rejectionReason?: string;
  organization?: string;
  applicantNotes?: string;
}

// Existing publishers (pre-Phase-B) have no applicationStatus and must be
// treated as approved. New rows created via the apply flow start as 'pending'.
export function isApproved(p: Pick<PublisherRecord, 'applicationStatus'>): boolean {
  return p.applicationStatus === undefined || p.applicationStatus === 'approved';
}

export interface ApplyFormPayload {
  name: string;             // human display name (publisher name)
  email: string;            // contact email; normalized to lowercase before storage
  organization?: string;    // affiliated org, if different from name
  sourceUrl: string;
  sourceType: SourceType;
  notes?: string;           // optional message to admin
}

export interface StoredPublisherEvent {
  publisherId: string;
  eventId: string;
  startDate: string;
  endDate: string;
  lastModified: string;
  payload: FeedEvent & { sourcePublisherId: string; sourcePublisherName: string };
  state: 'published' | 'pending' | 'rejected';
  // Set when admin rejects. Optional so blank reasons are simply absent.
  // Cap at 500 chars in the handler that sets it.
  rejectionReason?: string;
  // ISO 8601 timestamp at which admin rejected. Sidecar/UI uses this to
  // sort rejected items and to show "Rejected on …" in the publisher portal.
  rejectedAt?: string;
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
