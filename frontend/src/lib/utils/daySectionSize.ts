/**
 * How tall a day section probably is, before the browser has laid it out.
 *
 * **These are estimates and nothing enforces them.** They feed
 * `contain-intrinsic-size`, which is what the browser uses for the scrollbar
 * and for the geometry of sections it has skipped under
 * `content-visibility: auto`. Being wrong costs accuracy in the scrollbar and
 * a little document-height churn as real sizes replace estimates — it does
 * NOT cost navigation accuracy, because `useDayAnchor.scrollToDay` scrolls by
 * a *relative* delta read from the target's own rect, which forces that
 * element's real layout. (Measured on the phase 4 spike: jumps to the day at
 * 25%, 50% and 75% of the year each landed at the sticky offset to the pixel,
 * with 0px of drift, while the document shrank ~600px as estimates were
 * replaced. Never compute an absolute scroll offset by summing these.)
 *
 * Measured at 390pt in August 2026 against the live feed. `verify-full-list.mjs`
 * check "intrinsic size is in the right order of magnitude" is what notices if
 * the card design drifts far from them.
 */
export const DAY_HEADER_ESTIMATE_PX = 44;
export const EVENT_CARD_ESTIMATE_PX = 92;

export function estimatedDaySectionHeight(eventCount: number): number {
  const n = Number.isFinite(eventCount) && eventCount > 0 ? Math.floor(eventCount) : 0;
  return DAY_HEADER_ESTIMATE_PX + n * EVENT_CARD_ESTIMATE_PX;
}
