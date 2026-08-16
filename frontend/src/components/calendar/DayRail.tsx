import { useEffect, useRef } from 'react';
import type { DayChip } from '@/lib/utils/dayWindow';

export interface DayRailProps {
  chips: DayChip[];
  anchorDay: string | null;
  /**
   * The nearest reachable day on either side of the anchor — a day that has
   * events under the current non-date filters — or `null` when there is
   * none in that direction.
   *
   * Passed in rather than derived from `chips` here. `chips` spans every
   * calendar day in the navigable bounds, so an index step within it names a
   * day that may have nothing to show; the reachable set is the caller's
   * `navEventDays`, which the caller already owns and already uses for
   * "Show earlier"/"Show later". Passing the two keys keeps one source of
   * truth for where a step goes, and keeps the labelling — this component's
   * actual job — here.
   */
  prevDay: string | null;
  nextDay: string | null;
  /**
   * Whether the current scope resolves to a view window at all.
   *
   * False only for `'this-week'` outside the season — a value this branch
   * deliberately keeps working when restored from localStorage. `railTarget`
   * refuses every tap in that state, because expansion cannot rescue it:
   * `viewWindow` returns null out of `baseWindow` before it ever reads the
   * expansion inputs. The chips would otherwise render enabled and fully
   * labelled ("Go to Saturday, July 4, 12 events") over a list that can never
   * move — the announce-a-destination-and-do-nothing class this branch spent
   * three findings removing. The chevrons and `⟳ Now` are already honest
   * there (`anchorDay` is null, so both chevrons disable; off-season
   * `todayKey` is null, so the button is absent), so the chips are the only
   * dishonest part — but a rail of nothing but dead chips is not worth
   * showing, and the reader is looking at `EmptyState` regardless.
   */
  scopeHasWindow: boolean;
  /** Today's key when the current year is selected; null on an archived one. */
  todayKey: string | null;
  onSelectDay: (key: string) => void;
  onStepDay: (delta: -1 | 1) => void;
  onGoToToday: () => void;
  /**
   * A callback ref applied to the rail's own root element — the sticky one,
   * carrying `data-day-rail`. `position: sticky` is bounded by its element's
   * *containing block*; a wrapper `<div>` around this component sized to fit
   * only the rail would BE that containing block, giving sticky zero travel
   * and defeating it outright. The ref has to land on this root, not on a
   * caller-supplied wrapper, so `--day-rail-h` is measured on the element
   * that is actually stuck and the containing block stays whatever ancestor
   * the caller renders this inside of (in practice, `<main>`, which is tall).
   */
  rootRef?: (el: HTMLElement | null) => void;
}

/**
 * The day rail — the fine-grained half of D4's two strips, sticky beneath
 * the week strip.
 *
 * Purely presentational: chips in, callbacks out. Scroll position lives in
 * `useDayAnchor`, the window lives in `useFilterState`, and the rail knows
 * about neither — which is what lets it be tested without a layout stub.
 *
 * It spans the navigable bounds, **not** the current scope. It is a
 * navigation surface, not a filter readout: in `Today` scope it still shows
 * the week around you, because "where am I in the season" is the question it
 * exists to answer.
 *
 * Accessibility: `role="group"` with an `aria-label`. Not `role="menu"` — a
 * row of navigation targets is not a menu — and not a bare `<div>` carrying
 * an `aria-label`, which assistive technology drops. Both are recorded
 * lessons from PR #228/#219. Every control is labelled by its **target**
 * ("Go to Sunday, August 16, 4 events"), never by direction, and a day with
 * no matches is named as a fact rather than as a destination.
 *
 * A day with no matches is also `aria-disabled` and does not fire
 * `onSelectDay`. There is nothing on that day to take the reader to, and the
 * previous behaviour — announcing "Go to Monday, July 6" and then doing
 * nothing at all — is the dead-end this initiative exists to remove, not an
 * example of it: the chevrons skip straight past such days, and every
 * neighbouring day that *does* have something is one tap away. `aria-disabled`
 * rather than `disabled` so the chip stays focusable and the arrow-key walk
 * below cannot stall on it.
 */
export function DayRail({
  chips, anchorDay, prevDay, nextDay, scopeHasWindow, todayKey,
  onSelectDay, onStepDay, onGoToToday, rootRef,
}: DayRailProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  // Reachability, not adjacency: `chips` spans every calendar day in the
  // navigable bounds, so `anchorIdx ± 1` is enabled on days a step cannot
  // actually land on.
  const canStepBack = prevDay !== null;
  const canStepForward = nextDay !== null;

  // Labelled by target, not direction — "Go to Saturday, July 4, 12 events",
  // not "Go to the previous day". The rail already has everything needed to
  // name the real target (that day's own chip label), so the direction-based
  // exemption a relative control might otherwise get isn't needed here. The
  // plain directional fallback fires only when the chevron is disabled: there
  // is no reachable day to name in that direction, and "disabled" already
  // tells the reader they can't go further.
  const labelOf = (key: string | null) => chips.find(c => c.key === key)?.label;
  const prevLabel = labelOf(prevDay) ?? 'Go to the previous day';
  const nextLabel = labelOf(nextDay) ?? 'Go to the next day';

  // The strip is one tab stop, not one per day — see the chip's `tabIndex`
  // below. The stop is the anchor chip, falling back to the first chip
  // whenever the anchor is not on the strip (nothing measured yet, or an
  // anchor from a window the rail no longer spans); without that fallback a
  // null anchor would leave the whole strip unreachable from the keyboard.
  const tabStopKey = chips.some(c => c.key === anchorDay) ? anchorDay : chips[0]?.key;

  // Keep the highlighted chip in view as the reader scrolls the list. The
  // rail scrolls itself horizontally; it never scrolls the page.
  //
  // Deliberately NOT `chip.scrollIntoView(...)`. `block: 'nearest'` minimises
  // vertical movement but does not forbid it — with the rail scrolled
  // partway off-screen (an ordinary scroll position, not a bug), that call
  // drags the whole page to bring the chip's vertical position into view,
  // which is exactly the page-scroll this control must never cause. Setting
  // the strip's own `scrollLeft` can only move the strip.
  useEffect(() => {
    if (!anchorDay) return;
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-chip="${anchorDay}"]`);
    if (!strip || !chip) return;
    // `offsetLeft` is relative to the nearest positioned ancestor, which is
    // not reliably `strip` (the sticky root above it is itself positioned).
    // Bounding rects sidestep that: `chipRect.left - stripRect.left` is the
    // chip's edge relative to the strip's edge as currently painted, and
    // adding back the strip's own `scrollLeft` converts that into a
    // scroll-independent, content-relative position.
    const stripRect = strip.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const chipCenter = (chipRect.left - stripRect.left) + chipRect.width / 2 + strip.scrollLeft;
    strip.scrollLeft = chipCenter - strip.clientWidth / 2;
  }, [anchorDay]);

  // Left/Right move focus along the rail, Home jumps to today. Focus only —
  // activating is Enter/Space on the focused chip, which a <button> already
  // does. Moving the window on mere focus would make arrowing through the
  // rail refilter the list on every keystroke.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const strip = stripRef.current;
    if (!strip) return;
    const buttons = Array.from(strip.querySelectorAll<HTMLElement>('[data-chip]'));
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(current + 1, buttons.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (e.key === 'Home') {
      // `todayKey` and `chips` are computed independently in `page.tsx`
      // (`reachableTodayKey` against `navBounds`, `railChips` against the
      // same bounds) — today, that keeps them in agreement, but nothing
      // enforces it structurally. If a future change ever let them drift,
      // `findIndex` returning -1 here would otherwise swallow the keypress
      // with no feedback at all; falling back to the first chip means Home
      // always does something.
      const idx = todayKey ? buttons.findIndex(b => b.dataset.chip === todayKey) : 0;
      next = idx < 0 ? 0 : idx;
    }
    else return;
    if (next < 0) return;
    e.preventDefault();
    buttons[next].focus();
  };

  // Nothing to show, or nothing any of it could do — see `scopeHasWindow`.
  // After the hooks above, never before: an early return that skipped a hook
  // would change the hook order between renders.
  if (chips.length === 0 || !scopeHasWindow) return null;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Days"
      data-day-rail
      onKeyDown={onKeyDown}
      className="sticky top-0 z-20 flex items-center gap-1 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-1 py-1"
    >
      <button
        type="button"
        aria-label={prevLabel}
        disabled={!canStepBack}
        onClick={() => onStepDay(-1)}
        className="shrink-0 px-2 py-1 text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-default"
      >
        ‹
      </button>

      <div ref={stripRef} className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-hide">
        {chips.map((chip) => {
          const isAnchor = chip.key === anchorDay;
          // A day with nothing on it is not a destination. It keeps its
          // place on the strip — the rail is a calendar and a gap is
          // information — and it keeps its focusability, but it is announced
          // and painted as unavailable rather than offering a trip that
          // cannot happen.
          const isEmpty = chip.count === 0;
          return (
            <button
              key={chip.key}
              type="button"
              data-chip={chip.key}
              aria-label={chip.label}
              aria-current={isAnchor ? 'date' : undefined}
              aria-disabled={isEmpty || undefined}
              // One tab stop for the whole strip: a season is ~64 chips, and
              // every one of them being a tab stop between the filters and
              // the list is what the ArrowLeft/ArrowRight/Home handler above
              // exists to replace.
              tabIndex={chip.key === tabStopKey ? 0 : -1}
              onClick={() => { if (!isEmpty) onSelectDay(chip.key); }}
              className={`shrink-0 min-w-11 px-2 py-1 rounded-md text-center leading-tight transition-colors ${
                isAnchor
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700'
              } ${
                // The dashed border says "nothing here", mirroring iOS's
                // MyDayChipContent.isEmpty; the dimming says "and so there is
                // nothing to press".
                isEmpty ? 'border border-dashed border-gray-300 dark:border-gray-600 opacity-50 cursor-default' : 'border border-transparent'
              }`}
            >
              {chip.month && (
                <span className="block text-[10px] font-semibold uppercase opacity-70" aria-hidden="true">{chip.month}</span>
              )}
              <span className="block text-[10px] uppercase opacity-70" aria-hidden="true">{chip.weekday}</span>
              <span className="block text-sm font-semibold" aria-hidden="true">{chip.dayOfMonth}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label={nextLabel}
        disabled={!canStepForward}
        onClick={() => onStepDay(1)}
        className="shrink-0 px-2 py-1 text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-default"
      >
        ›
      </button>

      {/*
        ⟳ Now is navigation, never a filter change: it moves the reader to
        today and widens the window if today is not in it, and touches no
        scope, week, category or search. Hidden once the anchor is already
        today, and absent entirely on an archived year, where "today" is not
        a place in the season being read.
      */}
      {todayKey && anchorDay !== todayKey && (
        <button
          type="button"
          aria-label="Go to today"
          onClick={onGoToToday}
          className="shrink-0 px-2 py-1 text-sm rounded-md bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-gray-600"
        >
          ⟳ Now
        </button>
      )}
    </div>
  );
}
