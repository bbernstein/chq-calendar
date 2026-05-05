// Inline editor for { sourceUrl, sourceType } on the publisher status page.
//
// The Save button is gated behind a successful Preview that matches the
// CURRENT form values: editing the URL after a passing preview re-disables
// Save until you preview again. This mirrors the backend's "URL change must
// pass feed test" rule, but at the UI layer so the publisher gets immediate
// feedback before submitting.
//
// Hooks come from 'react' (aliased to preact/compat by @preact/preset-vite)
// — same rationale as EditableField.tsx; the project's onChange/onInput
// normalisation depends on this import.

import { useState } from 'react';

export type SourceType = 'json' | 'html';

export interface SourceEditPanelProps {
  currentUrl: string;
  currentType: SourceType;
  /** Run the same SSRF guard + fetch + parse + validate that the backend would. */
  onPreview: (
    url: string,
    type: SourceType,
  ) => Promise<{ ok: true; summary: string } | { ok: false; errors: string[] }>;
  /** Persist the change. Called only after a successful preview that matches the form. */
  onSave: (url: string, type: SourceType) => Promise<void>;
  onCancel: () => void;
}

type PreviewState =
  | null
  | { ok: true; summary: string; previewedUrl: string; previewedType: SourceType }
  | { ok: false; errors: string[] };

export function SourceEditPanel(props: SourceEditPanelProps) {
  const [url, setUrl] = useState(props.currentUrl);
  const [type, setType] = useState<SourceType>(props.currentType);
  const [previewResult, setPreviewResult] = useState<PreviewState>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Save is allowed only when the most recent preview succeeded AND the form
  // values still match what was previewed. Editing either field invalidates
  // the previous preview.
  const previewMatchesForm =
    previewResult !== null &&
    previewResult.ok === true &&
    previewResult.previewedUrl === url &&
    previewResult.previewedType === type;
  const canSave = previewMatchesForm && busy === null;

  async function runPreview() {
    setBusy('preview');
    setSaveError(null);
    try {
      const r = await props.onPreview(url, type);
      setPreviewResult(
        r.ok
          ? { ok: true, summary: r.summary, previewedUrl: url, previewedType: type }
          : { ok: false, errors: r.errors },
      );
    } catch (e) {
      // A thrown preview is treated as a failure with the message the user
      // saw (network glitch, etc). Keep the panel open so they can retry.
      setPreviewResult({
        ok: false,
        errors: [e instanceof Error ? e.message : 'Preview failed.'],
      });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setSaveError(null);
    try {
      await props.onSave(url, type);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">
        Edit source
      </h3>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Source URL
          <input
            type="url"
            aria-label="Source URL"
            value={url}
            disabled={busy !== null}
            onInput={e => {
              setUrl((e.target as HTMLInputElement).value);
              // Editing the URL invalidates the previous preview.
              setPreviewResult(null);
              setSaveError(null);
            }}
            className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            placeholder="https://example.com/events.json"
          />
        </label>
      </div>

      <fieldset
        className="space-y-1"
        disabled={busy !== null}
      >
        <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Source type
        </legend>
        <label className="inline-flex items-center mr-4 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="radio"
            name="sourceType"
            value="json"
            checked={type === 'json'}
            onChange={() => {
              setType('json');
              setPreviewResult(null);
              setSaveError(null);
            }}
            className="mr-1"
          />
          JSON
        </label>
        <label className="inline-flex items-center text-sm text-gray-700 dark:text-gray-300">
          <input
            type="radio"
            name="sourceType"
            value="html"
            checked={type === 'html'}
            onChange={() => {
              setType('html');
              setPreviewResult(null);
              setSaveError(null);
            }}
            className="mr-1"
          />
          HTML
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={busy !== null}
          className="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'preview' ? 'Previewing…' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            !canSave && busy === null
              ? 'Run a successful preview first.'
              : undefined
          }
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          disabled={busy !== null}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {previewResult !== null && previewResult.ok && (
        <div className="rounded border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-900 dark:text-green-200">
          <div className="font-medium mb-1">Preview passed</div>
          <div>{previewResult.summary}</div>
          {!previewMatchesForm && (
            <div className="mt-1 text-xs italic text-amber-700 dark:text-amber-300">
              You changed the URL or type since previewing — preview again to enable Save.
            </div>
          )}
        </div>
      )}
      {previewResult !== null && !previewResult.ok && (
        <div className="rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-900 dark:text-red-200">
          <div className="font-medium mb-1">Preview failed</div>
          <ul className="list-disc list-inside space-y-0.5">
            {previewResult.errors.map((err, i) => (
              <li key={i} className="break-words">{err}</li>
            ))}
          </ul>
        </div>
      )}
      {saveError && (
        <div className="rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-900 dark:text-red-200">
          {saveError}
        </div>
      )}
    </div>
  );
}
