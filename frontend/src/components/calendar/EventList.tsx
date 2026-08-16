import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { EventListViewProps } from './EventListView';
import { EventListLegacy } from './EventListLegacy';
import { EventListWindowed } from './EventListWindowed';

interface EventListCommonProps extends Omit<EventListViewProps, 'groups'> {
  groupedEvents: DayGroup[];
  dateFilter: string;
  /** Legacy path only. */
  onShowNextDay?: () => void;
  hasMoreDays?: boolean;
}

interface EventListWindowedDispatchProps {
  /**
   * Phase 2's render window, gated on `VITE_NAV_V2`, is on for this render.
   * `resetKey` is required in this arm — see EventListWindowed — so there is
   * no default to silently fall back to if a caller forgets it.
   */
  navV2: true;
  resetKey: string;
  earlierDay?: string | null;
  onShowEarlier?: () => void;
  canExpandEnd?: boolean;
  onExpandEnd?: () => void;
}

interface EventListLegacyDispatchProps {
  /** Off, or absent — the legacy container is the only thing that renders. */
  navV2?: false;
}

// A discriminated union on `navV2`: the windowed-only props (`resetKey` above
// all) exist only in the arm where `navV2` is `true`. This makes "navV2 on
// without a resetKey" a compile error instead of a silent `resetKey ?? ''`
// that would freeze the render window and never reset it across filter
// changes.
export type EventListProps = EventListCommonProps &
  (EventListWindowedDispatchProps | EventListLegacyDispatchProps);

// Dispatches on `navV2`: the windowed container (day-granular render window,
// auto-expanding forward) when the flag is on, the untouched legacy
// container (event-count slicing, manual "Show next day") when it is off or
// absent. Narrowing on the whole `props` object (rather than destructuring
// the union in the parameter list) is what lets the compiler track which arm
// is active — a destructured parameter would widen `resetKey` back to
// `string | undefined` and lose the guarantee. `dateFilter` is destructured
// out explicitly rather than left in `...view` — it is a legacy concept the
// windowed container's prop type does not declare, and a JSX spread carries
// excess properties through without a type error.
export function EventList(props: EventListProps) {
  if (props.navV2) {
    const { resetKey, earlierDay, onShowEarlier, canExpandEnd, onExpandEnd, ...view } = props;
    return (
      <EventListWindowed
        {...view}
        resetKey={resetKey}
        earlierDay={earlierDay}
        onShowEarlier={onShowEarlier}
        canExpandEnd={canExpandEnd}
        onExpandEnd={onExpandEnd}
      />
    );
  }
  const { dateFilter, onShowNextDay, hasMoreDays, ...view } = props;
  return (
    <EventListLegacy
      {...view}
      dateFilter={dateFilter}
      onShowNextDay={onShowNextDay}
      hasMoreDays={hasMoreDays}
    />
  );
}
