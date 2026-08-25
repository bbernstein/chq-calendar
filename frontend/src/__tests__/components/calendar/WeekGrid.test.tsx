import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { UNREACHABLE_FILL_OPACITY } from '@/lib/utils/railBandPalette';
import type { WeekBandDestination } from '@/lib/utils/weekBands';

const season = getChautauquaSeasonWeeks(2026);

/** Every week reachable except 4 — enough to test both states in one render. */
function destinations(exclude: number[] = [4]): Map<number, WeekBandDestination> {
  const map = new Map<number, WeekBandDestination>();
  for (const week of season) {
    if (exclude.includes(week.number)) continue;
    map.set(week.number, {
      dayKey: `2026-07-0${(week.number % 9) + 1}`,
      label: `Go to Week ${week.number}, opens Saturday, June 27, 84 events`,
    });
  }
  return map;
}

function renderGrid(overrides: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const props = {
    seasonWeeks: season,
    destinations: destinations(),
    currentWeek: 6 as number | null,
    onSelectWeek: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  const view = render(<WeekGrid {...props} />);
  return { ...view, props };
}

const cell = (week: number) => document.querySelector<HTMLElement>(`[data-week-cell="${week}"]`)!;
const cells = () => Array.from(document.querySelectorAll<HTMLElement>('[data-week-cell]'));

describe('WeekGrid', () => {
  it('renders every week of the season, derived from its length', () => {
    renderGrid();
    expect(cells().map(c => c.dataset.weekCell)).toEqual(
      season.map(w => String(w.number)));
  });

  it('lays out three rows of three for a nine-week season', () => {
    const { container } = renderGrid();
    const rows = container.querySelectorAll('[data-week-row]');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelectorAll('[data-week-cell]')).toHaveLength(3);
  });

  it('names a reachable week by its destination, verbatim from the shared map', () => {
    // The SAME string the band's button carries. One source, so the two
    // surfaces cannot describe the same jump differently.
    const { props } = renderGrid();
    expect(cell(6).getAttribute('aria-label'))
      .toBe(props.destinations.get(6)!.label);
  });

  it('states an unreachable week as a fact rather than offering a trip', () => {
    renderGrid();
    expect(cell(4).getAttribute('aria-label')).toBe('Week 4, no events');
    expect(cell(4).getAttribute('aria-disabled')).toBe('true');
  });

  it('does not navigate to an unreachable week', () => {
    const { props } = renderGrid();
    fireEvent.click(cell(4));
    expect(props.onSelectWeek).not.toHaveBeenCalled();
  });

  it('navigates to a reachable week and then dismisses', () => {
    const { props } = renderGrid();
    fireEvent.click(cell(8));
    expect(props.onSelectWeek).toHaveBeenCalledWith(8);
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('marks the current week, and only it', () => {
    renderGrid();
    const current = cells().filter(c => c.getAttribute('aria-current') === 'true');
    expect(current.map(c => c.dataset.weekCell)).toEqual(['6']);
  });

  it('marks nothing when the reader is in no week', () => {
    // Off-season, or a pre/post-season day inside the navigable bounds.
    renderGrid({ currentWeek: null });
    expect(cells().some(c => c.getAttribute('aria-current') === 'true')).toBe(false);
  });

  it("fades an unreachable week's fill and not its numeral", () => {
    // Phase 1's rule. A dimming pass over the whole cell is what took an empty
    // iOS chip's text to a sampled ~3.7:1.
    renderGrid();
    const fill = cell(4).querySelector<HTMLElement>('[data-week-cell-fill]')!;
    expect(fill.style.opacity).toBe(String(UNREACHABLE_FILL_OPACITY));
    const numeral = cell(4).querySelector<HTMLElement>('[data-week-cell-number]')!;
    expect(numeral.style.opacity === '' || numeral.style.opacity === '1').toBe(true);
  });

  it('does not grey a week merely for being in the past', () => {
    // `isWeekInPast` is a filter's opinion. A past week that still holds events
    // is perfectly navigable, and this is a navigation surface.
    renderGrid();
    const fill = cell(1).querySelector<HTMLElement>('[data-week-cell-fill]')!;
    expect(fill.style.opacity).toBe('1');
  });

  it('is one tab stop, starting on the current week', () => {
    renderGrid();
    expect(cells().filter(c => c.tabIndex === 0).map(c => c.dataset.weekCell))
      .toEqual(['6']);
  });

  it('starts on the first cell when no week is current', () => {
    renderGrid({ currentWeek: null });
    expect(cells().filter(c => c.tabIndex === 0).map(c => c.dataset.weekCell))
      .toEqual(['1']);
  });

  it('moves focus a whole row on ArrowDown', () => {
    const { container } = renderGrid();
    cell(6).focus();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell(9));
  });

  it('moves focus one cell on ArrowRight', () => {
    const { container } = renderGrid();
    cell(6).focus();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cell(7));
  });

  it('lets focus land on an unreachable week rather than stalling on it', () => {
    // `aria-disabled`, not `disabled` — the same call the day chips make. A walk
    // that skipped unreachable weeks would make the grid's shape change under
    // the reader as filters change.
    //
    // Rendered starting on week 1 (not the default week 6): `focusIndex` is
    // derived from `currentWeek` at mount, so three ArrowRights from week 6
    // would walk 5->6->7->8 (index), landing on week 9 rather than week 4.
    // Starting on week 1 puts `focusIndex` at 0, and 0->1->2->3 lands on week
    // 4 — the unreachable one, which is the whole point of this test.
    const { container } = renderGrid({ currentWeek: 1 });
    cell(1).focus();
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight']) {
      fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key });
    }
    expect(document.activeElement).toBe(cell(4));
  });

  it('dismisses on Escape', () => {
    const { container, props } = renderGrid();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'Escape' });
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('leaves Escape to an open theme popover', () => {
    // `WeekThemePopover` listens on `document` and stops propagation, but
    // Preact attaches this handler to the element, so it runs FIRST. Without
    // this deference, Escape would close the whole chooser when the reader only
    // meant to close the theme they had just opened.
    const themes = {
      6: {
        number: 6, title: 'Water', description: '', startDate: '2026-08-01',
        endDate: '2026-08-07',
      },
    };
    const { container, props } = renderGrid({ themes });
    fireEvent.contextMenu(cell(6));
    expect(screen.getByRole('dialog', { name: 'Week 6 theme' })).toBeTruthy();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'Escape' });
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it('renders nothing for a season with no weeks', () => {
    const { container } = renderGrid({ seasonWeeks: [] });
    expect(container.querySelector('[data-week-grid]')).toBeNull();
  });
});
