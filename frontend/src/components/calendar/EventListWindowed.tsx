import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import { extendRenderEndIndex, renderEndIndex } from '@/lib/utils/renderWindow';
import { EventListView, type EventListViewProps } from './EventListView';

export interface EventListWindowedProps extends Omit<EventListViewProps, 'groups'> {
  // NOTE: `earlierDay` and `onShowEarlier` below are declared now and wired
  // in Task 5. Destructure them in this task even though they are unused, so
  // they never reach the `...view` spread and land on `EventListView`.
  groupedEvents: DayGroup[];
  /** Identity of the non-window filters — see `renderResetKey`. */
  resetKey: string;
  /** True when the page has a later event day to widen the view window to. */
  canExpandEnd?: boolean;
  onExpandEnd?: () => void;
  /** The previous event day, or null at the navigable start. (Task 5) */
  earlierDay?: string | null;
  onShowEarlier?: () => void;
}

/** Whether the document is long enough to scroll at all. */
function isPageScrollable(): boolean {
  return document.documentElement.scrollHeight > window.innerHeight;
}

/**
 * The list under `VITE_NAV_V2`: a day-granular render window over the day
 * groups the view window produced, growing forward on its own.
 *
 * Two windows, deliberately not conflated. The **view** window is data —
 * which days pass the date filter, owned by `useFilterState` and derived by
 * `dayWindow`. The **render** window is DOM — which of those days are
 * mounted, owned here and reset only when the non-window filters change.
 * Growth is one-way: nothing is ever unmounted, because eviction breaks
 * scroll position to solve a problem 1,470 events do not have.
 */
export function EventListWindowed({
  groupedEvents, resetKey, canExpandEnd, onExpandEnd, earlierDay, onShowEarlier, ...view
}: EventListWindowedProps) {
  // Anchored on a day key, never an index: expanding the window backward
  // prepends groups and shifts every index underneath us.
  const [renderLastKey, setRenderLastKey] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Re-anchor on the initial fill whenever the question changes. Keyed on
  // `resetKey` alone: a window that merely grew is the same question, and
  // resetting on it would throw the reader back to the top of the list on
  // every auto-expand.
  // `groupedEvents` is read but deliberately not a dependency — that is the
  // whole point of the reset key, and this repo's ESLint has no
  // react-hooks plugin, so do not add a suppression comment for a rule that
  // is not configured.
  useEffect(() => {
    const idx = renderEndIndex(groupedEvents, null);
    setRenderLastKey(idx >= 0 ? groupedEvents[idx].key : null);
  }, [resetKey]);

  const endIdx = useMemo(
    () => renderEndIndex(groupedEvents, renderLastKey),
    [groupedEvents, renderLastKey]
  );
  const visibleGroups = useMemo(
    () => groupedEvents.slice(0, endIdx + 1),
    [groupedEvents, endIdx]
  );

  const hasMoreLoadedDays = endIdx >= 0 && endIdx + 1 < groupedEvents.length;
  const showSentinel = groupedEvents.length > 0 && (hasMoreLoadedDays || !!canExpandEnd);

  useEffect(() => {
    if (!showSentinel) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      if (hasMoreLoadedDays) {
        // Cheap half: mount more of what the view window already produced.
        const nextIdx = extendRenderEndIndex(groupedEvents, endIdx);
        setRenderLastKey(groupedEvents[nextIdx].key);
        return;
      }
      // Expensive half: ask the page for another day. Only from a page that
      // can actually scroll — otherwise a short list would widen its own
      // window on mount, before the reader scrolled past anything.
      if (canExpandEnd && onExpandEnd && isPageScrollable()) onExpandEnd();
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [showSentinel, hasMoreLoadedDays, endIdx, groupedEvents, canExpandEnd, onExpandEnd]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <EventListView groups={visibleGroups} {...view} />
      {showSentinel && (
        <div
          ref={sentinelRef}
          data-testid="event-list-sentinel"
          className="text-center py-4 text-sm text-gray-500 dark:text-gray-400"
        >
          Loading more events...
        </div>
      )}
    </div>
  );
}
