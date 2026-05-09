import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import {
  listPublishers,
  createPublisher,
  updatePublisher,
  deletePublisher,
  listPendingApplications,
  runPublisherIngest,
  type PublisherRecord,
  type CreatePublisherInput,
} from '@/lib/adminPublisherApi';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { logout } from '@/lib/auth';
import { Modal } from '@/components/Modal';
import { PublisherForm } from './PublisherForm';
import { PendingApplications } from './PendingApplications';

// Discriminated union for form open/closed state.
type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; publisher: PublisherRecord };

const CLOSED: FormMode = { kind: 'closed' };

// State machine for the "Run ingest now" button. Module-scope so it can be
// referenced from the component without re-allocating on every render.
type IngestState =
  | { kind: 'idle' }
  | { kind: 'running'; triggeredAt: string; pollCount: number }
  | { kind: 'success'; triggeredAt: string; finishedAt: string }
  | { kind: 'timeout'; triggeredAt: string }
  | { kind: 'error'; message: string };

// Polling cadence + ceiling for the "Run ingest now" button. Module-scope so
// the values aren't reallocated on every render. 3s × 40 attempts ≈ 2 min.
const INGEST_POLL_INTERVAL_MS = 3000;
const INGEST_POLL_MAX_ATTEMPTS = 40;

// Sentinel used as the optimistic triggeredAt when handleRunIngest sets the
// "running" state before the network call resolves. Replaced by the server's
// canonical value once the POST returns. Picking the epoch keeps the
// "is-newer-than-trigger" comparison defensively correct in the unlikely
// event polling fires before the replacement state lands.
const PROVISIONAL_TRIGGER_TIMESTAMP = '1970-01-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Inline icon components (Heroicons-style 24x24 outline). Inlined rather
// than pulled from a library to avoid a new dep for ~5 glyphs. Each accepts
// a `className` so the parent can size and color them.
// ---------------------------------------------------------------------------
type IconProps = { className?: string };

const PencilIcon = ({ className = 'w-5 h-5' }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
  </svg>
);

const CheckCircleIcon = ({ className = 'w-5 h-5' }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const NoSymbolIcon = ({ className = 'w-5 h-5' }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
  </svg>
);

const PauseIcon = ({ className = 'w-5 h-5' }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
  </svg>
);

const PlayIcon = ({ className = 'w-5 h-5' }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
  </svg>
);

const TrashIcon = ({ className = 'w-5 h-5' }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

export default function PublishersPage() {
  const user = useAdminAuth();
  const [publishers, setPublishers] = useState<PublisherRecord[]>([]);
  const [pending, setPending] = useState<PublisherRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(CLOSED);
  // Track IDs currently being toggled (enable/disable in-flight).
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  // Pause/play and delete share the same in-flight tracker.
  const [pausingIds, setPausingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  // Delete confirmation modal — null when closed. The shared <Modal>
  // component handles focus trap, Esc, and focus restore; the in-flight
  // guard against accidental dismissal is wired via closeOnEsc /
  // closeOnBackdropClick props at render time.
  const [deleteTarget, setDeleteTarget] = useState<PublisherRecord | null>(null);

  // Manual "Run ingest now" state. The admin endpoint async-invokes the
  // ingest Lambda and returns 202 immediately, so the UI then polls
  // listPublishers until every enabled publisher has a lastFetchedAt
  // newer than `triggeredAt` (or until the timeout below elapses).
  // The IngestState union is defined at module scope above.
  const [ingestState, setIngestState] = useState<IngestState>({ kind: 'idle' });
  // Hold the active polling timer id so we can clear it from any branch.
  // We use setTimeout (not setInterval) so each tick only fires after the
  // previous tick's async work resolves — avoids overlapping listPublishers
  // calls when the network is slow.
  const ingestPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation counter — bumped each time a new run starts; lets a still-
  // pending tick from a prior run notice it's stale and exit without
  // touching state.
  const ingestPollGenRef = useRef(0);

  // -------------------------------------------------------------------------
  // Data fetch
  // -------------------------------------------------------------------------
  const fetchPublishers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch both lists in parallel; either failing surfaces an error but
      // we keep whichever resolved successfully so partial UI still renders.
      const [allRes, pendingRes] = await Promise.allSettled([
        listPublishers(),
        listPendingApplications(),
      ]);
      if (allRes.status === 'fulfilled') {
        setPublishers(allRes.value);
      }
      if (pendingRes.status === 'fulfilled') {
        setPending(pendingRes.value);
      }
      const firstError = [allRes, pendingRes].find(r => r.status === 'rejected');
      if (firstError && firstError.status === 'rejected') {
        const reason = firstError.reason;
        setError(reason instanceof Error ? reason.message : 'Failed to load publishers.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchPublishers();
    }
  }, [user, fetchPublishers]);

  // -------------------------------------------------------------------------
  // Form submit handler
  // -------------------------------------------------------------------------
  const handleFormSubmit = useCallback(
    async (input: CreatePublisherInput | Partial<PublisherRecord>) => {
      if (formMode.kind === 'create') {
        await createPublisher(input as CreatePublisherInput);
      } else if (formMode.kind === 'edit') {
        await updatePublisher(formMode.publisher.id, input as Partial<PublisherRecord>);
      }
      setFormMode(CLOSED);
      await fetchPublishers();
    },
    [formMode, fetchPublishers],
  );

  // -------------------------------------------------------------------------
  // Enable / disable toggle
  // -------------------------------------------------------------------------
  const handleToggleEnabled = useCallback(
    async (p: PublisherRecord) => {
      setTogglingIds(prev => new Set(prev).add(p.id));
      try {
        // When disabling, also clear paused — pause is meaningless on a
        // disabled row, and leaving it set would silently re-pause the
        // publisher when a future admin re-enables them. Re-enabling
        // (`!p.enabled === true`) doesn't touch paused: the only way to
        // reach `enabled=true && paused=true` is to pause an enabled row.
        const patch: Partial<PublisherRecord> = p.enabled
          ? { enabled: false, paused: false }
          : { enabled: true };
        await updatePublisher(p.id, patch);
        await fetchPublishers();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update publisher.');
      } finally {
        setTogglingIds(prev => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
      }
    },
    [fetchPublishers],
  );

  // -------------------------------------------------------------------------
  // Pause / play toggle
  // -------------------------------------------------------------------------
  const handleTogglePaused = useCallback(
    async (p: PublisherRecord) => {
      setPausingIds(prev => new Set(prev).add(p.id));
      try {
        await updatePublisher(p.id, { paused: !p.paused });
        await fetchPublishers();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update publisher.');
      } finally {
        setPausingIds(prev => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
      }
    },
    [fetchPublishers],
  );

  // -------------------------------------------------------------------------
  // Delete (with confirmation modal)
  // -------------------------------------------------------------------------
  const handleConfirmDelete = useCallback(async () => {
    const p = deleteTarget;
    if (!p) return;
    setDeletingIds(prev => new Set(prev).add(p.id));
    try {
      await deletePublisher(p.id);
      setDeleteTarget(null);
      await fetchPublishers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete publisher.');
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  }, [deleteTarget, fetchPublishers]);

  // -------------------------------------------------------------------------
  // Run ingest now
  // -------------------------------------------------------------------------
  const stopIngestPoll = useCallback(() => {
    // Bump the generation so any tick currently mid-await notices it's stale
    // and bails out without writing state. Then cancel any scheduled tick.
    ingestPollGenRef.current += 1;
    if (ingestPollRef.current !== null) {
      clearTimeout(ingestPollRef.current);
      ingestPollRef.current = null;
    }
  }, []);

  // Cleanup on unmount.
  useEffect(() => stopIngestPoll, [stopIngestPoll]);

  const handleRunIngest = useCallback(async () => {
    // Set running state immediately so the button disables before the network
    // call begins — this prevents a fast double-click from firing two
    // POST /publishers/run-ingest requests. We use a provisional triggeredAt
    // and replace it with the server's canonical value once the POST returns.
    setIngestState({
      kind: 'running',
      triggeredAt: PROVISIONAL_TRIGGER_TIMESTAMP,
      pollCount: 0,
    });
    try {
      const { triggeredAt } = await runPublisherIngest();
      const triggeredAtMs = Date.parse(triggeredAt);
      // Snapshot the set of publisher ids that were eligible at trigger
      // time. The ingest Lambda took its own snapshot at the same moment,
      // so polling must check exactly this set — otherwise a row created
      // (or re-enabled, or unpaused) during the run would never be in the
      // ingest's working set, never get a fresh lastFetchedAt, and force
      // the poll to time out. Captured from the latest known list rather
      // than re-fetching to keep the timeline anchored to "what we just
      // told the backend to process".
      const triggerSnapshot = new Set(
        publishers
          .filter(p => p.enabled && !p.paused && p.applicationStatus !== 'pending')
          .map(p => p.id),
      );
      setIngestState({ kind: 'running', triggeredAt, pollCount: 0 });

      // Two-stage generation bump: stopIngestPoll() bumps once to invalidate
      // any prior-run tick that's currently mid-await; the ++ below bumps
      // again to claim a unique generation for this run. Looks like a
      // double-increment but each bump serves a different purpose.
      stopIngestPoll();
      const myGen = ++ingestPollGenRef.current;
      let attempts = 0;

      const scheduleNextTick = () => {
        ingestPollRef.current = setTimeout(runTick, INGEST_POLL_INTERVAL_MS);
      };

      const runTick = async () => {
        attempts += 1;
        try {
          const fresh = await listPublishers();
          // Stale tick guard: if stopIngestPoll fired, or another run started,
          // myGen no longer matches — abandon this tick without touching state.
          if (myGen !== ingestPollGenRef.current) return;
          setPublishers(fresh);

          // The publisher-ingest run is "done" when every publisher the
          // backend snapshotted at trigger time has a lastFetchedAt newer
          // than the trigger. We restrict the completion check to
          // triggerSnapshot (captured before the run started) so rows
          // created / re-enabled / unpaused during the run aren't counted
          // — the ingest Lambda never saw them. Rows that vanished mid-run
          // (deleted, disabled, paused) drop out naturally because they
          // either no longer appear in `fresh` or no longer match the
          // triggerSnapshot membership check.
          const eligible = fresh.filter(
            p =>
              triggerSnapshot.has(p.id) &&
              p.enabled &&
              !p.paused &&
              p.applicationStatus !== 'pending',
          );
          // Empty eligible list (snapshot was empty, or every snapshotted
          // publisher has since been removed/disabled/paused): there is
          // nothing left to wait for, so treat as immediate success.
          const allRefreshed =
            eligible.length === 0 ||
            eligible.every(p => {
              if (!p.lastFetchedAt) return false;
              const t = Date.parse(p.lastFetchedAt);
              return Number.isFinite(t) && t >= triggeredAtMs;
            });

          if (allRefreshed) {
            stopIngestPoll();
            setIngestState({
              kind: 'success',
              triggeredAt,
              finishedAt: new Date().toISOString(),
            });
            return;
          }

          if (attempts >= INGEST_POLL_MAX_ATTEMPTS) {
            stopIngestPoll();
            setIngestState({ kind: 'timeout', triggeredAt });
            return;
          }

          setIngestState({ kind: 'running', triggeredAt, pollCount: attempts });
          scheduleNextTick();
        } catch (err) {
          // Transient list errors during polling shouldn't kill the run —
          // log and reschedule so a single hiccup doesn't abort.
          if (myGen !== ingestPollGenRef.current) return;
          console.warn('Polling listPublishers failed:', err);
          if (attempts >= INGEST_POLL_MAX_ATTEMPTS) {
            stopIngestPoll();
            setIngestState({ kind: 'timeout', triggeredAt });
            return;
          }
          scheduleNextTick();
        }
      };

      scheduleNextTick();
    } catch (err) {
      stopIngestPoll();
      setIngestState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to trigger ingest.',
      });
    }
    // `publishers` MUST be in the deps: handleRunIngest captures it (via
    // `triggerSnapshot`) at trigger time. Without it, `useCallback` would
    // freeze the callback to the mount-time `publishers` (an empty array),
    // making `triggerSnapshot` always empty and causing the polling
    // completion check to immediately report success regardless of whether
    // the ingest Lambda has done any work.
  }, [stopIngestPoll, publishers]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  // The pending section renders pending applications separately; exclude
  // them from the main table to avoid duplicate rows.
  const nonPendingPublishers = publishers.filter(
    p => p.applicationStatus !== 'pending',
  );

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const statusBadgeClass = (status: PublisherRecord['lastFetchStatus'] | undefined): string => {
    switch (status) {
      case 'ok':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400';
      case 'parse_error':
      case 'validation_error':
      case 'network_error':
      case 'threshold_halt':
        return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400';
    }
  };

  // Render the ISO timestamp using the user's locale. Falls back to the raw
  // string if Date parsing fails so we never blank out a valid value.
  const formatFetchedAt = (iso: string | undefined): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  // -------------------------------------------------------------------------
  // Loading / unauthenticated guard
  // -------------------------------------------------------------------------
  if (!user || (loading && publishers.length === 0 && pending.length === 0)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="text-lg text-gray-600 dark:text-gray-300 mt-4">
            {!user ? 'Authenticating…' : 'Loading publishers…'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
                Publisher Management
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {isLocalhost && (
                <div className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-md">
                  Dev Mode
                </div>
              )}
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {nonPendingPublishers.length} publisher{nonPendingPublishers.length !== 1 ? 's' : ''}
                {pending.length > 0 && (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">
                    · {pending.length} pending
                  </span>
                )}
              </div>
              {user && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 dark:text-gray-300">{user.email}</span>
                  <button
                    onClick={logout}
                    className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page-level error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md flex items-center justify-between">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-400 hover:text-red-600 dark:hover:text-red-300 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6 gap-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Publishers</h2>
          {/* aria-live="polite" announces ingest status transitions
              (running → success/timeout/error) to screen readers without
              interrupting whatever they're currently reading. aria-atomic
              ensures the whole region is re-read when any child changes. */}
          <div className="flex items-center gap-3" aria-live="polite" aria-atomic="true">
            {/* Ingest status indicator */}
            {ingestState.kind === 'running' && (
              <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span>Ingest running… (poll {ingestState.pollCount})</span>
              </div>
            )}
            {ingestState.kind === 'success' && (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <span>✓ Ingest finished {formatFetchedAt(ingestState.finishedAt)}</span>
                <button
                  onClick={() => setIngestState({ kind: 'idle' })}
                  className="text-xs underline opacity-70 hover:opacity-100"
                >
                  Dismiss
                </button>
              </div>
            )}
            {ingestState.kind === 'timeout' && (
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <span>Ingest still running after 2 min — refresh manually to see updates.</span>
                <button
                  onClick={() => setIngestState({ kind: 'idle' })}
                  className="text-xs underline opacity-70 hover:opacity-100"
                >
                  Dismiss
                </button>
              </div>
            )}
            {ingestState.kind === 'error' && (
              <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                <span>✗ {ingestState.message}</span>
                <button
                  onClick={() => setIngestState({ kind: 'idle' })}
                  className="text-xs underline opacity-70 hover:opacity-100"
                >
                  Dismiss
                </button>
              </div>
            )}
            <button
              onClick={handleRunIngest}
              disabled={ingestState.kind === 'running'}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              title="Asynchronously triggers the publisher-ingest Lambda; this page polls until last-fetch timestamps update."
            >
              {ingestState.kind === 'running' ? 'Running…' : 'Run ingest now'}
            </button>
            {formMode.kind === 'closed' && (
              <button
                onClick={() => setFormMode({ kind: 'create' })}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                + New publisher
              </button>
            )}
          </div>
        </div>

        {/* Inline form — rendered above the list when open */}
        {formMode.kind !== 'closed' && (
          <PublisherForm
            initial={formMode.kind === 'edit' ? formMode.publisher : undefined}
            onCancel={() => setFormMode(CLOSED)}
            onSubmit={handleFormSubmit}
          />
        )}

        {/* Pending applications */}
        <PendingApplications applications={pending} onChange={fetchPublishers} />

        {/* Publisher list */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          {loading && publishers.length > 0 && (
            <div className="px-6 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs">
              Refreshing…
            </div>
          )}

          {nonPendingPublishers.length === 0 && !loading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              No publishers yet. Click &quot;+ New publisher&quot; to add one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      ID / Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Source URL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Trust
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Last Fetch
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Enabled
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {nonPendingPublishers.map(p => (
                    <tr key={p.id} className={p.enabled ? '' : 'opacity-60'}>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{p.id}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 max-w-xs truncate">
                        <a
                          href={p.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-blue-600 dark:hover:text-blue-400 underline"
                        >
                          {p.sourceUrl}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                          {p.trustLevel}
                        </span>
                      </td>
                      <td className="px-6 py-4 align-top max-w-md">
                        {p.lastFetchStatus ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusBadgeClass(p.lastFetchStatus)}`}
                            >
                              {p.lastFetchStatus}
                            </span>
                            {p.lastFetchedAt && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {formatFetchedAt(p.lastFetchedAt)}
                              </div>
                            )}
                            {p.lastFetchStatus !== 'ok' && p.lastFetchMessage && (
                              <div
                                className="text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap break-words font-mono leading-snug"
                                title={p.lastFetchMessage}
                              >
                                {p.lastFetchMessage}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full w-fit ${
                              p.enabled
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}
                          >
                            {p.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          {p.enabled && p.paused && (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full w-fit bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">
                              Paused
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setFormMode({ kind: 'edit', publisher: p })}
                            disabled={formMode.kind !== 'closed'}
                            title="Edit"
                            aria-label={`Edit ${p.name}`}
                            className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <PencilIcon />
                          </button>
                          <button
                            onClick={() => handleToggleEnabled(p)}
                            disabled={togglingIds.has(p.id)}
                            title={p.enabled ? 'Disable (retracts events)' : 'Enable'}
                            aria-label={p.enabled ? `Disable ${p.name}` : `Enable ${p.name}`}
                            className={`p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed ${
                              p.enabled
                                ? 'text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/30'
                                : 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30'
                            }`}
                          >
                            {p.enabled ? <NoSymbolIcon /> : <CheckCircleIcon />}
                          </button>
                          <button
                            onClick={() => handleTogglePaused(p)}
                            disabled={pausingIds.has(p.id) || !p.enabled}
                            title={
                              !p.enabled
                                ? 'Pause is only available for enabled publishers'
                                : p.paused
                                  ? 'Resume ingest'
                                  : 'Pause ingest (keeps existing events)'
                            }
                            aria-label={p.paused ? `Resume ${p.name}` : `Pause ${p.name}`}
                            className={`p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed ${
                              p.paused
                                ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30'
                                : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30'
                            }`}
                          >
                            {p.paused ? <PlayIcon /> : <PauseIcon />}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(p)}
                            disabled={deletingIds.has(p.id)}
                            title="Delete publisher and all their events"
                            aria-label={`Delete ${p.name}`}
                            className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {deleteTarget && (
        <Modal
          onClose={() => setDeleteTarget(null)}
          titleId="delete-publisher-title"
          // Suppress dismissal while the delete is in flight — the user
          // committed to it; tearing the dialog down mid-request would
          // leave them with no feedback when it resolves.
          closeOnEsc={!deletingIds.has(deleteTarget.id)}
          closeOnBackdropClick={!deletingIds.has(deleteTarget.id)}
        >
          <h3 id="delete-publisher-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Delete publisher?
          </h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This will permanently delete the publisher record and all of their stored events.
            The next sidecar publish will remove these events from the public site.
            This action cannot be undone.
          </p>
          <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900/40 rounded text-sm">
            <div className="font-medium text-gray-900 dark:text-gray-100">{deleteTarget.name}</div>
            <div className="font-mono text-xs text-gray-500 dark:text-gray-400">{deleteTarget.id}</div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deletingIds.has(deleteTarget.id)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              disabled={deletingIds.has(deleteTarget.id)}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deletingIds.has(deleteTarget.id) ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
