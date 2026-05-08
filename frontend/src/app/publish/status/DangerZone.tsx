// Phase 6 — publisher self-disable (typed-confirmation gate).
//
// Renders a red-bordered card at the bottom of the approved-publisher view.
// Clicking "Disable my publisher" opens a modal that requires the publisher
// to type their slug (= publisher.id) exactly before the Confirm button
// becomes enabled. On success the JWT is invalidated server-side (tokenVersion
// bump) so we redirect to /publish/ instead of trying to refresh the status
// page (which would 401 immediately).
//
// Hooks come from 'react' (which @preact/preset-vite aliases to preact/compat
// at build time). See project CLAUDE.md.

import { useState } from 'react';
import {
  selfDisablePublisher,
  PublisherSelfDisableError,
  type PublisherStatusRecord,
} from '@/lib/publisherStatusApi';
import { clearPublisherSession } from '@/lib/publisherAuthClient';
import { Modal } from '@/components/Modal';

export interface DangerZoneProps {
  publisher: PublisherStatusRecord;
}

export function DangerZone({ publisher }: DangerZoneProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border-2 border-red-300 dark:border-red-800">
      <h2 className="text-lg font-semibold text-red-800 dark:text-red-300 mb-2">
        Danger zone
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
        Disabling your publisher will retract your events from the calendar
        within an hour. Your record stays on file (so a future re-enable
        preserves your slug), but only an admin can re-enable it.
      </p>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-red-600 text-white font-medium hover:bg-red-700"
      >
        Disable my publisher
      </button>

      {modalOpen && (
        <DisableConfirmModal
          slug={publisher.id}
          onCancel={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

function DisableConfirmModal({
  slug,
  onCancel,
}: {
  slug: string;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Defence in depth: the server enforces the same equality, but we also
  // disable the button client-side so a misclick on a half-typed slug
  // can't fire the request. Case-sensitive exact match — same rule as
  // the server.
  const matches = typed === slug;

  async function handleConfirm() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await selfDisablePublisher(typed);
      // The server bumped tokenVersion, so the JWT we hold is now invalid.
      // Clear local session state and redirect rather than fall back to the
      // status page (which would 401 + redirect anyway, but more jarringly).
      clearPublisherSession();
      window.location.replace('/publish/');
    } catch (err) {
      // Map the typed-confirmation mismatch to a more actionable hint —
      // the server still validated the exact-match rule (defence in
      // depth) so this branch fires when the input was tampered with
      // between equality check and submit.
      if (err instanceof PublisherSelfDisableError && err.code === 'confirm_mismatch') {
        setError('The confirmation slug did not match. Type your publisher slug exactly.');
      } else {
        setError(err instanceof Error ? err.message : 'Disable failed.');
      }
      setBusy(false);
    }
  }

  return (
    // closeOnEsc=false: the typed-confirmation gate is meant to make the
    // user commit deliberately. A stray Escape from the input field
    // shouldn't undo that commitment.
    <Modal onClose={onCancel} titleId="disable-confirm-title" closeOnEsc={false}>
      <h3
        id="disable-confirm-title"
        className="text-lg font-semibold text-red-800 dark:text-red-300 mb-2"
      >
        Disable your publisher?
      </h3>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
        This will retract your events on the next ingest run. Re-enabling
        requires an admin.
      </p>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
        To confirm, type the publisher slug{' '}
        <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">
          {slug}
        </code>{' '}
        exactly:
      </p>
      <input
        type="text"
        value={typed}
        onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
        aria-label="Confirmation slug"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500 mb-3 font-mono"
        disabled={busy}
      />

      {error && (
        <p className="mb-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}

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
          onClick={handleConfirm}
          disabled={!matches || busy}
          className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? 'Disabling…' : 'Disable my publisher'}
        </button>
      </div>
    </Modal>
  );
}
