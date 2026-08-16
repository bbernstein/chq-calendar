import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { EventListViewProps } from './EventListView';
import { EventListLegacy } from './EventListLegacy';

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

// The windowed container arrives in the next task; until then the flag
// selects nothing and the legacy path is unconditional. The unused names are
// destructured so they do not reach `rest` and get spread onto a component
// whose props do not declare them. `@typescript-eslint/no-unused-vars` counts
// a destructured parameter as an argument, so this reports six warnings until
// Task 4 gives all six a use — accepted rather than suppressed, because a
// suppression would outlive the reason for it. Frontend lint does not fail on
// warnings; Task 4 must end with `npx eslint src/components/calendar/EventList.tsx`
// clean.
export function EventList({ navV2, resetKey, earlierDay, onShowEarlier, canExpandEnd, onExpandEnd, ...rest }: EventListProps) {
  return <EventListLegacy {...rest} />;
}
