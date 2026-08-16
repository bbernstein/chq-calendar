import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/preact';
import { EventListWindowed } from '@/components/calendar/EventListWindowed';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
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

describe('EventListWindowed', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => {
    io = installIntersectionObserverMock();
    setReaderScrolled(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders whole days, filling to at least one batch of events', () => {
    const groups = [group('2026-07-05', 20), group('2026-07-06', 20), group('2026-07-07', 20), group('2026-07-08', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);

    // 20 + 20 + 20 = 60 >= 50 → three whole days, never a partial one.
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-07-19')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-08')).not.toBeInTheDocument();
  });

  it('never splits a day across the render edge', () => {
    const groups = [group('2026-07-05', 80), group('2026-07-06', 5)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.getByText('Event 2026-07-05-79')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('extends the render window by whole days when the sentinel intersects', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20), group('2026-07-07', 40)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
  });

  it('does not call onExpandEnd while loaded days remain', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('asks the page to expand the view window once the loaded days run out', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 10)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(onExpandEnd).toHaveBeenCalledTimes(1);
  });

  it('renders no sentinel when there is nothing left in either window', () => {
    const groups = [group('2026-07-05', 10)];
    const { container } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd={false} />
    );
    expect(container.querySelector('[data-testid="event-list-sentinel"]')).toBeNull();
  });

  it('labels the sentinel "Loading more events..." only while a cheap step can actually mount something', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />);
    // day2 is loaded but not yet rendered — the cheap branch has something
    // to do the moment the sentinel intersects, so the label is honest.
    expect(screen.getByText('Loading more events...')).toBeInTheDocument();
  });

  it('renders an empty, aria-hidden sentinel with no text and no padding while the expensive step is blocked', () => {
    // canExpandEnd is true but nothing loaded remains AND the reader has not
    // scrolled — the sentinel must stay mounted (it's what detects the
    // scroll when it comes), but "Loading more events..." would be a lie:
    // nothing is loading, and won't until the reader scrolls. A permanent,
    // unresolving "loading" message reads as broken, not as blocked.
    setReaderScrolled(false);
    const groups = [group('2026-07-05', 3)];
    const { container } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />
    );
    expect(screen.queryByText('Loading more events...')).not.toBeInTheDocument();
    const sentinel = container.querySelector('[data-testid="event-list-sentinel"]');
    expect(sentinel).not.toBeNull();
    expect(sentinel).toHaveAttribute('aria-hidden', 'true');
    expect(sentinel?.textContent).toBe('');
    expect(sentinel?.className).not.toMatch(/py-4/);
  });

  it('does not auto-expand before the reader has scrolled', () => {
    // A reader who has not scrolled yet has not looked past anything.
    // Auto-expanding here would silently turn a three-event "Today" into
    // "Today and tomorrow" before the reader touched a thing.
    setReaderScrolled(false);
    const onExpandEnd = vi.fn();
    render(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

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
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
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
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);
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
    // `hasScrolled` is a session-lifetime latch: `EventListWindowed` is
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
      <EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />
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
      <EventListWindowed {...baseProps} resetKey="k2" groupedEvents={shortFilteredGroups}
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
      <EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />
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
    rerender(<EventListWindowed {...baseProps} groupedEvents={widened} canExpandEnd onExpandEnd={onExpandEnd} />);
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
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger(); // cheap growth: anchors on day 07-08, mounting everything
    expect(screen.getByText('Day 2026-07-08')).toBeInTheDocument();

    // Background refresh: the current anchor day (07-08) vanishes. Same
    // resetKey — this is not a filter change.
    const withoutAnchorDay = [group('2026-07-05', 60), group('2026-07-06', 5), group('2026-07-07', 5)];
    rerender(<EventListWindowed {...baseProps} groupedEvents={withoutAnchorDay} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    // Background refresh: the day reappears under the same key, e.g. a
    // transient sync blip resolves. Still the same resetKey, still no
    // growth trigger, still nothing the reader did.
    const anchorDayReturns = [
      group('2026-07-05', 60), group('2026-07-06', 5),
      group('2026-07-07', 5), group('2026-07-08', 40),
    ];
    rerender(<EventListWindowed {...baseProps} groupedEvents={anchorDayReturns} />);

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
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    const rebuilt = [group('2026-07-05', 60), group('2026-07-06', 20)];
    rerender(<EventListWindowed {...baseProps} resetKey="k2" groupedEvents={rebuilt} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('ignores a non-intersecting report', () => {
    const onExpandEnd = vi.fn();
    render(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger(false);

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('keeps the rendered days when the window grows at the end', () => {
    const groups = [group('2026-07-05', 60)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />);
    const grown = [...groups, group('2026-07-06', 20)];

    rerender(<EventListWindowed {...baseProps} groupedEvents={grown} canExpandEnd onExpandEnd={noop} />);

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
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 30), ...groups]} />);

    expect(screen.getByText('Day 2026-07-03')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('keeps the rendered tail when earlier days are prepended', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 10), ...groups]} />);

    expect(screen.getByText('Day 2026-07-03')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('resets the render window when the non-window filters change', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} resetKey="k2" groupedEvents={groups} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('renders nothing for no groups and asks for no expansion', () => {
    const onExpandEnd = vi.fn();
    const { container } = render(
      <EventListWindowed {...baseProps} groupedEvents={[]} canExpandEnd onExpandEnd={onExpandEnd} />
    );
    expect(container.querySelectorAll('.event-card')).toHaveLength(0);
    expect(onExpandEnd).not.toHaveBeenCalled();
  });
});

describe('EventListWindowed — showing earlier days', () => {
  beforeEach(() => {
    // No binding: none of these tests drive intersection. The mock is still
    // installed because the component constructs an observer whenever a
    // sentinel renders, and jsdom provides no constructor to construct.
    installIntersectionObserverMock();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Layout is simulated: jsdom measures nothing, so the test sets the heights. */
  function setScrollHeight(px: number) {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: px });
  }

  it('offers the earlier control only when there is an earlier day', () => {
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByRole('button', { name: /Show earlier/ })).not.toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={groups} earlierDay="2026-07-03" onShowEarlier={noop} />);
    expect(screen.getByRole('button', { name: /Show earlier/ })).toBeInTheDocument();
  });

  it('names the day it will show, never just "earlier"', () => {
    render(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    const button = screen.getByRole('button', { name: /Show earlier/ });
    expect(button).toHaveTextContent('Show earlier (Friday, Jul 3)');
    expect(button).toHaveAttribute('aria-label', 'Show earlier events, Friday, Jul 3');
  });

  it('calls onShowEarlier when clicked', () => {
    const onShowEarlier = vi.fn();
    render(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={onShowEarlier} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();
    expect(onShowEarlier).toHaveBeenCalledTimes(1);
  });

  it('restores scroll position across the prepend', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    (window as unknown as { scrollY: number }).scrollY = 900;

    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    // The page grows by 600px above the reader's position.
    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 8), ...groups]}
        earlierDay="2026-07-02" onShowEarlier={noop} />
    );

    expect(window.scrollTo).toHaveBeenCalledWith(0, 1500);
  });

  it('does not touch scroll position on an ordinary re-render', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={[...groups, group('2026-07-06', 5)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('corrects scroll only once per click', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    (window as unknown as { scrollY: number }).scrollY = 900;
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    setScrollHeight(2600);
    const prepended = [group('2026-07-03', 8), ...groups];
    rerender(<EventListWindowed {...baseProps} groupedEvents={prepended} earlierDay="2026-07-02" onShowEarlier={noop} />);
    setScrollHeight(3000);
    rerender(<EventListWindowed {...baseProps} groupedEvents={[...prepended, group('2026-07-06', 5)]} earlierDay="2026-07-02" onShowEarlier={noop} />);

    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('forgets a pending correction when the filters change under it', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} resetKey="k2" groupedEvents={[group('2026-08-01', 4)]}
        earlierDay={null} />
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
