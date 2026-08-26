import { useEffect, useRef } from 'react';
import { daySectionElement } from '@/lib/utils/daySections';
import type { DayKey } from '@/lib/utils/dayWindow';

/**
 * Puts the reader in front of `targetDay`, once per year, on load.
 *
 * Guarded on `window.scrollY === 0` as well as on the once-per-year ref: the
 * event feed refreshes in the background, and a refresh that changed
 * `targetDay` while the reader was 40,000px down the list must not teleport
 * them back to today.
 *
 * The scroll goes through `useDayAnchor.scrollToDay`, which computes a
 * *relative* delta from the target's own rect and then holds it there while
 * the page settles. That is load-bearing under `content-visibility: auto`:
 * sections above the target are sized by estimate until they render, so any
 * absolute offset computed by summing them would land near the day rather
 * than on it. Measured in the spec's addendum.
 */
export function useInitialLanding({ targetDay, year, listMounted, scrollToDay }: {
  targetDay: DayKey | null;
  year: number;
  /**
   * Whether the day list is on screen at all — `!showLanding && !loading &&
   * groupedEvents.length > 0` at the call site.
   *
   * A parameter rather than something this hook infers, and load-bearing:
   * without it the effect's dependencies never change between "the landing is
   * showing" and "the reader pressed Browse this season", so the list would
   * mount at January and stay there. The same gap swallows the first render,
   * where the feed has not arrived yet.
   */
  listMounted: boolean;
  scrollToDay: (key: DayKey) => void;
}): void {
  const landedFor = useRef<number | null>(null);

  useEffect(() => {
    if (landedFor.current === year) return;
    if (!targetDay || !listMounted) return;
    if (window.scrollY > 0) { landedFor.current = year; return; }
    if (!daySectionElement(targetDay)) return;
    landedFor.current = year;
    scrollToDay(targetDay);
  }, [targetDay, year, listMounted, scrollToDay]);
}
