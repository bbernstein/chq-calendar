import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { DayRail } from '@/components/calendar/DayRail';
import { dayChips, dayKeys } from '@/lib/utils/dayWindow';
import { weekBandSegments } from '@/lib/utils/weekBands';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { RAIL_CHIP_GUTTER_PX } from '@/lib/utils/railMetrics';
import { RAIL_CHIP_SELECTOR } from '@/hooks/useRailHighlight';
import { belowHeaderTop } from '@/app/filterHeaderLayout';

const chips = dayChips(
  ['2026-07-04', '2026-07-05', '2026-07-06'],
  new Map([['2026-07-04', 12], ['2026-07-05', 1]]),
);

const defaultBandSegments = weekBandSegments(chips.map(c => c.key), getChautauquaSeasonWeeks(2026));
const defaultWeekDestinations = new Map([
  [1, { dayKey: '2026-07-04', label: 'Go to Week 1, opens Saturday, July 4, 12 events' }],
  [2, { dayKey: '2026-07-05', label: 'Go to Week 2, first events Sunday, July 5, 1 event' }],
]);

// The default fixture puts the anchor on July 5 with July 4 reachable behind
// it and nothing reachable ahead — July 6 has no events, which is exactly the
// day a calendar step used to dead-end on.
function renderRail(overrides: Partial<Parameters<typeof DayRail>[0]> = {}) {
  const props = {
    chips, anchorDay: '2026-07-05',
    todayKey: '2026-07-05',
    windowDayKeys: ['2026-07-04', '2026-07-05', '2026-07-06'],
    bandSegments: defaultBandSegments, weekDestinations: defaultWeekDestinations, onSelectWeek: vi.fn(),
    seasonWeeks: getChautauquaSeasonWeeks(2026),
    onSelectDay: vi.fn(), onGoToToday: vi.fn(),
    ...overrides,
  };
  render(<DayRail {...props} />);
  return props;
}

/** As `renderRail`, but returning the container for the layer queries below. */
function renderRailIn(overrides: Partial<Parameters<typeof DayRail>[0]> = {}) {
  return render(
    <DayRail
      chips={chips} anchorDay="2026-07-05"
      todayKey="2026-07-05"
      windowDayKeys={['2026-07-04', '2026-07-05', '2026-07-06']}
      bandSegments={defaultBandSegments} weekDestinations={defaultWeekDestinations} onSelectWeek={vi.fn()}
      seasonWeeks={getChautauquaSeasonWeeks(2026)}
      onSelectDay={vi.fn()} onGoToToday={vi.fn()}
      {...overrides}
    />
  );
}

// The day chip that carries `key`. Queried by `data-chip` rather than by
// accessible name: it is the stable selector both this file and the rail's
// own keyboard walk (`RAIL_CHIP_SELECTOR`) use, and it is unambiguous even
// when two chips would otherwise share an accessible-name prefix.
function chipButton(key: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-chip="${key}"]`)!;
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
    renderRail({ anchorDay: null });
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

  it('offers ⟳ Now while the anchor is not today', () => {
    const { onGoToToday } = renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-05' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(onGoToToday).toHaveBeenCalled();
  });

  // The narrow-phone rail: the word "Now" becomes an icon-only glyph,
  // matching the week chooser and the Filters funnel — rendering text made
  // this the rail's one non-square control (~60px against 44px for every
  // other control), which is what left a 375pt phone with barely two chips
  // of strip (docs/plans/2026-08-25-narrow-phone-day-rail.md). The
  // accessible name does not change: the glyph is `aria-hidden`, so this
  // explicit `aria-label` is what a screen reader announces — the same
  // contract `FiltersIcon` and `WeekChooserIcon` follow — and `title` gives
  // a sighted mouse user the same words `WeekChooser`'s own trigger does.
  it('renders today as a miniature day chip, keeping its accessible name', () => {
    renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-05' });
    const button = screen.getByRole('button', { name: 'Go to today' });
    expect(button.getAttribute('title')).toBe('Go to today');
    expect(button.className).toContain('min-w-11');
    // The chip is the button's only content, and it is hidden from assistive
    // tech — an unhidden chip would risk the accessible name computed above
    // being the bare date rather than the explicit label.
    const chip = button.querySelector('[data-today-chip]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent?.trim()).toBe(chip!.textContent?.trim());
    expect(button.textContent).not.toMatch(/now/i);
    // The chip carries TODAY'S DATE, not a symbol. An earlier pass shipped a
    // bare `⟳` here, which is the refresh/reload glyph — it read as "reload
    // the page" and a reader reported it as meaningless. Asserting the date
    // is what stops a symbol from creeping back in: no glyph can satisfy it.
    expect(chip!.textContent?.trim()).toBe('5');
    expect(button.textContent).not.toMatch(/⟳|↻|⭯|🔄/u);
  });

  it("drops a date's leading zero rather than showing 05", () => {
    // Sliced out of the `yyyy-mm-dd` key, so the raw characters are "05".
    renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-05' });
    expect(document.querySelector('[data-today-chip]')!.textContent?.trim()).toBe('5');
  });

  it('shows a two-digit date in full', () => {
    renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-26' });
    expect(document.querySelector('[data-today-chip]')!.textContent?.trim()).toBe('26');
  });

  it('reads the date off the day key rather than through the browser clock', () => {
    // A day key is already resolved in the Institution's timezone (#243).
    // Parsing it with `new Date` would re-resolve it in the browser's, which
    // is how "today" becomes yesterday for a reader west of Chautauqua — the
    // exact class of bug #243 removed. `new Date('2026-07-01')` is UTC
    // midnight, which is June 30 in every US timezone.
    renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-01' });
    expect(document.querySelector('[data-today-chip]')!.textContent?.trim()).toBe('1');
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

  // The highlight is painted by duplicating the whole chip row in the
  // highlighted colour and clipping it to the pill. That copy is paint: it
  // must not be announced, must not be reachable, and must not be clickable,
  // or the rail silently doubles every day for a screen-reader or keyboard
  // reader.
  describe('the highlighted copy of the row', () => {
    it('is hidden from assistive technology', () => {
      const { container } = renderRailIn();
      const copy = container.querySelector<HTMLElement>('[data-rail-clip]')!;
      expect(copy.getAttribute('aria-hidden')).toBe('true');
      expect(copy.className).toContain('pointer-events-none');
    });

    it('adds no announced buttons', () => {
      renderRail();
      // Every button the rail exposes, counted outright — deliberately
      // exhaustive, so a stray control (or a leaked copy button) changes this
      // number: 3 day chips + 1 week-band button (the default fixture's sole
      // labelled segment, 2026-07-06 — see the week-band describe block
      // below) + 1 week-chooser trigger (always rendered — the fixture's
      // season has weeks). No chevrons (removed — see
      // docs/plans/2026-08-25-narrow-phone-day-rail.md), no `⟳ Now` (the
      // anchor already is today) and no Filters toggle (no `filtersToggle`
      // prop).
      //
      // Deliberately NOT filtered to `[data-chip]`: the copy's chips carry
      // no `data-chip`, so such a filter would exclude exactly the elements
      // this test exists to catch and could never fail. (The copy's own
      // elements are plain `<div>`s, not buttons — see the regression note
      // below — so unhiding the copy does not change this count; the guard
      // that would catch a reintroduced `<button>` there is the stray-button
      // test just below.)
      expect(screen.getAllByRole('button')).toHaveLength(5);
    });

    it('puts nothing extra in the tab order', () => {
      const { container } = renderRailIn();
      const copy = container.querySelector<HTMLElement>('[data-rail-clip]')!;
      expect(copy.children.length).toBeGreaterThan(0); // it really does render chips
      expect(copy.querySelectorAll('button, a, [tabindex], [contenteditable]')).toHaveLength(0);
    });

    // Regression, caught by `e2e/verify-rail.mjs` and by nothing else. The
    // copy's chips were `<button>` (chosen for box-metric parity) and carry
    // no `data-chip`, which made them match a generic "non-chip button on the
    // rail" selector Playwright used to find the (now-removed) chevrons.
    // Playwright then aimed a chevron click at inert paint and the real chip
    // beneath intercepted it, timing out.
    //
    // Asserted as the selector rather than as "they are divs", because the
    // selector shape is what has to keep working for any future non-chip
    // control on the rail — the e2e suite's other family, `[data-day-rail]
    // [data-chip]`, is covered by the count guard above, and between them
    // they pin both ways the copy could collide with a real control.
    it('contributes no stray button to the rail', () => {
      const { container } = renderRailIn();
      const rail = container.querySelector<HTMLElement>('[data-day-rail]')!;
      // Excludes `[data-week-band-button]` and `[data-week-chooser-trigger]`
      // deliberately: the default fixture has one real band button (see
      // above) and always renders the chooser trigger (see above), and both
      // are genuine controls on the REAL row, not a leak from the clipped
      // copy — this test's whole job is to prove the copy contributes
      // nothing here, so both must be excluded by attribute rather than
      // folded into the count, or a future leak in the copy could hide
      // behind them.
      const nonChipButtons = rail.querySelectorAll(
        'button:not([data-chip]):not([data-week-band-button]):not([data-week-chooser-trigger])');
      // Nothing else in this fixture: no chevrons (removed in #279), no
      // `⟳ Now` (the anchor IS today), and no Filters funnel — that control
      // lives in the site header now (#274 phase 3), not here.
      expect(nonChipButtons).toHaveLength(0);
    });

    it('starts fully clipped, so it cannot flash before the first measurement', () => {
      const { container } = renderRailIn();
      const copy = container.querySelector<HTMLElement>('[data-rail-clip]')!;
      const pill = container.querySelector<HTMLElement>('[data-rail-pill]')!;
      // jsdom runs the layout effect against zero-size rects, so the pill
      // settles at zero width rather than staying at the initial opacity 0 —
      // what matters here is that neither starts painted across the row.
      expect(pill.style.width === '' || pill.style.width === '0px').toBe(true);
      expect(copy.style.clipPath).toMatch(/^inset\(/);
    });
  });

  // The rail renders nothing until the events have loaded, so the
  // highlight's listeners must find the strip when it appears on a later
  // commit rather than on mount.
  //
  // This used to be driven by `scopeHasWindow: false` — an off-season
  // `'this-week'` restored from localStorage, where the rail rendered
  // nothing with `chips` populated the whole time — and that made it
  // discriminating about WHY the hook keys its listener effect on the
  // elements rather than on `chips.length > 0`. #274 phase 4 deleted the
  // scopes, so the only remaining route to a late strip is the chips
  // arriving with it, and this test no longer tells those two keyings apart.
  // The remaining coverage is still real: listeners attached to an element
  // that did not exist at mount.
  it('attaches the highlight to a strip that appears only after the chips arrive', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    try {
      const { container, rerender } = renderRailIn({ chips: [] });
      expect(container.querySelector('[data-rail-strip]')).toBeNull();

      act(() => {
        rerender(
          <DayRail
            chips={chips} anchorDay="2026-07-05"
            todayKey="2026-07-05"
            windowDayKeys={['2026-07-04', '2026-07-05', '2026-07-06']}
            bandSegments={defaultBandSegments} weekDestinations={defaultWeekDestinations} onSelectWeek={vi.fn()}
            seasonWeeks={getChautauquaSeasonWeeks(2026)}
            onSelectDay={vi.fn()} onGoToToday={vi.fn()}
          />
        );
      });

      const strip = container.querySelector<HTMLElement>('[data-rail-strip]')!;
      const writes: number[] = [];
      let value = 0;
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        get: () => value,
        set: (v: number) => { value = v; writes.push(v); },
      });

      act(() => { window.dispatchEvent(new Event('scroll')); });
      expect(writes.length).toBeGreaterThan(0); // the highlight is driving it

      // The reader pans the strip. This is only detectable if the strip's own
      // scroll listener attached to the element that appeared after mount.
      act(() => {
        strip.scrollLeft = 500;
        strip.dispatchEvent(new Event('scroll'));
      });
      writes.length = 0;
      act(() => { window.dispatchEvent(new Event('scroll')); });
      expect(writes).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('listens to nothing while it is rendering nothing', () => {
    // With no strip, every scroll frame would schedule a rAF only for the
    // highlight's `sync` to bail on null refs. The listeners go on when the
    // elements do — see the test above.
    const raf = vi.fn(() => 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    try {
      renderRailIn({ chips: [] });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(raf).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders nothing when there are no days to show', () => {
    const { container } = render(
      <DayRail chips={[]} anchorDay={null} todayKey={null} windowDayKeys={[]}
        bandSegments={[]} weekDestinations={defaultWeekDestinations} onSelectWeek={vi.fn()}
        seasonWeeks={getChautauquaSeasonWeeks(2026)}
        onSelectDay={vi.fn()} onGoToToday={vi.fn()} />
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
  //
  // The trigger moved with the scroll-linked highlight: the strip used to be
  // repositioned by an effect on `anchorDay`, and is now repositioned on
  // scroll, continuously. The property being guarded did not move, so this
  // test drives it the new way rather than being retired — a rail that
  // reached for `scrollIntoView` again would still be the same defect.
  // Geometry lives in `useRailHighlight.test.tsx`, which states it.
  it('keeps the anchor chip in view by moving the strip, never by scrolling the page', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    // The highlight measures inside a rAF, which jsdom defers to a timer, so
    // an unstubbed frame lands after this test's assertions. Returning 0 is
    // required: the hook throttles with `if (frame) return; frame = rAF(...)`
    // and an inline callback clears `frame` before that assignment, so a
    // truthy handle would be written back afterwards and latch the throttle
    // shut. Real rAF assigns before the callback runs and is unaffected.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    try {
      const { container } = render(
        <DayRail chips={chips} anchorDay="2026-07-04" todayKey="2026-07-05" windowDayKeys={['2026-07-04', '2026-07-05', '2026-07-06']}
          bandSegments={defaultBandSegments} weekDestinations={defaultWeekDestinations} onSelectWeek={vi.fn()}
          seasonWeeks={getChautauquaSeasonWeeks(2026)}
          onSelectDay={vi.fn()} onGoToToday={vi.fn()} />
      );
      // Stubbed only after mount: the layout effect that places the initial
      // highlight has already run by the time `render()` returns, so the
      // scroll below is what re-triggers it under observation.
      const strip = container.querySelector<HTMLElement>('[data-rail-strip]')!;
      const scrollLeftWrites: number[] = [];
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        get: () => 0,
        set: (v: number) => { scrollLeftWrites.push(v); },
      });

      act(() => { window.dispatchEvent(new Event('scroll')); });

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(scrollLeftWrites.length).toBeGreaterThan(0);
    } finally {
      Element.prototype.scrollIntoView = original;
      vi.unstubAllGlobals();
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
      <DayRail chips={chips} anchorDay="2026-07-05" todayKey="2026-07-05" windowDayKeys={['2026-07-04', '2026-07-05', '2026-07-06']}
        bandSegments={defaultBandSegments} weekDestinations={defaultWeekDestinations} onSelectWeek={vi.fn()}
        seasonWeeks={getChautauquaSeasonWeeks(2026)}
        onSelectDay={vi.fn()} onGoToToday={vi.fn()}
        rootRef={(el) => { ref.current = el; }} />
    );
    const stickyEl = document.querySelector('[data-day-rail]');
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(stickyEl);
    expect(ref.current?.className).toMatch(/\bsticky\b/);
    // And it sticks at the site header's bottom edge, not at the viewport
    // top. Before #274 phase 3 a sticky wrapper in `page.tsx` supplied that
    // offset and the rail hard-coded `top-0`; the wrapper is gone with the
    // in-flow filter card, so the rail owns its own `top` — and a rail still
    // pinned at `0` slides underneath the revealed header, which outranks it.
    expect(ref.current?.className).not.toMatch(/\btop-0\b/);
    expect(ref.current?.style.top).toBe(belowHeaderTop());
  });
});

describe('DayRail — the Filters toggle is gone (#274 phase 3)', () => {
  // It moved to the site header. The rail's job is navigation and only
  // navigation now: every control left on it moves the reader through the
  // season, and none of them changes what is in the list.
  //
  // Asserted by accessible NAME rather than by counting controls, because a
  // count cannot tell "the funnel came back" from "the rail gained something
  // else" — and the something else is the likelier future edit.
  it('renders no Filters control of its own', () => {
    renderRail();
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull();
  });

  // The rail also stops carrying the funnel's active-filter dot. Nothing on
  // the rail reports filter state any more; that reading moved with the
  // control it belonged to.
  it('renders no active-filter dot', () => {
    renderRail();
    expect(document.querySelector('[data-testid="filters-active-dot"]')).toBeNull();
  });

});

describe('DayRail — the week band', () => {
  it('renders one band cell per chip, inside the rail\'s own root', () => {
    // Inside the root `rootRef` lands on, because `useDayRailHeight` measures
    // only that element: persistent chrome in a sibling widens the stuck
    // header without widening `--day-rail-h`.
    const { container } = renderRailIn();
    const root = container.querySelector('[data-day-rail]')!;
    expect(root.querySelectorAll('[data-band-cell]')).toHaveLength(chips.length);
  });

  it('keeps the chip row findable by the one selector both walkers use', () => {
    // The guard against the failure that would otherwise be silent: chips are
    // grandchildren of the content element now, and a stale `:scope >
    // [data-chip]` matches nothing while every test still passes.
    const { container } = renderRailIn();
    const content = container.querySelector('[data-rail-content]')!;
    expect(content.querySelectorAll(RAIL_CHIP_SELECTOR)).toHaveLength(chips.length);
  });

  it('grows the clipped copy with a band-height spacer, column for column', () => {
    // The copy is positioned on top of the real row and clipped, so a single
    // pixel of difference shows as a seam through the middle of a digit.
    const { container } = renderRailIn();
    const copy = container.querySelector('[data-rail-clip]')!;
    expect(copy.querySelectorAll('[data-rail-column]')).toHaveLength(chips.length);
    expect(copy.querySelectorAll('[data-band-spacer]')).toHaveLength(chips.length);
    // And it is still paint, not controls.
    expect(copy.querySelectorAll('button')).toHaveLength(0);
    expect(copy.querySelectorAll('[data-chip]')).toHaveLength(0);
  });

  it('re-bases the highlight pill below the band', () => {
    const { container } = renderRailIn();
    const pill = container.querySelector<HTMLElement>('[data-rail-pill]')!;
    expect(pill.style.top).toBe('var(--rail-band-h)');
    expect(pill.style.bottom).toBe('0px');
  });

  it('lays both rows out on the shared gutter constant', () => {
    const { container } = renderRailIn();
    for (const row of ['[data-rail-content]', '[data-rail-clip]']) {
      expect(container.querySelector<HTMLElement>(row)!.style.gap)
        .toBe(`${RAIL_CHIP_GUTTER_PX}px`);
    }
  });

  it('makes the anchor\'s own week the band\'s tab stop', () => {
    const { container } = renderRailIn({ anchorDay: '2026-07-05' });
    const stops = Array.from(container.querySelectorAll<HTMLElement>('[data-week-band-button]'))
      .filter(b => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    // 2026-07-05 is a solo week-2 day; 07-04 is the shared Saturday, which
    // lights the LATER of its two weeks — the one the reader is scrolling into.
    expect(stops[0].dataset.weekBandButton).toBe('2');
  });

  it('walks the band row with the arrow keys, not the chip row', () => {
    // The default 3-chip fixture spans one solo week and so carries exactly
    // ONE labelled button — nothing to walk to. This fixture spans Jun 28
    // through Jul 11, which has a labelled day in week 1 and another in week
    // 2.
    const wide = dayChips(dayKeys('2026-06-28', '2026-07-11'), new Map([['2026-06-30', 4]]));
    const { container } = renderRailIn({
      chips: wide,
      bandSegments: weekBandSegments(wide.map(c => c.key), getChautauquaSeasonWeeks(2026)),
      anchorDay: '2026-06-30',
      windowDayKeys: wide.map(c => c.key),
    });
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('[data-week-band-button]'));
    expect(buttons.length).toBeGreaterThan(1);
    buttons[0].focus();
    fireEvent.keyDown(container.querySelector('[data-day-rail]')!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('hands a band tap to onSelectWeek and resumes the strip', () => {
    // In the default fixture the sole labelled segment is 2026-07-06, whose
    // week is 2 — 07-04 is the shared Saturday and carries no label at all.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    // Every rect in this file is zero-size (no layout stub), so the resumed
    // sync's catch-up jump is far past `useRailHighlight`'s tween threshold —
    // it would otherwise animate via the rAF stub above, which never advances
    // real time and spins forever. Reduced motion makes it a single direct
    // write instead, which is all this test needs to observe.
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      const props = renderRail();
      const strip = document.querySelector<HTMLElement>('[data-rail-strip]')!;
      const writes: number[] = [];
      let value = 0;
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        get: () => value,
        set: (v: number) => { value = v; writes.push(v); },
      });

      // The reader pans the strip themselves, which suspends the highlight's
      // own writes — see `useRailHighlight`'s `onStripScroll`.
      act(() => {
        strip.scrollLeft = 500;
        strip.dispatchEvent(new Event('scroll'));
      });
      writes.length = 0;
      act(() => { window.dispatchEvent(new Event('scroll')); });
      expect(writes).toEqual([]); // confirms the pan actually suspended it

      fireEvent.click(document.querySelector('[data-week-band-button="2"]')!);
      expect(props.onSelectWeek).toHaveBeenCalledWith(2);

      // `resume()` re-armed the highlight: a scroll now writes again, where
      // moments ago the identical event was swallowed.
      act(() => { window.dispatchEvent(new Event('scroll')); });
      expect(writes.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the week chooser', () => {
  it('sits on the rail, inside the measured root', () => {
    // Persistent chrome outside this root would widen the stuck header
    // without widening `--day-rail-h`, undercounting the clearance
    // `dayHeaderTop()` and `useDayAnchor` compute against it.
    const { container } = renderRailIn();
    const rail = container.querySelector('[data-day-rail]')!;
    expect(rail.querySelector('[data-week-chooser-trigger]')).not.toBeNull();
  });

  it('lights the week the anchor is in', () => {
    renderRail();
    // July 5 2026 is inside week 2 of the 2026 season (week 1 is Jun 27–Jul 4,
    // week 2 is Jul 4–Jul 11); the chooser and the band's tab stop resolve it
    // through the same `anchorWeekNumber`.
    const lit = Array.from(document.querySelectorAll('[data-week-chooser-cell][data-lit]'));
    expect(lit.map(c => c.getAttribute('data-week-chooser-cell'))).toEqual(['2']);
  });

  it('offers the same weeks the band does, from the same map', () => {
    renderRail();
    fireEvent.click(document.querySelector('[data-week-chooser-trigger]')!);
    // The default fixture reaches weeks 1 and 2 only.
    const enabled = Array.from(document.querySelectorAll('[data-week-cell]'))
      .filter(c => c.getAttribute('aria-disabled') !== 'true')
      .map(c => c.getAttribute('data-week-cell'));
    expect(enabled).toEqual(['1', '2']);
  });

  it("routes a choice through the rail's own onSelectWeek", () => {
    const props = renderRail();
    fireEvent.click(document.querySelector('[data-week-chooser-trigger]')!);
    fireEvent.click(document.querySelector('[data-week-cell="2"]')!);
    expect(props.onSelectWeek).toHaveBeenCalledWith(2);
  });

  it('contributes no stray button to the rail', () => {
    // Same guard as the band button's, by attribute rather than by a bigger
    // count: a count that absorbed the trigger could no longer distinguish
    // "the clipped copy leaked a button" from "the rail gained one".
    const { container } = renderRailIn();
    const rail = container.querySelector<HTMLElement>('[data-day-rail]')!;
    const nonChipButtons = rail.querySelectorAll(
      'button:not([data-chip]):not([data-week-band-button]):not([data-week-chooser-trigger])');
    expect(nonChipButtons).toHaveLength(0);
  });

  it("does not answer to the band's keyboard walk", () => {
    // The trigger is neither a chip nor a band button, so an arrow key on it
    // must fall through rather than teleporting focus into a row it is not in.
    const { container } = renderRailIn();
    const trigger = document.querySelector<HTMLElement>('[data-week-chooser-trigger]')!;
    trigger.focus();
    fireEvent.keyDown(container.querySelector('[data-day-rail]')!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(trigger);
  });
});
