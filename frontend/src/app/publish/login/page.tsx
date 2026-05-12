/**
 * Publisher portal — Sign-in page (Phase C).
 *
 * Single email field. POSTs to /api/publisher-auth/request, which always
 * returns 200 regardless of whether the email matches a known publisher
 * (anti-enumeration; see PublisherApplicationService.requestLogin).
 *
 * Anyone already authenticated lands on /publish/status/ instead.
 */

import { useEffect, useState } from 'preact/hooks';
// Project uses jsx: "react-jsx" with @types/react aliased to preact/compat at
// runtime. Form-event prop typing flows through React's typings, so we
// import the type (only) from 'react' and let preact/compat handle the
// actual event at runtime.
import type { FormEvent } from 'react';
import { isPublisherAuthenticated } from '@/lib/publisherAuthClient';

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string };

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// Window during which the submit button stays disabled after a successful
// send, to discourage spamming the SES quota. The backend rate-limits to
// 10/hour per IP regardless; this is a UX nudge, not a security control.
const RESEND_COOLDOWN_MS = 60_000;

// Reads the URL query string ONCE on mount. We don't want re-renders to
// flip the banner state if the URL is later cleaned by replaceState — the
// banner is purely informational, tied to the navigation that landed here.
function readEmailChangedSignal(): { emailPrefill: string; showBanner: boolean } {
  if (typeof window === 'undefined') return { emailPrefill: '', showBanner: false };
  const params = new URLSearchParams(window.location.search);
  return {
    emailPrefill: params.get('email') ?? '',
    showBanner: params.get('reason') === 'email-changed',
  };
}

export default function PublishLoginPage() {
  const [signal] = useState(readEmailChangedSignal);
  const [email, setEmail] = useState(signal.emailPrefill);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Bounce out if already signed in.
  useEffect(() => {
    if (isPublisherAuthenticated()) {
      window.location.replace('/publish/status/');
    }
  }, []);

  // Tick once a second while the cooldown is active so the button label updates.
  useEffect(() => {
    if (cooldownEndsAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooldownEndsAt]);

  const cooldownRemainingSec = cooldownEndsAt
    ? Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))
    : 0;
  const inCooldown = cooldownRemainingSec > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (status.kind === 'submitting' || inCooldown) return;
    const trimmed = email.trim();
    if (trimmed.length === 0) return;

    setStatus({ kind: 'submitting' });
    try {
      const r = await fetch(`${API_BASE}/api/publisher-auth/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        setStatus({ kind: 'sent' });
        // Refresh `now` from the same clock reading we use to set the
        // cooldown end. Without this the first render uses `now` captured
        // at mount time, so the countdown briefly shows >RESEND_COOLDOWN_MS
        // (off by however long the user spent between mount and submit).
        const sendTime = Date.now();
        setNow(sendTime);
        setCooldownEndsAt(sendTime + RESEND_COOLDOWN_MS);
        return;
      }
      if (r.status === 429) {
        setStatus({
          kind: 'error',
          message: body?.error ?? 'Too many requests. Please try again later.',
        });
        return;
      }
      setStatus({
        kind: 'error',
        message: body?.error ?? 'Sign-in request failed.',
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center py-4">
            <a href="/publish/" className="flex items-center hover:opacity-80">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Publisher sign-in
              </h1>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8">
          {signal.showBanner && (
            <div className="mb-4 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3">
              <p className="text-sm text-green-800 dark:text-green-200">
                Email changed successfully. Sign in with your new address.
              </p>
            </div>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">
            Enter the email you applied with. We&apos;ll send a one-time sign-in
            link to that address — no password needed.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                Email address
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onInput={e => setEmail((e.target as HTMLInputElement).value)}
                className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="you@example.com"
              />
            </label>

            <button
              type="submit"
              disabled={status.kind === 'submitting' || inCooldown}
              className="inline-flex items-center justify-center w-full px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {status.kind === 'submitting'
                ? 'Sending…'
                : inCooldown
                ? `Resend available in ${cooldownRemainingSec}s`
                : 'Send sign-in link'}
            </button>
          </form>

          {status.kind === 'sent' && (
            <div className="mt-4 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3">
              <p className="text-sm text-green-800 dark:text-green-200">
                If that email is on file, a sign-in link is on its way. Check
                your inbox (and your spam folder) within the next minute.
              </p>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                Links expire after 15 minutes. Each link is single-use.
              </p>
              <p className="text-xs text-green-700 dark:text-green-300 mt-2">
                Didn&apos;t receive it?{' '}
                {inCooldown
                  ? `You can request another in ${cooldownRemainingSec}s.`
                  : 'Click "Send sign-in link" above to send another.'}
              </p>
            </div>
          )}

          {status.kind === 'error' && (
            <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <p className="text-sm text-red-800 dark:text-red-200">{status.message}</p>
            </div>
          )}

          <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 text-center">
            Don&apos;t have an application yet?{' '}
            <a
              href="/publish/apply/"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Apply to publish
            </a>
          </p>
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
