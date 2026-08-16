import type { DayGroup } from '@/lib/utils/eventHelpers';
import { searchTermsOf } from '@/lib/utils/searchHelpers';

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
 *
 * Returns `JSON.stringify` of the whole tuple rather than a `'|'`-joined
 * string. `searchTerm` is free-form user input; a plain join lets a search
 * term collide with an adjacent JSON-encoded field (e.g. a tag list), which
 * would silently suppress a reset. Serializing the tuple as one JSON value
 * is unambiguous by construction.
 *
 * The search field is derived from `searchTermsOf` — the same tokenization
 * `searchEvents` itself uses — rather than the raw `searchTerm`. That is what
 * makes the key exact rather than merely conservative: every later stage of
 * `searchEvents` is a pure function of those terms, so two raw strings that
 * tokenize alike cannot produce different results. `"Organ"` and `"organ "`
 * therefore share a key (case-insensitive, trailing whitespace splits away to
 * nothing), while `"a\tb"` and `"a b"` do not, because they tokenize
 * differently — one term against two. (Do not extend that into a claim about
 * whitespace generally: `searchEvents` re-splits each term on `/\s+/` for its
 * word-level scoring, so a tab *is* a separator there. Tokenization is what
 * this key needs; it is not the whole of what matches.) The empty term (which
 * `searchEvents` special-cases to mean "no filter, return everything") is
 * encoded as `null` rather than `searchTermsOf('')`'s `[]`, because a
 * whitespace-only term also normalizes to `[]` but means the opposite —
 * `searchEvents` scores every event 0 and returns nothing for it.
 */
export function renderResetKey(o: RenderResetInput): string {
  return JSON.stringify([
    o.searchTerm ? searchTermsOf(o.searchTerm) : null,
    o.selectedTags,
    o.selectedLocations,
    o.showFavoritesOnly,
    o.showFavoritesOnly ? o.favoriteCount : 'off',
    o.dateFilter,
    o.selectedWeeks,
    o.year,
  ]);
}
