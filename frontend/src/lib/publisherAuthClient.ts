// LocalStorage helpers for the publisher portal Phase B magic-link auth.
//
// Storage keys use the `chq_publisher_*` prefix to avoid collision with the
// admin auth keys (`chq_auth_*`). Mixing the two is intentional: a publisher
// who is also an admin (because their email is in the whitelist) keeps two
// independent sessions.

export const PUBLISHER_JWT_KEY = 'chq_publisher_jwt';
export const PUBLISHER_ID_KEY = 'chq_publisher_id';
export const PUBLISHER_EMAIL_KEY = 'chq_publisher_email';

export interface PublisherSession {
  jwt: string;
  publisherId: string;
  email: string;
}

export function getPublisherJwt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PUBLISHER_JWT_KEY);
}

export function setPublisherSession(s: PublisherSession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PUBLISHER_JWT_KEY, s.jwt);
  localStorage.setItem(PUBLISHER_ID_KEY, s.publisherId);
  localStorage.setItem(PUBLISHER_EMAIL_KEY, s.email);
}

export function clearPublisherSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PUBLISHER_JWT_KEY);
  localStorage.removeItem(PUBLISHER_ID_KEY);
  localStorage.removeItem(PUBLISHER_EMAIL_KEY);
}

export function getPublisherSession(): PublisherSession | null {
  if (typeof window === 'undefined') return null;
  const jwt = localStorage.getItem(PUBLISHER_JWT_KEY);
  const publisherId = localStorage.getItem(PUBLISHER_ID_KEY);
  const email = localStorage.getItem(PUBLISHER_EMAIL_KEY);
  if (!jwt || !publisherId || !email) return null;
  return { jwt, publisherId, email };
}

export function isPublisherAuthenticated(): boolean {
  return getPublisherJwt() !== null;
}
