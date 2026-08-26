import { useCallback } from 'react';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import { formatDayLabel } from '@/lib/utils/dayWindow';
import { EventListView, type EventListViewProps } from './EventListView';

export interface EventListProps extends Omit<EventListViewProps, 'groups'> {
  groupedEvents: DayGroup[];
  /** The previous event day, or null at the navigable start. */
  earlierDay?: string | null;
  onShowEarlier?: () => void;
}

/**
 * The event list: every day the view window produced, mounted.
 *
 * There is no longer a second window here. The render window — a day-granular
 * subset of the view window's groups, grown forward by a bottom sentinel —
 * existed because mounting a whole scope at once was assumed to be
 * unaffordable. It was measured instead (#274 phase 4, the spec's addendum):
 * the cost was never the DOM's size but a whole-page re-render per scroll
 * anchor update, which `EventListView`'s memo removes, and
 * `content-visibility: auto` covers the rest. Everything the window needed —
 * the sentinel and its `IntersectionObserver`, `renderEndIndex`,
 * `extendRenderEndIndex`, `renderResetKey`, the anchor latch, the
 * upward-prepend correction, the settle window and its `ResizeObserver`
 * reassert, and `revealDay` — went with it.
 *
 * **Recorded gap, not fixed here**: the deleted upward-prepend correction is
 * NOT replaced by anything. The spec's original claim that `useDayAnchor`'s
 * settle hold "still covers the height change" was wrong — that hold is only
 * ever armed by `scrollToDay`, a prepend arms nothing, and `page.tsx`'s
 * `showEarlier` explicitly `cancelHold()`s it besides. So "Show earlier" now
 * inserts content above the reader with no correction at all — a guaranteed
 * jump on a browser with no scroll anchoring (WebKit). This is deliberately
 * not restored: task 5 deletes `showEarlier`, `expandWindowStart`/
 * `expandWindowEnd` and the view window outright, so nothing is ever
 * inserted above the reader after it and the correction would have no
 * subject to protect. Rebuilding it now would be building something to
 * delete one task later.
 */
export function EventList({ groupedEvents, earlierDay, onShowEarlier, ...view }: EventListProps) {
  const handleShowEarlier = useCallback(() => { onShowEarlier?.(); }, [onShowEarlier]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {earlierDay && onShowEarlier && (
        <div className="text-center py-2">
          <button
            type="button"
            onClick={handleShowEarlier}
            className="px-4 py-2 text-sm bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
          >
            Show earlier ({formatDayLabel(earlierDay)})
          </button>
        </div>
      )}
      <EventListView groups={groupedEvents} {...view} />
    </div>
  );
}
