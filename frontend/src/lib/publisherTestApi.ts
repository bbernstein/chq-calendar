/**
 * Typed client for the public POST /api/publisher-test endpoint.
 *
 * Contract (must match the backend handler being built in parallel):
 *
 *   POST /api/publisher-test
 *   Body: { url, sourceType: 'json' | 'html', publisherId? }
 *
 *   200: { fetchStatus, feed, report: { ok, errors[], warnings[] } }
 *   400: { error }
 *   429: { error }
 *
 * The frontend doesn't depend on `@chq-calendar/publisher-format` directly
 * (it's a backend/tools dep), so we mirror just the fields the UI renders.
 * Keep these types in sync with `tools/publisher-format/src/types.ts` —
 * specifically `FeedDocument`, `FeedEvent`, `ValidationIssue`.
 */

import { API_BASE_URL } from '@/lib/api';

// ---------------------------------------------------------------------------
// Mirror types — keep in sync with tools/publisher-format/src/types.ts
// ---------------------------------------------------------------------------

export interface FeedPublisherInfo {
  id: string;
  name: string;
  contactEmail: string;
  url?: string;
}

export interface FeedVenueRef {
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
  startDate: string;
  endDate: string;
  category: string;
  lastModified: string;
  status?: FeedEventStatus;
  description?: string;
  venueId?: string;
  venue?: FeedVenueRef;
  tags?: string[];
  presenter?: string;
  url?: string;
  cost?: string;
  attachments?: FeedAttachment[];
}

export interface FeedDocument {
  formatVersion: string;
  publisher: FeedPublisherInfo;
  events: FeedEvent[];
}

export interface ValidationIssue {
  path: string;
  message: string;
  code?: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

export type SourceType = 'json' | 'html';

export interface PublisherTestInput {
  url: string;
  sourceType: SourceType;
  publisherId?: string;
}

export type FetchStatus =
  | 'ok'
  | 'parse_error'
  | 'validation_error'
  | 'network_error';

export interface PublisherTestSuccessBody {
  fetchStatus: FetchStatus;
  feed: FeedDocument | null;
  report: ValidationReport;
}

// Discriminated union returned to the page so it can render every state
// without throwing.
export type PublisherTestResult =
  | { kind: 'ok'; body: PublisherTestSuccessBody }
  | { kind: 'bad_request'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'network_error'; message: string }
  | { kind: 'server_error'; status: number; message: string };

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const ENDPOINT = `${API_BASE_URL}/api/publisher-test`;

export async function testPublisherFeed(
  input: PublisherTestInput,
): Promise<PublisherTestResult> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    return {
      kind: 'network_error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  // Helper to safely extract a JSON body — some error responses may not be JSON.
  const tryJson = async (): Promise<unknown> => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  if (res.status === 200) {
    const body = (await tryJson()) as PublisherTestSuccessBody | null;
    if (!body || typeof body !== 'object') {
      return {
        kind: 'server_error',
        status: 200,
        message: 'Malformed success response from server.',
      };
    }
    return { kind: 'ok', body };
  }

  if (res.status === 400) {
    const body = (await tryJson()) as { error?: string } | null;
    return {
      kind: 'bad_request',
      message: body?.error ?? 'Bad request.',
    };
  }

  if (res.status === 429) {
    const body = (await tryJson()) as { error?: string } | null;
    return {
      kind: 'rate_limited',
      message:
        body?.error ?? 'Too many requests. Please wait and try again.',
    };
  }

  const body = (await tryJson()) as { error?: string } | null;
  return {
    kind: 'server_error',
    status: res.status,
    message: body?.error ?? `Server returned ${res.status}.`,
  };
}
