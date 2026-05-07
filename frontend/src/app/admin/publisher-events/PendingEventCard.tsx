import React, { useState } from 'react';
import type { PendingEvent } from '@/lib/adminPublisherApi';

export interface Props {
  event: PendingEvent;
  onApprove: (publisherId: string, eventId: string) => void;
  onReject: (publisherId: string, eventId: string, reason?: string) => void;
  disabled?: boolean;
}

export function PendingEventCard({ event, onApprove, onReject, disabled = false }: Props) {
  const start = new Date(event.payload.startDate).toLocaleString();
  const end = new Date(event.payload.endDate).toLocaleString();
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  function handleRejectClick() {
    if (!disabled) setRejecting(true);
  }

  function handleCancel() {
    setRejecting(false);
    setRejectReason('');
  }

  function handleConfirmReject() {
    if (!disabled) {
      onReject(event.publisherId, event.eventId, rejectReason);
      setRejecting(false);
      setRejectReason('');
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {event.payload.title}
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {start} &ndash; {end}
            {event.payload.category ? ` · ${event.payload.category}` : ''}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            via {event.payload.sourcePublisherName}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => !disabled && onApprove(event.publisherId, event.eventId)}
            disabled={disabled}
            className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve
          </button>
          {!rejecting ? (
            <button
              onClick={handleRejectClick}
              disabled={disabled}
              className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reject
            </button>
          ) : null}
        </div>
      </div>

      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={rejectReason}
            onInput={(e) => setRejectReason((e.currentTarget as HTMLTextAreaElement).value)}
            placeholder="Why was this rejected? (optional, will be shown to the publisher)"
            className="w-full text-sm border rounded p-2 dark:bg-gray-800 dark:border-gray-600"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleConfirmReject}
              disabled={disabled}
              className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm reject
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
