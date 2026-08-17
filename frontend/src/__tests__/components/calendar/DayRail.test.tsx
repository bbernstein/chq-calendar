import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DayRail } from '@/components/calendar/DayRail';
import { dayChips } from '@/lib/utils/dayWindow';

const chips = dayChips(
  ['2026-07-04', '2026-07-05', '2026-07-06'],
  new Map([['2026-07-04', 12], ['2026-07-05', 1]]),
);

// The default fixture puts the anchor on July 5 with July 4 reachable behind
// it and nothing reachable ahead — July 6 has no events, which is exactly the
// day a calendar step used to dead-end on.
function renderRail(overrides: Partial<Parameters<typeof DayRail>[0]> = {}) {
  const props = {
    chips, anchorDay: '2026-07-05', prevDay: '2026-07-04', nextDay: null as string | null,
    scopeHasWindow: true, todayKey: '2026-07-05',
    onSelectDay: vi.fn(), onStepDay: vi.fn(), onGoToToday: vi.fn(),
    ...overrides,
  };
  render(<DayRail {...props} />);
  return props;
}

// The day chip that carries `key`. Queried by `data-chip` rather than by
// accessible name: once the chevrons are labelled by target too, an
// adjacent-to-anchor day's own chip and the chevron pointing at it share the
// exact same accessible name, so a name-only query is ambiguous by design.
function chipButton(key: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-chip="${key}"]`)!;
}

// A chevron (not a day chip) with the given accessible name. Chevrons carry
// no `data-chip`, which is what distinguishes them from a same-named day
// chip when the chevron's target is adjacent to the anchor.
function chevronNamed(name: string): HTMLElement | undefined {
  return screen.queryAllByRole('button', { name }).find((btn) => !btn.hasAttribute('data-chip'));
}

describe('DayRail', () => {
  // role="group" with an aria-label, NOT role="menu" (a menu of navigation
  // targets is not a menu) and not a bare div with an aria-label (which
  // assistive technology drops). Both lessons are already recorded from
  // PR #228/#219.
  it('is a labelled group, not a menu', () => {
    renderRail();
    const rail = screen.getByRole('group', { name: /days/i });
    expect(rail).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('labels each chip by its target and event count', () => {
    renderRail();
    expect(chipButton('2026-07-04').getAttribute('aria-label')).toBe('Go to Saturday, July 4, 12 events');
    expect(chipButton('2026-07-06').getAttribute('aria-label')).toBe('Monday, July 6, no events');
  });

  // A day with nothing on it is not a destination: tapping it used to widen
  // the window, mount nothing, and leave the reader exactly where they were,
  // while the chip announced "Go to Monday, July 6". It keeps its place on
  // the strip and its focusability — the rail is a calendar, and the arrow
  // walk must not stall — but it is announced and painted as unavailable.
  it('presents a day with no events as unavailable rather than as a destination', () => {
    const { onSelectDay } = renderRail();
    const empty = chipButton('2026-07-06');
    expect(empty.getAttribute('aria-disabled')).toBe('true');
    expect(empty.getAttribute('aria-label')).not.toMatch(/^Go to/);
    fireEvent.click(empty);
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it('leaves a day that has events tappable', () => {
    const { onSelectDay } = renderRail();
    const live = chipButton('2026-07-04');
    expect(live.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(live);
    expect(onSelectDay).toHaveBeenCalledWith('2026-07-04');
  });

  // ~64 chips in a season. Every one being a tab stop between the filter
  // block and the list is what the arrow-key handler exists to replace.
  it('is a single tab stop, with the arrow keys moving within it', () => {
    renderRail();
    expect(chipButton('2026-07-05').getAttribute('tabindex')).toBe('0');
    expect(chipButton('2026-07-04').getAttribute('tabindex')).toBe('-1');
    expect(chipButton('2026-07-06').getAttribute('tabindex')).toBe('-1');
  });

  it('keeps a tab stop on the strip when nothing is anchored yet', () => {
    renderRail({ anchorDay: null, prevDay: null, nextDay: null });
    expect(chipButton('2026-07-04').getAttribute('tabindex')).toBe('0');
  });

  it('marks the anchor day as current', () => {
    renderRail();
    expect(chipButton('2026-07-05').getAttribute('aria-current')).toBe('date');
    expect(chipButton('2026-07-04').getAttribute('aria-current')).toBeNull();
  });

  it('reports the tapped day', () => {
    const { onSelectDay } = renderRail();
    fireEvent.click(chipButton('2026-07-04'));
    expect(onSelectDay).toHaveBeenCalledWith('2026-07-04');
  });

  // Chevrons are labelled by their target, not by direction — same rule as
  // the day chips (see DayRail's accessibility doc comment). The chevrons are
  // found here by their target chip's own label, filtered to exclude the day
  // chip itself via `chevronNamed`.
  it('steps to the reachable day on each side from the chevrons', () => {
    const { onStepDay } = renderRail({ prevDay: '2026-07-04', nextDay: '2026-07-06' });
    fireEvent.click(chevronNamed('Go to Saturday, July 4, 12 events')!);
    expect(onStepDay).toHaveBeenCalledWith(-1);
    fireEvent.click(chevronNamed('Monday, July 6, no events')!);
    expect(onStepDay).toHaveBeenCalledWith(1);
  });

  // Proves the chevron label is derived from the target it was handed, not
  // from a fixed chip: an implementation that always named the chevron after
  // a fixed chip (e.g. always chips[0]) would fail the second half.
  it('names the chevrons after their target, not a fixed direction', () => {
    renderRail({ anchorDay: '2026-07-05', prevDay: '2026-07-04' });
    expect(chevronNamed('Go to Saturday, July 4, 12 events')).toBeTruthy();

    renderRail({ anchorDay: '2026-07-06', prevDay: '2026-07-05' });
    expect(chevronNamed('Go to Sunday, July 5, 1 event')).toBeTruthy();
  });

  // Mirrors the previous-chevron proof above for the *next* chevron: with
  // the anchor on 07-04, the next target (07-05) diverges from a hardcoded
  // last chip (07-06), so this is the position that catches a regression
  // pinning the next chevron to the final chip.
  it('names the next chevron after its target, not the last chip', () => {
    renderRail({ anchorDay: '2026-07-04', prevDay: null, nextDay: '2026-07-05' });
    expect(chevronNamed('Go to Sunday, July 5, 1 event')).toBeTruthy();
  });

  // The chevrons are enabled by REACHABILITY, not by position within the
  // chips. The anchor here sits in the middle of the strip with a chip on
  // either side, so an index-based implementation enables both — but nothing
  // beyond it has events, so both steps would dead-end: no section mounts,
  // the pending scroll gives up, and `anchorDay` never moves, leaving the
  // reader pressing an enabled control that can never do anything.
  it('disables a chevron with no reachable day, even mid-strip', () => {
    renderRail({ anchorDay: '2026-07-05', prevDay: null, nextDay: null });
    expect(screen.getByRole('button', { name: 'Go to the previous day' })
      .hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Go to the next day' })
      .hasAttribute('disabled')).toBe(true);
  });

  it('offers ⟳ Now while the anchor is not today', () => {
    const { onGoToToday } = renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-05' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(onGoToToday).toHaveBeenCalled();
  });

  it('hides ⟳ Now once the anchor is already today', () => {
    renderRail({ anchorDay: '2026-07-05', todayKey: '2026-07-05' });
    expect(screen.queryByRole('button', { name: 'Go to today' })).toBeNull();
  });

  it('hides ⟳ Now entirely on an archived year', () => {
    renderRail({ anchorDay: '2026-07-04', todayKey: null });
    expect(screen.queryByRole('button', { name: 'Go to today' })).toBeNull();
  });

  it('moves focus along the rail with the arrow keys', () => {
    renderRail();
    const first = chipButton('2026-07-04');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 5');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 4');
  });

  it('jumps focus to today with Home', () => {
    renderRail({ todayKey: '2026-07-05' });
    const first = chipButton('2026-07-04');
    first.focus();
    fireEvent.keyDown(first, { key: 'Home' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 5');
  });

  // `todayKey` (`reachableTodayKey` against `navBounds`) and `chips`
  // (`railChips` against the same bounds) are computed independently in
  // `page.tsx`. Today that keeps them in agreement, but nothing enforces it
  // structurally — should a future change ever let them drift, a `todayKey`
  // absent from the rendered chips must not silently swallow the keypress.
  it('falls back to the first chip on Home when todayKey is not among the rendered chips', () => {
    renderRail({ todayKey: '2026-07-09' });
    const last = chipButton('2026-07-06');
    last.focus();
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 4');
  });

  // Off-season `'this-week'` restored from localStorage resolves to no view
  // window at all, and `railTarget` refuses every tap in that state. The chips
  // would otherwise render enabled and fully labelled — "Go to Saturday,
  // July 4, 12 events" — over a list that can never move, because the counts
  // come from the non-date-filtered events and so are real regardless of the
  // window. That is the announce-a-destination-and-do-nothing class this
  // branch removed from three other controls.
  it('renders nothing when the scope resolves to no window at all', () => {
    const { container } = render(
      <DayRail chips={chips} anchorDay={null} prevDay={null} nextDay={null}
        scopeHasWindow={false} todayKey={null}
        onSelectDay={vi.fn()} onStepDay={vi.fn()} onGoToToday={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there are no days to show', () => {
    const { container } = render(
      <DayRail chips={[]} anchorDay={null} prevDay={null} nextDay={null} scopeHasWindow todayKey={null}
        onSelectDay={vi.fn()} onStepDay={vi.fn()} onGoToToday={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  // Defect 2 (browser-verified, see task-10 report): `chip.scrollIntoView({
  // block: 'nearest', ... })` minimises vertical movement but does not
  // forbid it — with the rail scrolled off-screen, that call dragged the
  // whole page back into view. jsdom computes no real layout, so this cannot
  // assert the resulting geometry; it asserts the MECHANISM instead —
  // `scrollIntoView` is never called, and the strip's own `scrollLeft` is
  // written, which is the only kind of scroll this control is allowed to
  // cause.
  it('keeps the anchor chip in view by moving the strip, never by scrolling the page', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender } = render(
        <DayRail chips={chips} anchorDay="2026-07-04" prevDay={null} nextDay="2026-07-05" scopeHasWindow todayKey="2026-07-05"
          onSelectDay={vi.fn()} onStepDay={vi.fn()} onGoToToday={vi.fn()} />
      );
      // Stubbed only after mount: the effect that centres the *initial*
      // anchor has already run by the time `render()` returns, so the
      // rerender below is what re-triggers it under observation.
      const strip = chipButton('2026-07-04').parentElement as HTMLElement;
      const scrollLeftWrites: number[] = [];
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        get: () => 0,
        set: (v: number) => { scrollLeftWrites.push(v); },
      });

      rerender(
        <DayRail chips={chips} anchorDay="2026-07-06" prevDay="2026-07-05" nextDay={null} scopeHasWindow todayKey="2026-07-05"
          onSelectDay={vi.fn()} onStepDay={vi.fn()} onGoToToday={vi.fn()} />
      );

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(scrollLeftWrites.length).toBeGreaterThan(0);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  // Defect 1 (browser-verified, see task-10 report): a wrapper `<div>`
  // around the rail becomes the containing block `position: sticky` is
  // bounded by, sized to fit only the rail — giving sticky zero travel.
  // jsdom implements no layout, so stickiness itself cannot be asserted
  // here; this instead pins the *structural* invariant whose violation
  // caused it — `rootRef` must land on the very element that carries
  // `data-day-rail` and the sticky class, with nothing wrapping it.
  it('gives rootRef the same element that is data-day-rail and sticky — no wrapper', () => {
    const ref: { current: HTMLElement | null } = { current: null };
    render(
      <DayRail chips={chips} anchorDay="2026-07-05" prevDay="2026-07-04" nextDay={null} scopeHasWindow todayKey="2026-07-05"
        onSelectDay={vi.fn()} onStepDay={vi.fn()} onGoToToday={vi.fn()}
        rootRef={(el) => { ref.current = el; }} />
    );
    const stickyEl = document.querySelector('[data-day-rail]');
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(stickyEl);
    expect(ref.current?.className).toMatch(/\bsticky\b/);
  });
});

describe('DayRail filtersToggle', () => {
  // Deliberately rendered inside DayRail's own row rather than as a sibling
  // element: `useDayRailHeight` measures only DayRail's root, so any new
  // *persistent* chrome added outside that row (visible whenever the reader
  // has scrolled, not just while the panel is open) would silently widen
  // the real stuck header without widening `--day-rail-h`.
  it('renders nothing when not visible', () => {
    renderRail({
      filtersToggle: { open: false, onToggle: vi.fn(), panelId: 'filters-panel', visible: false },
    });
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull();
  });

  it('renders, with aria-expanded/aria-controls, once visible', () => {
    renderRail({
      filtersToggle: { open: false, onToggle: vi.fn(), panelId: 'filters-panel', visible: true },
    });
    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('filters-panel');
  });

  it('tracks aria-expanded when the panel is open', () => {
    renderRail({
      filtersToggle: { open: true, onToggle: vi.fn(), panelId: 'filters-panel', visible: true },
    });
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    renderRail({
      filtersToggle: { open: false, onToggle, panelId: 'filters-panel', visible: true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is absent entirely when no filtersToggle prop is supplied', () => {
    renderRail();
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull();
  });
});
