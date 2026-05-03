import { API_BASE_URL } from '@/lib/api';
import { getAuthToken, removeAuthToken } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

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
  // Phase B/C — apply flow. Optional; admin-created rows have no
  // applicationStatus and are treated as approved by the UI.
  applicationStatus?: ApplicationStatus;
  appliedAt?: string;
  reviewedAt?: string;
  reviewerEmail?: string;
  rejectionReason?: string;
  organization?: string;
  applicantNotes?: string;
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
  if (res.status === 401 || res.status === 403) {
    // Token expired or revoked: clear stored credentials and bounce to login.
    // Matches the existing /admin/feedback page's authenticatedFetch behavior,
    // including its localhost guard: on dev the dummy token never passes JWT
    // verification, so the 401 is expected and we surface it to the caller
    // without clearing storage or redirecting (the page bootstrap already
    // sets the dummy token and we'd loop forever otherwise).
    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if (!isLocalhost) {
      removeAuthToken();
      if (typeof window !== 'undefined') {
        window.location.href = '/admin/login/';
      }
    }
    throw new Error(`${res.status}: authentication expired`);
  }
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

// Backend wraps responses in named keys ({ publishers, publisher, events, halts })
// matching the convention from /admin/api/feedback. Unwrap here so callers
// receive the bare arrays / records they expect.

export const listPublishers = async (): Promise<PublisherRecord[]> => {
  const r = await req<{ publishers: PublisherRecord[] }>('/publishers');
  return r.publishers;
};

export const createPublisher = async (input: CreatePublisherInput): Promise<PublisherRecord> => {
  const r = await req<{ publisher: PublisherRecord }>('/publishers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return r.publisher;
};

export const updatePublisher = async (
  id: string,
  patch: Partial<PublisherRecord>,
): Promise<PublisherRecord> => {
  const r = await req<{ publisher: PublisherRecord }>(
    `/publishers/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return r.publisher;
};

// ---------------------------------------------------------------------------
// Pending events
// ---------------------------------------------------------------------------

export const listPending = async (): Promise<PendingEvent[]> => {
  const r = await req<{ events: PendingEvent[] }>('/publisher-events/pending');
  return r.events;
};

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

export const listHalts = async (): Promise<PublisherRecord[]> => {
  const r = await req<{ halts: PublisherRecord[] }>('/publisher-halts');
  return r.halts;
};

// Backend currently returns `{}` for halt approval (Plan 3 Task 3 deviation:
// the next scheduled ingest re-evaluates rather than re-running reconcile here).
// Typed as void so callers don't depend on a stats payload that isn't returned.
export const approveHalt = async (publisherId: string): Promise<void> => {
  await req<Record<string, never>>(
    `/publisher-halts/${encodeURIComponent(publisherId)}/approve`,
    { method: 'POST' }
  );
};

export const cancelHalt = (publisherId: string): Promise<void> =>
  req<void>(`/publisher-halts/${encodeURIComponent(publisherId)}/cancel`, { method: 'POST' });

// ---------------------------------------------------------------------------
// Phase C — pending application review
// ---------------------------------------------------------------------------

export const listPendingApplications = async (): Promise<PublisherRecord[]> => {
  const r = await req<{ applications: PublisherRecord[] }>('/publisher-applications/pending');
  return r.applications;
};

export const approveApplication = async (id: string): Promise<PublisherRecord> => {
  const r = await req<{ publisher: PublisherRecord }>(
    `/publisher-applications/${encodeURIComponent(id)}/approve`,
    { method: 'POST' },
  );
  return r.publisher;
};

export const rejectApplication = async (
  id: string,
  reason?: string,
): Promise<PublisherRecord> => {
  const r = await req<{ publisher: PublisherRecord }>(
    `/publisher-applications/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify({ reason: reason ?? '' }) },
  );
  return r.publisher;
};
