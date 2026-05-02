import React, { useState } from 'react';
import type { PublisherRecord, CreatePublisherInput } from '@/lib/adminPublisherApi';

export interface PublisherFormProps {
  initial?: PublisherRecord;
  onCancel: () => void;
  onSubmit: (input: CreatePublisherInput | Partial<PublisherRecord>) => Promise<void>;
}

interface FormFields {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel: 'auto' | 'review' | 'flagged';
}

export function PublisherForm({ initial, onCancel, onSubmit }: PublisherFormProps) {
  const isEdit = initial !== undefined;

  const [fields, setFields] = useState<FormFields>({
    id: initial?.id ?? '',
    name: initial?.name ?? '',
    contactEmail: initial?.contactEmail ?? '',
    sourceUrl: initial?.sourceUrl ?? '',
    sourceType: initial?.sourceType ?? 'json',
    trustLevel: initial?.trustLevel ?? 'review',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set =
    (key: keyof FormFields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFields(prev => ({ ...prev, [key]: e.target.value }));
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isEdit) {
        const patch: Partial<PublisherRecord> = {
          name: fields.name,
          contactEmail: fields.contactEmail,
          sourceUrl: fields.sourceUrl,
          sourceType: fields.sourceType,
          trustLevel: fields.trustLevel,
        };
        await onSubmit(patch);
      } else {
        const input: CreatePublisherInput = {
          id: fields.id,
          name: fields.name,
          contactEmail: fields.contactEmail,
          sourceUrl: fields.sourceUrl,
          sourceType: fields.sourceType,
          trustLevel: fields.trustLevel,
        };
        await onSubmit(input);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm ' +
    'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 ' +
    'disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500 dark:disabled:text-gray-400';

  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {isEdit ? 'Edit Publisher' : 'New Publisher'}
      </h2>

      <div className="space-y-4">
        {/* ID */}
        <div>
          <label htmlFor="pub-id" className={labelClass}>
            ID <span className="text-red-500">*</span>
          </label>
          <input
            id="pub-id"
            type="text"
            required
            disabled={isEdit}
            value={fields.id}
            onChange={set('id')}
            className={inputClass}
            placeholder="e.g. chq-arts"
          />
          {isEdit && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">ID cannot be changed after creation.</p>
          )}
        </div>

        {/* Name */}
        <div>
          <label htmlFor="pub-name" className={labelClass}>
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="pub-name"
            type="text"
            required
            value={fields.name}
            onChange={set('name')}
            className={inputClass}
            placeholder="e.g. Chautauqua Arts"
          />
        </div>

        {/* Contact Email */}
        <div>
          <label htmlFor="pub-email" className={labelClass}>
            Contact Email <span className="text-red-500">*</span>
          </label>
          <input
            id="pub-email"
            type="email"
            required
            value={fields.contactEmail}
            onChange={set('contactEmail')}
            className={inputClass}
            placeholder="contact@example.com"
          />
        </div>

        {/* Source URL */}
        <div>
          <label htmlFor="pub-url" className={labelClass}>
            Source URL <span className="text-red-500">*</span>
          </label>
          <input
            id="pub-url"
            type="url"
            required
            value={fields.sourceUrl}
            onChange={set('sourceUrl')}
            className={inputClass}
            placeholder="https://example.com/events.json"
          />
        </div>

        {/* Source Type */}
        <fieldset>
          <legend className={labelClass}>
            Source Type <span className="text-red-500">*</span>
          </legend>
          <div className="flex gap-4 mt-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="radio"
                name="sourceType"
                value="json"
                checked={fields.sourceType === 'json'}
                onChange={set('sourceType')}
                className="accent-blue-600"
              />
              JSON
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="radio"
                name="sourceType"
                value="html"
                checked={fields.sourceType === 'html'}
                onChange={set('sourceType')}
                className="accent-blue-600"
              />
              HTML
            </label>
          </div>
        </fieldset>

        {/* Trust Level */}
        <div>
          <label htmlFor="pub-trust" className={labelClass}>
            Trust Level
          </label>
          <select
            id="pub-trust"
            value={fields.trustLevel}
            onChange={set('trustLevel')}
            className={inputClass}
          >
            <option value="auto">auto — publish immediately</option>
            <option value="review">review — queue for approval</option>
            <option value="flagged">flagged — blocked</option>
          </select>
        </div>
      </div>

      {submitError && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
