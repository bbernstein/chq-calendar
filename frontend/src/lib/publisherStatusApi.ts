// Client for the publisher-facing /api/publisher-status endpoint (Phase C).
// On 401 we clear the local session and bounce to /publish/login/ — the
// caller doesn't need to handle that case.

import { clearPublisherSession, getPublisherJwt } from '@/lib/publisherAuthClient';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface PublisherStatusRecord {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel: 'auto' | 'review' | 'flagged';
  enabled: boolean;
  createdAt: string;
  applicationStatus?: ApplicationStatus;
  appliedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  organization?: string;
  applicantNotes?: string;
  lastFetchedAt?: string;
  lastFetchStatus?: 'ok' | 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';
  lastFetchMessage?: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '';

export class PublisherStatusError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PublisherStatusError';
  }
}

// Returns the publisher's own record. Throws PublisherStatusError on
// non-2xx responses (other than 401, which we handle by redirecting).
//
// The redirect-on-401 means callers can treat a thrown error as a real
// "something went wrong" rather than an auth event — auth events take the
// user straight to /publish/login/ before the throw.
export async function getPublisherStatus(): Promise<PublisherStatusRecord> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    // redirectToLogin replaces the page; throw is reachable only in tests.
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/publisher-status`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new PublisherStatusError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
    );
  }
  if (!body || typeof body.publisher !== 'object' || body.publisher === null) {
    throw new PublisherStatusError('Malformed response.', 500);
  }
  return body.publisher as PublisherStatusRecord;
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  window.location.replace('/publish/login/');
}
