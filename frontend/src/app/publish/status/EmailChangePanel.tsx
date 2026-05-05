// Phase 4 (publisher self-service email change).
//
// Two states:
//   1. No pending change   → "Change email" button → modal with new-email
//      input → on submit calls requestEmailChange.
//   2. Pending change      → yellow banner showing the masked target
//      address + remaining time + "Cancel change" button (calls
//      cancelEmailChangeBySelf).
//
// Hooks come from 'react' (which @preact/preset-vite aliases to
// preact/compat at build time). See project CLAUDE.md.

import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  requestEmailChange,
  cancelEmailChangeBySelf,
  PublisherEmailChangeError,
} from '@/lib/publisherStatusApi';

export interface PendingEmailChange {
  newEmail: string;
  expiresAt: string; // ISO 8601
}

export interface EmailChangePanelProps {
  contactEmail: string;
  pendingEmailChange: PendingEmailChange | null | undefined;
  onChanged: () => void;
}

// f***@example.com → keep first letter, asterisks, then full domain. We
// don't want to be clever about i18n / RTL here; the masked form is
// strictly informational.
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.charAt(0);
  return `${head}***@${domain}`;
}

export function EmailChangePanel(props: EmailChangePanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelEmailChangeBySelf();
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  }

  if (props.pendingEmailChange) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">
          Email change pending verification
        </h3>
        <p className="text-sm text-amber-900 dark:text-amber-200 mb-2">
          Pending verification by{' '}
          <span className="font-mono">
            {maskEmail(props.pendingEmailChange.newEmail)}
          </span>
          . We&apos;ve sent a confirmation link to that address. The change takes
          effect once the new address clicks the link.
        </p>
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="inline-flex items-center px-3 py-1 text-sm rounded-md border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-60"
        >
          {busy ? 'Cancelling…' : 'Cancel change'}
        </button>
        {error && (
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Contact email
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <span className="font-mono">{props.contactEmail}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Change email
        </button>
      </div>

      {modalOpen && (
        <ChangeEmailModal
          contactEmail={props.contactEmail}
          onClose={() => setModalOpen(false)}
          onSubmitted={() => {
            setModalOpen(false);
            props.onChanged();
          }}
        />
      )}
    </>
  );
}

function ChangeEmailModal({
  contactEmail,
  onClose,
  onSubmitted,
}: {
  contactEmail: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = newEmail.trim();
    if (trimmed.length === 0) return;
    if (trimmed.toLowerCase() === contactEmail.toLowerCase()) {
      setError("That's already your contact email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestEmailChange(trimmed);
      onSubmitted();
    } catch (err) {
      if (err instanceof PublisherEmailChangeError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Email change failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-email-title"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 id="change-email-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Change contact email
        </h3>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
          We&apos;ll send a confirmation link to the new address. The change
          only takes effect once that link is clicked. We&apos;ll also notify
          your current address ({' '}
          <span className="font-mono text-xs">{contactEmail}</span>
          ) so they can cancel if it wasn&apos;t you.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
              New email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={newEmail}
              onInput={e => setNewEmail((e.target as HTMLInputElement).value)}
              className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </label>

          {error && (
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send confirmation link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
