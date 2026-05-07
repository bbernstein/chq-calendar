import { useEffect, useState } from 'preact/hooks';
import { getPublisherEvents, type PublisherEventSummary } from '@/lib/publisherStatusApi';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; events: PublisherEventSummary[] }
  | { kind: 'error'; message: string };

function badge(state: PublisherEventSummary['state']): { label: string; cls: string } {
  if (state === 'published')
    return { label: 'Published', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
  if (state === 'pending')
    return { label: 'Pending review', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' };
  return { label: 'Rejected', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' };
}

function sortEvents(es: PublisherEventSummary[], now = Date.now()): PublisherEventSummary[] {
  const future = es.filter(e => Date.parse(e.startDate) >= now).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = es.filter(e => Date.parse(e.startDate) < now).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return [...future, ...past];
}

export function PublisherEventsPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getPublisherEvents()
      .then(events => { if (!cancelled) setState({ kind: 'ok', events }); })
      .catch(err => {
        if (!cancelled) setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load events',
        });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'loading') return <div className="text-sm text-gray-500 dark:text-gray-400">Loading events…</div>;
  if (state.kind === 'error') return <div className="text-sm text-red-700 dark:text-red-300">Failed to load events: {state.message}</div>;
  if (state.events.length === 0) return <div className="text-sm text-gray-500 dark:text-gray-400">No events ingested yet.</div>;

  const sorted = sortEvents(state.events);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
          <tr>
            <th className="text-left py-2 pr-4">Event</th>
            <th className="text-left py-2 pr-4">Start</th>
            <th className="text-left py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(e => {
            const b = badge(e.state);
            const showReason = e.state === 'rejected';
            const reasonLine = e.rejectionReason && e.rejectionReason.length > 0
              ? e.rejectionReason
              : 'Removed by admin.';
            return (
              <tr key={e.eventId} className="border-t border-gray-200 dark:border-gray-700">
                <td className="py-2 pr-4">
                  <div className="font-medium">{e.title}</div>
                  {showReason && (
                    <div className="text-xs italic text-gray-500 dark:text-gray-400">Reason: {reasonLine}</div>
                  )}
                </td>
                <td className="py-2 pr-4 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(e.startDate).toLocaleString()}
                </td>
                <td className="py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${b.cls}`}>{b.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
