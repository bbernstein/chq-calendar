import { API_BASE_URL } from '@/lib/api';
import { getAuthToken } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublisherRecord {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel: 'auto' | 'review' | 'flagged';
  enabled: boolean;
  createdAt: string;
  lastFetchedAt?: string;
  lastFetchStatus?: 'ok' | 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';
  lastFetchMessage?: string;
  pendingThresholdHalt?: {
    detectedAt: string;
    incomingFeed: { eventCount: number; publisherId: string };
  };
}

export interface PendingEvent {
  publisherId: string;
  eventId: string;
  startDate: string;
  endDate: string;
  lastModified: string;
  payload: {
    title: string;
    startDate: string;
    endDate: string;
    category: string;
    sourcePublisherId: string;
    sourcePublisherName: string;
    // additional fields from FeedEvent are allowed but not required by the UI
    [key: string]: unknown;
  };
  state: 'pending' | 'published';
  updatedAt: string;
}

export interface CreatePublisherInput {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel?: PublisherRecord['trustLevel'];
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

const ADMIN_API_PREFIX = `${API_BASE_URL}/admin/api`;

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${ADMIN_API_PREFIX}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Publisher CRUD
// ---------------------------------------------------------------------------

export const listPublishers = (): Promise<PublisherRecord[]> =>
  req<PublisherRecord[]>('/publishers');

export const createPublisher = (input: CreatePublisherInput): Promise<PublisherRecord> =>
  req<PublisherRecord>('/publishers', { method: 'POST', body: JSON.stringify(input) });

export const updatePublisher = (id: string, patch: Partial<PublisherRecord>): Promise<PublisherRecord> =>
  req<PublisherRecord>(`/publishers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// ---------------------------------------------------------------------------
// Pending events
// ---------------------------------------------------------------------------

export const listPending = (): Promise<PendingEvent[]> =>
  req<PendingEvent[]>('/publisher-events/pending');

export const approveEvent = (publisherId: string, eventId: string): Promise<void> =>
  req<void>(
    `/publisher-events/${encodeURIComponent(publisherId)}/${encodeURIComponent(eventId)}/approve`,
    { method: 'POST' }
  );

export const rejectEvent = (publisherId: string, eventId: string): Promise<void> =>
  req<void>(
    `/publisher-events/${encodeURIComponent(publisherId)}/${encodeURIComponent(eventId)}/reject`,
    { method: 'POST' }
  );

// ---------------------------------------------------------------------------
// Threshold halts
// ---------------------------------------------------------------------------

export const listHalts = (): Promise<PublisherRecord[]> =>
  req<PublisherRecord[]>('/publisher-halts');

export const approveHalt = (
  publisherId: string
): Promise<{ inserted: number; updated: number; removed: number } | Record<string, never>> =>
  req<{ inserted: number; updated: number; removed: number } | Record<string, never>>(
    `/publisher-halts/${encodeURIComponent(publisherId)}/approve`,
    { method: 'POST' }
  );

export const cancelHalt = (publisherId: string): Promise<void> =>
  req<void>(`/publisher-halts/${encodeURIComponent(publisherId)}/cancel`, { method: 'POST' });
