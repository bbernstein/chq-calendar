import { describe, it, expect } from 'vitest';
import {
  RENDER_BATCH_EVENTS,
  renderEndIndex,
  extendRenderEndIndex,
  renderResetKey,
} from '@/lib/utils/renderWindow';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

/** A day group with `count` placeholder events. */
function group(key: string, count: number): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`, title: `${key}-${i}`, startDate: `${key}T12:00:00`,
  } as Event));
  return { key, baseLabel: key, weekNumbers: [], events };
}

describe('renderEndIndex', () => {
  it('walks forward from the top until it has at least a batch of events', () => {
    const groups = [group('d1', 20), group('d2', 20), group('d3', 20), group('d4', 20)];
    // 20 + 20 = 40 < 50, 20 + 20 + 20 = 60 >= 50 → index 2.
    expect(renderEndIndex(groups, null)).toBe(2);
  });

  it('stops at the first day when that day alone fills the batch', () => {
    expect(renderEndIndex([group('d1', 80), group('d2', 10)], null)).toBe(0);
  });

  it('renders everything when the whole window is smaller than a batch', () => {
    expect(renderEndIndex([group('d1', 3), group('d2', 4)], null)).toBe(1);
  });

  it('returns -1 for no groups', () => {
    expect(renderEndIndex([], null)).toBe(-1);
    expect(renderEndIndex([], 'd1')).toBe(-1);
  });

  it('honours a remembered last key instead of re-running the initial fill', () => {
    const groups = [group('d1', 20), group('d2', 20), group('d3', 20), group('d4', 20)];
    expect(renderEndIndex(groups, 'd1')).toBe(0);
    expect(renderEndIndex(groups, 'd4')).toBe(3);
  });

  it('keeps the same tail rendered after earlier days are prepended', () => {
    // This is the whole reason the render window is anchored on a key and
    // not on an index: a prepend shifts every index by one, and an
    // index-based window would silently drop the last rendered day.
    const before = [group('d3', 20), group('d4', 20)];
    const after = [group('d1', 20), group('d2', 20), ...before];
    expect(renderEndIndex(before, 'd4')).toBe(1);
    expect(renderEndIndex(after, 'd4')).toBe(3);
  });

  it('falls back to the initial fill when the remembered key is gone', () => {
    const groups = [group('d1', 20), group('d2', 20), group('d3', 20)];
    expect(renderEndIndex(groups, 'vanished')).toBe(2);
  });

  it('takes a custom batch size', () => {
    const groups = [group('d1', 5), group('d2', 5), group('d3', 5)];
    expect(renderEndIndex(groups, null, 6)).toBe(1);
  });

  it('defaults its batch size to RENDER_BATCH_EVENTS', () => {
    expect(RENDER_BATCH_EVENTS).toBe(50);
    const groups = [group('d1', 49), group('d2', 1), group('d3', 1)];
    expect(renderEndIndex(groups, null)).toBe(1);
  });
});

describe('extendRenderEndIndex', () => {
  it('adds whole days until it has added at least a batch of events', () => {
    // Counts *added*, not counts total: 20 then 20 + 40 = 60 >= 50, so the
    // step lands on index 2 and day four stays unmounted.
    const groups = [group('d1', 60), group('d2', 20), group('d3', 40), group('d4', 20)];
    expect(extendRenderEndIndex(groups, 0)).toBe(2);
  });

  it('stops at the last group', () => {
    const groups = [group('d1', 60), group('d2', 1)];
    expect(extendRenderEndIndex(groups, 0)).toBe(1);
  });

  it('is a no-op when already at the end', () => {
    const groups = [group('d1', 60)];
    expect(extendRenderEndIndex(groups, 0)).toBe(0);
    expect(extendRenderEndIndex([], -1)).toBe(-1);
  });

  it('always adds at least one day, even when that day is huge', () => {
    const groups = [group('d1', 10), group('d2', 500)];
    expect(extendRenderEndIndex(groups, 0)).toBe(1);
  });
});

describe('renderResetKey', () => {
  const base = {
    searchTerm: 'organ', selectedTags: ['Music'], selectedLocations: ['Amphitheater'],
    showFavoritesOnly: false, favoriteCount: 3, dateFilter: 'next',
    selectedWeeks: [2], year: 2026,
  };

  it('is stable across calls with the same filters', () => {
    expect(renderResetKey(base)).toBe(renderResetKey({ ...base }));
  });

  it('changes when any non-window filter changes', () => {
    const variants = [
      { searchTerm: 'brass' },
      { selectedTags: ['Music', 'Lecture'] },
      { selectedLocations: [] },
      { showFavoritesOnly: true },
      { dateFilter: 'today' },
      { selectedWeeks: [2, 3] },
      { year: 2025 },
    ];
    for (const patch of variants) {
      expect(renderResetKey({ ...base, ...patch })).not.toBe(renderResetKey(base));
    }
  });

  it('ignores the favorite count while favorites-only is off', () => {
    // Starring an event changes nothing about which events are listed, so it
    // must not reset the render window and throw the reader back to the top.
    expect(renderResetKey({ ...base, favoriteCount: 99 })).toBe(renderResetKey(base));
  });

  it('tracks the favorite count while favorites-only is on', () => {
    // Here un-starring genuinely removes an event — possibly the last one of
    // the anchor day — so a reset is the correct response.
    const on = { ...base, showFavoritesOnly: true };
    expect(renderResetKey({ ...on, favoriteCount: 2 })).not.toBe(renderResetKey(on));
  });

  it('does not collide when a comma-joined array is ambiguous with another', () => {
    // A plain `.join(',')` would serialize `['a,b']` and `['a', 'b']`
    // identically, silently suppressing a reset that should have happened.
    expect(renderResetKey({ ...base, selectedTags: ['a,b'] }))
      .not.toBe(renderResetKey({ ...base, selectedTags: ['a', 'b'] }));
  });

  it('ignores window state even when it is handed some', () => {
    // Reaching into the window fields is the single mistake that would make
    // every auto-expand reset scroll position. Assigning to a variable
    // first is deliberate: TypeScript's excess-property check applies to an
    // object literal at the call site, not to a variable, so this compiles
    // while still proving the function ignores what it was not given.
    const withWindow = { ...base, windowStartDay: '2026-07-01', windowEndDay: '2026-07-09' };
    expect(renderResetKey(withWindow)).toBe(renderResetKey(base));
  });
});
