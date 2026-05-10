import React, { useState, useEffect, useCallback } from 'react';
import {
  listPending,
  approveEvent,
  rejectEvent,
  listHalts,
  approveHalt,
  cancelHalt,
  type PendingEvent,
  type PublisherRecord,
} from '@/lib/adminPublisherApi';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { logout } from '@/lib/auth';
import { PendingEventCard } from './PendingEventCard';

export default function PublisherEventsPage() {
  const user = useAdminAuth();
  const [pending, setPending] = useState<PendingEvent[]>([]);
  const [halts, setHalts] = useState<PublisherRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // in-flight keys: evt:<publisherId>:<eventId> or halt:<publisherId>
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Data fetch
  // -------------------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingData, haltsData] = await Promise.all([listPending(), listHalts()]);
      setPending(pendingData);
      setHalts(haltsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const data = await listPending();
      setPending(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload pending events.');
    }
  }, []);

  const fetchHalts = useCallback(async () => {
    try {
      const data = await listHalts();
      setHalts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload halts.');
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchAll();
    }
  }, [user, fetchAll]);

  // -------------------------------------------------------------------------
  // Pending event actions
  // -------------------------------------------------------------------------
  const handleApprove = useCallback(
    async (publisherId: string, eventId: string) => {
      const key = `evt:${publisherId}:${eventId}`;
      setInFlight(prev => new Set(prev).add(key));
      try {
        await approveEvent(publisherId, eventId);
        await fetchPending();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to approve event.');
      } finally {
        setInFlight(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [fetchPending],
  );

  const handleReject = useCallback(
    async (publisherId: string, eventId: string, reason?: string) => {
      const key = `evt:${publisherId}:${eventId}`;
      setInFlight(prev => new Set(prev).add(key));
      try {
        await rejectEvent(publisherId, eventId, reason);
        await fetchPending();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reject event.');
      } finally {
        setInFlight(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [fetchPending],
  );

  // -------------------------------------------------------------------------
  // Halt actions
  // -------------------------------------------------------------------------
  const handleApproveHalt = useCallback(
    async (publisherId: string) => {
      const key = `halt:${publisherId}`;
      setInFlight(prev => new Set(prev).add(key));
      try {
        await approveHalt(publisherId);
        await Promise.all([fetchHalts(), fetchPending()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to approve halt.');
      } finally {
        setInFlight(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [fetchHalts, fetchPending],
  );

  const handleCancelHalt = useCallback(
    async (publisherId: string) => {
      const key = `halt:${publisherId}`;
      setInFlight(prev => new Set(prev).add(key));
      try {
        await cancelHalt(publisherId);
        await fetchHalts();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to cancel halt.');
      } finally {
        setInFlight(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [fetchHalts],
  );

  // -------------------------------------------------------------------------
  // Loading / unauthenticated guard
  // -------------------------------------------------------------------------
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (!user || (loading && pending.length === 0 && halts.length === 0)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="text-lg text-gray-600 dark:text-gray-300 mt-4">
            {!user ? 'Authenticating…' : 'Loading…'}
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
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8"
              />
              <div>
                <a
                  href="/admin/"
                  aria-label="Back to Admin"
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  ← Admin
                </a>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                  Publisher Events
                </h1>
              </div>
              <a
                href="/admin/publishers/"
                aria-label="Go to Publisher Management"
                className="hidden sm:inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-md"
              >
                ← Publishers
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 ml-auto">
              {isLocalhost && (
                <div className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-md">
                  Dev Mode
                </div>
              )}
              {user && (
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm text-gray-600 dark:text-gray-300 break-all">{user.email}</span>
                  <button
                    onClick={logout}
                    className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm shrink-0"
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Page-level error */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md flex items-center justify-between">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-400 hover:text-red-600 dark:hover:text-red-300 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Section 1 — Pending events */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Pending events{' '}
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                ({pending.length})
              </span>
            </h2>
          </div>

          {loading && pending.length > 0 && (
            <div className="mb-2 px-4 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs rounded-md">
              Refreshing…
            </div>
          )}

          {pending.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No events awaiting review.</p>
          ) : (
            <div className="space-y-3">
              {pending.map(e => (
                <PendingEventCard
                  key={`${e.publisherId}:${e.eventId}`}
                  event={e}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  disabled={inFlight.has(`evt:${e.publisherId}:${e.eventId}`)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Section 2 — Threshold halts */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Threshold halts{' '}
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                ({halts.length})
              </span>
            </h2>
          </div>

          {halts.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No active halts.</p>
          ) : (
            <div className="space-y-3">
              {halts.map(halt => {
                const haltKey = `halt:${halt.id}`;
                const isInFlight = inFlight.has(haltKey);
                const detectedAt = halt.pendingThresholdHalt
                  ? new Date(halt.pendingThresholdHalt.detectedAt).toLocaleString()
                  : '';
                const eventCount = halt.pendingThresholdHalt?.incomingFeed.eventCount ?? 0;

                return (
                  <div
                    key={halt.id}
                    className="border border-orange-200 dark:border-orange-800 rounded-lg p-4 bg-white dark:bg-gray-800"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {halt.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500 font-mono">
                          {halt.id}
                        </p>
                        {halt.pendingThresholdHalt && (
                          <p className="mt-1 text-xs text-orange-700 dark:text-orange-400">
                            Detected {detectedAt} &mdash; incoming feed had {eventCount} events
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0 items-end">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApproveHalt(halt.id)}
                            disabled={isInFlight}
                            className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isInFlight ? '…' : 'Approve & let next pass through'}
                          </button>
                          <button
                            onClick={() => handleCancelHalt(halt.id)}
                            disabled={isInFlight}
                            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isInFlight ? '…' : 'Cancel halt'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-right">
                          Both clear the halt; the next scheduled ingest re-evaluates the feed.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
