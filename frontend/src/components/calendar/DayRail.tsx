import { useEffect, useRef } from 'react';
import type { DayChip } from '@/lib/utils/dayWindow';

export interface DayRailProps {
  chips: DayChip[];
  anchorDay: string | null;
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
 * no matches says so.
 */
export function DayRail({
  chips, anchorDay, todayKey, onSelectDay, onStepDay, onGoToToday, rootRef,
}: DayRailProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const anchorIdx = anchorDay ? chips.findIndex(c => c.key === anchorDay) : -1;
  const canStepBack = anchorIdx > 0;
  const canStepForward = anchorIdx >= 0 && anchorIdx < chips.length - 1;

  // Labelled by target, not direction — "Go to Saturday, July 4, 12 events",
  // not "Go to the previous day". The rail already has everything needed to
  // name the real target (the adjacent chip's own `label`), so the
  // direction-based exemption a relative control might otherwise get isn't
  // needed here. The plain directional fallback fires only when the chevron
  // is disabled: there is no adjacent chip to name in that direction, and
  // "disabled" already tells the reader they can't go further.
  const prevLabel = canStepBack ? chips[anchorIdx - 1].label : 'Go to the previous day';
  const nextLabel = canStepForward ? chips[anchorIdx + 1].label : 'Go to the next day';

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
    else if (e.key === 'Home') next = todayKey ? buttons.findIndex(b => b.dataset.chip === todayKey) : 0;
    else return;
    if (next < 0) return;
    e.preventDefault();
    buttons[next].focus();
  };

  if (chips.length === 0) return null;

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
          return (
            <button
              key={chip.key}
              type="button"
              data-chip={chip.key}
              aria-label={chip.label}
              aria-current={isAnchor ? 'date' : undefined}
              onClick={() => onSelectDay(chip.key)}
              className={`shrink-0 min-w-11 px-2 py-1 rounded-md text-center leading-tight transition-colors ${
                isAnchor
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700'
              } ${
                // An empty day is still navigable — it is a calendar day, and
                // the rail steps by calendar days. The dashed border says
                // "nothing here" without removing the target, mirroring
                // iOS's MyDayChipContent.isEmpty.
                chip.count === 0 ? 'border border-dashed border-gray-300 dark:border-gray-600' : 'border border-transparent'
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
