import { describe, expect, it } from 'vitest';
import { railTarget } from '@/app/dayRailNavigation';

describe('railTarget', () => {
  const bounds = { startDay: '2026-06-27', endDay: '2026-08-30' };

  it('expands the start when the target is before the window', () => {
    expect(railTarget({ target: '2026-07-01', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: '2026-07-01', expandEnd: null, scrollTo: '2026-07-01' });
  });

  it('expands the end when the target is after the window', () => {
    expect(railTarget({ target: '2026-07-20', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: null, expandEnd: '2026-07-20', scrollTo: '2026-07-20' });
  });

  // D1: stepping scrolls if it can, and widens only if it must. A target
  // already inside the window is a scroll and nothing else — dispatching an
  // expansion for it would refilter the whole list for no reason and, worse,
  // mark the window "expanded" so the date chip starts naming a range the
  // reader never asked for.
  it('only scrolls when the target is already inside the window', () => {
    expect(railTarget({ target: '2026-07-06', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: null, expandEnd: null, scrollTo: '2026-07-06' });
  });

  it('refuses a target outside the navigable bounds', () => {
    expect(railTarget({ target: '2026-12-25', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toBeNull();
  });

  it('handles a null window by expanding both edges to the target', () => {
    // Reachable for 'this-week' outside the season, where the scope matches
    // nothing at all and there is no window to compare against.
    expect(railTarget({ target: '2026-07-06', window: null, bounds }))
      .toEqual({ expandStart: '2026-07-06', expandEnd: '2026-07-06', scrollTo: '2026-07-06' });
  });
});
