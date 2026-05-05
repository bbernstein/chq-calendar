// Inline editable field used on the publisher status page for free-form
// text edits (name, organization). Click the pencil → edit mode → Save
// dispatches an async onSave; rejection surfaces the error message inline.
//
// Hooks are imported from 'react' (which @preact/preset-vite aliases to
// preact/compat) — see project CLAUDE.md: this is required so the
// onChange/onInput event normalisation behaves the way component tests
// expect.

import { useState } from 'react';

export interface EditableFieldProps {
  label: string;
  value: string;
  /** When true, an empty value is allowed (e.g. clearing organization). */
  allowEmpty?: boolean;
  /** Soft cap mirrored on the backend; default 200 chars. */
  maxLength?: number;
  /** Resolved on success, rejected on failure (caller throws to render the message). */
  onSave: (newValue: string) => Promise<void>;
}

export function EditableField({
  label,
  value,
  allowEmpty,
  maxLength = 200,
  onSave,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(value);
    setEditing(true);
    setError(null);
  }
  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!allowEmpty && trimmed.length === 0) {
      setError('This field cannot be empty.');
      return;
    }
    if (trimmed.length > maxLength) {
      setError(`Maximum length is ${maxLength} characters.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-gray-900 dark:text-gray-100">
          {value || <span className="text-gray-400 italic">—</span>}
        </span>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onClick={start}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        aria-label={label}
        value={draft}
        // Allow over-typing by 1 so paste of an over-long value still surfaces
        // the inline length error rather than being silently truncated.
        maxLength={maxLength + 1}
        disabled={pending}
        onInput={e => setDraft((e.target as HTMLInputElement).value)}
        className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
