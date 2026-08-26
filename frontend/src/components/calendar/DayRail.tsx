import { useCallback, useMemo } from 'react';
import type { DayChip } from '@/lib/utils/dayWindow';
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { FiltersIcon } from '@/components/filters/FiltersIcon';
import { WeekBandCell } from '@/components/calendar/WeekBandCell';
import { WeekChooser } from '@/components/calendar/WeekChooser';
import { anchorWeekNumber, bridgesGutter, type WeekBandDestination, type WeekBandSegment } from '@/lib/utils/weekBands';
import { RAIL_CHIP_GUTTER_PX } from '@/lib/utils/railMetrics';
import { RAIL_CHIP_SELECTOR, useRailHighlight } from '@/hooks/useRailHighlight';

/**
 * Everything that decides a chip's box, shared verbatim by the two layers.
 *
 * The highlighted copy of the row has to lay out pixel-identically to the
 * real one — it is positioned on top of it and clipped, so a single pixel of
 * width difference shows up as a seam through the middle of a digit. Sharing
 * one string is what makes that a compile-time guarantee rather than a thing
 * two class lists happen to agree on, and it is why the empty-day border is
 * here (1px, and it must be 1px on both) while the dimming that goes with it
 * is not (paint only, and the copy is clipped away over an empty day anyway).
 */
function chipBoxClass(isEmpty: boolean): string {
  return `shrink-0 min-h-11 min-w-11 px-2 py-1 rounded-md text-center leading-tight ${
    isEmpty ? 'border border-dashed border-gray-300 dark:border-gray-600' : 'border border-transparent'
  }`;
}

/**
 * The column that holds one day's band cell and its chip.
 *
 * Shared verbatim by the two layers for the same reason `chipBoxClass` is: the
 * clipped copy is positioned on top of the real row, so a column that laid out
 * differently in one layer would show as a seam. `items-stretch` on the rows
 * (not `items-center`) is what keeps every band cell on the same baseline —
 * a chip carrying a month label is a line taller than its neighbours, and
 * centring the columns would push those days' band segments out of line.
 */
const railColumnClass = 'flex shrink-0 flex-col';

/** The band's own row, for the keyboard walk. Excludes the clipped copy's columns. */
const BAND_BUTTON_SELECTOR = ':scope > [data-rail-column] [data-week-band-button]';

/** A chip's three lines. Rendered identically into both layers. */
function ChipFace({ chip }: { chip: DayChip }) {
  return (
    <>
      {chip.month && (
        <span className="block text-[10px] font-semibold uppercase opacity-70" aria-hidden="true">{chip.month}</span>
      )}
      <span className="block text-[10px] uppercase opacity-70" aria-hidden="true">{chip.weekday}</span>
      <span className="block text-sm font-semibold" aria-hidden="true">{chip.dayOfMonth}</span>
    </>
  );
}

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
  /**
   * The "Filters" toggle, rendered inside this component's own row rather
   * than as a separate element beside it.
   *
   * That placement is deliberate, not cosmetic: `useDayRailHeight` measures
   * only this component's root (`rootRef`, above), so any new *persistent*
   * chrome added outside this row — visible whenever the reader has
   * scrolled, not just while the panel is open — would silently widen the
   * actual stuck header without widening `--day-rail-h`, undercounting the
   * clearance day headers and `useDayAnchor` compute against it. Inside the
   * row, the toggle is already part of what gets measured, so no offset
   * math anywhere else has to learn about it.
   */
  filtersToggle?: DayRailFiltersToggleProps;
  /**
   * The view window's day list, in order — the same array `useDayAnchor` is
   * given in `page.tsx`.
   *
   * Passed rather than derived from `chips` so both the discrete anchor and
   * this component's continuous highlight walk *identical* input through the
   * same `resolveAnchor`. `chips` spans the navigable bounds, a superset, and
   * walking it here would in practice agree — but "in practice agrees" is
   * exactly the property that lets `aria-current` and the painted highlight
   * drift onto different days the first time the two ranges diverge.
   */
  windowDayKeys: string[];
  /**
   * One segment per chip, in the same order — `weekBandSegments(chipKeys, …)`.
   *
   * Passed rather than derived here so the band's model stays a pure function
   * of the season that can be tested without a view, and so the reachability
   * map beside it is built once per filter change rather than per render.
   */
  bandSegments: WeekBandSegment[];
  /**
   * Which weeks the band can reach under the current non-date filters. A week
   * absent from the map renders faded and refuses its tap — including every
   * week, when the map itself is empty.
   */
  weekDestinations: Map<number, WeekBandDestination>;
  /** A band tap. The caller turns the week into a day and calls `goToDay`. */
  onSelectWeek: (week: number) => void;
  /**
   * The season's weeks, for the chooser's grid.
   *
   * Passed rather than derived from `bandSegments` because the grid must show
   * every week of the season — including one entirely outside `navigableBounds`,
   * which has no segment at all and would silently vanish from a grid built
   * from the segments.
   */
  seasonWeeks: SeasonWeek[];
  /**
   * The weekly themes, if they have loaded. Optional throughout: the themes
   * file can 404 for a season, and the chooser has to work without it.
   */
  weekThemes?: Record<number, WeekTheme>;
}

export interface DayRailFiltersToggleProps {
  /** Whether the revealed filter panel is currently open. */
  open: boolean;
  /** Opens or closes the panel. */
  onToggle: () => void;
  /** The panel's id — used for `aria-controls`. */
  panelId: string;
  /**
   * Whether to render the toggle at all. True once the reader has scrolled
   * past the in-flow filter card (see `useScrolledPastFilters`, owned by the
   * caller, not this component). At the top of the page the filter card is
   * already visible and a toggle for it would be redundant — matching the
   * design's own state table.
   */
  visible: boolean;
  /**
   * Callback ref for the toggle button itself. The caller uses the node to
   * return focus here when the panel closes via `Escape`.
   */
  toggleRef?: (el: HTMLButtonElement | null) => void;
  /**
   * Whether the reader has narrowed the list themselves —
   * `useFilterState`'s `hasNonDefaultFilters`, passed straight through.
   * Drives the small dot D5 adds to the icon. An icon alone can't tell the
   * reader "everything" from "a slice", and neither could the word
   * "Filters" it replaces; the dot is the one place this change adds
   * something rather than merely preserving it.
   *
   * Deliberately NOT `hasFilters`, which is true on a default visit (the
   * app starts on the `next` scope, a date filter) and would light the dot
   * for every reader before they touched anything.
   */
  hasActiveFilters: boolean;
}

/**
 * The day rail — the fine-grained half of D4's two strips, sticky beneath
 * the week strip.
 *
 * Chips in, callbacks out. The window lives in `useFilterState` and the
 * *discrete* anchor in `useDayAnchor`; the rail owns neither, and still
 * decides nothing about which day is current.
 *
 * It is no longer layout-free, though, and the old claim that it could be
 * tested without a layout stub no longer holds: `useRailHighlight` measures
 * the chip row and the day sections to place the highlight continuously. The
 * chips, the labels, the keyboard walk and the disabled states all still
 * test on plain markup; anything about *where the highlight is* needs stated
 * geometry, which is what `useRailHighlight.test.tsx` provides.
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
  onSelectDay, onStepDay, onGoToToday, rootRef, filtersToggle, windowDayKeys,
  bandSegments, weekDestinations, onSelectWeek, seasonWeeks, weekThemes,
}: DayRailProps) {
  const chipKeys = useMemo(() => chips.map(c => c.key), [chips]);
  const { stripRef, contentRef, pillRef, clipRef, contentEl, resume } =
    useRailHighlight(chipKeys, windowDayKeys);

  // Stable, so `WeekChooser`'s `memo` actually has something to compare.
  // `resume` is itself a `useCallback` with an empty dependency array
  // (`useRailHighlight`), so this only changes identity when `onSelectWeek`
  // — DayRail's own prop, `page.tsx`'s `goToWeek` — does, which is rare.
  // An inline arrow here would recreate on every render regardless of
  // whether the reader touched the chooser, defeating the memo on exactly
  // the renders it exists to skip (the filter panel opening and closing
  // re-renders this whole row without changing anything about the chooser).
  const handleSelectWeek = useCallback((week: number) => {
    resume();
    onSelectWeek(week);
  }, [resume, onSelectWeek]);

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

  // The band is one tab stop, like the chip row: the week the reader is
  // actually in, resolved once in `weekBands.ts` so the band's tab stop and the
  // chooser's lit cell cannot answer this differently. Falls back to the first
  // labelled week so the band is never unreachable from the keyboard.
  const anchorWeek = anchorWeekNumber(anchorDay, bandSegments);
  const bandTabStopWeek = anchorWeek
    ?? bandSegments.find(s => s.labelledWeek !== null)?.labelledWeek
    ?? null;

  // The highlight — where it sits, and what moves the strip — now lives in
  // `useRailHighlight`, driven continuously from scroll position rather than
  // from `anchorDay` changing. `anchorDay` is still what this component
  // *announces* (`aria-current` below); it is no longer what it paints.

  // Left/Right move focus along the rail, Home jumps to today. Focus only —
  // activating is Enter/Space on the focused chip, which a <button> already
  // does. Moving the window on mere focus would make arrowing through the
  // rail refilter the list on every keystroke.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const content = contentEl.current;
    if (!content) return;
    const active = document.activeElement as HTMLElement | null;
    // Which row the walk applies to is decided by where focus already is, so
    // the band and the chips each behave like the single strip they look like.
    const onBand = active?.hasAttribute('data-week-band-button') ?? false;
    const buttons = Array.from(content.querySelectorAll<HTMLElement>(
      onBand ? BAND_BUTTON_SELECTOR : RAIL_CHIP_SELECTOR));
    const current = buttons.indexOf(active as HTMLElement);
    if (current < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(current + 1, buttons.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (e.key === 'Home') {
      if (onBand) next = 0;
      else {
        const idx = todayKey ? buttons.findIndex(b => b.dataset.chip === todayKey) : 0;
        next = idx < 0 ? 0 : idx;
      }
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
        onClick={() => { resume(); onStepDay(-1); }}
        className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-default"
      >
        ‹
      </button>

      {/*
        Three stacked layers inside one scroller, so all of them share a
        single `scrollLeft` and cannot desync:

          chips (static)  — the real, interactive row
          pill  (z-10)    — the highlight, painted OVER the chips' own
                            backgrounds and text
          copy  (z-20)    — the same row again in the highlighted colour,
                            clipped to exactly the pill

        The pill sitting above the chips rather than behind them is what
        keeps `hover:bg-blue-50` from painting over the highlight on the
        current day; the copy above the pill is what puts legible text back.
        A chip straddling the pill's edge is therefore genuinely split — the
        left half in the base colour, the right half white — which is the
        half-and-half state the reader sees if they stop mid-scroll.
      */}
      <div ref={stripRef} data-rail-strip className="flex-1 overflow-x-auto scrollbar-hide">
        <div
          ref={contentRef}
          data-rail-content
          className="relative flex items-stretch w-max"
          // The gutter the band's bleed is derived from — one constant, not a
          // Tailwind class and a literal that happen to agree.
          style={{ gap: `${RAIL_CHIP_GUTTER_PX}px` }}
        >
          {chips.map((chip, index) => {
            const isEmpty = chip.count === 0;
            // Looked up by index, then confirmed by day key. Index alignment
            // is structural today (both arrays are built from the same chip
            // list, in order), but a segment drawn over the wrong day is a
            // silent, plausible-looking defect, so the band says nothing
            // rather than guessing.
            const raw = bandSegments[index];
            const segment = raw?.dayKey === chip.key ? raw : null;
            return (
              <div key={chip.key} data-rail-column className={railColumnClass}>
                <WeekBandCell
                  segment={segment}
                  destinations={weekDestinations}
                  bridgesLeading={bridgesGutter(index - 1, bandSegments)}
                  bridgesTrailing={bridgesGutter(index, bandSegments)}
                  isTabStop={segment?.labelledWeek !== null
                    && segment?.labelledWeek === bandTabStopWeek}
                  onSelectWeek={(week) => { resume(); onSelectWeek(week); }}
                />
                <button
                  type="button"
                  data-chip={chip.key}
                  aria-label={chip.label}
                  aria-current={chip.key === anchorDay ? 'date' : undefined}
                  aria-disabled={isEmpty || undefined}
                  tabIndex={chip.key === tabStopKey ? 0 : -1}
                  onClick={() => { if (!isEmpty) { resume(); onSelectDay(chip.key); } }}
                  className={`${chipBoxClass(isEmpty)} text-gray-700 dark:text-gray-300 ${
                    isEmpty ? 'opacity-50 cursor-default' : 'hover:bg-blue-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <ChipFace chip={chip} />
                </button>
              </div>
            );
          })}

          <div
            ref={pillRef}
            data-rail-pill
            aria-hidden="true"
            className="absolute left-0 z-10 rounded-md bg-blue-600 pointer-events-none"
            // Re-based below the band: `inset-y-0` would paint the highlight
            // over the week it is meant to sit under. Vertical placement is
            // static; `useRailHighlight` writes only width and transform.
            style={{ opacity: 0, top: 'var(--rail-band-h)', bottom: '0px' }}
          />

          <div
            ref={clipRef}
            data-rail-clip
            aria-hidden="true"
            className="absolute inset-0 z-20 flex items-stretch text-white pointer-events-none"
            style={{ gap: `${RAIL_CHIP_GUTTER_PX}px`, clipPath: 'inset(0 100% 0 0)' }}
          >
            {chips.map((chip) => (
              // Divs, not buttons, and carrying no `data-chip` — this row is
              // paint: it must not be a control, and it must not answer to a
              // selector looking for one.
              <div key={chip.key} data-rail-column className={railColumnClass}>
                {/*
                  The band's height, spent on nothing. Without it the copy's
                  chips sit one band higher than the real ones and every digit
                  gets a seam through it — the exact failure the shared
                  `chipBoxClass` exists to prevent, one level up.
                */}
                <div data-band-spacer className="h-[var(--rail-band-h)] shrink-0" />
                <div className={chipBoxClass(chip.count === 0)}>
                  <ChipFace chip={chip} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-label={nextLabel}
        disabled={!canStepForward}
        onClick={() => { resume(); onStepDay(1); }}
        className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-default"
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
          onClick={() => { resume(); onGoToToday(); }}
          className="shrink-0 inline-flex min-h-11 items-center justify-center px-2 py-1 text-sm rounded-md bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-gray-600"
        >
          ⟳ Now
        </button>
      )}

      {/*
        The week chooser. Right end of the rail, next to `⟳ Now` — the two
        controls that answer "take me somewhere in the season" rather than
        "take me one step".
      */}
      <WeekChooser
        seasonWeeks={seasonWeeks}
        destinations={weekDestinations}
        currentWeek={anchorWeek}
        themes={weekThemes}
        // `resume()` for the same reason a band tap and a chip tap call it: the
        // highlight is scroll-linked and paused while the reader is dragging the
        // rail, and a jump has to hand control back to the scroll position it is
        // about to land on. Stabilized above so `WeekChooser`'s `memo` holds.
        onSelectWeek={handleSelectWeek}
      />

      {filtersToggle?.visible && (
        <button
          type="button"
          ref={filtersToggle.toggleRef}
          // D5: the label is now a funnel icon, not the word "Filters" —
          // horizontal space on the rail is scarcest right here. The
          // accessible name does not change: FiltersIcon's SVG and dot are
          // both aria-hidden, so this explicit aria-label is what a screen
          // reader announces, same as when the button's own text did.
          aria-label="Filters"
          aria-expanded={filtersToggle.open}
          aria-controls={filtersToggle.panelId}
          onClick={filtersToggle.onToggle}
          // `min-h-11 min-w-11` = 44px square, the platform minimum, on the
          // one control this whole feature depends on — at the rail's
          // rightmost edge, on a phone-first app. The word "Filters" it
          // replaced was ~54px wide; a 16px icon in `px-2 py-1` alone would
          // be roughly 32x28. This costs the rail no visual height: the day
          // chips are ~50px tall (three lines of `leading-tight` text plus
          // `py-1`), so the row is already taller than 44px and the parent's
          // `items-center` centres this inside it rather than growing it.
          // `inline-flex` + centring because a `min-h` on a plain
          // inline-block button would leave the icon top-aligned in the
          // taller box.
          className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 text-sm rounded-md bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-gray-600"
        >
          <FiltersIcon active={filtersToggle.hasActiveFilters} />
        </button>
      )}
    </div>
  );
}
