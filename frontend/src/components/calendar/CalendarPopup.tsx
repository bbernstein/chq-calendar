import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Event } from '@/lib/types';
import { getGoogleCalendarUrl, getOutlookCalendarUrl, getWebcalUrl } from '@/lib/utils/calendarUrls';
import { downloadICS } from '@/lib/utils/icsHelpers';

interface CalendarPopupProps {
  event: Event;
  buttonRect: DOMRect;
  onClose: () => void;
}

export function CalendarPopup({ event, buttonRect, onClose }: CalendarPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const clickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  const stableOnClose = useCallback(onClose, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stableOnClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [stableOnClose]);

  // Close on click outside (setTimeout(0) to avoid instant close from the same click)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
          stableOnClose();
        }
      };
      clickHandlerRef.current = handleClickOutside;
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      if (clickHandlerRef.current) {
        document.removeEventListener('mousedown', clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
    };
  }, [stableOnClose]);

  const webcalUrl = getWebcalUrl(event.id);
  const googleUrl = getGoogleCalendarUrl(event);
  const outlookUrl = getOutlookCalendarUrl(event);

  // Position popup below and aligned to the right edge of the button
  const top = buttonRect.bottom + 4;
  const right = window.innerWidth - buttonRect.right;

  const popup = (
    <div
      ref={popupRef}
      className="fixed z-50 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-2 min-w-[200px]"
      style={{ top: `${top}px`, right: `${right}px` }}
      role="menu"
      aria-label="Add to calendar"
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        Add to calendar
      </div>

      {/* Apple Calendar (.ics) */}
      {webcalUrl ? (
        <a
          href={webcalUrl}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          role="menuitem"
          onClick={stableOnClose}
        >
          <span className="w-5 text-center" aria-hidden="true">🍎</span>
          Apple Calendar
        </a>
      ) : (
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors w-full text-left"
          role="menuitem"
          onClick={() => { downloadICS(event); stableOnClose(); }}
        >
          <span className="w-5 text-center" aria-hidden="true">🍎</span>
          Apple Calendar (.ics)
        </button>
      )}

      {/* Google Calendar */}
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        role="menuitem"
        onClick={stableOnClose}
      >
        <span className="w-5 text-center" aria-hidden="true">📅</span>
        Google Calendar
      </a>

      {/* Outlook */}
      <a
        href={outlookUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        role="menuitem"
        onClick={stableOnClose}
      >
        <span className="w-5 text-center" aria-hidden="true">📧</span>
        Outlook
      </a>
    </div>
  );

  // Render via portal to escape content-visibility containment on .event-card
  return createPortal(popup, document.body);
}
