// Phase 5 (publisher self-service ingest controls).
//
// Three buttons under the LastFetchPanel:
//   - Pause      → confirmation modal → POST /publisher-pause
//   - Resume     → one-click          → POST /publisher-resume
//   - Fetch now  → one-click          → POST /publisher-fetch-now
//                  (disabled with countdown when 429-rate-limited)
//
// Hooks come from 'react' (which @preact/preset-vite aliases to
// preact/compat at build time). See project CLAUDE.md.

import { useEffect, useState } from 'react';
import {
  pausePublisher,
  resumePublisher,
  triggerFetchNow,
  PublisherFetchNowError,
  type PublisherStatusRecord,
} from '@/lib/publisherStatusApi';
import { Modal } from '@/components/Modal';

export interface IngestControlsProps {
  publisher: PublisherStatusRecord;
  onChanged: () => void;
}

export function IngestControls({ publisher, onChanged }: IngestControlsProps) {
  const paused = publisher.paused === true;
  // An admin-disabled publisher (`enabled === false`) should not see Pause /
  // Resume / Fetch-now controls — those mutations don't make sense once the
  // ingest gate is off, and clicking Resume on an admin-disabled row would
  // not actually restart fetches. A self-disabled publisher's tokenVersion
  // was bumped, so they'd already be redirected to login on the next API
  // call; this branch is for the admin-disable case where the JWT is still
  // valid. The disable copy mirrors the "Disabled" wording on status/page.tsx.
  const adminDisabled = publisher.enabled === false;

  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'pause' | 'resume' | 'fetch'>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Cooldown countdown driven by a ticking interval. When non-null, the
  // fetch-now button is disabled and the label shows "Try again in Ns". The
  // countdown is local-only — refreshing the page resets it (the backend
  // 429 will reappear on the next attempt anyway).
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (cooldownRemaining === null) return;
    if (cooldownRemaining <= 0) {
      setCooldownRemaining(null);
      return;
    }
    const t = window.setTimeout(() => {
      setCooldownRemaining(r => (r === null ? null : Math.max(0, r - 1)));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [cooldownRemaining]);

  async function handlePauseConfirm() {
    setBusy('pause');
    setError(null);
    setInfo(null);
    try {
      await pausePublisher();
      setPauseModalOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pause failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleResume() {
    setBusy('resume');
    setError(null);
    setInfo(null);
    try {
      await resumePublisher();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleFetchNow() {
    setBusy('fetch');
    setError(null);
    setInfo(null);
    try {
      await triggerFetchNow();
      setInfo('Fetch queued. Check back in a minute for updated last-fetched time.');
    } catch (err) {
      if (err instanceof PublisherFetchNowError && err.status === 429) {
        const remaining = err.retryAfterSeconds ?? 60;
        setCooldownRemaining(remaining);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Fetch-now failed.');
      }
    } finally {
      setBusy(null);
    }
  }

  if (adminDisabled) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
          Ingest controls
        </h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          This publisher is{' '}
          <span className="font-semibold text-red-700 dark:text-red-300">
            disabled
          </span>
          . Contact an admin to re-enable. Events have been retracted from
          the calendar.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        Ingest controls
      </h2>

      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
        {paused ? (
          <>
            Your feed is <span className="font-semibold text-amber-700 dark:text-amber-300">paused</span>.
            New events from your feed are not being fetched. Your previously-published
            events stay live on the calendar.
          </>
        ) : (
          <>
            Your feed is <span className="font-semibold text-green-700 dark:text-green-300">active</span>.
            We re-fetch it on a regular schedule. Use the controls below to
            pause future fetches or trigger one immediately.
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        {paused ? (
          <button
            type="button"
            onClick={handleResume}
            disabled={busy !== null}
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-60"
          >
            {busy === 'resume' ? 'Resuming…' : 'Resume fetches'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPauseModalOpen(true)}
            disabled={busy !== null}
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-60"
          >
            Pause fetches
          </button>
        )}

        <button
          type="button"
          onClick={handleFetchNow}
          disabled={busy !== null || cooldownRemaining !== null}
          className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
        >
          {busy === 'fetch'
            ? 'Queueing…'
            : cooldownRemaining !== null
              ? `Try again in ${cooldownRemaining}s`
              : 'Fetch now'}
        </button>
      </div>

      {info && (
        <p className="mt-3 text-sm text-green-700 dark:text-green-300" role="status">
          {info}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}

      {pauseModalOpen && (
        <PauseConfirmModal
          busy={busy === 'pause'}
          onConfirm={handlePauseConfirm}
          onCancel={() => setPauseModalOpen(false)}
        />
      )}
    </div>
  );
}

function PauseConfirmModal({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} titleId="pause-confirm-title" closeOnEsc={!busy}>
      <h3
        id="pause-confirm-title"
        className="text-lg font-semibold text-gray-900 dark:text-white mb-2"
      >
        Pause fetches?
      </h3>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
        Pausing stops new fetches of your feed. Your previously-published
        events stay live on the calendar until you Resume or Disable.
        Pause anyway?
      </p>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? 'Pausing…' : 'Pause anyway'}
        </button>
      </div>
    </Modal>
  );
}
