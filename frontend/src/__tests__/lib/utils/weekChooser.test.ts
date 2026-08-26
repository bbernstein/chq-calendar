import { describe, expect, it } from 'vitest';
import {
  moveGridFocus, weekChooserTriggerLabel, weekGridColumns, weekGridRows,
} from '@/lib/utils/weekChooser';

describe('weekGridColumns', () => {
  it('gives a nine-week season three columns', () => {
    // Nine 44px cells in a row is 396px, wider than a 390px phone. Nine in a
    // 3x3 is a 132px square with real touch targets.
    expect(weekGridColumns(9)).toBe(3);
  });

  it('degrades to an odd-shaped grid rather than dropping weeks', () => {
    // Derived, never a literal 9 — a hypothetical non-nine season must still
    // show every week it has.
    expect(weekGridColumns(8)).toBe(3);   // 3 + 3 + 2
    expect(weekGridColumns(10)).toBe(4);  // 4 + 4 + 2
    expect(weekGridColumns(1)).toBe(1);
  });

  it('never returns zero, which would divide the rows by nothing', () => {
    expect(weekGridColumns(0)).toBe(1);
    expect(weekGridColumns(-3)).toBe(1);
  });
});

describe('weekGridRows', () => {
  it('wraps nine weeks into three rows of three, in order', () => {
    expect(weekGridRows([1, 2, 3, 4, 5, 6, 7, 8, 9], 3))
      .toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  });

  it('leaves a short final row short rather than padding it', () => {
    // A padded cell is a control that means nothing; the icon and the grid both
    // render exactly what they are given.
    expect(weekGridRows([1, 2, 3, 4, 5, 6, 7, 8], 3))
      .toEqual([[1, 2, 3], [4, 5, 6], [7, 8]]);
  });

  it('holds every week it was given', () => {
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(weekGridRows(weeks, weekGridColumns(weeks.length)).flat()).toEqual(weeks);
  });

  it('is empty for no weeks', () => {
    expect(weekGridRows([], 3)).toEqual([]);
  });
});

describe('moveGridFocus', () => {
  // A 3x3 of indices:
  //   0 1 2
  //   3 4 5
  //   6 7 8
  const COLS = 3, COUNT = 9;

  it('moves one cell horizontally', () => {
    expect(moveGridFocus(4, 'ArrowRight', COUNT, COLS)).toBe(5);
    expect(moveGridFocus(4, 'ArrowLeft', COUNT, COLS)).toBe(3);
  });

  it('moves a whole row vertically — the thing a 1x9 strip could not do', () => {
    expect(moveGridFocus(4, 'ArrowDown', COUNT, COLS)).toBe(7);
    expect(moveGridFocus(4, 'ArrowUp', COUNT, COLS)).toBe(1);
  });

  it('clamps at every edge instead of wrapping', () => {
    // Clamping matches the rail's own chip walk. Wrapping from week 9 to week 1
    // on one keystroke is a jump across the whole season disguised as a nudge.
    expect(moveGridFocus(8, 'ArrowRight', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(0, 'ArrowLeft', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(1, 'ArrowUp', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(7, 'ArrowDown', COUNT, COLS)).toBeNull();
  });

  it('crosses a row boundary horizontally', () => {
    // Left/Right walk the whole sequence, so a reader who only knows two arrow
    // keys can still reach every week.
    expect(moveGridFocus(2, 'ArrowRight', COUNT, COLS)).toBe(3);
    expect(moveGridFocus(3, 'ArrowLeft', COUNT, COLS)).toBe(2);
  });

  it('jumps to the ends', () => {
    expect(moveGridFocus(4, 'Home', COUNT, COLS)).toBe(0);
    expect(moveGridFocus(4, 'End', COUNT, COLS)).toBe(8);
  });

  it('returns null for a key it does not handle, so the caller does not preventDefault', () => {
    // Escape, Tab and Enter all have to keep working. A walk that swallowed
    // them would trap focus in the grid and break dismissal.
    for (const key of ['Escape', 'Tab', 'Enter', ' ', 'a']) {
      expect(moveGridFocus(4, key, COUNT, COLS), key).toBeNull();
    }
  });

  it('returns null when the move would not move', () => {
    expect(moveGridFocus(0, 'Home', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(8, 'End', COUNT, COLS)).toBeNull();
  });

  it('returns null from an index outside the grid', () => {
    expect(moveGridFocus(-1, 'ArrowRight', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(9, 'ArrowLeft', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(0, 'ArrowRight', 0, COLS)).toBeNull();
  });

  it('walks a short final row without falling off it', () => {
    // Eight weeks: 0 1 2 / 3 4 5 / 6 7. Down from 5 lands on 8, which is not
    // there.
    expect(moveGridFocus(5, 'ArrowDown', 8, 3)).toBeNull();
    expect(moveGridFocus(4, 'ArrowDown', 8, 3)).toBe(7);
  });
});

describe('weekChooserTriggerLabel', () => {
  it('says where you are and what it does', () => {
    expect(weekChooserTriggerLabel(6, 9)).toBe('Week 6 of 9, choose a week');
  });

  it('says only what it does when no week is current', () => {
    // Off-season, or on a pre/post-season day inside the navigable bounds, the
    // anchor is in no week. This mirrors the rail's own convention: a control
    // that cannot mean anything says less rather than something false.
    expect(weekChooserTriggerLabel(null, 9)).toBe('Choose a week');
  });
});
