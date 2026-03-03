import { useState, useEffect, useRef, useMemo } from 'react';
import type { Event } from '@/lib/types';
import { downloadICS } from '@/lib/utils/icsHelpers';
import { EventCard } from './EventCard';

interface DayGroup {
  day: string;
  events: Event[];
}

interface EventListProps {
  groupedEvents: DayGroup[];
  expandedDescriptions: Set<string>;
  onToggleDescription: (eventId: string) => void;
  onToggleTag: (tag: string) => void;
  isTagSelected: (tag: string) => boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (eventId: string) => void;
  dateFilter: string;
  onShowNextDay?: () => void;
  hasMoreDays?: boolean;
}

const BATCH_SIZE = 50;

export function EventList({ groupedEvents, expandedDescriptions, onToggleDescription, onToggleTag, isTagSelected, favoriteIds, onToggleFavorite, dateFilter, onShowNextDay, hasMoreDays }: EventListProps) {
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
  const visibleGroups: Array<{ day: string; events: Event[] }> = [];
  for (const group of groupedEvents) {
    if (remaining <= 0) break;
    if (group.events.length <= remaining) {
      visibleGroups.push(group);
      remaining -= group.events.length;
    } else {
      visibleGroups.push({ day: group.day, events: group.events.slice(0, remaining) });
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
      {visibleGroups.map((dayGroup) => (
        <div key={dayGroup.day}>
          <div className="sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-1 sm:pb-2 mb-2 sm:mb-4">
            <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">{dayGroup.day}</h3>
          </div>
          <div className="space-y-1">
            {dayGroup.events.map((event, index) => (
              <EventCard
                key={event.id}
                event={event}
                index={index}
                isExpanded={expandedDescriptions.has(event.id)}
                onToggleDescription={onToggleDescription}
                onToggleTag={onToggleTag}
                isTagSelected={isTagSelected}
                isFavorite={favoriteIds.has(event.id)}
                onToggleFavorite={onToggleFavorite}
                onDownloadICS={downloadICS}
              />
            ))}
          </div>
        </div>
      ))}
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
