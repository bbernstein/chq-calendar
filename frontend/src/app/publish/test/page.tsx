/**
 * Public publisher feed test/preview tool.
 *
 * User pastes a URL, picks JSON or HTML, optionally provides a publisher id,
 * hits "Test feed", and the backend (`POST /api/publisher-test`) fetches +
 * validates the URL against the publisher-format spec. We render:
 *
 *   - Status badge (ok / parse_error / validation_error / network_error /
 *     bad_request / rate_limited / server_error).
 *   - Errors list (red) and warnings list (amber).
 *   - Parsed event count + preview cards.
 *   - "Show raw feed JSON" toggle for the full FeedDocument.
 *
 * Preview card decision:
 *   The main calendar's `EventCard`
 *   (frontend/src/components/calendar/EventCard.tsx) takes a calendar-format
 *   `Event` (from @/lib/types), not the publisher-format `FeedEvent` shape
 *   the API returns. It also depends on favorites / tag-selection / ICS
 *   download props plumbed through the global event-data context. Wiring a
 *   FeedEvent → Event adapter just to render a preview here would require
 *   reproducing the venue/category enrichment logic that lives server-side
 *   in the ingest pipeline. For Phase A we render a portal-local card that
 *   mimics the visual style (time, location/venue, title, category pill,
 *   description, tag pills) without dragging in calendar context. If we
 *   want pixel-identical preview later, the right move is to extract a
 *   pure presentational `EventCardView` from EventCard and feed it both
 *   shapes via an adapter.
 */

import type { FormEvent } from 'react';
import { useState } from 'preact/hooks';
import {
  testPublisherFeed,
  type FeedDocument,
  type FeedEvent,
  type PublisherTestResult,
  type SourceType,
  type ValidationIssue,
} from '@/lib/publisherTestApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime())) return start;
  const dateStr = s.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const startTime = s.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  if (isNaN(e.getTime())) return `${dateStr} · ${startTime}`;
  const endTime = e.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr} · ${startTime} – ${endTime}`;
}

// Status -> visual treatment for the result-summary badge.
type StatusKind =
  | 'ok'
  | 'parse_error'
  | 'validation_error'
  | 'network_error'
  | 'bad_request'
  | 'rate_limited'
  | 'server_error';

function statusBadgeClass(status: StatusKind): string {
  switch (status) {
    case 'ok':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-800';
    case 'parse_error':
    case 'validation_error':
    case 'network_error':
    case 'bad_request':
    case 'server_error':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-800';
    case 'rate_limited':
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800';
  }
}

function statusLabel(status: StatusKind): string {
  switch (status) {
    case 'ok':
      return 'Feed OK';
    case 'parse_error':
      return 'Parse error';
    case 'validation_error':
      return 'Validation error';
    case 'network_error':
      return 'Network error';
    case 'bad_request':
      return 'Bad request';
    case 'rate_limited':
      return 'Rate limited';
    case 'server_error':
      return 'Server error';
  }
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: ValidationIssue[];
  tone: 'error' | 'warning';
}) {
  if (issues.length === 0) return null;
  const toneClasses =
    tone === 'error'
      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
      : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300';

  return (
    <div className={`border rounded-md p-4 ${toneClasses}`}>
      <h3 className="font-semibold text-sm mb-2">
        {title} ({issues.length})
      </h3>
      <ul className="space-y-1 text-sm font-mono">
        {issues.map((issue, i) => (
          <li key={i} className="break-words">
            <span className="opacity-75">{issue.path || '(root)'}:</span>{' '}
            {issue.message}
            {issue.code ? (
              <span className="opacity-60"> [{issue.code}]</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Portal-local preview card. See top-of-file comment for why we don't reuse
// `frontend/src/components/calendar/EventCard.tsx`.
function PreviewEventCard({ event }: { event: FeedEvent }) {
  const venueLabel =
    event.venue?.name ?? event.venueId ?? undefined;
  const isCancelled = event.status === 'cancelled';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md p-4 bg-white dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          🕐 {formatDateRange(event.startDate, event.endDate)}
          {venueLabel && <span className="ml-2">📍 {venueLabel}</span>}
        </div>
        {event.status && event.status !== 'scheduled' && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              isCancelled
                ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
            }`}
          >
            {event.status}
          </span>
        )}
      </div>
      <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
        {event.title}
      </h4>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
          {event.category}
        </span>
        {event.presenter && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            by {event.presenter}
          </span>
        )}
        {event.cost && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            · {event.cost}
          </span>
        )}
      </div>
      {event.description && (
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line mb-2">
          {event.description}
        </p>
      )}
      {event.tags && event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {event.tags.map(tag => (
            <span
              key={tag}
              className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
        >
          {event.url}
        </a>
      )}
      <div className="mt-2 text-[10px] font-mono text-gray-400 dark:text-gray-500">
        id: {event.id}
      </div>
    </div>
  );
}

function ResultPanel({
  result,
  showRaw,
  onToggleRaw,
}: {
  result: PublisherTestResult;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  // Collapse the discriminated union into a single render path with a status
  // kind, errors, warnings, and (optional) feed.
  let status: StatusKind;
  let errors: ValidationIssue[] = [];
  let warnings: ValidationIssue[] = [];
  let feed: FeedDocument | null = null;
  let topMessage: string | null = null;

  switch (result.kind) {
    case 'ok':
      // Backend returned 200 — but fetchStatus inside the body still tells us
      // whether the fetch/parse/validate succeeded.
      status = result.body.fetchStatus;
      errors = result.body.report.errors;
      warnings = result.body.report.warnings;
      feed = result.body.feed;
      break;
    case 'bad_request':
      status = 'bad_request';
      topMessage = result.message;
      break;
    case 'rate_limited':
      status = 'rate_limited';
      topMessage = result.message;
      break;
    case 'network_error':
      status = 'network_error';
      topMessage = result.message;
      break;
    case 'server_error':
      status = 'server_error';
      topMessage = `${result.message} (HTTP ${result.status})`;
      break;
  }

  const events = feed?.events ?? [];

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div
        className={`border rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${statusBadgeClass(status)}`}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold">{statusLabel(status)}</span>
          {feed && (
            <span className="text-sm">
              {events.length} event{events.length === 1 ? '' : 's'} parsed
            </span>
          )}
        </div>
        {feed && (
          <span className="text-xs font-mono opacity-75">
            publisher: {feed.publisher.id} · v{feed.formatVersion}
          </span>
        )}
      </div>

      {topMessage && (
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-md p-4 text-sm text-red-800 dark:text-red-300">
          {topMessage}
        </div>
      )}

      <IssueList title="Errors" issues={errors} tone="error" />
      <IssueList title="Warnings" issues={warnings} tone="warning" />

      {/* Event preview list */}
      {events.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Preview ({events.length})
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Approximate rendering — the live calendar may format some fields
            differently after server-side enrichment.
          </p>
          <div className="grid gap-3">
            {events.map((event, i) => (
              <PreviewEventCard key={`${event.id}-${i}`} event={event} />
            ))}
          </div>
        </div>
      )}

      {/* Raw JSON toggle */}
      {feed && (
        <div>
          <button
            type="button"
            onClick={onToggleRaw}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showRaw ? 'Hide' : 'Show'} raw feed JSON
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-96 overflow-auto text-xs bg-gray-900 text-gray-100 dark:bg-black p-4 rounded-md font-mono">
              {JSON.stringify(feed, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PublishTestPage() {
  const [url, setUrl] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('json');
  const [publisherId, setPublisherId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublisherTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // NOTE: we hit the real endpoint via the Vite dev proxy. If the backend
  // isn't running locally, the user will see a `network_error` result —
  // that's acceptable for Phase A. Sample feed for visual development:
  //   {
  //     "formatVersion": "1.0.0",
  //     "publisher": { "id": "demo", "name": "Demo", "contactEmail": "x@y.z" },
  //     "events": [{ "id": "e1", "title": "Test", "startDate": "...", ... }]
  //   }
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setFormError('Please enter a URL.');
      return;
    }
    try {
      // Cheap client-side sanity check — the server enforces real validation.
      const u = new URL(trimmedUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        setFormError('URL must start with http:// or https://');
        return;
      }
    } catch {
      setFormError('That doesn’t look like a valid URL.');
      return;
    }

    setSubmitting(true);
    setResult(null);
    setShowRaw(false);
    try {
      const r = await testPublisherFeed({
        url: trimmedUrl,
        sourceType,
        publisherId: publisherId.trim() || undefined,
      });
      setResult(r);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Test your publisher feed
              </h1>
            </div>
            <a
              href="/publish/"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              ← Publisher portal
            </a>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Form card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Paste the URL of your feed (a JSON document or an HTML page we can
            parse). We&apos;ll fetch it, validate it against the publisher
            format, and show you any errors and a preview of every event.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="url"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Feed URL
              </label>
              <input
                id="url"
                type="url"
                value={url}
                onInput={e => setUrl((e.target as HTMLInputElement).value)}
                placeholder="https://example.com/events.json"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Source type
              </span>
              <div className="flex gap-4">
                <label className="inline-flex items-center text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="sourceType"
                    value="json"
                    checked={sourceType === 'json'}
                    onChange={() => setSourceType('json')}
                    className="mr-2"
                  />
                  JSON
                </label>
                <label className="inline-flex items-center text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="sourceType"
                    value="html"
                    checked={sourceType === 'html'}
                    onChange={() => setSourceType('html')}
                    className="mr-2"
                  />
                  HTML
                </label>
              </div>
            </div>

            <div>
              <label
                htmlFor="publisherId"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Publisher ID{' '}
                <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                  (optional)
                </span>
              </label>
              <input
                id="publisherId"
                type="text"
                value={publisherId}
                onInput={e =>
                  setPublisherId((e.target as HTMLInputElement).value)
                }
                placeholder="e.g. my-venue"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                If you&apos;re already a registered publisher, enter your ID
                so we can flag id mismatches in your feed.
              </p>
            </div>

            {formError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                <p className="text-red-600 dark:text-red-400 text-sm">
                  {formError}
                </p>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Testing…' : 'Test feed'}
              </button>
            </div>
          </form>
        </div>

        {/* Result card */}
        {(submitting || result) && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8">
            {submitting && !result && (
              <div className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                <span>Fetching and validating feed…</span>
              </div>
            )}
            {result && (
              <ResultPanel
                result={result}
                showRaw={showRaw}
                onToggleRaw={() => setShowRaw(s => !s)}
              />
            )}
          </div>
        )}
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie
            and Claude
          </p>
        </div>
      </footer>
    </div>
  );
}
