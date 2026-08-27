import type { DayKey, NavigableBounds } from '@/lib/utils/dayWindow';

/**
 * What tapping a rail chip does: D1, expressed once.
 *
 * *Take me to that day.* Every day of the year is mounted (#274 phase 4
 * deleted both the view window and the render window), so a chip tap is a
 * scroll and nothing else — there is no edge to grow and no commit to wait
 * for. What is left is a bounds check.
 *
 * Returns `null` for a target outside the navigable bounds: such a day has no
 * section and never will, and a control that reports success while scrolling
 * nowhere is the defect this refusal exists to avoid. The two other `null`
 * cases this used to have — an unexpandable scope, and a plan that widened a
 * window — went with the window itself.
 */
export function railTarget(target: DayKey, bounds: NavigableBounds): DayKey | null {
  if (target < bounds.startDay || target > bounds.endDay) return null;
  return target;
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
