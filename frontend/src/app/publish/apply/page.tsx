/**
 * Publisher portal — Apply form (Phase B).
 *
 * Captures the application payload and POSTs to /api/publisher-apply/request.
 * On success the user is told to check their email; the magic-link verifies
 * and creates the actual publisher row server-side.
 *
 * Validation is done server-side; client-side we only enforce required-ness
 * and basic HTML5 patterns. The server's response carries field-specific
 * errors that we surface inline.
 *
 * The form is gated by reCAPTCHA v3 (action: `publisher_apply`). The site
 * key is loaded via VITE_RECAPTCHA_SITE_KEY at build time. When the site
 * key is unset (local dev with no .env.local) the captcha layer is skipped
 * and the request is sent without a token — the backend allows this in
 * non-production environments and fails closed in prod.
 */

import React, { useEffect, useState } from 'react';
// Window.grecaptcha is declared globally by src/types/grecaptcha.d.ts.

type SourceType = 'json' | 'html';

interface FormState {
  name: string;
  email: string;
  organization: string;
  sourceUrl: string;
  sourceType: SourceType;
  notes: string;
}

const INITIAL: FormState = {
  name: '',
  email: '',
  organization: '',
  sourceUrl: '',
  sourceType: 'json',
  notes: '',
};

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string; field?: string };

const API_BASE = import.meta.env.VITE_API_URL ?? '';
// Read directly via `import.meta.env.VITE_RECAPTCHA_SITE_KEY` (no cast or
// optional chain) so vitest.config.ts's compile-time `define` for that exact
// expression substitutes deterministically. Empty string is treated as
// "captcha disabled" by the falsy checks below.
const RECAPTCHA_SITE_KEY: string = import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? '';

// If the reCAPTCHA script doesn't report ready within this many ms (ad
// blocker, network problem, Google blip), give up waiting and let the user
// submit anyway — the backend will reject in production but the user sees
// a useful error rather than a permanently disabled button.
const RECAPTCHA_LOAD_TIMEOUT_MS = 10_000;

// Surfaced when the user submits before reCAPTCHA finishes loading. We
// clear it explicitly if the load later fails so the yellow banner isn't
// shown alongside conflicting "wait a moment" guidance.
const CAPTCHA_LOADING_ERROR = 'Verifying you’re human… try again in a moment.';

export default function PublishApplyPage() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [captchaReady, setCaptchaReady] = useState(false);
  const [captchaFailed, setCaptchaFailed] = useState(false);

  // Lazy-load the reCAPTCHA script when a site key is configured. When it
  // isn't (e.g. local dev with no .env.local), captchaReady stays false and
  // we send the request without a token — the backend's captchaService
  // allows that in non-production environments.
  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return;

    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.grecaptcha?.ready(() => {
        setCaptchaReady(true);
        // If the timeout already fired and we'd shown the failure
        // banner, clear it now that the script has actually loaded.
        setCaptchaFailed(false);
      });
    };
    script.onerror = () => {
      setCaptchaFailed(true);
    };
    document.head.appendChild(script);

    // Belt-and-suspenders: if neither onload's ready callback nor onerror
    // fires (e.g. blocker silently swallows the load), surface the failure
    // after a timeout so the form stays usable.
    const timeout = window.setTimeout(() => {
      setCaptchaFailed(prev => prev || !window.grecaptcha);
    }, RECAPTCHA_LOAD_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  // When the captcha-failed banner appears, the transient "verifying
  // you're human, try again" status becomes outdated — the banner now
  // tells the user what's actually going on. Clear that specific error
  // so the UI doesn't present conflicting guidance.
  useEffect(() => {
    if (captchaFailed) {
      setStatus(prev =>
        prev.kind === 'error' && prev.message === CAPTCHA_LOADING_ERROR
          ? { kind: 'idle' }
          : prev,
      );
    }
  }, [captchaFailed]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Block the submit briefly if a site key is configured but the script
    // hasn't finished loading yet — unless the load has clearly failed, in
    // which case the user has been told to retry/disable a blocker and
    // we let them submit with no token (backend rejects in prod).
    if (RECAPTCHA_SITE_KEY && !captchaReady && !captchaFailed) {
      setStatus({ kind: 'error', message: CAPTCHA_LOADING_ERROR });
      return;
    }

    setStatus({ kind: 'submitting' });

    let captchaToken = '';
    if (RECAPTCHA_SITE_KEY && captchaReady && window.grecaptcha) {
      try {
        captchaToken = await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, {
          action: 'publisher_apply',
        });
      } catch (err) {
        console.warn('reCAPTCHA execute failed:', err);
        // fall through — backend will reject if token is missing in prod
      }
    }

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      organization: form.organization.trim() || undefined,
      sourceUrl: form.sourceUrl.trim(),
      sourceType: form.sourceType,
      notes: form.notes.trim() || undefined,
      captchaToken: captchaToken || undefined,
    };

    try {
      const r = await fetch(`${API_BASE}/api/publisher-apply/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body?.ok === true) {
        setStatus({ kind: 'sent', email: payload.email });
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
        message: body?.error ?? 'Submission failed.',
        field: body?.field,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
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
                Apply to Publish
              </h1>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8">
          {status.kind === 'sent' ? (
            <SentNotice email={status.email} />
          ) : (
            <>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Tell us about your venue and where to find your feed. We&apos;ll
                send a verification link to your email — click it within 15
                minutes to complete your application. An admin will review and
                approve before your events appear on chqcal.org.
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                Not sure what your feed should look like? Read the{' '}
                <a
                  href="/publish/docs/"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  publisher format docs
                </a>{' '}
                first.
              </p>

              <form onSubmit={onSubmit} className="space-y-4">
                <Field
                  label="Publisher name"
                  required
                  hint="The name that will appear next to your events on chqcal.org"
                  error={status.kind === 'error' && status.field === 'name' ? status.message : undefined}
                >
                  <input
                    type="text"
                    required
                    value={form.name}
                    onInput={e => update('name', (e.target as HTMLInputElement).value)}
                    className={inputClass}
                    placeholder="e.g. Athenaeum Hotel"
                  />
                </Field>

                <Field
                  label="Contact email"
                  required
                  hint="We send your verification link here. Used only to communicate about this application."
                  error={status.kind === 'error' && status.field === 'email' ? status.message : undefined}
                >
                  <input
                    type="email"
                    required
                    value={form.email}
                    onInput={e => update('email', (e.target as HTMLInputElement).value)}
                    className={inputClass}
                    placeholder="you@example.com"
                  />
                </Field>

                <Field
                  label="Organization"
                  hint="Optional — your venue, employer, or affiliated org"
                >
                  <input
                    type="text"
                    value={form.organization}
                    onInput={e => update('organization', (e.target as HTMLInputElement).value)}
                    className={inputClass}
                    placeholder="e.g. Chautauqua Institution"
                  />
                </Field>

                <Field
                  label="Feed URL"
                  required
                  hint="Public URL where we'll fetch your events. We've already validated your feed via the test tool? Great — paste the same URL."
                  error={status.kind === 'error' && status.field === 'sourceUrl' ? status.message : undefined}
                >
                  <input
                    type="url"
                    required
                    value={form.sourceUrl}
                    onInput={e => update('sourceUrl', (e.target as HTMLInputElement).value)}
                    className={inputClass}
                    placeholder="https://example.com/events.json"
                  />
                </Field>

                <Field
                  label="Source type"
                  required
                  hint="JSON in the @chq-calendar/publisher-format shape, or HTML we'll extract"
                  error={status.kind === 'error' && status.field === 'sourceType' ? status.message : undefined}
                >
                  <select
                    value={form.sourceType}
                    onChange={e => update('sourceType', (e.target as HTMLSelectElement).value as SourceType)}
                    className={inputClass}
                  >
                    <option value="json">JSON</option>
                    <option value="html">HTML</option>
                  </select>
                </Field>

                <Field
                  label="Notes for the reviewer"
                  hint="Optional — anything else we should know"
                  error={status.kind === 'error' && status.field === 'notes' ? status.message : undefined}
                >
                  <textarea
                    rows={3}
                    value={form.notes}
                    onInput={e => update('notes', (e.target as HTMLTextAreaElement).value)}
                    className={inputClass}
                    placeholder="(optional)"
                  />
                </Field>

                {status.kind === 'error' && !status.field && (
                  <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                    <p className="text-sm text-red-800 dark:text-red-200">{status.message}</p>
                  </div>
                )}

                {captchaFailed && (
                  <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      Couldn&rsquo;t load reCAPTCHA — likely a tracker/ad
                      blocker or network issue. You can still try submitting,
                      but we may not be able to verify the request.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <a
                    href="/publish/"
                    className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
                  >
                    ← Back
                  </a>
                  <button
                    type="submit"
                    // Don't disable on `!captchaReady` alone — if the
                    // script never loads (blocker, network blip), the
                    // button would be permanently dead. Instead the
                    // captchaFailed banner above tells the user what
                    // happened and onSubmit handles the not-ready case.
                    disabled={status.kind === 'submitting'}
                    className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {status.kind === 'submitting' ? 'Sending…' : 'Send verification email'}
                  </button>
                </div>
              </form>

              {RECAPTCHA_SITE_KEY && (
                <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
                  This form is protected by reCAPTCHA and the Google{' '}
                  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-300">
                    Privacy Policy
                  </a>{' '}
                  and{' '}
                  <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-300">
                    Terms of Service
                  </a>{' '}
                  apply.
                </p>
              )}
            </>
          )}
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

function SentNotice({ email }: { email: string }) {
  return (
    <div className="text-center py-6">
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
        Check your email
      </h2>
      <p className="text-gray-700 dark:text-gray-300 mb-1">
        We sent a verification link to <span className="font-mono">{email}</span>.
      </p>
      <p className="text-gray-600 dark:text-gray-400 text-sm">
        Click the link within 15 minutes to complete your application. The link
        is single-use; if you need a new one, just submit the form again.
      </p>
      <p className="text-gray-600 dark:text-gray-400 text-sm mt-4">
        Don&apos;t see it? Check your spam folder.
      </p>
    </div>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      {children}
      {hint && !error && (
        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</span>
      )}
      {error && (
        <span className="block text-xs text-red-600 dark:text-red-400 mt-1">{error}</span>
      )}
    </label>
  );
}

const inputClass =
  'block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
