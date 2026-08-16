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
 *
 * **The caller must hand down a referentially stable `groupedEvents`.** Every
 * growth step is driven by an `IntersectionObserver` that is torn down and
 * recreated when the effect's dependencies change, so that a sentinel still
 * in view fires again immediately and growth continues at the pace the
 * browser reports intersection. A parent that rebuilds the array on every
 * render — same content, new identity — turns that into one growth step per
 * render instead. `page.tsx` memoizes it; anything else that mounts this
 * component must too.
 */
export function EventListWindowed({
  groupedEvents, resetKey, canExpandEnd, onExpandEnd, earlierDay, onShowEarlier, ...view
}: EventListWindowedProps) {
  // Anchored on a day key, never an index: expanding the window backward
  // prepends groups and shifts every index underneath us.
  //
  // The anchor carries the `resetKey` it was set under, and re-anchoring is
  // *derived* rather than synchronised by an effect. An effect runs after the
  // commit, so the render that first sees a filter change would still be
  // matching the previous question's anchor against the new day groups — and
  // whenever that day survives the new filter (a search that narrows event
  // counts but not which days have any events), it resolves to a far later
  // index and paints one frame with many more days mounted than the fresh
  // fill wants. Deriving costs a string comparison and cannot be out of step.
  //
  // A window that merely grew keeps its anchor: that is the same question,
  // and re-anchoring on it would throw the reader back to the top of the list
  // on every auto-expand.
  const [anchor, setAnchor] = useState<{ key: string | null; resetKey: string }>(
    { key: null, resetKey }
  );
  const sentinelRef = useRef<HTMLDivElement>(null);

  // A stale anchor is simply never consulted; the next growth step overwrites
  // it. Nothing has to clear it.
  const anchorKey = anchor.resetKey === resetKey ? anchor.key : null;

  const endIdx = useMemo(
    () => renderEndIndex(groupedEvents, anchorKey),
    [groupedEvents, anchorKey]
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
        // Deliberately NOT gated on the page being scrollable — this step
        // changes no filter and costs one render.
        const nextIdx = extendRenderEndIndex(groupedEvents, endIdx);
        setAnchor({ key: groupedEvents[nextIdx].key, resetKey });
        return;
      }
      // Expensive half: ask the page for another day. Only from a page that
      // can actually scroll — otherwise a short list would widen its own
      // window on mount, before the reader scrolled past anything.
      if (canExpandEnd && onExpandEnd && isPageScrollable()) onExpandEnd();
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [showSentinel, hasMoreLoadedDays, endIdx, groupedEvents, canExpandEnd, onExpandEnd, resetKey]);

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
