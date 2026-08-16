import { describe, it, expect } from 'vitest';
import type { EventListProps } from '@/components/calendar/EventList';

const noop = () => {};
const viewProps = {
  groupedEvents: [],
  dateFilter: 'all',
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
};

/**
 * `EventListProps` is a discriminated union on `navV2`: the compiler, not a
 * runtime fallback, is what enforces "`navV2: true` requires `resetKey`".
 * There is nothing to assert at runtime — a component call that violated
 * this contract would never reach a `render()` call, it would fail
 * `tsc`/`npm run type-check` first. The `@ts-expect-error` below is the pin:
 * if the union ever regresses to making `resetKey` optional (e.g. a future
 * edit reintroducing `resetKey ?? ''`), this line stops compiling and the
 * missing `@ts-expect-error` fails `npm run type-check`.
 */
describe('EventListProps contract', () => {
  it('requires resetKey when navV2 is true (compile-time only)', () => {
    // @ts-expect-error navV2: true requires resetKey — see EventList.tsx.
    const missingResetKey: EventListProps = { ...viewProps, navV2: true };
    expect(missingResetKey.navV2).toBe(true);
  });

  it('does not require resetKey when navV2 is false or absent', () => {
    const legacyOff: EventListProps = { ...viewProps };
    const legacyExplicitFalse: EventListProps = { ...viewProps, navV2: false };
    const windowed: EventListProps = { ...viewProps, navV2: true, resetKey: 'k1' };

    expect(legacyOff.navV2).toBeUndefined();
    expect(legacyExplicitFalse.navV2).toBe(false);
    expect(windowed.resetKey).toBe('k1');
  });
});
