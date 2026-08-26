import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { WeekChooser } from '@/components/calendar/WeekChooser';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import type { WeekBandDestination } from '@/lib/utils/weekBands';

const season = getChautauquaSeasonWeeks(2026);

function destinations(): Map<number, WeekBandDestination> {
  return new Map(season.map(w => [w.number, {
    dayKey: '2026-07-04',
    label: `Go to Week ${w.number}, opens Saturday, July 4, 12 events`,
  }]));
}

function renderChooser(overrides: Partial<Parameters<typeof WeekChooser>[0]> = {}) {
  const props = {
    seasonWeeks: season,
    destinations: destinations(),
    currentWeek: 6 as number | null,
    onSelectWeek: vi.fn(),
    ...overrides,
  };
  const view = render(<WeekChooser {...props} />);
  return { ...view, props };
}

const trigger = () => document.querySelector<HTMLElement>('[data-week-chooser-trigger]')!;
const popover = () => document.querySelector<HTMLElement>('[data-week-chooser-popover]');

describe('WeekChooser', () => {
  it('names itself by position in the season and by what it does', () => {
    renderChooser();
    expect(trigger().getAttribute('aria-label')).toBe('Week 6 of 9, choose a week');
    // The same words for a sighted mouse user, who gets no accessible name.
    expect(trigger().getAttribute('title')).toBe('Week 6 of 9, choose a week');
  });

  it('says only what it does when the reader is in no week', () => {
    renderChooser({ currentWeek: null });
    expect(trigger().getAttribute('aria-label')).toBe('Choose a week');
  });

  it('lights exactly one icon cell, the current week', () => {
    renderChooser();
    const lit = Array.from(document.querySelectorAll('[data-week-chooser-cell][data-lit]'));
    expect(lit.map(c => c.getAttribute('data-week-chooser-cell'))).toEqual(['6']);
  });

  it('lights nothing when no week is current', () => {
    renderChooser({ currentWeek: null });
    expect(document.querySelectorAll('[data-week-chooser-cell][data-lit]')).toHaveLength(0);
  });

  it('draws a miniature of the grid it opens', () => {
    // The icon is a legend, not decoration: same cell count, same row-by-row
    // wrap as the grid it opens. `WeekChooser` and `WeekGrid` each derive their
    // own shape from `weekGridColumns`/`weekGridRows` rather than sharing one
    // computed value, so this compares the two independently-derived shapes
    // rather than just counting nine cells — a count alone would still pass if
    // one side reshaped (say, to 4 columns) and the other did not.
    renderChooser();
    fireEvent.click(trigger());
    const iconRowSizes = Array.from(document.querySelectorAll('[data-week-chooser-icon] > span'))
      .map(row => row.querySelectorAll('[data-week-chooser-cell]').length);
    const gridRowSizes = Array.from(document.querySelectorAll('[data-week-row]'))
      .map(row => row.querySelectorAll('[data-week-cell]').length);
    expect(iconRowSizes.reduce((a, b) => a + b, 0)).toBe(9);
    expect(iconRowSizes).toEqual(gridRowSizes);
  });

  it('opens on click and announces that it did', () => {
    renderChooser();
    expect(popover()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger());
    expect(popover()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('is a dialog with a name of its own', () => {
    renderChooser();
    fireEvent.click(trigger());
    expect(screen.getByRole('dialog', { name: 'Choose a week' })).toBeTruthy();
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('puts focus on the current week when it opens', () => {
    // Two interactions to any week: this is the first, and it must land the
    // keyboard reader somewhere they can walk from.
    renderChooser();
    fireEvent.click(trigger());
    expect(document.activeElement?.getAttribute('data-week-cell')).toBe('6');
  });

  it('closes on Escape and gives focus back to the trigger', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.keyDown(document.querySelector('[data-week-grid]')!, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a second click of the trigger', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(popover()).toBeNull();
  });

  it('closes on a pointer press outside itself', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(popover()).toBeNull();
  });

  it('does not steal focus back to the trigger on an outside press', () => {
    // A press outside is not a request to move focus back into the rail —
    // stealing it from whatever the reader pressed would be worse than
    // leaving it where they put it. This is `setOpen(false)`, not `close()`,
    // and the distinction is invisible to the test above, which only checks
    // that the popover closed.
    renderChooser();
    fireEvent.click(trigger());
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    fireEvent.mouseDown(document.body);
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(trigger());
    outside.remove();
  });

  it('stays open for a press inside the popover', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.querySelector('[data-week-cell="3"]')!);
    expect(popover()).not.toBeNull();
  });

  it('does not close on a press inside a theme popover reached through the grid', () => {
    // `WeekThemePopover` portals to `document.body`, so it sits inside NEITHER
    // `popoverRef` nor `triggerRef` — the outside-press handler below used to
    // treat a press on the theme card as "outside" and tear down the whole
    // chooser (and the theme popover with it) before a click on, say, the
    // "View on chq.org" link could ever land. Right-click mirrors what a real
    // long-press or Shift+F10 would open; see `WeekGrid.test.tsx`'s "leaves
    // Escape to an open theme popover" for the same setup on the keyboard path.
    const themes = {
      6: {
        number: 6, title: 'Water', description: 'All about water.',
        startDate: '2026-08-01', endDate: '2026-08-07',
      },
    };
    renderChooser({ themes });
    fireEvent.click(trigger());
    fireEvent.contextMenu(document.querySelector('[data-week-cell="6"]')!);
    const themeDialog = screen.getByRole('dialog', { name: 'Week 6 theme' });

    fireEvent.mouseDown(themeDialog);

    expect(popover()).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Week 6 theme' })).toBeTruthy();
  });

  it('DOES close from the trigger while a theme popover is open', () => {
    // The deliberate counterpart to the test above, pinned so the asymmetry is
    // a decision rather than an oversight. A press elsewhere on the page and an
    // Escape are both ambiguous — far more likely to mean "close the thing I
    // just opened" than "close everything" — so they defer to the theme
    // popover. A click on the chooser's own trigger is not ambiguous: the
    // reader aimed at the chooser, so it closes and takes the theme popover
    // with it. Without this test, "make the three paths consistent" reads like
    // a tidy-up rather than a behaviour change.
    const themes = {
      6: {
        number: 6, title: 'Water', description: 'All about water.',
        startDate: '2026-08-01', endDate: '2026-08-07',
      },
    };
    renderChooser({ themes });
    fireEvent.click(trigger());
    fireEvent.contextMenu(document.querySelector('[data-week-cell="6"]')!);
    expect(screen.getByRole('dialog', { name: 'Week 6 theme' })).toBeTruthy();

    fireEvent.click(trigger());

    expect(popover()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Week 6 theme' })).toBeNull();
  });

  it('navigates, closes, and returns focus when a week is chosen', () => {
    const { props } = renderChooser();
    fireEvent.click(trigger());
    fireEvent.click(document.querySelector('[data-week-cell="8"]')!);
    expect(props.onSelectWeek).toHaveBeenCalledWith(8);
    expect(popover()).toBeNull();
    // The list is about to scroll a long way. Focus left inside a removed node
    // would be lost to the document body.
    expect(document.activeElement).toBe(trigger());
  });

  it('renders nothing at all for a season with no weeks', () => {
    // Not a disabled trigger: a control that can never open is chrome that
    // costs rail width and means nothing.
    renderChooser({ seasonWeeks: [] });
    expect(document.querySelector('[data-week-chooser-trigger]')).toBeNull();
  });
});
