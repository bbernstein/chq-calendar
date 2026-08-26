import type { SeasonWeek } from '@/lib/types';
import { type DayKey, type NavigableBounds, dayKeyOf, spokenDayTitle } from '@/lib/utils/dayWindow';

/**
 * One week's extent expressed in day keys — the opening Saturday through the
 * closing Saturday, both inclusive.
 *
 * This is the day-granular model, not the noon-granular one. A Chautauqua
 * week turns over at Saturday *noon*, but splitting a 44px chip at its centre
 * is a distinction no reader can use at swipe speed, so a boundary Saturday
 * belongs to both of its weeks — the same rule
 * `weekNumbersForCalendarDate` gives the day header's `Wk 5/6` badge and the
 * week filter (#257).
 *
 * Day keys are `"yyyy-mm-dd"`, so string order is chronological order and
 * membership is a plain pair of comparisons. That is the whole reason this
 * type exists: `weekNumbersForCalendarDate` costs ~7 `Intl.formatToParts`
 * round-trips per call and the rail asks about ~70 days on every filter
 * change. Nine `dayKeyOf` calls, then string compares.
 * `weekBands.test.ts` walks the whole navigable range asserting the two
 * agree, so this stays a faster spelling of one model rather than a second
 * model that happens to match.
 */
export interface WeekDayKeySpan {
  number: number;
  opening: DayKey;
  closing: DayKey;
}

export function weekDayKeySpans(seasonWeeks: SeasonWeek[]): WeekDayKeySpan[] {
  return seasonWeeks.map(w => ({
    number: w.number,
    opening: dayKeyOf(w.start),
    closing: dayKeyOf(w.end),
  }));
}

/** One day's slice of the week band above the day rail. */
export interface WeekBandSegment {
  dayKey: DayKey;
  /** Ascending. Two entries = a boundary Saturday. Empty = outside the season. */
  weekNumbers: number[];
  /** `(n - 1) / (weeks - 1)` per entry, same order. Drives the lightness ramp. */
  rampSteps: number[];
  /**
   * The week a tap here navigates to, or `null` when a tap would be ambiguous
   * or meaningless.
   *
   * `null` for a *shared* Saturday: it opens one week and closes another, so
   * a tap on it cannot mean one week. Each week's six non-shared days carry
   * its navigation instead — plus week 1's opening Saturday and the final
   * week's closing Saturday, which have no neighbour to share with. Also
   * `null` outside the season.
   */
  navigationTarget: number | null;
  /** The week whose `WEEK n` label this segment draws. At most one per week. */
  labelledWeek: number | null;
}

/**
 * Segments for `keys`, in the order given.
 *
 * `keys` is the rail's own span (`navigableBounds`), a superset of the season
 * that can start or end mid-week. Label placement therefore follows the
 * *visible* run of each week rather than a fixed offset from a week start
 * that may be off screen.
 *
 * Pure and fully unit-testable: *which* spans the band covers is decided
 * here; where they land in pixels is `WeekBandCell`'s problem. That split is
 * deliberate — the pixel half is the part only a browser can check.
 */
export function weekBandSegments(keys: DayKey[], seasonWeeks: SeasonWeek[]): WeekBandSegment[] {
  // Built once and reused for every day, rather than per lookup: the iOS
  // version needed exactly this fix after a ~70-chip rail cost ~70 season
  // rebuilds per scroll tick (#256).
  const spans = weekDayKeySpans(seasonWeeks);
  // `getChautauquaSeasonWeeks` always returns nine, so an empty season is
  // unreachable — but the ramp divides by this, and a one-week season would
  // divide by zero rather than merely look wrong.
  const denominator = Math.max(seasonWeeks.length - 1, 1);

  const membership = keys.map(key =>
    spans.filter(s => s.opening <= key && key <= s.closing).map(s => s.number));

  // A week's label goes on the middle of its visible *non-shared* days, so it
  // never lands on a boundary Saturday — where it would have to pick one of
  // two weeks and would sit on the split fill.
  const soloIndicesByWeek = new Map<number, number[]>();
  membership.forEach((numbers, index) => {
    if (numbers.length !== 1) return;
    const existing = soloIndicesByWeek.get(numbers[0]);
    if (existing) existing.push(index);
    else soloIndicesByWeek.set(numbers[0], [index]);
  });
  const labelIndexByWeek = new Map<number, number>();
  for (const [week, indices] of soloIndicesByWeek) {
    labelIndexByWeek.set(week, indices[Math.floor(indices.length / 2)]);
  }

  return keys.map((key, index) => {
    const numbers = membership[index];
    // Unambiguous only when this day belongs to exactly one week.
    const target = numbers.length === 1 ? numbers[0] : null;
    const labelled =
      numbers.length === 1 && labelIndexByWeek.get(numbers[0]) === index ? numbers[0] : null;
    return {
      dayKey: key,
      weekNumbers: numbers,
      rampSteps: numbers.map(n => (n - 1) / denominator),
      navigationTarget: target,
      labelledWeek: labelled,
    };
  });
}

/** Where a tap on one week's band lands, and what a screen reader reads for it. */
export interface WeekBandDestination {
  dayKey: DayKey;
  /** e.g. `"Go to Week 6, opens Saturday, June 27, 84 events"`. */
  label: string;
}

interface FoundDay {
  dayKey: DayKey;
  opensTheWeek: boolean;
}

/**
 * The design's three branches, in order:
 *
 * 1. the full Saturday that opens the week, when it holds events under the
 *    current non-date filters — a reader asking for week 6 is asking to be put
 *    at the top of week 6;
 * 2. otherwise the week's first day that does, because the rail never
 *    announces a destination it cannot reach;
 * 3. otherwise `null`, which is the signal the band is **disabled** — matching
 *    the dashed empty chips directly beneath it. A normal-looking band next to
 *    visibly empty chips that does nothing when tapped is worse than one that
 *    says it cannot go there.
 *
 * `bounds` is the rail's own navigable span. A day outside it is not a legal
 * target (`railTarget` refuses it), so a week whose days all lie outside is
 * unreachable even if events exist there.
 */
function findDay(
  span: WeekDayKeySpan, eventDays: DayKey[], bounds: NavigableBounds
): FoundDay | null {
  // Day keys are `"yyyy-mm-dd"`, so the clamp against `bounds` is a plain
  // string comparison.
  const first = span.opening > bounds.startDay ? span.opening : bounds.startDay;
  const last = span.closing < bounds.endDay ? span.closing : bounds.endDay;
  if (first > last) return null;

  if (span.opening >= first && span.opening <= last && eventDays.includes(span.opening)) {
    return { dayKey: span.opening, opensTheWeek: true };
  }
  // `eventDays` is `eventDayKeys`' output, already sorted ascending, so the
  // first match in its existing order is the week's earliest reachable day.
  const fallback = eventDays.find(k => k >= first && k <= last);
  return fallback === undefined ? null : { dayKey: fallback, opensTheWeek: false };
}

/**
 * Named by destination, never by direction — the rail's established
 * convention, and why `⟳ Now` reads "Go to Wednesday, July 1, today, 3 events"
 * rather than "go forward". "Opens" is said only when the target really is the
 * week's opening Saturday; when the reader is being sent to a later day
 * because that Saturday is empty, saying "opens" would be a small lie about
 * where they are landing.
 */
function destinationLabel(week: number, found: FoundDay, count: number): string {
  const title = spokenDayTitle(found.dayKey);
  const where = found.opensTheWeek ? `opens ${title}` : `first events ${title}`;
  return `Go to Week ${week}, ${where}, ${count} event${count === 1 ? '' : 's'}`;
}

/**
 * Every week the band can navigate to, keyed by week number.
 *
 * A week **absent** from the map is unreachable: its fill renders faded and a
 * tap does nothing — including every week, when the map itself is empty
 * (before the events feed has loaded, or under a filter matching nothing).
 * `WeekBandCell` treats that the same as any other absence; there is no
 * separate "not known yet" state, because by the time this map could be
 * empty the chips beneath the band are already rendering that same state
 * themselves (every chip dashed, dimmed, "no events").
 *
 * One batch form, not a batch and a single-week form: the tap handler and the
 * fill both read this map, so they cannot disagree about which weeks are
 * reachable.
 */
export function weekBandDestinations(o: {
  seasonWeeks: SeasonWeek[];
  /** Sorted ascending — the days navigation can reach under the non-date filters. */
  eventDays: DayKey[];
  bounds: NavigableBounds;
  countsByDay: Map<DayKey, number>;
}): Map<number, WeekBandDestination> {
  const result = new Map<number, WeekBandDestination>();
  for (const span of weekDayKeySpans(o.seasonWeeks)) {
    const found = findDay(span, o.eventDays, o.bounds);
    if (!found) continue;
    result.set(span.number, {
      dayKey: found.dayKey,
      label: destinationLabel(span.number, found, o.countsByDay.get(found.dayKey) ?? 0),
    });
  }
  return result;
}

/**
 * What a screen reader reads for a week the band cannot reach — a statement of
 * fact, not an offer, exactly as an empty day chip reads "Monday, July 6, no
 * events" rather than offering to go there.
 */
export function weekBandUnreachableLabel(week: number): string {
  return `Week ${week}, no events`;
}

/**
 * Whether the band's fill runs straight through the gutter between the chips
 * at `index` and `index + 1`, instead of stopping at the chip's edge the way
 * the segment's own box does.
 *
 * Two adjacent days bridge when they share a week. A boundary Saturday shares
 * its closing week with the Friday before it and its opening week with the
 * Sunday after, so it bridges *both* ways and its own split is where the break
 * goes. An out-of-season day shares nothing, so a run ends at the season's
 * edge.
 *
 * Must compare every element on both sides, not just the first: a boundary
 * Saturday's `[1, 2]` shares its *second* entry with the week after it, which
 * a first-only shortcut would miss. `weekNumbers` holds 0, 1 or 2 entries by
 * construction and this runs twice per segment on every rail render, so a
 * `Set` over a domain this small would buy nothing but an allocation.
 */
export function bridgesGutter(index: number, segments: WeekBandSegment[]): boolean {
  if (index < 0 || index + 1 >= segments.length) return false;
  const left = segments[index].weekNumbers;
  const right = segments[index + 1].weekNumbers;
  if (left.length === 0 || right.length === 0) return false;
  return left.some(n => right.includes(n));
}
