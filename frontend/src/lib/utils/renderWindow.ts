import type { DayGroup } from '@/lib/utils/eventHelpers';

/**
 * How many events one growth step of the render window aims to add.
 *
 * The render window is a *view* concern: which of the day groups the view
 * window already produced are mounted in the DOM. Growing it costs a render
 * and no refilter, which is what makes it the cheap half of the two-step
 * the bottom sentinel performs.
 */
export const RENDER_BATCH_EVENTS = 50;

/** Index of the last group whose events reach `minEvents`, walking from `startIdx`. */
function fillFrom(groups: DayGroup[], startIdx: number, minEvents: number): number {
  let total = 0;
  for (let i = startIdx; i < groups.length; i++) {
    total += groups[i].events.length;
    if (total >= minEvents) return i;
  }
  return groups.length - 1;
}

/**
 * The index of the last day group to render.
 *
 * The render window is anchored on a **day key**, not an index, because
 * expanding the view window backward prepends groups and shifts every index.
 * An index-based window would keep the same numeric bounds over different
 * content and silently unmount the day the reader was looking at.
 *
 * `lastKey === null` (first render, or a filter change) runs the initial
 * fill from the top. A `lastKey` that is no longer present falls back to the
 * same fill — reachable when the anchor day's last event is un-starred while
 * favourites-only is on, which `renderResetKey` deliberately treats as a
 * reset anyway.
 */
export function renderEndIndex(
  groups: DayGroup[],
  lastKey: string | null,
  minEvents: number = RENDER_BATCH_EVENTS
): number {
  if (groups.length === 0) return -1;
  if (lastKey !== null) {
    const idx = groups.findIndex(g => g.key === lastKey);
    if (idx >= 0) return idx;
  }
  return fillFrom(groups, 0, minEvents);
}

/**
 * The render window grown by roughly one batch of events, in whole days.
 *
 * Always advances by at least one day when one is available, so a single
 * day larger than the batch can never stall growth.
 */
export function extendRenderEndIndex(
  groups: DayGroup[],
  fromIdx: number,
  minEvents: number = RENDER_BATCH_EVENTS
): number {
  if (fromIdx + 1 >= groups.length) return fromIdx;
  return fillFrom(groups, fromIdx + 1, minEvents);
}

export interface RenderResetInput {
  searchTerm: string;
  selectedTags: string[];
  selectedLocations: string[];
  showFavoritesOnly: boolean;
  favoriteCount: number;
  dateFilter: string;
  selectedWeeks: number[];
  year: number;
}

/**
 * Identity of the *non-window* filters.
 *
 * `EventList` resets its render window when this changes and only when this
 * changes. The window fields are deliberately absent: a window that merely
 * grew is not a new question, and resetting on it would throw the reader
 * back to the top of the list on every auto-expand — the gotcha the design
 * calls out by name.
 *
 * `favoriteCount` participates only while favourites-only is on, because
 * that is the only mode in which starring changes which events are listed.
 */
export function renderResetKey(o: RenderResetInput): string {
  return [
    o.searchTerm,
    JSON.stringify(o.selectedTags),
    JSON.stringify(o.selectedLocations),
    String(o.showFavoritesOnly),
    o.showFavoritesOnly ? String(o.favoriteCount) : 'off',
    o.dateFilter,
    JSON.stringify(o.selectedWeeks),
    String(o.year),
  ].join('|');
}
