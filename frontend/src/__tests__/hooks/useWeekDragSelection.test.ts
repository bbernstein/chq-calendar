/// <reference types="vitest/globals" />
import { renderHook, act } from '@testing-library/preact';
import { useState, useCallback } from 'preact/hooks';
import { useWeekDragSelection } from '@/hooks/useScrollState';
import type { DateFilter } from '@/hooks/useFilterState';

function useHarness(initial: { dateFilter: DateFilter; selectedWeeks: number[]; currentWeekNumber: number | null }) {
  const [dateFilter, setDateFilterState] = useState<DateFilter>(initial.dateFilter);
  const [selectedWeeks, setSelectedWeeksState] = useState<number[]>(initial.selectedWeeks);
  const setDateFilter = useCallback((f: DateFilter) => setDateFilterState(f), []);
  const setSelectedWeeks = useCallback((w: number[] | ((prev: number[]) => number[])) => {
    setSelectedWeeksState(prev => (typeof w === 'function' ? w(prev) : w));
  }, []);
  const drag = useWeekDragSelection(initial.currentWeekNumber, dateFilter, setDateFilter, selectedWeeks, setSelectedWeeks);
  return { dateFilter, selectedWeeks, drag };
}

// `handleWeekMouseDown` mutates `document.body.style.userSelect = 'none'` when it
// starts a drag, and `handleWeekMouseUp` (or the global mouseup listener) is what
// resets it. Tests that exercise mouseDown without a matching mouseUp would leak
// that global DOM state into the next test — reset it after every test to keep
// the order-independence guarantee.
afterEach(() => {
  document.body.style.userSelect = '';
});

describe('useWeekDragSelection — handleWeekTap (touchscreen)', () => {
  it('replaces an active "Now" filter with the tapped week', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'next', selectedWeeks: [], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(5);
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([5]);
  });

  it('replaces an active "Today" filter with the tapped week', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'today', selectedWeeks: [], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(3);
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([3]);
  });

  it('replaces an active "This Week" filter with the tapped non-current week', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'this-week', selectedWeeks: [], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(5);
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([5]);
  });

  it('switches to "This Week" when tapping the current week from a clean state', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [], currentWeekNumber: 7 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(7);
    });

    expect(result.current.dateFilter).toBe('this-week');
    expect(result.current.selectedWeeks).toEqual([]);
  });

  it('stays on "This Week" when tapping the current week while already in "this-week" (no toggle off)', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'this-week', selectedWeeks: [], currentWeekNumber: 7 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(7);
    });

    expect(result.current.dateFilter).toBe('this-week');
    expect(result.current.selectedWeeks).toEqual([]);
  });

  it('switches to "This Week" when tapping the current week while "Now" is active', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'next', selectedWeeks: [], currentWeekNumber: 7 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(7);
    });

    expect(result.current.dateFilter).toBe('this-week');
    expect(result.current.selectedWeeks).toEqual([]);
  });

  it('switches to "This Week" when tapping the current week while "Today" is active', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'today', selectedWeeks: [], currentWeekNumber: 7 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(7);
    });

    expect(result.current.dateFilter).toBe('this-week');
    expect(result.current.selectedWeeks).toEqual([]);
  });

  it('multi-selects weeks when no relative filter is active', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [5], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(7);
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([5, 7]);
  });

  it('toggles off a week that is already selected', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [5, 7], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(5);
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([7]);
  });

  it('replaces an active "All Season" filter with the tapped week', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'season', selectedWeeks: [], currentWeekNumber: 3 }),
    );

    act(() => {
      result.current.drag.handleWeekTap(6);
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([6]);
  });
});

function makeMouseEvent(overrides: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) {
  return {
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault: () => {},
    ...overrides,
  } as unknown as React.MouseEvent;
}

describe('useWeekDragSelection — handleWeekMouseDown (desktop)', () => {
  it('clears a relative date filter when clicking a non-current week', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'next', selectedWeeks: [], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(5, makeMouseEvent());
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([5]);
    expect(result.current.drag.isDragging).toBe(true);
  });

  it('preserves "this-week" when clicking the current week with no modifiers', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'this-week', selectedWeeks: [], currentWeekNumber: 7 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(7, makeMouseEvent());
    });

    // mouseDown initialises a drag; the click→this-week conversion happens on mouseUp
    expect(result.current.drag.isDragging).toBe(true);
  });

  it('cmd-click toggles a week in the multi-selection', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [3], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(5, makeMouseEvent({ metaKey: true }));
    });

    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([3, 5]);
    expect(result.current.drag.isDragging).toBe(false);
  });

  it('cmd-click removes a week that is already in the selection', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [3, 5], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(5, makeMouseEvent({ metaKey: true }));
    });

    expect(result.current.selectedWeeks).toEqual([3]);
  });

  it('shift-click extends the selection to a range', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [3], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(6, makeMouseEvent({ shiftKey: true }));
    });

    expect(result.current.selectedWeeks).toEqual([3, 4, 5, 6]);
  });

  it('shift-click also extends downward from the existing range', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [5], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(2, makeMouseEvent({ shiftKey: true }));
    });

    expect(result.current.selectedWeeks).toEqual([2, 3, 4, 5]);
  });

  it('shift-click anchors against the "this-week" current-week marker when no weeks are selected', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'this-week', selectedWeeks: [], currentWeekNumber: 5 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(8, makeMouseEvent({ shiftKey: true }));
    });

    expect(result.current.selectedWeeks).toEqual([5, 6, 7, 8]);
    expect(result.current.dateFilter).toBe('all');
  });
});

describe('useWeekDragSelection — handleWeekMouseEnter (drag)', () => {
  it('extends the selection while dragging across weeks', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(3, makeMouseEvent());
    });
    act(() => {
      result.current.drag.handleWeekMouseEnter(6);
    });

    expect(result.current.selectedWeeks).toEqual([3, 4, 5, 6]);
  });

  it('does nothing when not dragging', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [2], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseEnter(6);
    });

    expect(result.current.selectedWeeks).toEqual([2]);
  });
});

describe('useWeekDragSelection — handleWeekMouseUp', () => {
  it('converts a single click on the current week into "this-week"', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [], currentWeekNumber: 7 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(7, makeMouseEvent());
    });
    act(() => {
      result.current.drag.handleWeekMouseUp(7);
    });

    expect(result.current.dateFilter).toBe('this-week');
    expect(result.current.selectedWeeks).toEqual([]);
    expect(result.current.drag.isDragging).toBe(false);
  });

  it('leaves a dragged range untouched after mouseUp', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'all', selectedWeeks: [], currentWeekNumber: 11 }),
    );

    act(() => {
      result.current.drag.handleWeekMouseDown(3, makeMouseEvent());
    });
    act(() => {
      result.current.drag.handleWeekMouseEnter(6);
    });
    act(() => {
      result.current.drag.handleWeekMouseUp(6);
    });

    expect(result.current.selectedWeeks).toEqual([3, 4, 5, 6]);
    expect(result.current.dateFilter).toBe('all');
  });
});
