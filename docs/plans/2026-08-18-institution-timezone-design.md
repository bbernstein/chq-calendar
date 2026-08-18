# All times in the Institution's timezone

**Status:** Design, approved in conversation. Not yet implemented.
**Branch:** `feat/institution-timezone`

## The decision

> All times and dates, including "now", should be in the timezone of the
> Institution (America/New_York).

Times are **not labelled**. `7:00 PM` stays `7:00 PM` for everyone; no "ET"
suffix, no per-viewer variation.

## The data, and what must not change

Every event in the feed looks like this:

```json
{ "startDate": "2026-07-27 12:45:00",
  "endDate":   "2026-07-27 12:45:00",
  "timezone":  "America/New_York" }
```

Surveyed across all **3,246** events: the `startDate` format is uniform
(space-separated, naive, no offset, zero exceptions) and `timezone` is
`America/New_York` for every single one. The web has never read the
`timezone` field.

**This change touches `frontend/src/**` only.** No backend handler, no
`syncHandler`, nothing in the ingest path. `all-events.json` stays
byte-identical, so an old web bundle or the shipped iOS app fetches the same
bytes and runs the code it shipped with — unaffected by construction, not
merely in practice. The implementation diff must contain zero files outside
`frontend/`, and that is checkable rather than assertable.

Stored state is unaffected too: localStorage holds `dateFilter` (a string
enum), `selectedWeeks` (numbers) and day keys. Day keys are already
timezone-independent (see below). No instants are persisted, so there is
nothing to migrate.

### Why the fix is not in the data

Emitting offsets (`2026-07-27T12:45:00-04:00`) would fix every client at
once, including old ones. It is the wrong move here:

- The **shipped iOS app** parses with two fixed-format `DateFormatter`s,
  `"yyyy-MM-dd HH:mm:ss"` and `"yyyy-MM-dd'T'HH:mm:ss"`. A trailing offset
  is outside both. Whether `DateFormatter` tolerates trailing characters is
  not something to gamble on against a binary already on people's phones
  that cannot be patched retroactively.
- The **backend itself** assumes the naive shape — `articleMatcher`
  regex-matches `[T ](\d{2}):(\d{2})`.
- Blast radius: a data change reaches every client of every age plus backend
  services; a client change reaches one deployable that can be rolled back.

If offsets are ever wanted in the feed, the ordering is forced: ship iOS
parsers that accept both shapes, wait for adoption, *then* change the data.
Separate project.

## What is actually broken

Measured, not reasoned — the app's real logic run under four device zones
against one event (`2026-07-27 12:45:00`) and one fixed instant (12:50 EDT,
five minutes *after* it):

| Device TZ | Displayed | Day group | "Upcoming?" | "Today" |
|---|---|---|---|---|
| `America/New_York` | 12:45 PM | 2026-07-27 | no | 2026-07-27 |
| `UTC` | 12:45 PM | 2026-07-27 | no | 2026-07-27 |
| `America/Los_Angeles` | 12:45 PM | 2026-07-27 | **yes** ❌ | 2026-07-27 |
| `Asia/Tokyo` | 12:45 PM | 2026-07-27 | no | **2026-07-28** ❌ |

Display and day-grouping are **identical everywhere**, because parsing a
naive string as device-local and reading device-local components back is an
identity round-trip. The ICS export is correct for the same reason.

What breaks is comparison against the true current instant:

- **The `Now` scope.** West of Eastern, events look later than they are — an
  event that ended five minutes ago still reads as upcoming.
- **`todayKey`.** East of Eastern, "today" can be tomorrow, so `⟳ Now`, the
  day rail's anchor and the Today scope land on the wrong day.

This is the same defect that made CI's `⟳ Now` check fail after 20:00 UTC
(see [[browser-checks-e2e-time-dependence]]).

## The part that is easy to get wrong

An earlier draft of this design listed grouping, week assignment, display and
ICS as things to fix. That was wrong: each is **already correct**. But they
are correct only because everything — parsing, day keys, week boundaries,
formatting — is consistently device-local, so the offsets cancel.

The moment parsing moves to Institution time, that cancellation stops
holding. So those call sites must move too, not because they are broken but
because leaving them behind would break them:

| Site | Broken today? | Must change? | Why |
|---|---|---|---|
| Event parsing | yes (wrong instant) | yes | the root |
| `Now` scope / now-comparisons | **yes** | yes | user-visible defect |
| `todayKey` | **yes** | yes | user-visible defect |
| Day keys / grouping | no | **yes** | must read NY components off an NY instant |
| Season week boundaries | no | **yes** | Saturday *noon at Chautauqua* |
| Time display | no | **yes** | must format an NY instant in NY |
| ICS export | no | **yes** | must keep its round-trip property |

**It is all-or-nothing.** A partial migration leaves mixed semantics, which
is strictly worse than today's consistent-but-shifted state.

## The module

`frontend/src/lib/utils/chqTime.ts`, mirroring iOS's `ChqTime` rather than
inventing a second model — the two apps should agree about what a day is.

```
CHQ_ZONE = 'America/New_York'

parseEventDate(s)         naive "yyyy-MM-dd HH:mm:ss" | "...T..." -> instant
chqDayKey(instant)        the Chautauqua calendar day of an instant
chqStartOfDay(dayKey)     -> instant
chqDateAt(y, m, d, h, min)  Chautauqua wall time -> instant
formatChqTime(instant)    "7:00 PM", unlabelled
chqParts(instant)         { year, month, day, hour, minute } in CHQ_ZONE
```

Built on `Intl.DateTimeFormat` with `timeZone` — no new dependency, correct
across DST. Wall-time-to-instant uses the standard offset-lookup-and-correct
technique, which must be tested at both DST transitions
(2026-03-08, 2026-11-01).

## Call sites

- `lib/utils/dateHelpers.ts` — `getChautauquaSeasonWeeks` (the noon
  boundaries), `isInChautauquaWeek`, `isWeekInPast`, `getCurrentWeekNumber`,
  `getWeekNumberForDate`, `getAdaptiveEndDate`
- `lib/utils/dayWindow.ts` — `dayKeyOf`, `startOfDay`, `dayAfter`, `addDays`
- `lib/utils/eventHelpers.ts` — day grouping and sorting
- `lib/utils/filterHelpers.ts` — the window containment test
- `lib/utils/icsHelpers.ts` — preserve the round-trip
- `lib/constants.ts` — `getDefaultYear`'s October-1 turnover
- `app/page.tsx` — the two `now: new Date()` sites and `todayKey`
- `components/calendar/EventCard.tsx` — time display
- `components/layout/CountdownBanner.tsx`

## Testing, and one corrected proposal

**A second unit-test leg under `TZ=UTC` does not work.** `vitest.config.ts`
already pins `env: { TZ: 'America/New_York' }` on purpose — without it the
DST-transition tests in `dayWindow.test.ts` stop discriminating a DST-safe
implementation from naive millisecond arithmetic, because GitHub runners are
UTC where 2026-03-08 and 2026-11-01 are not transitions. The pin overrides
the environment: the full suite passes unchanged under `UTC`,
`America/Los_Angeles`, `Asia/Tokyo` and `Pacific/Kiritimati`. Verified.

The safeguard instead has two parts:

1. **Unit** — `chqTime` tested directly, including both DST transitions, and
   the existing suites extended where behaviour is now pinned rather than
   incidental (day keys, ICS round-trip).
2. **Browser** — the e2e already sets `timezoneId` per context (added in
   #241). Add a pass that drives the app under a **non-Eastern** zone and
   asserts the same days, the same grouping and the same rendered times as
   the Eastern pass. That tests the actual property — "the app shows
   Chautauqua's day regardless of the device" — at the layer where it
   matters, and no config pin can defeat it.

Every new guard proved by breaking the code first; see
[[falsify-guards-and-suspect-the-harness]] for the trap that a browser-check
falsification needs `npx vite build`, not `npm run build`.

## Out of scope

- Any backend or data change (see above).
- iOS — already correct via `ChqTime`.
- Timezone labels in the UI — explicitly declined.
