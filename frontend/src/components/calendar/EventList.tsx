import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { EventListViewProps } from './EventListView';
import { EventListLegacy } from './EventListLegacy';
import { EventListWindowed } from './EventListWindowed';

export interface EventListProps extends Omit<EventListViewProps, 'groups'> {
  groupedEvents: DayGroup[];
  dateFilter: string;
  /** Legacy path only. */
  onShowNextDay?: () => void;
  hasMoreDays?: boolean;
  /**
   * Phase 2's render window, gated on `VITE_NAV_V2`. Off by default, and
   * off means the legacy container below is the only thing that renders.
   */
  navV2?: boolean;
  /** Windowed path only — see EventListWindowed. */
  resetKey?: string;
  earlierDay?: string | null;
  onShowEarlier?: () => void;
  canExpandEnd?: boolean;
  onExpandEnd?: () => void;
}

// Dispatches on `navV2`: the windowed container (day-granular render window,
// auto-expanding forward) when the flag is on, the untouched legacy
// container (event-count slicing, manual "Show next day") when it is off or
// absent. `dateFilter` is destructured out explicitly rather than left in
// `...view` — it is a legacy concept the windowed container's prop type does
// not declare, and a JSX spread carries excess properties through without a
// type error.
export function EventList({
  navV2, resetKey, earlierDay, onShowEarlier, canExpandEnd, onExpandEnd,
  dateFilter, onShowNextDay, hasMoreDays, ...view
}: EventListProps) {
  if (navV2) {
    return (
      <EventListWindowed
        {...view}
        resetKey={resetKey ?? ''}
        earlierDay={earlierDay}
        onShowEarlier={onShowEarlier}
        canExpandEnd={canExpandEnd}
        onExpandEnd={onExpandEnd}
      />
    );
  }
  return (
    <EventListLegacy
      {...view}
      dateFilter={dateFilter}
      onShowNextDay={onShowNextDay}
      hasMoreDays={hasMoreDays}
    />
  );
}
