import { useCallback, useEffect, useState } from 'react';
import { daySectionElement } from '@/lib/utils/daySections';

/**
 * How far below the viewport top a day header counts as "the one I'm reading".
 *
 * Read from `--day-rail-h` rather than hardcoded: the rail's height changes
 * with browser text zoom, and a hardcoded offset would put the highlight one
 * day out of step for anyone who zooms — the same reason the sticky offset
 * itself is a custom property.
 */
function stickyOffset(): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The day the reader is currently looking at, and a way to go to another one.
 *
 * Pure view state. The anchor is derived from scroll position, is never
 * persisted, and never participates in filtering — a navigation control that
 * mutated a filter would put the reader back in the walled-garden this whole
 * initiative exists to escape.
 *
 * Driven by a rAF-throttled `scroll` listener rather than an
 * `IntersectionObserver`. "The last section whose top has passed the sticky
 * chrome" is a question about position; IO answers a question about
 * visibility, and reports only *changes* in it. Phase 2 already paid for
 * that distinction once.
 */
export function useDayAnchor(windowDayKeys: string[]): {
  anchorDay: string | null;
  scrollToDay: (key: string) => void;
} {
  const [anchorDay, setAnchorDay] = useState<string | null>(null);

  // Serialized so the effect below re-runs when the *contents* change, not on
  // every render that hands down a new array identity.
  const keysId = windowDayKeys.join(',');

  useEffect(() => {
    if (windowDayKeys.length === 0) { setAnchorDay(null); return; }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const limit = stickyOffset() + 1;
      // Walk forward and keep the last one that has passed the chrome. The
      // first day in the window is the fallback: before any scroll, nothing
      // has passed, and the reader is plainly looking at the top of the list.
      // `windowDayKeys` is the view window's full day list, not the render
      // window's mounted subset — a day this loop reaches may have no
      // section yet, which is exactly what `daySectionElement` returning
      // null below is for.
      let next = windowDayKeys[0];
      for (const key of windowDayKeys) {
        const el = daySectionElement(key);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= limit) next = key;
        else break;
      }
      setAnchorDay(next);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    // Measure once immediately: a prepend or an auto-expand moves content
    // past the reader without producing any scroll event, and an anchor that
    // waited for a gesture would sit on a day that is no longer on screen.
    measure();
    // Passive: this listener must never delay a scroll.
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // NOTE for humans, not a real eslint-disable: this repo has no
    // eslint-plugin-react-hooks, so a literal `eslint-disable-next-line
    // react-hooks/exhaustive-deps` comment here is a hard ESLint 9 error
    // ("Definition for rule ... was not found"), not a silenced warning.
    // The dependency array is intentionally just [keysId] — a serialized
    // form of windowDayKeys — so the effect re-runs when the *contents*
    // change rather than on every render that hands down a new array
    // identity.
  }, [keysId]);

  const scrollToDay = useCallback((key: string) => {
    // `scroll-margin-top` on the section is what keeps the target from
    // landing underneath the sticky rail — see `globals.css`. Doing the
    // offset arithmetic here instead would duplicate a number CSS already
    // owns and get it wrong at any text zoom.
    daySectionElement(key)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  return { anchorDay, scrollToDay };
}
