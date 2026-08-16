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
 */
export function railTarget(o: RailTargetInput): RailTarget | null {
  if (o.target < o.bounds.startDay || o.target > o.bounds.endDay) return null;
  if (!o.window) {
    // The scope matches nothing (off-season 'this-week'), so there is no
    // window to compare against — open one on the target itself.
    return { expandStart: o.target, expandEnd: o.target, scrollTo: o.target };
  }
  return {
    expandStart: o.target < o.window.startDay ? o.target : null,
    expandEnd: o.target > o.window.endDay ? o.target : null,
    scrollTo: o.target,
  };
}
