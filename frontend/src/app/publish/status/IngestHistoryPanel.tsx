import { useEffect, useState } from 'preact/hooks';
import { getPublisherRuns, type IngestRunSummary } from '@/lib/publisherStatusApi';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; runs: IngestRunSummary[] }
  | { kind: 'error'; message: string };

function statusLabel(s: IngestRunSummary['status']): string {
  switch (s) {
    case 'ok': return 'OK';
    case 'parse_error': return 'Parse error';
    case 'validation_error': return 'Validation error';
    case 'network_error': return 'Network error';
    case 'threshold_halt': return 'Threshold halt';
    // Fallback for forward-compat: if a future backend deploy ships a new
    // status string before the frontend deploy catches up, render the raw
    // value rather than blanking the cell.
    default: return s;
  }
}

function statusBadgeClasses(s: IngestRunSummary['status']): string {
  if (s === 'ok') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (s === 'threshold_halt') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

function relativeTime(iso: string, now = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function IngestHistoryPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getPublisherRuns()
      .then(runs => { if (!cancelled) setState({ kind: 'ok', runs }); })
      .catch(err => {
        if (!cancelled) setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load runs',
        });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'loading') {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading ingest history…</div>;
  }
  if (state.kind === 'error') {
    return <div className="text-sm text-red-700 dark:text-red-300">Failed to load ingest history: {state.message}</div>;
  }
  if (state.runs.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No ingest runs yet — your first scheduled fetch will appear here within an hour.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
          <tr>
            <th className="text-left py-2 pr-4">When</th>
            <th className="text-left py-2 pr-4">Status</th>
            <th className="text-left py-2 pr-4">Counts</th>
            <th className="text-left py-2 pr-4">Trigger</th>
            <th className="text-left py-2">Message</th>
          </tr>
        </thead>
        <tbody>
          {state.runs.map(r => (
            <tr key={r.runAt} className="border-t border-gray-200 dark:border-gray-700">
              <td className="py-2 pr-4" title={r.runAt}>{relativeTime(r.runAt)}</td>
              <td className="py-2 pr-4">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeClasses(r.status)}`}>
                  {statusLabel(r.status)}
                </span>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                {r.counts ? `+${r.counts.added} ~${r.counts.updated} -${r.counts.retracted}` : '—'}
              </td>
              <td className="py-2 pr-4 text-xs text-gray-500 dark:text-gray-400">{r.triggeredBy}</td>
              <td className="py-2 text-xs text-gray-700 dark:text-gray-300">
                {r.message ? <span className="break-words">{r.message}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
