/**
 * Institution-anchored time.
 *
 * Every date the calendar reasons about belongs to the Chautauqua
 * Institution, whose season runs on Eastern time, and the feed's timestamps
 * carry no offset of their own (`"2026-07-27 12:45:00"`, with a sibling
 * `timezone` field that has said `America/New_York` for all 3,246 events).
 * Reading them in the device's zone made the app agree with a reader
 * standing on the grounds and disagree with everyone else.
 *
 * Mirrors iOS's `ChqTime` deliberately: the two apps should not hold
 * different opinions about which day an event is on.
 */

/** Never a fixed offset — the season spans a DST transition in most years. */
export const CHQ_ZONE = 'America/New_York';

export interface ChqParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday, matching `Date.prototype.getDay`. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  weekday: 'short', hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
});

const dayLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE,
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

/** An instant's calendar fields as they read at Chautauqua. */
export function chqParts(d: Date): ChqParts {
  const found: Record<string, string> = {};
  for (const { type, value } of partsFormatter.formatToParts(d)) {
    found[type] = value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // `hourCycle: h23` still renders midnight as "24" in some engines.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(found.weekday)),
  };
}

/** The Chautauqua calendar day an instant falls on, as `yyyy-mm-dd`. */
export function chqDayKey(d: Date): string {
  const { year, month, day } = chqParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The instant at which the Chautauqua clock reads the given wall time.
 *
 * Offset-lookup-and-correct, applied twice. A single correction is wrong
 * when the guess and the answer straddle a DST boundary: the offset used to
 * make the guess is not the offset in force at the result. The second pass
 * re-reads the offset at the corrected instant and settles it. Ambiguous
 * times (the repeated hour each autumn) resolve to the first occurrence —
 * the second pass converges there directly, since the pre-transition offset
 * is still in force at the first-pass guess.
 *
 * Nonexistent wall times (the skipped hour each spring) have no fixed
 * point: no instant reads back as the requested time, so blindly applying
 * a second correction overshoots *backwards*, past the gap, into the
 * previous offset. When the second pass still doesn't read back what was
 * asked for, prefer the first pass's guess instead — it lands on the
 * instant immediately after the gap, matching `Calendar` on iOS.
 */
export function chqDateAt(
  y: number, mo: number, d: number,
  h = 0, mi = 0, s = 0, ms = 0,
): Date {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s, ms);

  const correct = (guess: Date): Date => {
    const p = chqParts(guess);
    const readBack = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ms);
    return new Date(guess.getTime() - (readBack - asUTC));
  };

  const firstPass = correct(new Date(asUTC));
  const secondPass = correct(firstPass);

  const p = chqParts(secondPass);
  const matches = p.year === y && p.month === mo && p.day === d
    && p.hour === h && p.minute === mi && p.second === s;
  return matches ? secondPass : firstPass;
}

/**
 * A feed timestamp — naive Institution wall time — as an absolute instant.
 *
 * Accepts the space-separated form the CHQ feed emits and the T-separated
 * form publisher feeds use, with or without seconds. Anything else yields an
 * Invalid Date, which `groupEventsByDay` turns into its `NaN-NaN-NaN` key
 * rather than crashing.
 */
export function parseEventDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s ?? '');
  if (!m) return new Date(NaN);
  return chqDateAt(
    Number(m[1]), Number(m[2]), Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
  );
}

/** `"7:00 PM"` at Chautauqua. Deliberately unlabelled — see the design doc. */
export function formatChqTime(d: Date): string {
  return timeFormatter.format(d);
}

/** `"Sunday, July 26, 2026"` at Chautauqua. */
export function formatChqDayLabel(d: Date): string {
  return dayLabelFormatter.format(d);
}
