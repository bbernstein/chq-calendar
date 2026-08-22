# Week Filters Include the Full Boundary Saturdays — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the week filter on both platforms match the day-header badge — a boundary Saturday belongs to *both* of its weeks, in full.

**Architecture:** Both platforms already ship a day-granular, overlapping week helper that drives the `Wk 5/6` badge (`SeasonCalendar.weekNumbers(spanningDayOf:)` on iOS, `weekNumbersForCalendarDate` on web). Only the filter predicate never adopted it. This repoints the filter at that helper on both platforms. No new model, no change to `SeasonCalendar.weeks`' noon bounds.

**Tech Stack:** Swift 6 / Swift Testing (iOS), TypeScript / Vitest (web).

**Spec:** GitHub issue #257. Background in `docs/superpowers/specs/2026-08-21-ios-events-chrome-consolidation-design.md` §A4.

## Global Constraints

- **`SeasonCalendar.weeks(forYear:)` keeps its Saturday-noon → Saturday-noon bounds.** They are when the Institution's weekly gate program turns over. This plan changes a *predicate*, never the model.
- **`SeasonCalendar.currentWeekNumber(at:)` (iOS) and `getCurrentWeekNumber` (web) stay noon-based and single-valued.** Siri's "what's the theme this week" cannot answer with two weeks, and `FilterChipState.isWeekSelected` reads `currentWeek`. Do not touch them.
- **`SeasonWeek.contains(_:)` stays and keeps its noon semantics.** Three other callers depend on it: `SeasonCalendar.currentWeekNumber:82`, `WeekStripState:51`, `ViewWindow:216`. Only `EventFilter:84` stops using it.
- **Both platforms ship together.** This is filter behaviour, not presentation. Do not merge one without the other.
- The 2026 season's week 1 runs **Sat Jun 27 12:00 → Sat Jul 4 12:00** NY. `2026-07-04` is the week 1 / week 2 boundary Saturday and is the canonical fixture date for every test below.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ios/ChqCalendarShared/Domain/EventFilter.swift` | The filter pipeline | week stage repointed |
| `ios/ChqCalendarTests/EventFilterTests.swift` | Filter behaviour | new week-overlap cases |
| `frontend/src/lib/utils/dateHelpers.ts` | Season/week date math | gains `weekNumbersForDate`, loses `isInChautauquaWeek` |
| `frontend/src/lib/utils/eventHelpers.ts` | Day grouping | its private helper delegates to the shared one |
| `frontend/src/lib/utils/filterHelpers.ts` | The filter pipeline | week stage repointed |
| `frontend/src/__tests__/lib/utils/dateHelpers.test.ts` | Date math | `isInChautauquaWeek` cases become `weekNumbersForDate` cases |
| `frontend/src/__tests__/lib/utils/filterHelpers.test.ts` | Filter behaviour | new week-overlap cases |

---

## Task 1: iOS — the week stage becomes day-granular

**Files:**
- Modify: `ios/ChqCalendarShared/Domain/EventFilter.swift:82-85`
- Test: `ios/ChqCalendarTests/EventFilterTests.swift`

**Interfaces:**
- Consumes: `SeasonCalendar.weekNumbers(spanningDayOf: Date, year: Int) -> [Int]` (already exists, already tested), `EventFilter.apply(_ sel: FilterSelection, to: [Event], favorites: Set<String>, now: Date, year: Int, isCurrentYear: Bool) -> [Event]`, `makeEvent(id:start:...)` from `ChqCalendarTests/TestSupport.swift`, `ChqTime.parse(_ s: String) -> Date?`.
- Produces: nothing new. Behaviour change only.

- [ ] **Step 1: Write the failing tests**

Append to `ios/ChqCalendarTests/EventFilterTests.swift`, inside `struct EventFilterTests`:

```swift
    // MARK: - apply: week stage spans full boundary Saturdays (#257)

    /// 2026 week 1 is Sat Jun 27 12:00 → Sat Jul 4 12:00. Jul 4 is the
    /// week 1 / week 2 boundary Saturday, and the day header already
    /// labels it `Wk 1/2`. Both halves of that day must now match both
    /// weeks, so the badge and the filter finally agree.
    @Test func boundarySaturdayMorningMatchesBothAdjacentWeeks() throws {
        let morning = try #require(ChqTime.parse("2026-07-04 11:00:00"))
        let event = makeEvent(id: "sat-am", start: morning)

        let week1 = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [1]),
            to: [event], favorites: [], now: morning, year: 2026, isCurrentYear: true)
        let week2 = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [2]),
            to: [event], favorites: [], now: morning, year: 2026, isCurrentYear: true)

        #expect(week1.map(\.id) == ["sat-am"])
        #expect(week2.map(\.id) == ["sat-am"])
    }

    @Test func boundarySaturdayAfternoonMatchesBothAdjacentWeeks() throws {
        let afternoon = try #require(ChqTime.parse("2026-07-04 13:00:00"))
        let event = makeEvent(id: "sat-pm", start: afternoon)

        let week1 = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [1]),
            to: [event], favorites: [], now: afternoon, year: 2026, isCurrentYear: true)
        let week2 = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [2]),
            to: [event], favorites: [], now: afternoon, year: 2026, isCurrentYear: true)

        #expect(week1.map(\.id) == ["sat-pm"])
        #expect(week2.map(\.id) == ["sat-pm"])
    }

    /// A midweek day is in exactly one week — the overlap is a property of
    /// the boundary Saturday, not of every day.
    @Test func midweekDayMatchesOnlyItsOwnWeek() throws {
        let tuesday = try #require(ChqTime.parse("2026-06-30 10:00:00"))
        let event = makeEvent(id: "tue", start: tuesday)

        let week1 = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [1]),
            to: [event], favorites: [], now: tuesday, year: 2026, isCurrentYear: true)
        let week2 = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [2]),
            to: [event], favorites: [], now: tuesday, year: 2026, isCurrentYear: true)

        #expect(week1.map(\.id) == ["tue"])
        #expect(week2.isEmpty)
    }

    /// The season edge widens: week 1's opening Saturday morning is before
    /// `weeks.first.start` (Jun 27 12:00) and used to match nothing, even
    /// though the day header labels it Week 1.
    @Test func openingSaturdayMorningMatchesWeekOne() throws {
        let morning = try #require(ChqTime.parse("2026-06-27 09:00:00"))
        let event = makeEvent(id: "open-am", start: morning)

        let result = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [1]),
            to: [event], favorites: [], now: morning, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["open-am"])
    }

    /// The mirror at the other end: week 9's closing Saturday afternoon is
    /// after `weeks.last.end` and used to match nothing.
    @Test func closingSaturdayAfternoonMatchesWeekNine() throws {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let lastWeek = try #require(weeks.last)
        let afternoon = lastWeek.end.addingTimeInterval(60 * 60)
        let event = makeEvent(id: "close-pm", start: afternoon)

        let result = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [9]),
            to: [event], favorites: [], now: afternoon, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["close-pm"])
    }

    /// Selecting adjacent weeks is a union, and the shared Saturday is not
    /// double-counted.
    @Test func adjacentWeeksUnionDoesNotDuplicateTheSharedSaturday() throws {
        let saturday = try #require(ChqTime.parse("2026-07-04 11:00:00"))
        let tuesday = try #require(ChqTime.parse("2026-06-30 10:00:00"))
        let events = [makeEvent(id: "sat", start: saturday), makeEvent(id: "tue", start: tuesday)]

        let result = EventFilter.apply(
            FilterSelection(dateScope: .all, selectedWeeks: [1, 2]),
            to: events, favorites: [], now: saturday, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id).sorted() == ["sat", "tue"])
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ios && xcodebuild test \
  -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO \
  -only-testing:ChqCalendarTests/EventFilterTests 2>&1 | tail -40
```

Expected: `boundarySaturdayMorningMatchesBothAdjacentWeeks` fails (week 2 is empty), `boundarySaturdayAfternoonMatchesBothAdjacentWeeks` fails (week 1 is empty), `openingSaturdayMorningMatchesWeekOne` fails (empty), `closingSaturdayAfternoonMatchesWeekNine` fails (empty). `midweekDayMatchesOnlyItsOwnWeek` and the union test should already pass.

Do **not** pin `OS=` in the destination — resolve the simulator at runtime. CI runs 3-core hosted runners, which is why `-parallel-testing-enabled NO` is mandatory.

- [ ] **Step 3: Repoint the week stage**

In `ios/ChqCalendarShared/Domain/EventFilter.swift`, replace lines 82-85:

```swift
        if !sel.selectedWeeks.isEmpty {
            let selected = weeks.filter { sel.selectedWeeks.contains($0.number) }
            result = result.filter { event in selected.contains { $0.contains(event.start) } }
        }
```

with:

```swift
        // Day-granular, and a boundary Saturday is in BOTH of its weeks
        // (#257). `weekNumbers(spanningDayOf:)` is the same helper that
        // drives the `Wk 5/6` day-header badge, so the filter and the badge
        // now answer the same question the same way; before this they
        // disagreed, and filtering to week 5 returned half of a day the
        // header called "weeks 5 and 6".
        //
        // `SeasonWeek.contains` is deliberately NOT used here any more, and
        // is deliberately still used by `SeasonCalendar.currentWeekNumber`,
        // `WeekStripState` and `ViewWindow` — those ask "which single week
        // is it *now*", a question the noon boundary answers correctly and
        // that must stay single-valued for Siri.
        if !sel.selectedWeeks.isEmpty {
            result = result.filter { event in
                !Set(SeasonCalendar.weekNumbers(spanningDayOf: event.start, year: year))
                    .isDisjoint(with: sel.selectedWeeks)
            }
        }
```

Note `weeks` is still used by the date stage above, so its `let weeks = SeasonCalendar.weeks(forYear: year)` binding at line 43 stays. If the compiler now warns it is unused, the date stage changed and something else is wrong — investigate rather than deleting the binding.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ios && xcodebuild test \
  -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO \
  -only-testing:ChqCalendarTests/EventFilterTests 2>&1 | tail -40
```

Expected: all pass.

- [ ] **Step 5: Run the full unit suite for regressions**

```bash
cd ios && xcodebuild test \
  -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO \
  -only-testing:ChqCalendarTests 2>&1 | tail -60
```

Expected: all pass. If `FilterChipStateTests`, `DateScopeExemptionTests` or `ViewWindowTests` fail, read the failure before changing anything — those cover `currentWeekNumber` and the *date scope* stage, neither of which this task touches. A failure there means the change reached further than intended.

- [ ] **Step 6: Falsify the guard**

Temporarily revert the implementation to `selected.contains { $0.contains(event.start) }`, re-run `EventFilterTests`, and confirm the four boundary tests fail. Restore the implementation. A test that passes against the old code is not testing this change.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendarShared/Domain/EventFilter.swift ios/ChqCalendarTests/EventFilterTests.swift
git commit -m "fix(ios): week filters span the full boundary Saturday (#257)

The day header already labels a boundary Saturday Wk 1/2, via
SeasonCalendar.weekNumbers(spanningDayOf:). The week filter used
SeasonWeek.contains instead, splitting that day at noon — so filtering
to week 1 returned half of a day the app had just called weeks 1 and 2.

Points the filter at the helper the badge already uses. SeasonWeek.contains
stays, and stays noon-based, for its three remaining callers:
currentWeekNumber, WeekStripState and ViewWindow all ask which single
week it is now, which must remain single-valued for Siri.

Widens the season edges as a consequence: week 1 now matches the opening
Saturday morning and week 9 the closing Saturday afternoon, both of which
sit on days the app already labels with those weeks."
```

---

## Task 2: web — the same change, and `isInChautauquaWeek` retires

**Files:**
- Modify: `frontend/src/lib/utils/dateHelpers.ts:50-54`
- Modify: `frontend/src/lib/utils/eventHelpers.ts:96-109`
- Modify: `frontend/src/lib/utils/filterHelpers.ts:3,43-47`
- Test: `frontend/src/__tests__/lib/utils/dateHelpers.test.ts:140-142`
- Test: `frontend/src/__tests__/lib/utils/filterHelpers.test.ts`

**Interfaces:**
- Consumes: `chqParts(d: Date): ChqParts`, `chqDateAt(year, month, day, h, m, s, ms): Date`, `parseEventDate(s: string): Date` — all from `@/lib/utils/chqTime`. `SeasonWeek` from `@/lib/types`.
- Produces: `weekNumbersForDate(date: Date, seasonWeeks: SeasonWeek[]): number[]`, exported from `dateHelpers.ts`. Returns 1–2 ascending week numbers, or `[]` for a date outside the season.
- Removes: `isInChautauquaWeek` — after this task it has no production caller.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/__tests__/lib/utils/dateHelpers.test.ts`, replace the three `isInChautauquaWeek` assertions at lines 140-142 with:

```ts
    // 2026 week 1 is Sat Jun 27 12:00 → Sat Jul 4 12:00. Jul 4 is the
    // week 1 / week 2 boundary and belongs to BOTH weeks, all day — the
    // same answer the `Wk 1/2` day-header badge has always given (#257).
    expect(weekNumbersForDate(parseEventDate('2026-07-04 11:00:00'), weeks)).toEqual([1, 2]);
    expect(weekNumbersForDate(parseEventDate('2026-07-04 13:00:00'), weeks)).toEqual([1, 2]);
    // A midweek day is in exactly one week.
    expect(weekNumbersForDate(parseEventDate('2026-06-30 10:00:00'), weeks)).toEqual([1]);
    // Out of season entirely.
    expect(weekNumbersForDate(parseEventDate('2026-01-15 10:00:00'), weeks)).toEqual([]);
```

Update that file's import on line 1 to:

```ts
import { getAdaptiveEndDate, getChautauquaSeasonWeeks, weekNumbersForDate } from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';
```

(If `parseEventDate` is already imported in that file, do not add it twice.)

Then append to `frontend/src/__tests__/lib/utils/filterHelpers.test.ts`:

```ts
describe('the weeks stage spans full boundary Saturdays (#257)', () => {
  const weeks = getChautauquaSeasonWeeks(2026);

  it('matches a boundary Saturday morning in both adjacent weeks', () => {
    const event = makeEvent({ id: 'sat-am', startDate: '2026-07-04 11:00:00' });
    expect(
      filterEvents([event], baseOptions({ dateFilter: 'all', selectedWeeks: [1], seasonWeeks: weeks }))
        .map(e => e.id)
    ).toEqual(['sat-am']);
    expect(
      filterEvents([event], baseOptions({ dateFilter: 'all', selectedWeeks: [2], seasonWeeks: weeks }))
        .map(e => e.id)
    ).toEqual(['sat-am']);
  });

  it('matches a boundary Saturday afternoon in both adjacent weeks', () => {
    const event = makeEvent({ id: 'sat-pm', startDate: '2026-07-04 13:00:00' });
    expect(
      filterEvents([event], baseOptions({ dateFilter: 'all', selectedWeeks: [1], seasonWeeks: weeks }))
        .map(e => e.id)
    ).toEqual(['sat-pm']);
    expect(
      filterEvents([event], baseOptions({ dateFilter: 'all', selectedWeeks: [2], seasonWeeks: weeks }))
        .map(e => e.id)
    ).toEqual(['sat-pm']);
  });

  it('keeps a midweek day in exactly one week', () => {
    const event = makeEvent({ id: 'tue', startDate: '2026-06-30 10:00:00' });
    expect(
      filterEvents([event], baseOptions({ dateFilter: 'all', selectedWeeks: [1], seasonWeeks: weeks }))
        .map(e => e.id)
    ).toEqual(['tue']);
    expect(
      filterEvents([event], baseOptions({ dateFilter: 'all', selectedWeeks: [2], seasonWeeks: weeks }))
    ).toEqual([]);
  });

  it('matches the opening Saturday morning in week 1', () => {
    const event = makeEvent({ id: 'open-am', startDate: '2026-06-27 09:00:00' });
    expect(
      filterEvents([event], baseOptions({ dateFilter: 'all', selectedWeeks: [1], seasonWeeks: weeks }))
        .map(e => e.id)
    ).toEqual(['open-am']);
  });

  it('does not duplicate the shared Saturday when both weeks are selected', () => {
    const events = [
      makeEvent({ id: 'sat', startDate: '2026-07-04 11:00:00' }),
      makeEvent({ id: 'tue', startDate: '2026-06-30 10:00:00' }),
    ];
    expect(
      filterEvents(events, baseOptions({ dateFilter: 'all', selectedWeeks: [1, 2], seasonWeeks: weeks }))
        .map(e => e.id).sort()
    ).toEqual(['sat', 'tue']);
  });
});
```

Read the top of `filterHelpers.test.ts` first: it already has a `baseOptions` factory (line ~32-45) and an event-building helper. Use the ones that are there — do not add a second `makeEvent` if one exists under another name, and pass `seasonWeeks` only if `baseOptions` does not already supply the 2026 weeks.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/dateHelpers.test.ts src/__tests__/lib/utils/filterHelpers.test.ts
```

Expected: `dateHelpers.test.ts` fails to import (`weekNumbersForDate` is not exported); the new `filterHelpers` cases fail on the boundary Saturday and opening Saturday.

Use `npx vitest run`, **not** `npm run build`. `npm run build` gates the bundle on the unit suite, so a deliberately-failing test blocks the build and you learn nothing.

- [ ] **Step 3: Add `weekNumbersForDate` to `dateHelpers.ts`**

In `frontend/src/lib/utils/dateHelpers.ts`, delete `isInChautauquaWeek` (lines 50-54) and add in its place:

```ts
/**
 * The season week number(s) whose `[start, end)` range intersects the
 * Institution calendar day containing `date` — ascending, 1-2 entries, or
 * `[]` for a date outside the season.
 *
 * A Chautauqua week runs Saturday noon to Saturday noon, so a boundary
 * Saturday intersects both the outgoing and the incoming week and this
 * returns two numbers for it. That is the model the `Wk 5/6` day-header
 * badge has always rendered; since #257 it is also the model the week
 * filter applies, so the two finally agree.
 *
 * This replaced `isInChautauquaWeek`, which answered the noon-split
 * question and had no caller left once `filterEvents` stopped asking it.
 * `getCurrentWeekNumber` and `getWeekNumberForDate` deliberately remain
 * single-valued and noon-based — "which week is it right now" is a
 * different question, and it must have one answer.
 */
export function weekNumbersForDate(date: Date, seasonWeeks: SeasonWeek[]): number[] {
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

Add `chqParts` and `chqDateAt` to `dateHelpers.ts`'s existing import from `@/lib/utils/chqTime` (it already imports `CHQ_ZONE`, `chqDateAt` and `parseEventDate` — check the exact line and extend it rather than adding a second import statement).

- [ ] **Step 4: Make `eventHelpers` delegate**

In `frontend/src/lib/utils/eventHelpers.ts`, delete the private `weekNumbersForCalendarDate` (lines 96-109) and change its single call site (line ~129) from:

```ts
        weekNumbers: weekNumbersForCalendarDate(eventDate, seasonWeeks),
```

to:

```ts
        weekNumbers: weekNumbersForDate(eventDate, seasonWeeks),
```

Add `weekNumbersForDate` to this file's import from `@/lib/utils/dateHelpers`, and drop `chqDateAt` / `chqParts` from its `chqTime` import **only if** nothing else in the file still uses them — grep before removing.

One helper now serves both the badge and the filter. That shared identity is the point of the task: it is what makes "the badge and the filter agree" a structural property rather than two functions that happen to match.

- [ ] **Step 5: Repoint the week stage**

In `frontend/src/lib/utils/filterHelpers.ts`, change the import on line 3:

```ts
import { weekNumbersForDate } from './dateHelpers';
```

and replace lines 43-47:

```ts
  // Week filter (independent of date filter)
  if (options.selectedWeeks.length > 0) {
    filtered = filtered.filter(event =>
      options.selectedWeeks.some(weekNum => isInChautauquaWeek(event.startDate, weekNum, options.seasonWeeks))
    );
  }
```

with:

```ts
  // Week filter (independent of date filter). Day-granular, and a boundary
  // Saturday is in BOTH of its weeks (#257) — the same helper that builds
  // the `Wk 5/6` day-header badge.
  //
  // Also one `parseEventDate` per event rather than one per selected week:
  // the old `some(...)` re-parsed the same string for every week in the
  // selection, and `parseEventDate` is ~51x the cost of `new Date`.
  if (options.selectedWeeks.length > 0) {
    const selected = new Set(options.selectedWeeks);
    filtered = filtered.filter(event =>
      weekNumbersForDate(parseEventDate(event.startDate), options.seasonWeeks)
        .some(n => selected.has(n))
    );
  }
```

`parseEventDate` is already imported in `filterHelpers.ts` (the date stage uses it on line ~40). Confirm rather than adding a duplicate import.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/dateHelpers.test.ts src/__tests__/lib/utils/filterHelpers.test.ts
```

Expected: all pass.

- [ ] **Step 7: Run the full frontend suite and validate**

```bash
cd frontend && npx vitest run && npm run validate
```

Expected: all tests pass, no type errors, no lint errors. `npm run validate` will catch a stale `isInChautauquaWeek` import anywhere it survived.

- [ ] **Step 8: Falsify the guard**

Temporarily change `weekNumbersForDate`'s loop condition to `w.start <= date && date < w.end` (the old noon predicate), run `npx vitest run src/__tests__/lib/utils/filterHelpers.test.ts`, and confirm the boundary-Saturday and opening-Saturday cases fail. Restore.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/utils/dateHelpers.ts frontend/src/lib/utils/eventHelpers.ts \
        frontend/src/lib/utils/filterHelpers.ts \
        frontend/src/__tests__/lib/utils/dateHelpers.test.ts \
        frontend/src/__tests__/lib/utils/filterHelpers.test.ts
git commit -m "fix(web): week filters span the full boundary Saturday (#257)

Mirrors the iOS change so the two platforms return the same events for
the same week filter. The day-granular helper that built the Wk 5/6
badge moves from eventHelpers into dateHelpers as weekNumbersForDate,
and both the badge and the filter now call it — the agreement is
structural rather than two functions that happened to match.

isInChautauquaWeek is deleted: filterEvents was its only production
caller. getCurrentWeekNumber and getWeekNumberForDate stay single-valued
and noon-based, because which week it is right now must have one answer.

Also one parseEventDate per event instead of one per selected week."
```

---

## Task 3: verify the two platforms agree

**Files:**
- No production changes. This task is a check that fails loudly if tasks 1 and 2 diverged.

- [ ] **Step 1: Compare the same fixture through both filters**

The two suites already assert identical behaviour on identical dates. Confirm by listing the four shared cases and checking each appears in both:

| Case | iOS test | web test |
|---|---|---|
| Boundary Sat morning → both weeks | `boundarySaturdayMorningMatchesBothAdjacentWeeks` | `matches a boundary Saturday morning in both adjacent weeks` |
| Boundary Sat afternoon → both weeks | `boundarySaturdayAfternoonMatchesBothAdjacentWeeks` | `matches a boundary Saturday afternoon in both adjacent weeks` |
| Midweek → one week | `midweekDayMatchesOnlyItsOwnWeek` | `keeps a midweek day in exactly one week` |
| Opening Sat morning → week 1 | `openingSaturdayMorningMatchesWeekOne` | `matches the opening Saturday morning in week 1` |

If any row is missing on a platform, add it there before proceeding.

- [ ] **Step 2: Run both suites clean**

```bash
cd frontend && npx vitest run
cd ../ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO -only-testing:ChqCalendarTests 2>&1 | tail -20
```

Expected: both green.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "week filters include the full boundary Saturdays (#257)" --body "Closes #257.

Both platforms already shipped a day-granular overlapping week helper driving the \`Wk 5/6\` day-header badge; only the filter predicate never adopted it, so the app could call a day 'weeks 1 and 2' and then return half of it when filtered to week 1. This points both filters at that helper.

Unchanged and deliberately so: \`SeasonCalendar.weeks\` noon bounds (the gate program), \`currentWeekNumber\` / \`getCurrentWeekNumber\` (must stay single-valued for Siri), and \`SeasonWeek.contains\` (still used by \`currentWeekNumber\`, \`WeekStripState\`, \`ViewWindow\`).

**Reviewer note — the season edges widen.** Week 1 now matches the opening Saturday's morning and week 9 the closing Saturday's afternoon; selecting all nine weeks goes from 63 days to all 64 day-keys. This is the same inconsistency in a third place, but it is a real boundary behaviour change and is the thing most worth a second opinion.

No UI changes. Both platforms ship together because this is filter behaviour, not presentation — staggering would make 'week 5' return different sets on iOS and web, and the widgets and Siri read the iOS predicate."
```

Do not merge. Hand the PR to the user.
