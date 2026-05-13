/**
 * Publisher portal — Status page (Phase C).
 *
 * Authenticated view of the caller's own publisher record. Three paths:
 *   - 'pending'  → review-in-progress notice
 *   - 'approved' → publisher details + last-fetch summary
 *   - 'rejected' → rejection notice + reason + apply-again CTA
 *
 * Authentication is the publisher JWT in localStorage (separate from admin).
 * On 401 the API client clears the session and redirects to /publish/login/,
 * so this component doesn't need to handle that case explicitly.
 */

import { useEffect, useState } from 'preact/hooks';
// `react-jsx` runtime + the project's @types/react alias mean the children
// slot expects React.ReactNode. Importing the type only keeps the runtime
// alignment with preact (the `preact/compat` alias handles the actual JSX).
import type { FormEvent, ReactNode } from 'react';
import {
  clearPublisherSession,
  getPublisherSession,
  isPublisherAuthenticated,
} from '@/lib/publisherAuthClient';
import {
  getPublisherStatus,
  patchPublisherProfile,
  previewPublisherFeed,
  type PublisherStatusRecord,
} from '@/lib/publisherStatusApi';
import { isApprovedPublisher } from '@/lib/publisherApproval';
import { EditableField } from './EditableField';
import { SourceEditPanel } from './SourceEditPanel';
import { EmailChangePanel } from './EmailChangePanel';
import { IngestControls } from './IngestControls';
import { DangerZone } from './DangerZone';
import { IngestHistoryPanel } from './IngestHistoryPanel';
import { PublisherEventsPanel } from './PublisherEventsPanel';

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; rec: PublisherStatusRecord }
  | { kind: 'error'; message: string };

export default function PublishStatusPage() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    if (!isPublisherAuthenticated()) {
      window.location.replace('/publish/login/');
      return;
    }
    void getPublisherStatus()
      .then(rec => setStatus({ kind: 'ok', rec }))
      .catch(err => {
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load status.',
        });
      });
  }, []);

  function handleSignOut() {
    clearPublisherSession();
    window.location.replace('/publish/');
  }

  // Replace the local record with whatever the backend returned after a
  // successful profile patch. Encoded as a callback so the children don't
  // need to know about the Status discriminator shape.
  function handleRecordUpdated(rec: PublisherStatusRecord) {
    setStatus({ kind: 'ok', rec });
  }

  const session = getPublisherSession();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <a href="/publish/" className="flex items-center hover:opacity-80">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Publisher status
              </h1>
            </a>
            {session && (
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline text-sm text-gray-600 dark:text-gray-300">
                  {session.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="px-3 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {status.kind === 'loading' && <Loading />}
        {status.kind === 'error' && <ErrorBlock message={status.message} />}
        {status.kind === 'ok' && (
          <StatusView rec={status.rec} onUpdated={handleRecordUpdated} />
        )}
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie
          </p>
        </div>
      </footer>
    </div>
  );
}

// ── Sub-views ─────────────────────────────────────────────────────────────

function Loading() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
      <div className="mx-auto w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-gray-600 dark:text-gray-300">Loading your status…</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">
        Could not load your status
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{message}</p>
      <a
        href="/publish/login/"
        className="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
      >
        Back to sign-in
      </a>
    </div>
  );
}

function StatusView({
  rec,
  onUpdated,
}: {
  rec: PublisherStatusRecord;
  onUpdated: (rec: PublisherStatusRecord) => void;
}) {
  // Treat a missing applicationStatus as approved — legacy admin-created
  // rows pre-date the application flow. Shared rule via isApprovedPublisher
  // so the backend handler and frontend view stay in lockstep.
  const applicationStatus = rec.applicationStatus ?? 'approved';
  const editable = isApprovedPublisher(rec);

  // The source-edit panel is rendered inline below the card when toggled,
  // not in a modal — keeps the read-only context (current URL, last-fetch
  // status) visible while the publisher is choosing a replacement.
  const [sourceEditOpen, setSourceEditOpen] = useState(false);

  async function handleNamePatch(newName: string) {
    const updated = await patchPublisherProfile({ name: newName });
    onUpdated(updated);
  }
  async function handleOrgPatch(newOrg: string) {
    const updated = await patchPublisherProfile({ organization: newOrg });
    onUpdated(updated);
  }
  async function handleSourceSave(url: string, sourceType: 'json' | 'html') {
    const updated = await patchPublisherProfile({ sourceUrl: url, sourceType });
    onUpdated(updated);
    setSourceEditOpen(false);
  }

  // Refetch the status after any self-service mutation that changes the row
  // (email-change submit/cancel, pause/resume, fetch-now, etc.) so the panels
  // reflect freshly-mutated state. Originally introduced for email-change;
  // generalized when pause/resume/disable started reusing the same pattern.
  //
  // Errors are swallowed (the banner stays put rather than showing a
  // refresh-failure UI) but logged to console so that failures aren't
  // invisible during development. A 401 inside getPublisherStatus already
  // triggers its own auth-redirect, so the most-impactful failure mode is
  // already handled at the API-client layer; what we're swallowing here is
  // genuinely transient (e.g. network blip mid-render).
  async function handleStatusRefresh() {
    try {
      const fresh = await getPublisherStatus();
      onUpdated(fresh);
    } catch (err) {
      console.error('[publish/status] post-mutation refresh failed; UI may show stale data until next mount', err);
    }
  }

  return (
    <div className="space-y-6">
      <StatusBadge status={applicationStatus} />

      {applicationStatus === 'pending' && <PendingNotice />}
      {applicationStatus === 'rejected' && (
        <RejectedNotice reason={rec.rejectionReason} />
      )}

      <PublisherCard
        rec={rec}
        editable={editable}
        sourceEditOpen={sourceEditOpen}
        onEditSource={() => setSourceEditOpen(true)}
        onNamePatch={handleNamePatch}
        onOrgPatch={handleOrgPatch}
      />

      {editable && sourceEditOpen && (
        <SourceEditPanel
          currentUrl={rec.sourceUrl}
          currentType={rec.sourceType}
          onPreview={previewPublisherFeed}
          onSave={handleSourceSave}
          onCancel={() => setSourceEditOpen(false)}
        />
      )}

      {editable && (
        <EmailChangePanel
          contactEmail={rec.contactEmail}
          pendingEmailChange={rec.pendingEmailChange ?? null}
          onChanged={handleStatusRefresh}
        />
      )}

      {applicationStatus === 'approved' && <LastFetchPanel rec={rec} />}

      {applicationStatus === 'approved' && (
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Ingest history</h2>
          <IngestHistoryPanel />
        </section>
      )}

      {applicationStatus === 'approved' && (
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Your events</h2>
          <PublisherEventsPanel />
        </section>
      )}

      {applicationStatus === 'approved' && (
        <NotificationsPanel rec={rec} onUpdated={onUpdated} />
      )}

      {applicationStatus === 'approved' && (
        <IngestControls publisher={rec} onChanged={handleStatusRefresh} />
      )}

      {applicationStatus === 'approved' && <DangerZone publisher={rec} />}
    </div>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const map = {
    pending: {
      label: 'Pending review',
      cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300',
    },
    approved: {
      label: 'Approved',
      cls: 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300',
    },
    rejected: {
      label: 'Not approved',
      cls: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300',
    },
  } as const;
  const { label, cls } = map[status];
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 flex items-center gap-3">
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${cls}`}>
        {label}
      </span>
      <span className="text-sm text-gray-600 dark:text-gray-300">
        Application status
      </span>
    </div>
  );
}

function PendingNotice() {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        Your application is in the review queue. We&apos;ll email you when the
        review is complete (usually within a few days). No action needed
        right now — feel free to keep iterating on your feed using the{' '}
        <a href="/publish/test/" className="underline">test tool</a>.
      </p>
    </div>
  );
}

function RejectedNotice({ reason }: { reason?: string }) {
  return (
    <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
      <p className="text-sm text-red-900 dark:text-red-200 mb-3">
        Your application wasn&apos;t approved at this time.
      </p>
      {reason && (
        <blockquote className="border-l-4 border-red-300 dark:border-red-700 pl-3 text-sm italic text-gray-700 dark:text-gray-300 mb-3">
          {reason}
        </blockquote>
      )}
      <a
        href="/publish/apply/"
        className="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
      >
        Apply again
      </a>
    </div>
  );
}

function PublisherCard({
  rec,
  editable,
  sourceEditOpen,
  onEditSource,
  onNamePatch,
  onOrgPatch,
}: {
  rec: PublisherStatusRecord;
  editable: boolean;
  sourceEditOpen: boolean;
  onEditSource: () => void;
  onNamePatch: (next: string) => Promise<void>;
  onOrgPatch: (next: string) => Promise<void>;
}) {
  // When the publisher row is editable, the Name and Organization rows swap
  // to inline EditableField widgets. Source is edited via the standalone
  // SourceEditPanel (rendered by the parent) — here we just expose a button
  // that toggles it. Pending/rejected applicants see the read-only display
  // for every field.
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        Publisher details
      </h2>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm">
        <Detail
          label="Name"
          value={
            editable
              ? <EditableField label="Name" value={rec.name} onSave={onNamePatch} />
              : rec.name
          }
        />
        <Detail label="Publisher ID" value={<span className="font-mono text-xs">{rec.id}</span>} />
        <Detail label="Contact email" value={rec.contactEmail} />
        <Detail
          label="Organization"
          value={
            editable
              ? <EditableField
                  label="Organization"
                  value={rec.organization ?? ''}
                  allowEmpty
                  onSave={onOrgPatch}
                />
              : (rec.organization || <span className="text-gray-400 italic">—</span>)
          }
        />
        <Detail
          label="Source"
          value={
            <div className="flex items-start gap-2">
              <a
                href={rec.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-600 dark:text-blue-400 hover:underline break-all"
              >
                {rec.sourceUrl}
              </a>
              {editable && !sourceEditOpen && (
                <button
                  type="button"
                  onClick={onEditSource}
                  aria-label="Edit source"
                  className="shrink-0 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                >
                  ✎
                </button>
              )}
            </div>
          }
          span={2}
        />
        <Detail label="Source type" value={rec.sourceType.toUpperCase()} />
        <Detail
          label="Ingest"
          value={!rec.enabled ? 'Disabled' : rec.paused ? 'Paused' : 'Active'}
        />
        <Detail
          label="Created"
          value={rec.createdAt ? new Date(rec.createdAt).toLocaleString() : '—'}
        />
      </dl>
    </div>
  );
}

function LastFetchPanel({ rec }: { rec: PublisherStatusRecord }) {
  if (!rec.lastFetchedAt) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Last fetch
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Your feed hasn&apos;t been fetched yet. The first scheduled run will
          ingest your events; check back later.
        </p>
      </div>
    );
  }
  const cls = statusColor(rec.lastFetchStatus);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        Last fetch
      </h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm">
        <Detail
          label="Status"
          value={
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${cls}`}>
              {rec.lastFetchStatus ?? '—'}
            </span>
          }
        />
        <Detail
          label="Fetched at"
          value={new Date(rec.lastFetchedAt).toLocaleString()}
        />
        {rec.lastFetchMessage && (
          <Detail label="Message" value={<span className="break-words">{rec.lastFetchMessage}</span>} span={2} />
        )}
      </dl>
    </div>
  );
}

function NotificationsPanel({
  rec,
  onUpdated,
}: {
  rec: PublisherStatusRecord;
  onUpdated: (rec: PublisherStatusRecord) => void;
}) {
  // Default-treated-as-true so legacy rows opt in.
  const enabled = rec.notificationsEnabled !== false;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(e: FormEvent<HTMLInputElement>) {
    const next = (e.currentTarget as HTMLInputElement).checked;
    setBusy(true);
    setError(null);
    try {
      const updated = await patchPublisherProfile({ notificationsEnabled: next });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        Email notifications
      </h2>
      <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onInput={handleToggle}
          className="mt-1"
        />
        <span>
          Email me when my feed breaks or an event is rejected.
        </span>
      </label>
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>
      )}
    </section>
  );
}

function statusColor(s: PublisherStatusRecord['lastFetchStatus']): string {
  switch (s) {
    case 'ok':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
    case 'parse_error':
    case 'validation_error':
    case 'network_error':
    case 'threshold_halt':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
  }
}

function Detail({
  label,
  value,
  span,
}: {
  label: string;
  value: ReactNode;
  span?: 2;
}) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="mt-0.5 text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}
