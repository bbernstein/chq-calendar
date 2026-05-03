/**
 * Magic-link verify landing page.
 *
 * Reads ?token & ?purpose from the URL, posts to the matching verify
 * endpoint, persists the publisher JWT in localStorage, and shows a brief
 * status. Phase B: redirects to /publish/ — there's no status page yet.
 * Phase C will add /publish/status/ as the post-login destination.
 */

import { useEffect, useState } from 'react';
import { setPublisherSession } from '@/lib/publisherAuthClient';

type Status =
  | { kind: 'pending' }
  | { kind: 'ok'; email: string; isApply: boolean }
  | { kind: 'error'; message: string };

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '';

export default function PublishVerifyPage() {
  const [status, setStatus] = useState<Status>({ kind: 'pending' });

  useEffect(() => {
    void verify().then(setStatus);
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
              Publisher Portal
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
          {status.kind === 'pending' && <Pending />}
          {status.kind === 'ok' && <Success email={status.email} isApply={status.isApply} />}
          {status.kind === 'error' && <Failed message={status.message} />}
        </div>
      </main>
    </div>
  );
}

async function verify(): Promise<Status> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const purpose = params.get('purpose');

  if (!token) {
    return { kind: 'error', message: 'No token in URL.' };
  }
  if (purpose !== 'apply' && purpose !== 'login') {
    return { kind: 'error', message: 'Unknown link purpose.' };
  }

  const url = purpose === 'apply'
    ? `${API_BASE}/api/publisher-apply/verify`
    : `${API_BASE}/api/publisher-auth/verify`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { kind: 'error', message: body?.error ?? 'Verification failed.' };
    }
    if (typeof body?.jwt !== 'string' || typeof body?.publisherId !== 'string' || typeof body?.email !== 'string') {
      return { kind: 'error', message: 'Verification succeeded but the response was malformed.' };
    }
    setPublisherSession({ jwt: body.jwt, publisherId: body.publisherId, email: body.email });
    // Strip the token from the address bar so it can't leak via screenshot or history.
    const cleanUrl = `${window.location.pathname}`;
    window.history.replaceState({}, '', cleanUrl);
    return { kind: 'ok', email: body.email, isApply: purpose === 'apply' };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}

function Pending() {
  return (
    <div className="py-8">
      <div className="mx-auto w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-gray-700 dark:text-gray-300">Verifying your link…</p>
    </div>
  );
}

function Success({ email, isApply }: { email: string; isApply: boolean }) {
  // Apply path: send the user back to /publish/ — the form told them to wait
  // for review, and the home page is the natural landing.
  // Login path: take them to /publish/status/ where they can see their own
  // record and any post-approval state.
  const ctaHref = isApply ? '/publish/' : '/publish/status/';
  const ctaLabel = isApply ? 'Go to publisher home' : 'Go to your account';
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
        {isApply ? 'Application received' : 'Signed in'}
      </h2>
      <p className="text-gray-700 dark:text-gray-300">
        {isApply
          ? 'Your application is in the review queue. An admin will look at your feed and either approve it or reach out with questions.'
          : 'You can now access your publisher account.'}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 mb-6">
        Signed in as <span className="font-mono">{email}</span>
      </p>
      <a
        href={ctaHref}
        className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
      >
        {ctaLabel}
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
        Couldn&apos;t verify
      </h2>
      <p className="text-gray-700 dark:text-gray-300 mb-6">{message}</p>
      <div className="flex gap-3 justify-center">
        <a
          href="/publish/apply/"
          className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
        >
          Apply again
        </a>
        <a
          href="/publish/"
          className="inline-flex items-center px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Back to publish home
        </a>
      </div>
    </div>
  );
}
