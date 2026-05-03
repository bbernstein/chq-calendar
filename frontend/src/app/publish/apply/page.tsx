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
 */

import React, { useState } from 'react';

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

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '';

export default function PublishApplyPage() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'submitting' });

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      organization: form.organization.trim() || undefined,
      sourceUrl: form.sourceUrl.trim(),
      sourceType: form.sourceType,
      notes: form.notes.trim() || undefined,
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

                <div className="flex items-center justify-between pt-2">
                  <a
                    href="/publish/"
                    className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
                  >
                    ← Back
                  </a>
                  <button
                    type="submit"
                    disabled={status.kind === 'submitting'}
                    className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {status.kind === 'submitting' ? 'Sending…' : 'Send verification email'}
                  </button>
                </div>
              </form>
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
