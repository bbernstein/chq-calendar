import { usePublishedElementHeight } from '@/hooks/usePublishedElementHeight';

const PROPERTY = '--day-rail-h';

const railHeight = (el: HTMLElement) => el.getBoundingClientRect().height;

/**
 * Publishes the rail's measured height as `--day-rail-h` on `:root`.
 *
 * Three unrelated things need this number: the day headers' own sticky
 * `top`, every day section's `scroll-margin-top`, and `useDayAnchor`'s
 * sticky offset. Hardcoding it would put all three one text-zoom step out of
 * true — the gotcha #225 called out by name — so it is measured rather than
 * declared, and re-measured on every resize.
 *
 * See `usePublishedElementHeight` for the mechanism, which the filter card's
 * own measurement shares.
 */
export function useDayRailHeight() {
  return usePublishedElementHeight(PROPERTY, railHeight);
}
