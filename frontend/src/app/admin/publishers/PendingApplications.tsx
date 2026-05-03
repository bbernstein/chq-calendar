// Phase C: pending application review section for /admin/publishers/.
//
// Renders only when there are pending rows. Each row exposes an Approve and
// a Reject control; Reject opens an inline reason textarea before
// confirming. Buttons disable while a request is in-flight; per-row errors
// surface inline.

import { useState } from 'preact/hooks';
import {
  approveApplication,
  rejectApplication,
  type PublisherRecord,
} from '@/lib/adminPublisherApi';

interface Props {
  applications: PublisherRecord[];
  // Called after every successful approve/reject so the parent can refetch
  // both the pending list and the main publisher list.
  onChange: () => Promise<void> | void;
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'rejecting'; reason: string }
  | { kind: 'busy' }
  | { kind: 'error'; message: string };

const REASON_MAX = 500;

export function PendingApplications({ applications, onChange }: Props) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  if (applications.length === 0) return null;

  const stateFor = (id: string): RowState => rowStates[id] ?? { kind: 'idle' };

  const setState = (id: string, s: RowState) => {
    setRowStates(prev => ({ ...prev, [id]: s }));
  };

  const handleApprove = async (id: string) => {
    setState(id, { kind: 'busy' });
    try {
      await approveApplication(id);
      // Drop our row state; parent's refetch will remove the row.
      setRowStates(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await onChange();
    } catch (err) {
      setState(id, {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to approve.',
      });
    }
  };

  const handleReject = async (id: string, reason: string) => {
    setState(id, { kind: 'busy' });
    try {
      await rejectApplication(id, reason.trim() || undefined);
      setRowStates(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await onChange();
    } catch (err) {
      setState(id, {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to reject.',
      });
    }
  };

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Pending applications{' '}
          <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300">
            {applications.length}
          </span>
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Review feeds before they go live.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {applications.map(app => {
            const state = stateFor(app.id);
            const busy = state.kind === 'busy';
            return (
              <li key={app.id} className="px-6 py-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {app.name}
                      </p>
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                        {app.id}
                      </span>
                    </div>
                    <dl className="mt-1 text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                      <div>
                        <dt className="inline font-medium">Email:</dt>{' '}
                        <dd className="inline">{app.contactEmail}</dd>
                      </div>
                      {app.organization && (
                        <div>
                          <dt className="inline font-medium">Organization:</dt>{' '}
                          <dd className="inline">{app.organization}</dd>
                        </div>
                      )}
                      <div>
                        <dt className="inline font-medium">Source:</dt>{' '}
                        <dd className="inline">
                          <a
                            href={app.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                          >
                            {app.sourceUrl}
                          </a>{' '}
                          <span className="uppercase text-[10px] tracking-wide bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                            {app.sourceType}
                          </span>
                        </dd>
                      </div>
                      {app.applicantNotes && (
                        <div>
                          <dt className="inline font-medium">Notes:</dt>{' '}
                          <dd className="inline italic">{app.applicantNotes}</dd>
                        </div>
                      )}
                      {app.appliedAt && (
                        <div>
                          <dt className="inline font-medium">Applied:</dt>{' '}
                          <dd className="inline">{new Date(app.appliedAt).toLocaleString()}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  <div className="flex flex-col gap-2 sm:items-end">
                    {state.kind !== 'rejecting' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(app.id)}
                          disabled={busy}
                          className="px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {busy ? 'Working…' : 'Approve'}
                        </button>
                        <button
                          onClick={() => setState(app.id, { kind: 'rejecting', reason: '' })}
                          disabled={busy}
                          className="px-3 py-1.5 text-sm font-medium rounded-md border border-red-600 text-red-700 dark:text-red-300 dark:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {state.kind === 'rejecting' && (
                  <RejectInline
                    initialReason={state.reason}
                    onCancel={() => setState(app.id, { kind: 'idle' })}
                    onConfirm={reason => handleReject(app.id, reason)}
                  />
                )}

                {state.kind === 'error' && (
                  <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {state.message}{' '}
                    <button
                      type="button"
                      onClick={() => setState(app.id, { kind: 'idle' })}
                      className="underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// Inline reason textarea for the Reject confirmation.
function RejectInline({
  initialReason,
  onCancel,
  onConfirm,
}: {
  initialReason: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(initialReason);
  const remaining = REASON_MAX - reason.length;

  return (
    <div className="mt-3 p-3 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
      <label className="block text-xs font-medium text-red-700 dark:text-red-300 mb-1">
        Reason (optional, sent to the applicant)
      </label>
      <textarea
        value={reason}
        onInput={e => setReason((e.target as HTMLTextAreaElement).value.slice(0, REASON_MAX))}
        rows={3}
        placeholder="e.g., Source URL returned non-public events; please re-apply with a corrected feed."
        className="w-full text-sm rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2 focus:outline-none focus:ring-2 focus:ring-red-500"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {remaining} chars left
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            className="px-3 py-1 text-xs rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            Confirm reject
          </button>
        </div>
      </div>
    </div>
  );
}
