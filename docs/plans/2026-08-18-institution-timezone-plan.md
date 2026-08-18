# Institution Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every time and date the web app computes — including "now" and "today" — resolve in the Chautauqua Institution's timezone, `America/New_York`, regardless of the reader's device.

**Architecture:** One new pure module, `chqTime.ts`, converts between naive Institution wall-clock strings and absolute instants using `Intl.DateTimeFormat`. Every existing site that today reads or builds device-local calendar fields is migrated to it in one coherent sweep. The migration is all-or-nothing: display, day grouping and ICS are *correct today* only because everything is consistently device-local and the offsets cancel; moving parsing alone would break them.

**Tech Stack:** TypeScript 5, Vite 7, Preact 10, Vitest 4, Playwright (e2e). No new runtime dependency — `Intl.DateTimeFormat` only.

**Spec:** `docs/plans/2026-08-18-institution-timezone-design.md`

## Global Constraints

- **Zero files outside `frontend/`.** `git diff --stat main...HEAD` must list only `frontend/` paths. The feed, the backend and `all-events.json` are untouched, so old web bundles and the shipped iOS app are unaffected by construction.
- **Timezone identifier is exactly `America/New_York`.** Never a fixed offset, never `EST`/`EDT`.
- **Times are unlabelled.** `7:00 PM` stays `7:00 PM`. No "ET" suffix anywhere, no per-viewer variation.
- **Half-open windows.** `start <= x < endExclusive`. Never an inclusive bound with a subtracted epsilon.
- **Day keys are `yyyy-mm-dd`,** zero-padded, lexicographically chronological, byte-identical to iOS `ChqTime.dayKey`.
- **Do not change `vitest.config.ts`'s `env: { TZ: 'America/New_York' }`.** It exists so the DST-transition tests keep discriminating on UTC runners.
- Run `npm run validate` (type-check + lint) before every commit. Frontend commands run from `frontend/`.

---

### Task 1: The `chqTime` module

**Files:**
- Create: `frontend/src/lib/utils/chqTime.ts`
- Test: `frontend/src/__tests__/lib/utils/chqTime.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CHQ_ZONE: string`, `chqParts(d: Date): ChqParts`, `chqDayKey(d: Date): string`, `chqDateAt(y: number, mo: number, d: number, h?: number, mi?: number, s?: number, ms?: number): Date`, `parseEventDate(s: string): Date`, `formatChqTime(d: Date): string`, `formatChqDayLabel(d: Date): string`, and `interface ChqParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/lib/utils/chqTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CHQ_ZONE, chqParts, chqDayKey, chqDateAt, parseEventDate,
  formatChqTime, formatChqDayLabel,
} from '@/lib/utils/chqTime';

describe('CHQ_ZONE', () => {
  it('is the Institution zone, never a fixed offset', () => {
    expect(CHQ_ZONE).toBe('America/New_York');
  });
});

describe('chqParts', () => {
  it('reads calendar fields in Institution time, not the device zone', () => {
    // 2026-07-27T03:45:00Z is 23:45 on 2026-07-26 at Chautauqua (EDT, -4).
    const p = chqParts(new Date('2026-07-27T03:45:00Z'));
    expect(p).toMatchObject({ year: 2026, month: 7, day: 26, hour: 23, minute: 45 });
  });

  it('reads winter instants in EST', () => {
    // 2026-01-15T18:30:00Z is 13:30 EST (-5).
    const p = chqParts(new Date('2026-01-15T18:30:00Z'));
    expect(p).toMatchObject({ year: 2026, month: 1, day: 15, hour: 13, minute: 30 });
  });

  it('reports midnight as hour 0, never 24', () => {
    // 2026-07-27T04:00:00Z is exactly midnight EDT.
    expect(chqParts(new Date('2026-07-27T04:00:00Z')).hour).toBe(0);
  });
});

describe('chqDayKey', () => {
  it('gives the Institution calendar day of an instant', () => {
    expect(chqDayKey(new Date('2026-07-27T03:45:00Z'))).toBe('2026-07-26');
    expect(chqDayKey(new Date('2026-07-27T16:45:00Z'))).toBe('2026-07-27');
  });

  it('zero-pads to yyyy-mm-dd', () => {
    expect(chqDayKey(new Date('2026-01-05T17:00:00Z'))).toBe('2026-01-05');
  });
});

describe('chqDateAt', () => {
  it('builds an instant from Institution wall time in summer', () => {
    // Noon EDT on 2026-07-27 is 16:00Z.
    expect(chqDateAt(2026, 7, 27, 12).toISOString()).toBe('2026-07-27T16:00:00.000Z');
  });

  it('builds an instant from Institution wall time in winter', () => {
    // Noon EST on 2026-01-15 is 17:00Z.
    expect(chqDateAt(2026, 1, 15, 12).toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('round-trips through chqParts across the spring DST transition', () => {
    // 2026-03-08: 02:00 does not exist; 03:00 EDT is 07:00Z.
    const d = chqDateAt(2026, 3, 8, 3);
    expect(chqParts(d)).toMatchObject({ year: 2026, month: 3, day: 8, hour: 3 });
  });

  it('round-trips through chqParts across the autumn DST transition', () => {
    // 2026-11-01: 01:00 occurs twice. Either instant must read back as 01:00.
    const d = chqDateAt(2026, 11, 1, 1);
    expect(chqParts(d)).toMatchObject({ year: 2026, month: 11, day: 1, hour: 1 });
  });

  it('round-trips every hour of both DST transition days', () => {
    for (const [mo, day] of [[3, 8], [11, 1]] as const) {
      for (let h = 0; h < 24; h++) {
        const p = chqParts(chqDateAt(2026, mo, day, h));
        // The spring-forward hour 02:00 does not exist; it normalises to 03:00.
        const expected = mo === 3 && h === 2 ? 3 : h;
        expect({ h, got: p.hour }).toEqual({ h, got: expected });
      }
    }
  });
});

describe('parseEventDate', () => {
  it('reads the feed\'s space-separated form as Institution wall time', () => {
    expect(parseEventDate('2026-07-27 12:45:00').toISOString()).toBe('2026-07-27T16:45:00.000Z');
  });

  it('reads the T-separated form the publisher feeds use', () => {
    expect(parseEventDate('2026-07-27T12:45:00').toISOString()).toBe('2026-07-27T16:45:00.000Z');
  });

  it('reads a winter date in EST', () => {
    expect(parseEventDate('2026-01-15 12:00:00').toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('tolerates a missing seconds field', () => {
    expect(parseEventDate('2026-07-27 12:45').toISOString()).toBe('2026-07-27T16:45:00.000Z');
  });

  it('returns an Invalid Date for an unparseable string', () => {
    // groupEventsByDay relies on this to emit its NaN-NaN-NaN key.
    expect(Number.isNaN(parseEventDate('not a date').getTime())).toBe(true);
  });
});

describe('formatChqTime', () => {
  it('renders Institution wall time, unlabelled', () => {
    expect(formatChqTime(new Date('2026-07-27T23:00:00Z'))).toBe('7:00 PM');
  });

  it('carries no timezone suffix', () => {
    expect(formatChqTime(new Date('2026-07-27T23:00:00Z'))).not.toMatch(/ET|EDT|EST|GMT|UTC/);
  });
});

describe('formatChqDayLabel', () => {
  it('names the Institution day, not the device day', () => {
    // 03:45Z is still the 26th at Chautauqua.
    expect(formatChqDayLabel(new Date('2026-07-27T03:45:00Z')))
      .toBe('Sunday, July 26, 2026');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/chqTime.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/utils/chqTime"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/utils/chqTime.ts`:

```ts
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
 * times (the repeated hour each autumn) resolve to the first occurrence,
 * and nonexistent ones (the skipped hour each spring) to the instant after
 * the gap — both matching `Calendar` on iOS.
 */
export function chqDateAt(
  y: number, mo: number, d: number,
  h = 0, mi = 0, s = 0, ms = 0,
): Date {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  let guess = new Date(asUTC);
  for (let pass = 0; pass < 2; pass++) {
    const p = chqParts(guess);
    const readBack = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ms);
    const drift = readBack - asUTC;
    if (drift === 0) break;
    guess = new Date(guess.getTime() - drift);
  }
  return guess;
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/chqTime.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Prove the DST tests bite**

Temporarily replace the body of `chqDateAt` with the naive version:

```ts
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
```

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/chqTime.test.ts`
Expected: FAIL on the summer/winter and both DST round-trip cases. Restore the real implementation and re-run to PASS.

- [ ] **Step 6: Validate and commit**

```bash
cd frontend && npm run validate
cd .. && git add frontend/src/lib/utils/chqTime.ts frontend/src/__tests__/lib/utils/chqTime.test.ts
git commit -m "feat(web): add Institution-anchored time helpers"
```

---

### Task 2: Day keys and window boundaries

**Files:**
- Modify: `frontend/src/lib/utils/dayWindow.ts` — `dayKeyOf`, `startOfDay`, `dayAfter`, `lastDayCovered`, `addDays`, `isDayKey`
- Test: `frontend/src/__tests__/lib/utils/dayWindow.test.ts` (existing — add to it)

**Interfaces:**
- Consumes: `chqDayKey`, `chqDateAt`, `chqParts` from Task 1.
- Produces: the same exported signatures as today — `dayKeyOf(d: Date): DayKey`, `startOfDay(key: DayKey): Date`, `dayAfter(key: DayKey): Date`, `lastDayCovered(endExclusive: Date): DayKey`, `addDays(key: DayKey, n: number): DayKey`. Only their *meaning* changes: Institution time rather than device time.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/lib/utils/dayWindow.test.ts`:

```ts
describe('Institution-anchored day boundaries', () => {
  it('files an instant under the Institution day, not the device day', () => {
    // 03:45Z on the 27th is 23:45 on the 26th at Chautauqua.
    expect(dayKeyOf(new Date('2026-07-27T03:45:00Z'))).toBe('2026-07-26');
  });

  it('starts a day at Institution midnight', () => {
    expect(startOfDay('2026-07-27').toISOString()).toBe('2026-07-27T04:00:00.000Z');
  });

  it('starts a winter day at Institution midnight', () => {
    expect(startOfDay('2026-01-15').toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  it('ends a day at the next Institution midnight', () => {
    expect(dayAfter('2026-07-27').toISOString()).toBe('2026-07-28T04:00:00.000Z');
  });

  it('tiles exactly: one day\'s end is the next day\'s start', () => {
    expect(dayAfter('2026-03-07').getTime()).toBe(startOfDay('2026-03-08').getTime());
    expect(dayAfter('2026-10-31').getTime()).toBe(startOfDay('2026-11-01').getTime());
  });

  it('treats Institution midnight as midnight for lastDayCovered', () => {
    // 04:00Z is midnight EDT, so the window does not show that day.
    expect(lastDayCovered(new Date('2026-07-28T04:00:00.000Z'))).toBe('2026-07-27');
  });

  it('keeps the final day when a window ends mid-day at Chautauqua', () => {
    // Noon EDT Saturday — 'this-week' ends here and that morning has events.
    expect(lastDayCovered(new Date('2026-07-25T16:00:00.000Z'))).toBe('2026-07-25');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts -t "Institution-anchored"`
Expected: FAIL — the device-local implementations return `2026-07-27` and midnight-local instants.

- [ ] **Step 3: Write the implementation**

In `frontend/src/lib/utils/dayWindow.ts`, add the import and replace the five functions.

Import:

```ts
import { chqDateAt, chqDayKey, chqParts } from '@/lib/utils/chqTime';
```

Update the `DayKey` doc comment's first line from `in local time` to:

```ts
/**
 * A calendar day as `yyyy-mm-dd`, zero-padded, in Institution time.
 *
```

Replace the function bodies:

```ts
export function dayKeyOf(d: Date): DayKey {
  return chqDayKey(d);
}

export function startOfDay(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  return chqDateAt(y, m, d, 0, 0, 0, 0);
}

export function dayAfter(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  // Built by adding a calendar day, never 86,400,000ms: a DST transition day
  // is 23 or 25 hours long, and millisecond arithmetic lands an hour out.
  return chqDateAt(y, m, d + 1, 0, 0, 0, 0);
}

export function lastDayCovered(endExclusive: Date): DayKey {
  const p = chqParts(endExclusive);
  const isMidnight = p.hour === 0 && p.minute === 0 && p.second === 0;
  const key = dayKeyOf(endExclusive);
  return isMidnight ? addDays(key, -1) : key;
}

export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = partsOf(key);
  return dayKeyOf(chqDateAt(y, m, d + n, 12, 0, 0, 0));
}
```

Also replace `isDayKey`'s body, which validated against a device-local `Date`:

```ts
function isDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = partsOf(key);
  // Noon, not midnight: a date that does not exist rolls over, and noon is
  // far enough from any DST edge that only a genuine rollover moves the day.
  return dayKeyOf(chqDateAt(y, m, d, 12)) === key;
}
```

Note the deliberate `12` in `addDays` and `isDayKey`: `chqDateAt` normalises the nonexistent 02:00 on a spring-forward day to 03:00, so anchoring at noon keeps the arithmetic away from the boundary entirely.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts`
Expected: PASS — both the new cases and every pre-existing case in the file, including the DST-transition tests.

- [ ] **Step 5: Validate and commit**

```bash
cd frontend && npm run validate
cd .. && git add frontend/src/lib/utils/dayWindow.ts frontend/src/__tests__/lib/utils/dayWindow.test.ts
git commit -m "feat(web): anchor day keys and day boundaries to Institution time"
```

---

### Task 3: Event parsing, grouping, and filtering

**Files:**
- Modify: `frontend/src/lib/utils/eventHelpers.ts:95-136` — `weekNumbersForCalendarDate`, `groupEventsByDay`
- Modify: `frontend/src/lib/utils/filterHelpers.ts:39`
- Test: `frontend/src/__tests__/lib/utils/eventHelpers.test.ts` (existing — add to it)

**Interfaces:**
- Consumes: `parseEventDate`, `formatChqDayLabel`, `chqParts`, `chqDateAt` from Task 1; `dayKeyOf` from Task 2.
- Produces: unchanged signatures — `groupEventsByDay(events: Event[], seasonWeeks: SeasonWeek[]): DayGroup[]`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/lib/utils/eventHelpers.test.ts`:

```ts
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

describe('groupEventsByDay in Institution time', () => {
  const ev = (id: string, startDate: string): Event =>
    ({ id, title: id, startDate } as Event);

  it('files a late-evening event under the Institution day it belongs to', () => {
    const groups = groupEventsByDay([ev('a', '2026-07-26 23:45:00')], []);
    expect(groups[0].key).toBe('2026-07-26');
  });

  it('labels the group with the Institution day', () => {
    const groups = groupEventsByDay([ev('a', '2026-07-26 23:45:00')], []);
    expect(groups[0].baseLabel).toBe('Sunday, July 26, 2026');
  });

  it('keeps an unparseable date out of the real days rather than crashing', () => {
    const groups = groupEventsByDay([ev('bad', 'not a date')], []);
    expect(groups[0].key).toBe('NaN-NaN-NaN');
  });

  it('sorts within a day by true instant', () => {
    const groups = groupEventsByDay([
      ev('late', '2026-07-27 19:00:00'),
      ev('early', '2026-07-27 09:00:00'),
    ], []);
    expect(groups[0].events.map(e => e.id)).toEqual(['early', 'late']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/eventHelpers.test.ts -t "Institution time"`
Expected: FAIL — `baseLabel` renders in the device zone and, under the pinned test TZ, the key is right for the wrong reason.

- [ ] **Step 3: Write the implementation**

In `frontend/src/lib/utils/eventHelpers.ts`, add:

```ts
import { chqDateAt, chqParts, formatChqDayLabel, parseEventDate } from '@/lib/utils/chqTime';
```

Replace `weekNumbersForCalendarDate` (line 95):

```ts
function weekNumbersForCalendarDate(date: Date, seasonWeeks: SeasonWeek[]): number[] {
  const { year, month, day } = chqParts(date);
  const dayStart = chqDateAt(year, month, day, 0, 0, 0, 0);
  // Half-open against the next Institution midnight, so a DST day of 23 or
  // 25 hours needs no special case.
  const dayEnd = chqDateAt(year, month, day + 1, 0, 0, 0, 0);
  const numbers: number[] = [];
  for (const w of seasonWeeks) {
    if (w.start < dayEnd && w.end > dayStart) {
      numbers.push(w.number);
    }
  }
  return numbers;
}
```

In `groupEventsByDay`, replace the two `new Date(...)` reads:

```ts
    const eventDate = parseEventDate(event.startDate);
```

```ts
      const baseLabel = formatChqDayLabel(eventDate);
```

and the sort:

```ts
    group.events.sort(
      (a, b) => parseEventDate(a.startDate).getTime() - parseEventDate(b.startDate).getTime()
    );
```

In `frontend/src/lib/utils/filterHelpers.ts`, add the import and replace line 39:

```ts
import { parseEventDate } from '@/lib/utils/chqTime';
```

```ts
  filtered = filtered.filter((event) => windowContains(dateWindow, parseEventDate(event.startDate)));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/eventHelpers.test.ts src/__tests__/lib/utils/filterHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate and commit**

```bash
cd frontend && npm run validate
cd .. && git add frontend/src/lib/utils/eventHelpers.ts frontend/src/lib/utils/filterHelpers.ts frontend/src/__tests__/lib/utils/eventHelpers.test.ts
git commit -m "feat(web): parse, group and filter events in Institution time"
```

---

### Task 4: Season weeks and "now"

**Files:**
- Modify: `frontend/src/lib/utils/dateHelpers.ts` — `getChautauquaSeasonWeeks`, `isInChautauquaWeek`, `isWeekInPast`, `getCurrentWeekNumber`, `getAdaptiveEndDate`
- Test: `frontend/src/__tests__/lib/utils/dateHelpers.test.ts` (existing — add to it)

**Interfaces:**
- Consumes: `parseEventDate`, `chqDateAt`, `chqParts` from Task 1.
- Produces: unchanged signatures — `getChautauquaSeasonWeeks(year: number): SeasonWeek[]`, `isInChautauquaWeek(dateString: string, weekNumber: number, seasonWeeks: SeasonWeek[]): boolean`, `isWeekInPast(weekNumber: number, seasonWeeks: SeasonWeek[]): boolean`, `getCurrentWeekNumber(seasonWeeks: SeasonWeek[]): number | null`, `getAdaptiveEndDate(events: Event[], startDate: Date, minEvents: number): Date`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/lib/utils/dateHelpers.test.ts`:

```ts
describe('season weeks in Institution time', () => {
  it('starts week 1 at Saturday noon at Chautauqua, not noon on the device', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    // 2026's 4th Sunday of June is the 28th; the Saturday before is the 27th.
    // Noon EDT on 2026-06-27 is 16:00Z.
    expect(weeks[0].start.toISOString()).toBe('2026-06-27T16:00:00.000Z');
  });

  it('runs each week exactly seven calendar days, noon to noon', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    expect(weeks[0].end.toISOString()).toBe('2026-07-04T16:00:00.000Z');
    expect(weeks).toHaveLength(9);
  });

  it('tiles: each week ends where the next begins', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i].start.getTime()).toBe(weeks[i - 1].end.getTime());
    }
  });

  it('places an event by its Institution instant', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    // 11:00 on the Saturday is still the previous week; 13:00 is the next.
    expect(isInChautauquaWeek('2026-07-04 11:00:00', 1, weeks)).toBe(true);
    expect(isInChautauquaWeek('2026-07-04 13:00:00', 1, weeks)).toBe(false);
    expect(isInChautauquaWeek('2026-07-04 13:00:00', 2, weeks)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dateHelpers.test.ts -t "Institution time"`
Expected: FAIL — the weeks are built with device-local `new Date(year, 5, 1)` and `setHours(12, ...)`.

- [ ] **Step 3: Write the implementation**

In `frontend/src/lib/utils/dateHelpers.ts`, add:

```ts
import { chqDateAt, chqParts, parseEventDate } from '@/lib/utils/chqTime';
```

Replace `getChautauquaSeasonWeeks` (lines 3-49):

```ts
export function getChautauquaSeasonWeeks(year: number): SeasonWeek[] {
  // The 4th Sunday of June, found by walking Institution calendar days.
  // Anchored at noon throughout: a DST transition never falls at midday, so
  // the walk cannot be knocked onto a neighbouring day.
  let sundayCount = 0;
  let fourthSundayDay: number | null = null;
  for (let day = 1; day <= 30; day++) {
    if (chqParts(chqDateAt(year, 6, day, 12)).weekday === 0) {
      sundayCount++;
      if (sundayCount === 4) { fourthSundayDay = day; break; }
    }
  }
  // June always contains four Sundays, so this cannot be null — but a
  // silent NaN downstream would be far worse than an explicit throw.
  if (fourthSundayDay === null) {
    throw new Error(`no 4th Sunday of June ${year}`);
  }

  const weeks: SeasonWeek[] = [];
  for (let i = 0; i < 9; i++) {
    // Week 1 starts at noon on the Saturday before, i.e. the day before the
    // 4th Sunday. `chqDateAt` normalises out-of-range days, so subtracting
    // one and adding 7i needs no month arithmetic here.
    const startDayOfJune = fourthSundayDay - 1 + i * 7;
    const start = chqDateAt(year, 6, startDayOfJune, 12);
    const end = chqDateAt(year, 6, startDayOfJune + 7, 12);
    weeks.push({
      number: i + 1,
      start,
      end,
      label: `Week ${i + 1} (${formatWeekEdge(start)} 12pm - ${formatWeekEdge(end)} 12pm)`,
    });
  }
  return weeks;
}

const weekEdgeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
});

/** `"Jun 27"` at Chautauqua — the week label's edges. */
function formatWeekEdge(d: Date): string {
  return weekEdgeFormatter.format(d);
}
```

Replace `isInChautauquaWeek`'s parse:

```ts
export function isInChautauquaWeek(dateString: string, weekNumber: number, seasonWeeks: SeasonWeek[]): boolean {
  const eventDate = parseEventDate(dateString);
  const week = seasonWeeks[weekNumber - 1];
  return eventDate >= week.start && eventDate < week.end;
}
```

`isWeekInPast` and `getCurrentWeekNumber` compare `new Date()` — a true instant — against `week.start`/`week.end`, which are now true instants. **Leave both unchanged**; they become correct automatically once the week boundaries are right.

In `getAdaptiveEndDate`, replace the three event parses and the day arithmetic:

```ts
  const futureEvents = events
    .filter(e => parseEventDate(e.startDate) >= startDate)
    .sort((a, b) => parseEventDate(a.startDate).getTime() - parseEventDate(b.startDate).getTime());

  if (futureEvents.length === 0) {
    const p = chqParts(startDate);
    return chqDateAt(p.year, p.month, p.day + 91, 0, 0, 0, 0);
  }
```

and inside the loop:

```ts
  for (const event of futureEvents) {
    const eventDate = parseEventDate(event.startDate);
    const p = chqParts(eventDate);
    const eventDay = chqDateAt(p.year, p.month, p.day, 0, 0, 0, 0);

    if (!currentDayDate || eventDay.getTime() !== currentDayDate.getTime()) {
      if (currentDayDate) {
        // Exclusive end-of-day: the next Institution midnight, so a 23- or
        // 25-hour DST day needs no special case.
        const c = chqParts(currentDayDate);
        lastCompleteDayEnd = chqDateAt(c.year, c.month, c.day + 1, 0, 0, 0, 0);
        if (accumulated >= minEvents) {
          return lastCompleteDayEnd;
        }
      }
      currentDayDate = eventDay;
    }
    accumulated++;
  }

  const last = chqParts(currentDayDate!);
  return chqDateAt(last.year, last.month, last.day + 1, 0, 0, 0, 0);
```

Note this converts `getAdaptiveEndDate` from an inclusive `23:59:59.999` bound to an exclusive next-midnight bound, matching the half-open rule in Global Constraints.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dateHelpers.test.ts`
Expected: PASS. If a pre-existing case asserts `23:59:59.999`, update it to the next Institution midnight and note the half-open change in the commit message — do not weaken the assertion.

- [ ] **Step 5: Validate and commit**

```bash
cd frontend && npm run validate
cd .. && git add frontend/src/lib/utils/dateHelpers.ts frontend/src/__tests__/lib/utils/dateHelpers.test.ts
git commit -m "feat(web): build season weeks on Institution noon boundaries"
```

---

### Task 5: Display, countdown, today, and the default year

**Files:**
- Modify: `frontend/src/components/calendar/EventCard.tsx:52-56`
- Modify: `frontend/src/components/layout/CountdownBanner.tsx:12,21-25`
- Modify: `frontend/src/lib/constants.ts:19-23` — `getDefaultYear`
- Modify: `frontend/src/app/page.tsx:312` — `todayKey`
- Test: `frontend/src/__tests__/lib/constants.test.ts` (create if absent), `frontend/src/__tests__/components/calendar/EventCard.test.tsx` (existing)

**Interfaces:**
- Consumes: `formatChqTime`, `chqParts`, `parseEventDate` from Task 1; `dayKeyOf` from Task 2.
- Produces: `getDefaultYear(): number` unchanged in signature.

- [ ] **Step 1: Write the failing test**

Create or append to `frontend/src/__tests__/lib/constants.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultYear } from '@/lib/constants';

afterEach(() => { vi.useRealTimers(); });

describe('getDefaultYear', () => {
  it('turns over on October 1 at Chautauqua, not on the device', () => {
    // 2026-10-01T03:00:00Z is still 23:00 on September 30 at Chautauqua,
    // so the season year must not have turned over yet.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
    expect(getDefaultYear()).toBe(2026);
  });

  it('turns over once Chautauqua reaches October', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T05:00:00Z')); // 01:00 EDT, Oct 1
    expect(getDefaultYear()).toBe(2027);
  });
});
```

Append to `frontend/src/__tests__/components/calendar/EventCard.test.tsx`:

```ts
describe('event time display', () => {
  it('shows the Institution wall time, unlabelled', () => {
    // 23:00Z is 7:00 PM EDT.
    render(<EventCard {...baseProps} event={{ ...baseProps.event, startDate: '2026-07-27 19:00:00' }} />);
    expect(screen.getByText(/7:00 PM/)).toBeTruthy();
    expect(screen.queryByText(/ET|EDT|EST/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/constants.test.ts`
Expected: FAIL on the first case — device-local `getMonth()` already reads October.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/constants.ts`:

```ts
import { chqParts } from '@/lib/utils/chqTime';

/**
 * The default season year, turning over on October 1 — at Chautauqua.
 *
 * Read in Institution time so a reader east of Eastern does not see next
 * season a few hours early on September 30.
 */
export function getDefaultYear(): number {
  const { year, month } = chqParts(new Date());
  return month >= 10 ? year + 1 : year;
}
```

`frontend/src/components/calendar/EventCard.tsx` — add the import and replace the time expression:

```ts
import { formatChqTime, parseEventDate } from '@/lib/utils/chqTime';
```

```tsx
              🕐 {formatChqTime(parseEventDate(event.startDate))}
```

`frontend/src/components/layout/CountdownBanner.tsx` — `now` is a true instant and `seasonWeeks[0].start` is now a true instant, so the comparison is already right. Only the *rendered date* needs the zone. Add the import and replace the formatter:

```ts
import { CHQ_ZONE } from '@/lib/utils/chqTime';
```

```ts
  const dateStr = seasonStart.toLocaleDateString('en-US', {
    timeZone: CHQ_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
```

`frontend/src/app/page.tsx:312` needs no edit — `dayKeyOf(new Date())` became Institution-anchored in Task 2. Confirm by reading the line; leave it alone if it already reads `dayKeyOf(isCurrentYear ? ... : null)`.

The two `now: new Date()` sites (`page.tsx:114,156`) also need no edit: they pass a true instant, and every value they are compared against is now a true instant.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/constants.test.ts src/__tests__/components/calendar/EventCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Validate and commit**

```bash
cd frontend && npm run validate
cd .. && git add frontend/src/lib/constants.ts frontend/src/components/calendar/EventCard.tsx frontend/src/components/layout/CountdownBanner.tsx frontend/src/__tests__/lib/constants.test.ts frontend/src/__tests__/components/calendar/EventCard.test.tsx
git commit -m "feat(web): render times and the season turnover in Institution time"
```

---

### Task 6: Preserve the ICS export

**Files:**
- Modify: `frontend/src/lib/utils/icsHelpers.ts:33-43` — `formatICSDate`
- Test: `frontend/src/__tests__/lib/utils/icsHelpers.test.ts` (existing — add to it)

**Interfaces:**
- Consumes: `chqParts`, `parseEventDate` from Task 1.
- Produces: `generateICS(event: Event): string` unchanged.

This task changes no behaviour. `formatICSDate` is correct today by accident — it parses naive-as-device-local and reads device-local components back, an identity round-trip — and the file declares `DTSTART;TZID=America/New_York`. Once Task 3 has moved parsing, that accident no longer holds, so the reader must move with it.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/lib/utils/icsHelpers.test.ts`:

```ts
describe('ICS times are Institution wall time', () => {
  it('emits the feed\'s wall clock verbatim under TZID America/New_York', () => {
    const ics = generateICS({ id: 'x', title: 'T', startDate: '2026-07-27 12:45:00', endDate: '2026-07-27 13:45:00' } as Event);
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260727T124500');
    expect(ics).toContain('DTEND;TZID=America/New_York:20260727T134500');
  });

  it('round-trips a winter date without shifting an hour', () => {
    const ics = generateICS({ id: 'x', title: 'T', startDate: '2026-01-15 09:30:00', endDate: '2026-01-15 10:30:00' } as Event);
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260115T093000');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/icsHelpers.test.ts -t "Institution wall time"`
Expected: FAIL after Task 3 — the naive `new Date(dateStr)` no longer matches how the rest of the app reads that string. If it passes, the test is not yet discriminating; check Task 3 landed first.

- [ ] **Step 3: Write the implementation**

In `frontend/src/lib/utils/icsHelpers.ts`, add the import and replace `formatICSDate`:

```ts
import { chqParts, parseEventDate } from '@/lib/utils/chqTime';
```

```ts
/**
 * An ICS local datetime, `YYYYMMDDTHHMMSS`, in Institution time.
 *
 * Paired with `DTSTART;TZID=America/New_York`, so the components written
 * here must be Chautauqua's wall clock — which is exactly the wall clock the
 * feed gave us. The round trip is therefore an identity, and this function
 * existed in a device-local form that was correct only because parsing was
 * device-local too.
 */
function formatICSDate(dateStr: string): string {
  const { year, month, day, hour, minute, second } = chqParts(parseEventDate(dateStr));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${year}${p2(month)}${p2(day)}T${p2(hour)}${p2(minute)}${p2(second)}`;
}
```

Leave `formatICSTimestamp` unchanged — `DTSTAMP` is correctly UTC per RFC 5545.

Find the "+1 hour" default (`const endDate = new Date(event.startDate);` near line 80) and replace its parse:

```ts
    const endDate = parseEventDate(event.startDate);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/icsHelpers.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Validate and commit**

```bash
cd frontend && npm run validate
cd .. && git add frontend/src/lib/utils/icsHelpers.ts frontend/src/__tests__/lib/utils/icsHelpers.test.ts
git commit -m "fix(web): keep the ICS export on Institution wall time"
```

---

### Task 7: Prove it in a browser, from a non-Eastern device

**Files:**
- Modify: `frontend/e2e/verify-rail.mjs` — parameterise the context timezone
- Create: `frontend/e2e/verify-timezone.mjs`
- Modify: `frontend/package.json` — the `test:browser` script

**Interfaces:**
- Consumes: the running app.
- Produces: a `test:browser` script that also runs `verify-timezone.mjs`.

A unit-level `TZ` sweep cannot prove this: `vitest.config.ts` pins `TZ: 'America/New_York'` on purpose, and the whole suite passes unchanged under `UTC`, `America/Los_Angeles`, `Asia/Tokyo` and `Pacific/Kiritimati`. Playwright's per-context `timezoneId` is not defeated that way.

- [ ] **Step 1: Write the failing check**

Create `frontend/e2e/verify-timezone.mjs`:

```js
/**
 * The app shows Chautauqua's day and Chautauqua's clock regardless of where
 * the reader's device thinks it is.
 *
 * Asserted by rendering the same page under four device timezones and
 * requiring the results to be identical, rather than by hardcoding an
 * expected day — the fixture is live production data, so the only stable
 * property is agreement.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:3000/';
const ZONES = ['America/New_York', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo'];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();

async function readUnder(timezoneId) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, timezoneId });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-day-key]', { timeout: 30000 });
  const out = await page.evaluate(() => ({
    days: [...document.querySelectorAll('[data-day-key)'.replace(')', ']'))].map(e => e.dataset.dayKey).slice(0, 6),
    headers: [...document.querySelectorAll('[data-day-header]')].map(e => e.textContent.trim()).slice(0, 6),
    times: [...document.querySelectorAll('.event-card')].slice(0, 12)
      .map(e => (e.textContent.match(/\d{1,2}:\d{2}\s?[AP]M/) ?? [''])[0]),
    today: document.querySelector('[data-chip][aria-current="date"]')?.dataset.chip ?? null,
    nowVisible: document.querySelectorAll('.event-card').length,
  }));
  await ctx.close();
  return out;
}

const baseline = await readUnder(ZONES[0]);
check('0 baseline rendered something to compare', baseline.days.length > 0,
  `${baseline.days.length} days, first=${baseline.days[0]}`);

for (const zone of ZONES.slice(1)) {
  const got = await readUnder(zone);
  check(`1 same days under ${zone}`,
    JSON.stringify(got.days) === JSON.stringify(baseline.days),
    `${got.days[0]}..${got.days.at(-1)} vs ${baseline.days[0]}..${baseline.days.at(-1)}`);
  check(`2 same day headers under ${zone}`,
    JSON.stringify(got.headers) === JSON.stringify(baseline.headers),
    got.headers[0] ?? '(none)');
  check(`3 same event times under ${zone}`,
    JSON.stringify(got.times) === JSON.stringify(baseline.times),
    got.times.slice(0, 3).join(', '));
  check(`4 same day is today under ${zone}`,
    got.today === baseline.today, `${got.today} vs ${baseline.today}`);
  check(`5 same events are upcoming under ${zone}`,
    got.nowVisible === baseline.nowVisible, `${got.nowVisible} vs ${baseline.nowVisible}`);
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
```

Fix the deliberate obfuscation on the `days` selector line before running — it must read:

```js
    days: [...document.querySelectorAll('[data-day-key]')].map(e => e.dataset.dayKey).slice(0, 6),
```

- [ ] **Step 2: Run it against the pre-change build to verify it fails**

```bash
cd frontend && git stash && npm run build && (npm run preview &)
until curl -sf http://localhost:3000/ -o /dev/null; do sleep 1; done
node e2e/verify-timezone.mjs
```

Expected: FAIL on `4 same day is today under Asia/Tokyo` and `5 same events are upcoming under America/Los_Angeles`.
Then: `pkill -f "vite preview"; git stash pop`.

- [ ] **Step 3: Wire it into the suite**

In `frontend/package.json`, extend the script:

```json
    "test:browser": "node e2e/verify-rail.mjs && node e2e/verify-filter-reveal.mjs && node e2e/verify-timezone.mjs"
```

- [ ] **Step 4: Run it against the changed build to verify it passes**

```bash
cd frontend && npm run build && (npm run preview &)
until curl -sf http://localhost:3000/ -o /dev/null; do sleep 1; done
npm run test:browser
pkill -f "vite preview"
```

Expected: PASS — all three suites, including every zone comparison.

- [ ] **Step 5: Confirm the Global Constraint and commit**

```bash
cd .. && git diff --stat main...HEAD -- . ':(exclude)frontend'
```

Expected: empty output. If anything is listed, a file outside `frontend/` was touched and must be reverted.

```bash
git add frontend/e2e/verify-timezone.mjs frontend/package.json
git commit -m "test(web): prove the app shows Chautauqua's day from any device timezone"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: the module (1), day keys and boundaries (2), parsing/grouping/filtering (3), season weeks and now-comparisons (4), display/countdown/today/default-year (5), ICS (6), the browser safeguard (7). The "all-or-nothing" table in the spec is covered row by row — parsing (3), now-comparisons (4), `todayKey` (2, via `dayKeyOf`), day keys (2), week boundaries (4), display (5), ICS (6). The client-only constraint is enforced by an explicit check in Task 7 Step 5.

**Placeholders.** None. Every code step carries the actual code; the one deliberate defect is the obfuscated selector in Task 7 Step 1, which Step 1 itself instructs the implementer to fix.

**Type consistency.** `chqParts` returns `ChqParts` with `year/month/day/hour/minute/second/weekday`, used with those exact names in Tasks 2-6. `chqDateAt(y, mo, d, h?, mi?, s?, ms?)` is called with 1-based months throughout. `parseEventDate` returns `Date` and is the only parser used after Task 3. `dayKeyOf` keeps its signature; only its meaning changes.

**Known risk carried into execution.** Tasks 2-4 change values that existing tests assert. Where a pre-existing assertion encodes the old device-local answer, update it and say so in the commit — never weaken it. Where one encodes the inclusive `23:59:59.999` bound, Task 4 converts it to the next Institution midnight deliberately.
