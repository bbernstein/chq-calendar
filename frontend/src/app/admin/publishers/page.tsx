import React, { useState, useEffect, useCallback } from 'react';
import {
  listPublishers,
  createPublisher,
  updatePublisher,
  type PublisherRecord,
  type CreatePublisherInput,
} from '@/lib/adminPublisherApi';
import { PublisherForm } from './PublisherForm';

// Discriminated union for form open/closed state.
type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; publisher: PublisherRecord };

const CLOSED: FormMode = { kind: 'closed' };

export default function PublishersPage() {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [publishers, setPublishers] = useState<PublisherRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(CLOSED);
  // Track IDs currently being toggled (enable/disable in-flight).
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Auth bootstrap (mirrors admin/feedback/page.tsx lines 39-66 exactly)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (isLocalhost) {
      const dummyUser = { email: 'dev@localhost.local', name: 'Local Dev User' };
      setUser(dummyUser);
      localStorage.setItem('chq_auth_user', JSON.stringify(dummyUser));
      localStorage.setItem('chq_auth_token', 'dummy-local-token');
      return;
    }

    const token = localStorage.getItem('chq_auth_token');
    const userStr = localStorage.getItem('chq_auth_user');

    if (!token || !userStr) {
      window.location.href = '/admin/login/';
      return;
    }

    setUser(JSON.parse(userStr));
  }, []);

  // -------------------------------------------------------------------------
  // Data fetch
  // -------------------------------------------------------------------------
  const fetchPublishers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPublishers();
      setPublishers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publishers.');
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
        await updatePublisher(p.id, { enabled: !p.enabled });
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
  // Render helpers
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Loading / unauthenticated guard
  // -------------------------------------------------------------------------
  if (!user || (loading && publishers.length === 0)) {
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
                {publishers.length} publisher{publishers.length !== 1 ? 's' : ''}
              </div>
              {user && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 dark:text-gray-300">{user.email}</span>
                  <button
                    onClick={() => {
                      localStorage.removeItem('chq_auth_token');
                      localStorage.removeItem('chq_auth_user');
                      window.location.href = '/admin/login/';
                    }}
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
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Publishers</h2>
          {formMode.kind === 'closed' && (
            <button
              onClick={() => setFormMode({ kind: 'create' })}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              + New publisher
            </button>
          )}
        </div>

        {/* Inline form — rendered above the list when open */}
        {formMode.kind !== 'closed' && (
          <PublisherForm
            initial={formMode.kind === 'edit' ? formMode.publisher : undefined}
            onCancel={() => setFormMode(CLOSED)}
            onSubmit={handleFormSubmit}
          />
        )}

        {/* Publisher list */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          {loading && publishers.length > 0 && (
            <div className="px-6 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs">
              Refreshing…
            </div>
          )}

          {publishers.length === 0 && !loading ? (
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
                  {publishers.map(p => (
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        {p.lastFetchStatus ? (
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusBadgeClass(p.lastFetchStatus)}`}
                            title={p.lastFetchMessage}
                          >
                            {p.lastFetchStatus}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            p.enabled
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {p.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          onClick={() => setFormMode({ kind: 'edit', publisher: p })}
                          disabled={formMode.kind !== 'closed'}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleEnabled(p)}
                          disabled={togglingIds.has(p.id)}
                          className={`${
                            p.enabled
                              ? 'text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-300'
                              : 'text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {togglingIds.has(p.id) ? '…' : p.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
