/**
 * Email-change cancel landing page (Phase 4).
 *
 * One-shot link clicked from the OLD address's "wasn't me" warning email.
 * GETs /api/publisher-email-change/cancel with the token; backend deletes
 * the pending pair and writes a 24h emailChangeLockedUntil on the publisher
 * row. Renders the outcome.
 */

import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

type Status =
  | { kind: 'pending' }
  | { kind: 'ok'; lockedUntil: string }
  | { kind: 'error'; message: string };

export default function PublishEmailChangeCancelPage() {
  const [status, setStatus] = useState<Status>({ kind: 'pending' });

  useEffect(() => {
    void cancel().then(s => {
      setStatus(s);
      // Strip token from URL once we've consumed it.
      window.history.replaceState({}, '', window.location.pathname);
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
              Cancel email change
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
          {status.kind === 'pending' && <Pending />}
          {status.kind === 'ok' && <Success lockedUntil={status.lockedUntil} />}
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

async function cancel(): Promise<Status> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    // Same UX as the backend's `kind: 'invalid'` — link likely truncated.
    return { kind: 'error', message: explainKind('invalid') };
  }
  try {
    const r = await fetch(
      `${API_BASE}/api/publisher-email-change/cancel?token=${encodeURIComponent(token)}`,
    );
    const body = await r.json().catch(() => ({}));
    if (!r.ok || typeof body?.kind !== 'string') {
      return { kind: 'error', message: 'Cancel failed.' };
    }
    if (body.kind === 'ok') {
      return { kind: 'ok', lockedUntil: typeof body.lockedUntil === 'string' ? body.lockedUntil : '' };
    }
    return { kind: 'error', message: explainKind(body.kind) };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Network error' };
  }
}

function explainKind(kind: string): string {
  switch (kind) {
    case 'invalid':
      // No usable token — likely a truncated-by-email-client link. Distinct
      // from "already used" so the user doesn't think they double-clicked.
      return (
        'This link looks broken. Try clicking it directly from your email — ' +
        'some email clients truncate long links when copy-pasted. If that ' +
        'still fails, sign in at /publish/login/ to manage your account.'
      );
    case 'already_used':
      return 'This link has already been used.';
    case 'expired':
      return 'This link has expired. Email-change links are valid for 24 hours.';
    default:
      return 'Cancel failed.';
  }
}

function Pending() {
  return (
    <div className="py-8">
      <div className="mx-auto w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-gray-700 dark:text-gray-300">Cancelling email change…</p>
    </div>
  );
}

function Success({ lockedUntil }: { lockedUntil: string }) {
  const lockUntilDisplay = lockedUntil ? new Date(lockedUntil).toLocaleString() : '';
  return (
    <div>
      <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-green-600 dark:text-green-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Email change cancelled
      </h2>
      <p className="text-gray-700 dark:text-gray-300 mb-2">
        We&apos;ve cancelled the pending email change. The publisher account
        is still tied to your address.
      </p>
      {lockUntilDisplay && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          We&apos;ve locked email-change requests on this account until{' '}
          <span className="font-mono">{lockUntilDisplay}</span> as a precaution.
        </p>
      )}
      <a
        href="/publish/login/"
        className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
      >
        Go to sign-in
      </a>
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
        Couldn&apos;t cancel
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
