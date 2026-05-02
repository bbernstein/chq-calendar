import React from 'react';
import type { PendingEvent } from '@/lib/adminPublisherApi';

export interface Props {
  event: PendingEvent;
  onApprove: (publisherId: string, eventId: string) => void;
  onReject: (publisherId: string, eventId: string) => void;
  disabled?: boolean;
}

export function PendingEventCard({ event, onApprove, onReject, disabled = false }: Props) {
  const start = new Date(event.payload.startDate).toLocaleString();
  const end = new Date(event.payload.endDate).toLocaleString();

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
          <button
            onClick={() => !disabled && onReject(event.publisherId, event.eventId)}
            disabled={disabled}
            className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
