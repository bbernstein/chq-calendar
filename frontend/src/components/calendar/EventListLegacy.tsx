import { useState, useEffect, useRef, useMemo } from 'react';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import { EventListView, type EventListViewProps } from './EventListView';

export interface EventListLegacyProps extends Omit<EventListViewProps, 'groups'> {
  groupedEvents: DayGroup[];
  dateFilter: string;
  onShowNextDay?: () => void;
  hasMoreDays?: boolean;
}

const BATCH_SIZE = 50;

/**
 * The pre-phase-2 list: a prefix of N *events*, grown 50 at a time, with a
 * manual "Show next day" button under the `next` scope.
 *
 * Kept intact behind `VITE_NAV_V2` so merging phase 2 changes nothing for
 * anyone. Deleted wholesale when the flag flips in phase 3.
 */
export function EventListLegacy({ groupedEvents, dateFilter, onShowNextDay, hasMoreDays, ...view }: EventListLegacyProps) {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Flatten events for counting, but render by day group
  const totalEvents = useMemo(() => groupedEvents.reduce((sum, g) => sum + g.events.length, 0), [groupedEvents]);

  // Reset visible count when grouped events change (new filter applied)
  useEffect(() => { setVisibleCount(BATCH_SIZE); }, [groupedEvents]);

  // IntersectionObserver to load more when sentinel is visible
  useEffect(() => {
    if (visibleCount >= totalEvents) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(prev => Math.min(prev + BATCH_SIZE, totalEvents));
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, totalEvents]);

  // Slice day groups to only show visibleCount events total
  let remaining = visibleCount;
  const visibleGroups: DayGroup[] = [];
  for (const group of groupedEvents) {
    if (remaining <= 0) break;
    if (group.events.length <= remaining) {
      visibleGroups.push(group);
      remaining -= group.events.length;
    } else {
      visibleGroups.push({ ...group, events: group.events.slice(0, remaining) });
      remaining = 0;
    }
  }

  // Compute next day label for the "Show next day" button
  const nextDayLabel = useMemo(() => {
    if (dateFilter !== 'next' || groupedEvents.length === 0) return '';
    const lastGroup = groupedEvents[groupedEvents.length - 1];
    const lastEvent = lastGroup?.events[lastGroup.events.length - 1];
    if (!lastEvent) return '';
    const lastDate = new Date(lastEvent.startDate);
    lastDate.setDate(lastDate.getDate() + 1);
    return ` (${lastDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })})`;
  }, [dateFilter, groupedEvents]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <EventListView groups={visibleGroups} {...view} />
      {visibleCount < totalEvents && (
        <div ref={sentinelRef} className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
          Loading more events...
        </div>
      )}
      {dateFilter === 'next' && visibleCount >= totalEvents && totalEvents > 0 && hasMoreDays && onShowNextDay && (
          <div className="text-center py-4">
            <button
              type="button"
              onClick={onShowNextDay}
              className="px-4 py-2 text-sm bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
            >
              Show next day{nextDayLabel}
            </button>
          </div>
      )}
    </div>
  );
}
