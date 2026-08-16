import type { DayKey, NavigableBounds, ViewWindow } from '@/lib/utils/dayWindow';

export interface RailTargetInput {
  target: DayKey;
  window: Pick<ViewWindow, 'startDay' | 'endDay'> | null;
  bounds: NavigableBounds;
}

export interface RailTarget {
  expandStart: DayKey | null;
  expandEnd: DayKey | null;
  scrollTo: DayKey;
}

/**
 * What tapping a rail chip does: D1, expressed once.
 *
 * *Take me to that day.* If it is already in the loaded window this is a
 * scroll and nothing more; if it lies past an edge, that edge grows to
 * include it and then we scroll. The window only ever grows — the scope
 * button you started from is what shrinks it back — so "widen or move" never
 * arises.
 *
 * Returns `null` for a target outside the navigable bounds. The reducer
 * would clamp such a value anyway, but clamping would move the window to an
 * edge and then scroll to a day that is not there; refusing is honest.
 *
 * Also returns `null` when the scope matches nothing at all (off-season
 * `'this-week'`, reachable from a persisted localStorage value). Expansion
 * cannot rescue that case: `viewWindow` returns `null` from `baseWindow`
 * before it ever reads the expansion inputs, so a plan that expanded both
 * edges to the target would widen nothing, mount nothing, and leave the
 * pending scroll waiting on a day that can never appear. Refusing the tap is
 * the same honesty the out-of-bounds branch above applies.
 */
export function railTarget(o: RailTargetInput): RailTarget | null {
  if (o.target < o.bounds.startDay || o.target > o.bounds.endDay) return null;
  if (!o.window) return null;
  return {
    expandStart: o.target < o.window.startDay ? o.target : null,
    expandEnd: o.target > o.window.endDay ? o.target : null,
    scrollTo: o.target,
  };
}

/**
 * Whether a pending scroll target should be abandoned rather than waited for.
 *
 * A pending target that is never cleared survives every later commit and
 * hijacks one of them — scrolling the reader to a day they tapped under a
 * different scope, minutes ago. Two cases end the wait:
 *
 * - **No window at all.** The scope matches nothing, so no day can mount;
 *   there is nothing to wait for. (`railTarget` refuses such a tap in the
 *   first place, so this covers the target set under one scope and left
 *   pending when the scope changed to a null-window one.)
 * - **The window already covers the target.** The expansion has landed and
 *   the day still has no section, which means it has no matching events —
 *   an ordinary empty day, not a commit still in flight.
 *
 * Anything else is an expansion that has not landed yet: keep waiting, the
 * next commit will have it.
 */
export function shouldAbandonScroll(
  target: DayKey,
  window: Pick<ViewWindow, 'startDay' | 'endDay'> | null
): boolean {
  if (!window) return true;
  return target >= window.startDay && target <= window.endDay;
}

/**
 * The nearest day with events on either side of `anchor`.
 *
 * `eventDays` is every day that has an event under the current *non-date*
 * filters, sorted — so a step always lands somewhere that will actually
 * render. A raw `addDays(anchor, ±1)` cannot: with ★ Favourites on, or any
 * search or venue filter that leaves gaps, the adjacent calendar day usually
 * has no matches, so no section mounts, the pending scroll gives up, and the
 * anchor — which is derived from scroll position — never moves. Pressing
 * again recomputes the identical dead target. That is the initiative's own
 * wall rebuilt inside the control meant to escape it.
 *
 * The chevrons stay "named for the adjacent day"; the adjacent day simply
 * becomes the one that can actually be reached, which is what an accessible
 * label should have meant all along.
 */
export function stepTargets(
  anchor: DayKey | null,
  eventDays: DayKey[]
): { prevDay: DayKey | null; nextDay: DayKey | null } {
  if (!anchor) return { prevDay: null, nextDay: null };
  let prevDay: DayKey | null = null;
  let nextDay: DayKey | null = null;
  // Sorted, so the last key below the anchor wins (the walk keeps overwriting
  // prevDay) and the first key above it wins (guarded by the null check).
  // Same shape as `navigationTargets`, which applies the identical rule to a
  // window's edges rather than to a single day.
  for (const key of eventDays) {
    if (key < anchor) prevDay = key;
    else if (key > anchor && nextDay === null) nextDay = key;
  }
  return { prevDay, nextDay };
}

/**
 * Today's key, but only when it is somewhere navigation can actually reach.
 *
 * `railTarget` refuses a target outside the navigable bounds, and off-season
 * today is outside them for roughly ten months of the year — so an unclamped
 * `todayKey` renders a `⟳ Now` button that is visible, enabled, and does
 * nothing when pressed. Returning `null` removes the button instead, which is
 * the treatment the rail already gives an archived year.
 */
export function reachableTodayKey(
  today: DayKey | null,
  bounds: NavigableBounds
): DayKey | null {
  if (!today) return null;
  return today >= bounds.startDay && today <= bounds.endDay ? today : null;
}
