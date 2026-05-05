/**
 * Email-change verify landing page (Phase 4).
 *
 * Reads ?token from the URL, GETs /api/publisher-email-change/verify, and
 * renders the outcome:
 *   - kind=ok          → redirect to /publish/login/?email=<new>&reason=email-changed
 *                        (the publisher's old session is now invalid via
 *                        tokenVersion bump; they need to sign in fresh)
 *   - kind=already_used → friendly error
 *   - kind=expired      → friendly error
 *   - kind=email_taken  → friendly error explaining the race
 */

import { useEffect, useState } from 'react';

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '';

type Status =
  | { kind: 'pending' }
  | { kind: 'redirecting'; newEmail: string }
  | { kind: 'error'; message: string };

export default function PublishEmailChangeVerifyPage() {
  const [status, setStatus] = useState<Status>({ kind: 'pending' });

  useEffect(() => {
    void verify().then(s => {
      setStatus(s);
      if (s.kind === 'redirecting') {
        const params = new URLSearchParams({
          email: s.newEmail,
          reason: 'email-changed',
        });
        // Strip token from current URL before navigating away.
        window.history.replaceState({}, '', window.location.pathname);
        window.location.replace(`/publish/login/?${params.toString()}`);
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center py-4">
            <img
              src="/chq-calendar-icon-256.svg"
              alt="Chautauqua Calendar Logo"
              width={32}
              height={32}
              className="w-8 h-8 mr-3"
            />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
              Confirm email change
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
          {(status.kind === 'pending' || status.kind === 'redirecting') && <Pending />}
          {status.kind === 'error' && <Failed message={status.message} />}
        </div>
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie and Claude
          </p>
        </div>
      </footer>
    </div>
  );
}

async function verify(): Promise<Status> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    // Same UX as the backend's `kind: 'invalid'` — usually means the email
    // client mangled the link.
    return { kind: 'error', message: explainKind('invalid') };
  }
  try {
    const r = await fetch(
      `${API_BASE}/api/publisher-email-change/verify?token=${encodeURIComponent(token)}`,
    );
    const body = await r.json().catch(() => ({}));
    if (!r.ok || typeof body?.kind !== 'string') {
      return { kind: 'error', message: 'Verification failed.' };
    }
    if (body.kind === 'ok') {
      return { kind: 'redirecting', newEmail: typeof body.newEmail === 'string' ? body.newEmail : '' };
    }
    return { kind: 'error', message: explainKind(body.kind) };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Network error' };
  }
}

function explainKind(kind: string): string {
  switch (kind) {
    case 'invalid':
      // Link arrived without a usable token at all — most often the email
      // client truncated the URL. Tell the user how to recover rather than
      // implying they did something wrong (which "already used" would).
      return (
        'This link looks broken. Try clicking it directly from your email — ' +
        'some email clients truncate long links when copy-pasted. If that ' +
        'still fails, sign in at /publish/login/ and request a new email change.'
      );
    case 'already_used':
      return 'This link is no longer valid — it may have already been used or cancelled.';
    case 'expired':
      return 'This link has expired. Email-change links are valid for 24 hours.';
    case 'email_taken':
      return (
        'The new email address is no longer available. It may have been claimed by ' +
        'another publisher while this request was pending.'
      );
    default:
      return 'Verification failed.';
  }
}

function Pending() {
  return (
    <div className="py-8">
      <div className="mx-auto w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-gray-700 dark:text-gray-300">Confirming your new email…</p>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div>
      <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-red-600 dark:text-red-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Couldn&apos;t confirm
      </h2>
      <p className="text-gray-700 dark:text-gray-300 mb-6">{message}</p>
      <a
        href="/publish/login/"
        className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
      >
        Go to sign-in
      </a>
    </div>
  );
}
