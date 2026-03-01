import type { Event } from '@/lib/types';
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
}

export function EventList({ groupedEvents, expandedDescriptions, onToggleDescription, onToggleTag, isTagSelected }: EventListProps) {
  return (
    <div className="space-y-4 sm:space-y-6">
      {groupedEvents.map((dayGroup) => (
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
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
