import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/preact';
import { EventList } from '@/components/calendar/EventList';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function group(key: string, count: number): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    title: `Event ${key}-${i}`,
    startDate: new Date(`${key}T12:00:00`).toISOString(),
    endDate: new Date(`${key}T13:00:00`).toISOString(),
  } as Event));
  return { key, baseLabel: `Day ${key}`, weekNumbers: [], events };
}

function makeGroups(keys: string[]): DayGroup[] {
  return keys.map(k => group(k, 1));
}

const noop = () => {};
const baseProps = {
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
  resetKey: 'k1',
};

/**
 * Whether the reader has scrolled — jsdom starts every test at `scrollY 0`,
 * so this is the thing the expensive-expansion guard actually checks, not a
 * geometry proxy for it. `document.documentElement.scrollHeight` and
 * `window.innerHeight` both read 0 in jsdom regardless, which is exactly why
 * a guard built on them can pass for a reason that has nothing to do with
 * scrolling.
 */
function setReaderScrolled(scrolled: boolean) {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    writable: true,
    value: scrolled ? 500 : 0,
  });
}

describe('EventList', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => {
    io = installIntersectionObserverMock();
    setReaderScrolled(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders whole days, filling to at least one batch of events', () => {
    const groups = [group('2026-07-05', 20), group('2026-07-06', 20), group('2026-07-07', 20), group('2026-07-08', 20)];
    render(<EventList {...baseProps} groupedEvents={groups} />);

    // 20 + 20 + 20 = 60 >= 50 → three whole days, never a partial one.
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-07-19')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-08')).not.toBeInTheDocument();
  });

  it('never splits a day across the render edge', () => {
    const groups = [group('2026-07-05', 80), group('2026-07-06', 5)];
    render(<EventList {...baseProps} groupedEvents={groups} />);
    expect(screen.getByText('Event 2026-07-05-79')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('extends the render window by whole days when the sentinel intersects', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20), group('2026-07-07', 40)];
    render(<EventList {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
  });

  it('does not call onExpandEnd while loaded days remain', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('asks the page to expand the view window once the loaded days run out', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 10)];
    render(<EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(onExpandEnd).toHaveBeenCalledTimes(1);
  });

  it('renders no sentinel when there is nothing left in either window', () => {
    const groups = [group('2026-07-05', 10)];
    const { container } = render(
      <EventList {...baseProps} groupedEvents={groups} canExpandEnd={false} />
    );
    expect(container.querySelector('[data-testid="event-list-sentinel"]')).toBeNull();
  });

  it('labels the sentinel "Loading more events..." only while a cheap step can actually mount something', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { container } = render(
      <EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />
    );
    // day2 is loaded but not yet rendered — the cheap branch has something
    // to do the moment the sentinel intersects, so the label is honest.
    expect(screen.getByText('Loading more events...')).toBeInTheDocument();
    // The labelled sentinel is not the 1px empty one — it has real content
    // and padding to show it, so it never needs the intersection-target
    // insurance the empty branch below does.
    const sentinel = container.querySelector('[data-testid="event-list-sentinel"]');
    expect(sentinel?.className).not.toMatch(/\bh-px\b/);
  });

  it('renders a 1px, aria-hidden sentinel with no text while the expensive step is blocked', () => {
    // canExpandEnd is true but nothing loaded remains AND the reader has not
    // scrolled — the sentinel must stay mounted (it's what detects the
    // scroll when it comes), but "Loading more events..." would be a lie:
    // nothing is loading, and won't until the reader scrolls. A permanent,
    // unresolving "loading" message reads as broken, not as blocked.
    //
    // It still needs a real, non-zero-area intersection target: a browser
    // pass confirmed a zero-height sentinel fires in Chrome, but Safari and
    // Firefox were never checked, so `h-px` removes the doubt for a single
    // pixel of vertical space rather than relying on the spec's zero-area
    // guarantee holding in every engine.
    setReaderScrolled(false);
    const groups = [group('2026-07-05', 3)];
    const { container } = render(
      <EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />
    );
    expect(screen.queryByText('Loading more events...')).not.toBeInTheDocument();
    const sentinel = container.querySelector('[data-testid="event-list-sentinel"]');
    expect(sentinel).not.toBeNull();
    expect(sentinel).toHaveAttribute('aria-hidden', 'true');
    expect(sentinel?.textContent).toBe('');
    expect(sentinel?.className).not.toMatch(/py-4/);
    expect(sentinel?.className).toMatch(/\bh-px\b/);
  });

  it('does not auto-expand before the reader has scrolled', () => {
    // A reader who has not scrolled yet has not looked past anything.
    // Auto-expanding here would silently turn a three-event "Today" into
    // "Today and tomorrow" before the reader touched a thing.
    setReaderScrolled(false);
    const onExpandEnd = vi.fn();
    render(<EventList {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('still mounts more loaded days before the reader has scrolled', () => {
    // The scrolled-reader guard belongs to the expensive step only. Without
    // this case, an implementation that wrapped BOTH steps in the guard would
    // pass every other test in this file, because they all start with a
    // scrolled reader — and the list would refuse to grow into days it had
    // already loaded whenever the reader hadn't scrolled yet.
    setReaderScrolled(false);
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventList {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('expands once the reader scrolls, even when the sentinel was already intersecting at mount', () => {
    // The hole: IntersectionObserver only reports CHANGES in intersection.
    // A list barely taller than the viewport has its sentinel inside the
    // 200px rootMargin from the very first render — already intersecting
    // before the reader has done anything. The one callback that fires gets
    // refused (the reader hasn't scrolled), and because the sentinel never
    // leaves and re-enters the intersection root, no second callback ever
    // arrives — scrolling further within that short list does nothing,
    // forever. `readerHasScrolled()` alone can't fix this: it's a function,
    // not something the observer effect can depend on. Growth requires the
    // observer to be torn down and recreated the moment "has the reader
    // scrolled" flips, so a still-intersecting sentinel gets re-reported.
    //
    // Note on what actually discriminates here: `io.trigger()` re-invokes
    // whatever the CURRENT live observer's callback closure is, and that
    // callback reads `window.scrollY` fresh on every call — so a naive
    // "set scrollY, trigger again, expect onExpandEnd" version of this test
    // passes even against the OLD, un-fixed code, because the callback
    // was never wrong about what it computed, only about whether it was
    // ever invoked again by a real browser. The assertion that actually
    // proves the fix is that a NEW observer gets created in response to the
    // scroll — `totalCreated` incrementing with no `io.trigger()` involved
    // — since dispatching a bare `scroll` event is exactly what a real
    // reader scrolling does, and the old code has no scroll listener at
    // all, so nothing would happen to it.
    setReaderScrolled(false);
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 3)];
    render(<EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);
    const createdBeforeScroll = io.totalCreated;

    io.trigger();
    expect(onExpandEnd).not.toHaveBeenCalled();

    // The reader scrolls. No manual re-trigger yet: a new observer must be
    // created by the scroll alone, exactly as a real browser's `observe()`
    // would re-report a still-intersecting sentinel on its own.
    setReaderScrolled(true);
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(io.totalCreated).toBeGreaterThan(createdBeforeScroll);

    // Complete the loop: the mock doesn't auto-fire on `observe()` the way
    // a real IntersectionObserver does, so an explicit trigger stands in for
    // that immediate re-report against the observer the scroll just created.
    io.trigger();
    expect(onExpandEnd).toHaveBeenCalledTimes(1);
  });

  it('does not auto-expand a freshly-filtered short list just because the reader scrolled under a previous scope', () => {
    // `hasScrolled` is a session-lifetime latch: `EventList` is
    // never remounted and never keyed by `resetKey`, so once it flips true
    // under ANY scope it stays true for the rest of the session. If the
    // expansion decision read `hasScrolled` instead of live scroll position,
    // this sequence would silently widen a just-applied filter's window
    // before the reader had looked at any of it: browse a scope, scroll at
    // all (latching `hasScrolled`), then apply a narrow filter short enough
    // that its sentinel is already intersecting at mount. The reader is back
    // at the top of a brand new list — nothing about THIS list has been
    // scrolled — but the stale latch from the PREVIOUS scope would still
    // read true. The expansion decision must read live scroll position, not
    // the latch, so it correctly refuses here even though `hasScrolled` is
    // (correctly, for its own job) still true.
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />
    );

    // The reader scrolls under this first scope — latches hasScrolled.
    setReaderScrolled(true);
    act(() => { window.dispatchEvent(new Event('scroll')); });

    // A filter change: new resetKey, short result set, reader back at the
    // top (a filter change resets scroll — this is the state the reader is
    // actually in, regardless of what the latch remembers).
    setReaderScrolled(false);
    const shortFilteredGroups = [group('2026-07-10', 3)];
    rerender(
      <EventList {...baseProps} resetKey="k2" groupedEvents={shortFilteredGroups}
        canExpandEnd onExpandEnd={onExpandEnd} />
    );

    io.trigger();

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('tears down and recreates the observer across two consecutive growth cycles, alternating cheap and expensive', () => {
    // Every other test in this file fires io.trigger() exactly once, so the
    // tear-down/recreate-so-a-still-intersecting-sentinel-refires mechanism
    // — the engine of the whole feature — is never exercised twice. This
    // walks it through cheap growth, then the expensive step, then cheap
    // growth again once the page responds by widening groupedEvents, and
    // checks the observer is actually recreated at each dependency change
    // rather than reused stale.
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />
    );
    // Initial fill: day1 alone (60) already clears the batch, so only day1
    // is mounted and day2 is still "loaded but not rendered" — the cheap
    // branch has somewhere to go. The shared beforeEach starts the reader
    // already scrolled, so mount itself contributes one extra
    // teardown/recreate (hasScrolled flips false → true in the same effect
    // flush) — track counts relative to that baseline rather than an
    // absolute "1", which is the correct thing to assert either way: this
    // test is about recreation happening at each dependency change, not
    // about how many of those changes mounting itself causes.
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
    const createdAtMount = io.totalCreated;

    // Cycle 1: cheap. Mounts day2, which is everything currently loaded, so
    // the sentinel's meaning flips to "ask for more" and its dependencies
    // change — the observer must be torn down and recreated for the next
    // trigger to reach the still-intersecting sentinel at all.
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(onExpandEnd).not.toHaveBeenCalled();
    expect(io.totalCreated).toBe(createdAtMount + 1);
    expect(io.liveCount).toBe(1);

    // Cycle 2: expensive. Nothing loaded remains, so this asks the page to
    // widen the view window instead of mounting anything.
    io.trigger();
    expect(onExpandEnd).toHaveBeenCalledTimes(1);

    // The page responds to onExpandEnd by widening groupedEvents (what
    // page.tsx does for real) — a new day is now loaded but not rendered.
    const widened = [...groups, group('2026-07-07', 20)];
    rerender(<EventList {...baseProps} groupedEvents={widened} canExpandEnd onExpandEnd={onExpandEnd} />);
    expect(screen.queryByText('Day 2026-07-07')).not.toBeInTheDocument();

    // Cycle 3: cheap again. The alternation is cheap → expensive → cheap,
    // not stuck on one branch or on a disconnected observer.
    io.trigger();
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
    expect(onExpandEnd).toHaveBeenCalledTimes(1);
  });

  it('does not jump back to a stale deep anchor when a vanished day reappears', () => {
    // A background events refresh can drop the anchor day without any
    // filter change (same resetKey) — renderEndIndex's own fallback
    // handles that fine for the render it happens on. What it can't fix by
    // itself is what happens if that same day key reappears in a LATER
    // refresh: if the anchor is only latched to null (never to "the key is
    // missing"), the stale anchor stays exactly the vanished day's key
    // forever, and the moment that key is valid again, `renderEndIndex`
    // finds it directly and jumps the render window straight back to the
    // deep position — with no scroll, no growth trigger, nothing the
    // reader did. Latching on "missing", not just "null", fixes the anchor
    // to the fallback day as soon as the original vanishes, so a later
    // reappearance of the old key doesn't resurrect it.
    const groups = [
      group('2026-07-05', 60), group('2026-07-06', 5),
      group('2026-07-07', 5), group('2026-07-08', 40),
    ];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} />);
    io.trigger(); // cheap growth: anchors on day 07-08, mounting everything
    expect(screen.getByText('Day 2026-07-08')).toBeInTheDocument();

    // Background refresh: the current anchor day (07-08) vanishes. Same
    // resetKey — this is not a filter change.
    const withoutAnchorDay = [group('2026-07-05', 60), group('2026-07-06', 5), group('2026-07-07', 5)];
    rerender(<EventList {...baseProps} groupedEvents={withoutAnchorDay} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    // Background refresh: the day reappears under the same key, e.g. a
    // transient sync blip resolves. Still the same resetKey, still no
    // growth trigger, still nothing the reader did.
    const anchorDayReturns = [
      group('2026-07-05', 60), group('2026-07-06', 5),
      group('2026-07-07', 5), group('2026-07-08', 40),
    ];
    rerender(<EventList {...baseProps} groupedEvents={anchorDayReturns} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-08')).not.toBeInTheDocument();
  });

  it('re-anchors on a filter change even when the day groups are rebuilt', () => {
    // The existing reset test reuses the same array reference, so it cannot
    // tell a derived anchor from an effect-synchronised one. Neither can this
    // one, in the end: `rerender` runs inside `act`, which flushes effects
    // before returning, so the extra frame an effect would paint is invisible
    // here. What this DOES pin is that re-anchoring survives the realistic
    // shape of a filter change — a brand-new array whose surviving day keys
    // overlap the old anchor — which is the state that makes the effect
    // version misbehave in a browser.
    //
    // The frame itself is verified in the browser pass, not here.
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    const rebuilt = [group('2026-07-05', 60), group('2026-07-06', 20)];
    rerender(<EventList {...baseProps} resetKey="k2" groupedEvents={rebuilt} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('ignores a non-intersecting report', () => {
    const onExpandEnd = vi.fn();
    render(<EventList {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger(false);

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('keeps the rendered days when the window grows at the end', () => {
    const groups = [group('2026-07-05', 60)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />);
    const grown = [...groups, group('2026-07-06', 20)];

    rerender(<EventList {...baseProps} groupedEvents={grown} canExpandEnd onExpandEnd={noop} />);

    // The appended day is not mounted until the sentinel asks for it, and
    // the day already on screen is untouched — no reset, no jump.
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('keeps the rendered tail when earlier days are prepended before any growth', () => {
    // The sibling test below triggers a growth step first, which sets the
    // anchor as a side effect — so it cannot catch an anchor that is still
    // null when the prepend lands. That is the ordinary case: pressing
    // "Show earlier" is a perfectly normal first action, and with a null
    // anchor the initial fill re-runs over the prepended array and unmounts
    // days that were already on screen.
    const groups = [group('2026-07-05', 30), group('2026-07-06', 30), group('2026-07-07', 30)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} />);
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventList {...baseProps} groupedEvents={[group('2026-07-03', 30), ...groups]} />);

    expect(screen.getByText('Day 2026-07-03')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('keeps the rendered tail when earlier days are prepended', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventList {...baseProps} groupedEvents={[group('2026-07-03', 10), ...groups]} />);

    expect(screen.getByText('Day 2026-07-03')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('resets the render window when the non-window filters change', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventList {...baseProps} resetKey="k2" groupedEvents={groups} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('renders nothing for no groups and asks for no expansion', () => {
    const onExpandEnd = vi.fn();
    const { container } = render(
      <EventList {...baseProps} groupedEvents={[]} canExpandEnd onExpandEnd={onExpandEnd} />
    );
    expect(container.querySelectorAll('.event-card')).toHaveLength(0);
    expect(onExpandEnd).not.toHaveBeenCalled();
  });
});

describe('EventList — showing earlier days', () => {
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // No binding: none of these tests drive intersection. The mock is still
    // installed because the component constructs an observer whenever a
    // sentinel renders, and jsdom provides no constructor to construct.
    installIntersectionObserverMock();
    // Same reasoning as above, for the settle window's ResizeObserver: it is
    // constructed on every successful prepend correction, whether or not a
    // given test ever triggers a resize.
    installResizeObserverMock();
    scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error — restoring the prototype method jsdom shipped.
    delete HTMLElement.prototype.getBoundingClientRect;
  });

  /**
   * Layout is simulated: jsdom measures nothing, so the test controls each
   * mounted day section's `top` directly, keyed by its day-key attribute
   * rather than by DOM node identity — whether Preact reuses the same node
   * across a rerender is an implementation detail these tests don't need to
   * know about.
   */
  function stubDayTops() {
    const tops: Record<string, number> = {};
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        const key = this.getAttribute(DAY_SECTION_ATTR);
        return { top: key !== null ? (tops[key] ?? 0) : 0 } as DOMRect;
      },
    });
    return (key: string, top: number) => { tops[key] = top; };
  }

  it('offers the earlier control only when there is an earlier day', () => {
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByRole('button', { name: /Show earlier/ })).not.toBeInTheDocument();

    rerender(<EventList {...baseProps} groupedEvents={groups} earlierDay="2026-07-03" onShowEarlier={noop} />);
    expect(screen.getByRole('button', { name: /Show earlier/ })).toBeInTheDocument();
  });

  it('names the day it will show, never just "earlier"', () => {
    render(
      <EventList {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    // The visible text is the accessible name — no aria-label duplicating
    // (and drifting from) it. WCAG 2.5.3 Label in Name: a speech-input user
    // reading the screen must be able to say what they see.
    const button = screen.getByRole('button', { name: 'Show earlier (Friday, Jul 3)' });
    expect(button).toHaveTextContent('Show earlier (Friday, Jul 3)');
    expect(button).not.toHaveAttribute('aria-label');
  });

  it('calls onShowEarlier when clicked', () => {
    const onShowEarlier = vi.fn();
    render(
      <EventList {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={onShowEarlier} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();
    expect(onShowEarlier).toHaveBeenCalledTimes(1);
  });

  it('restores scroll position across the prepend', () => {
    const setDayTop = stubDayTops();
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    setDayTop('2026-07-05', 400);
    screen.getByRole('button', { name: /Show earlier/ }).click();

    // The page prepends a day: the reference section is now 600px further down.
    setDayTop('2026-07-05', 1000);
    rerender(
      <EventList {...baseProps} groupedEvents={[group('2026-07-03', 8), ...groups]}
        earlierDay="2026-07-02" onShowEarlier={noop} />
    );

    expect(scrollBy).toHaveBeenCalledWith(0, 600);
  });

  it('does not touch scroll position on an ordinary re-render', () => {
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    rerender(
      <EventList {...baseProps} groupedEvents={[...groups, group('2026-07-06', 5)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('corrects scroll only once per click', () => {
    const setDayTop = stubDayTops();
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    setDayTop('2026-07-05', 400);
    screen.getByRole('button', { name: /Show earlier/ }).click();

    setDayTop('2026-07-05', 1000);
    const prepended = [group('2026-07-03', 8), ...groups];
    rerender(<EventList {...baseProps} groupedEvents={prepended} earlierDay="2026-07-02" onShowEarlier={noop} />);

    // A second, unrelated re-render must not re-trigger the correction — the
    // pending ref was already consumed by the layout effect above.
    setDayTop('2026-07-05', 1400);
    rerender(<EventList {...baseProps} groupedEvents={[...prepended, group('2026-07-06', 5)]} earlierDay="2026-07-02" onShowEarlier={noop} />);

    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('forgets a pending correction when the filters change under it', () => {
    const setDayTop = stubDayTops();
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    setDayTop('2026-07-05', 400);
    screen.getByRole('button', { name: /Show earlier/ }).click();

    // The reference day (2026-07-05) is still present and has genuinely
    // moved — the same shape the correction is meant to react to — but
    // resetKey changed too: a filter change, not a prepend. Without the
    // resetKey guard this would still scroll, on a real, nonzero delta.
    setDayTop('2026-07-05', 1000);
    rerender(
      <EventList {...baseProps} resetKey="k2" groupedEvents={groups}
        earlierDay={null} />
    );

    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('upward prepend scroll correction', () => {
  /**
   * Drives the one thing jsdom can express about this: that the correction
   * is computed from a day section's own rect, not from document height.
   * Layout is faked by handing each mounted section a fixed height and
   * deriving `top` from the number of sections above it — so a prepend
   * genuinely moves the reference section down, exactly as a browser would.
   */
  function stubLayout(sectionHeight: number) {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        const sections = Array.from(document.querySelectorAll(`[${DAY_SECTION_ATTR}]`));
        const idx = sections.indexOf(this);
        const top = idx < 0 ? 0 : idx * sectionHeight - window.scrollY;
        return { top, bottom: top + sectionHeight, height: sectionHeight } as DOMRect;
      },
    });
  }

  beforeEach(() => {
    // Installed unconditionally, like the IntersectionObserver mocks
    // elsewhere in this file: the settle window constructs a
    // ResizeObserver on every successful prepend correction, whether or
    // not a given test ever triggers a resize. Tests that need to fire it
    // install their own via `installResizeObserverMock()`, which simply
    // replaces this stub before render.
    installResizeObserverMock();
    // `stubLayout`'s `top` is relative to `window.scrollY`, and individual
    // tests below set it (some to a nonzero constant, one partway through
    // to simulate a real `scrollBy` call). Resetting it here, rather than
    // relying on each test to clean up after itself, is what stops one
    // test's `scrollY` from leaking into the next — a delta between two
    // measurements at the same `scrollY` cancels it out, so most tests here
    // never noticed, but a test that changes `scrollY` mid-run does.
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  afterEach(() => {
    // @ts-expect-error — restoring the prototype method jsdom shipped.
    delete HTMLElement.prototype.getBoundingClientRect;
    vi.unstubAllGlobals();
  });

  it('scrolls by how far the reference day moved, not by the document delta', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    Object.defineProperty(window, 'scrollY', { value: 250, writable: true, configurable: true });

    const initial = makeGroups(['2026-07-02', '2026-07-03']);
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={initial} resetKey="k"
        earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );

    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));

    // The page prepends one day: the reference section (2026-07-02) is now
    // 100px further down than it was.
    rerender(
      <EventList {...baseProps}
        groupedEvents={makeGroups(['2026-07-01', '2026-07-02', '2026-07-03'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );

    expect(scrollBy).toHaveBeenCalledWith(0, 100);
  });

  it('does not correct when a filter change landed between the click and the prepend', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));

    // The reference day (2026-07-02) is still present and has genuinely
    // moved — a day was prepended ahead of it, same shape as a real
    // prepend — but resetKey changed too: a filter change, not a prepend.
    // Without the resetKey guard this would still scroll, on a real,
    // nonzero delta (2026-07-02 moved from index 0 to index 1).
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-08-01', '2026-07-02'])}
        resetKey="DIFFERENT" earlierDay={null} onShowEarlier={() => {}} />
    );

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not correct when the reference day has left the list entirely', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));

    // Same resetKey, but a background refresh dropped the reference day. A
    // correction computed against a missing node would scroll by whatever
    // the fallback rect happens to be — do nothing instead.
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-05'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('re-corrects when the prepended region changes height after the commit', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const resize = installResizeObserverMock();

    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-01', '2026-07-02'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );
    expect(scrollBy).toHaveBeenCalledWith(0, 100);

    // `scrollBy` is a bare spy here, not a real implementation — it never
    // moves `window.scrollY`, so `stubLayout`'s `top` (which subtracts
    // `scrollY`) would otherwise re-report the pre-correction position on
    // every later measurement, no matter what changed. A real `scrollBy`
    // call updates `scrollY`; simulate that by hand so the next measurement
    // reflects a page that has actually been corrected once already.
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true });

    // Content above the reader changes height one frame late — measured at
    // ~104px of growth in the browser. Modelled here as a 60px shrink so the
    // expected correction is signed and unambiguous: the reference day moves
    // UP by 60, so the re-assert scrolls by -60.
    stubLayout(40);
    resize.trigger();

    expect(scrollBy).toHaveBeenLastCalledWith(0, -60);
  });

  it('stops re-correcting once the reader interacts', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const resize = installResizeObserverMock();

    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-01', '2026-07-02'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );
    scrollBy.mockClear();

    // Any deliberate scroll gesture ends the settle window: a correction
    // applied after the reader has taken over fights them for the viewport,
    // which is strictly worse than the drift it would remove.
    fireEvent.wheel(window);
    stubLayout(70);
    resize.trigger();

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not hold a stale settle window through a later filter change', () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const resize = installResizeObserverMock();

    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-01', '2026-07-02'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );
    expect(scrollBy).toHaveBeenCalledWith(0, 100);
    scrollBy.mockClear();

    // A filter change lands next — not a prepend, but the reference day
    // (2026-07-02) survives it anyway, now second rather than first. This
    // commit's `pendingPrependRef` is already null (consumed by the
    // correction above), so the layout effect takes the `!pending` branch —
    // the one a settle window armed by a DIFFERENT commit must not survive.
    // The reference day's own `top` genuinely differs from the held target
    // now (idx 1, not idx 0): a settle window that outlived its commit would
    // "correct" this into a wrong, unrequested scroll.
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-06-15', '2026-07-02'])}
        resetKey="k2" earlierDay={null} onShowEarlier={() => {}} />
    );

    // A settle window scoped to the prepend that armed it leaves nothing
    // alive after a commit that didn't renew it — the effect's own cleanup
    // tears down the old observer either way, but only a correctly-cleared
    // `settleRef` stops a new one from being built on the stale target.
    expect(resize.liveCount).toBe(0);
    // Belt and suspenders: even if something were still live, firing it
    // must not move the reader.
    if (resize.liveCount > 0) resize.trigger();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  // `ResizeObserver` is absent in some older browsers and in jsdom without a
  // stub — which is jsdom's actual, unmocked state here, reached by undoing
  // the `beforeEach` install. Before the guard, a successful prepend
  // correction threw the moment it tried to build a `ResizeObserver`, which
  // would have broken "Show earlier" entirely in such an environment; the
  // fix is to skip only the observer, not the correction itself.
  it('does not throw when ResizeObserver is unavailable', () => {
    stubLayout(100);
    vi.unstubAllGlobals();
    expect(typeof ResizeObserver).toBe('undefined');
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));

    expect(() => rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(['2026-07-01', '2026-07-02'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    )).not.toThrow();
    // The correction itself is unaffected — only the later re-assert (which
    // needs a live observer) is lost.
    expect(scrollBy).toHaveBeenCalledWith(0, 100);
  });
});

describe('revealDay', () => {
  // 5 events/day, not the shared makeGroups' 1: at 1/day, 20 days never
  // reaches the 50-event batch minimum, so fillFrom falls through to
  // "render everything" and day 20 would already be mounted before
  // revealDay is even in play. At 5/day the batch fills by day 10, leaving
  // day 20 in groupedEvents but genuinely un-rendered — the state these
  // tests need to exist.
  function makeGroups(keys: string[]): DayGroup[] {
    return keys.map(k => group(k, 5));
  }

  // Constructed whenever the render window has more to grow into, same as
  // the top describe block above — jsdom has no IntersectionObserver.
  beforeEach(() => { installIntersectionObserverMock(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('mounts through to a day past the render window', () => {
    const keys = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const { container, rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" />
    );
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).toBeNull();

    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-07-20" />
    );
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).not.toBeNull();
  });

  it('never shrinks the render window back', () => {
    const keys = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const { container, rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-07-20" />
    );
    // Revealing an earlier day must not unmount what revealing a later one
    // already brought in — growth is one-way, and the reader may be reading
    // any of it.
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-07-02" />
    );
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).not.toBeNull();
  });

  it('ignores a reveal target that is not in the day groups', () => {
    const keys = ['2026-07-01', '2026-07-02'];
    expect(() => render(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-09-09" />
    )).not.toThrow();
  });
});
