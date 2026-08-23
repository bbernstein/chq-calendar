# Pin the Screenshot Run to a Fixed Summer-2026 Instant — Implementation Record

> **Status:** Implemented on branch `feat/ios-pin-screenshot-date-222`.
> This is a record of what was built and why, written alongside the work
> rather than ahead of it — the spec is GitHub issue #222.

**Goal:** `ios/Scripts/capture-screenshots.sh` produces the same App Store
screenshots whatever the machine's real date is, and *what date they depict*
is one editable value.

**Spec:** GitHub issue #222, plus its comment: "We want to be able to set the
screenshot date easily. For now, let's set the default to a date near the
middle of the season on a Tuesday in early August."

## The two seams

A screenshot run has two independent inputs that both track real time, and
pinning either alone is worse than pinning neither:

| Input | Where it enters | Pin |
|---|---|---|
| The clock — relative labels, which events are upcoming, My Day's default day, the season landing state | `AppModel.launchNow()`, captured once into a `let` at `ChqCalendarApp.init` | `-uitest-freeze-now` (already existed, #177) |
| The dataset year — which `all-events-<year>.json` is fetched, and whether the app thinks it is showing the current season | `AppModel.start()` reads `defaultYear` off the server's `years.json` | `-uitest-pin-year` (new) |

Freezing only the clock means that once `years.json` names 2027 as its
default, a capture run renders **2027 events under a summer-2026 clock**.

## What was built

1. **`-uitest-pin-year <year>`** — a DEBUG-only launch argument, read by
   `AppModel.launchPinnedYear()` exactly the way `launchNow()` reads
   `-uitest-freeze-now`, and threaded into `AppModel.init(pinnedYear:)` from
   `ChqCalendarApp.init`. It binds at construction (not in `start()`) because
   the launching UI reads `selectedYear` before any manifest exists.
   `start()` then overrides `defaultYear` with it as well as `selectedYear`,
   so the pinned season reads as *the current* one (`isCurrentYear`) rather
   than as an archived year with its own chrome and downgraded date scope,
   and force-lists the pinned year among `years` so the picker cannot
   disagree with what is on screen.

   Both parsers were split into testable `parsedFrozenNow(from:)` /
   `parsedPinYear(from:)` seams — the clock parse now carries every shot, not
   just the one off-season shot it was written for, and it had no test.

2. **A run-wide `capture` block in `screenshot-plan.json`** —
   `{ "frozenNow": "2026-08-04 09:41:00", "pinYear": 2026 }`.
   `capture-screenshots.sh` prepends both flags to every automated shot's
   merged args, **unless that shot already passes the same flag** in either
   its `launchArgs` or its `deviceLaunchArgs`. This is the single knob for
   "what day does the listing depict."

3. **Both pins are required, and `capture-screenshots.sh` validates them
   before touching a simulator** — the run-wide pair and each shot's own
   override alike. This is a hard gate rather than a nicety because of *how*
   a bad value fails: the app falls back to the real clock and the server's
   default season exactly as if the flag were never passed, the run
   completes, the quality checks pass, and it silently ships screenshots of
   "now". That is the failure this whole mechanism exists to prevent, in its
   least visible form. The date pattern is deliberately stricter than
   `ChqTime.parse`, which accepts variable-width fields ("26-08-09" reads as
   year *26*).

   There is no unpinned mode. An earlier draft let a missing key "disable" a
   pin, which quietly turned `"capture": null`, a deleted block, and a
   mistyped key into "shoot today" — the failure the gate exists to catch,
   arriving through the one door the gate had no value to inspect.
   `.capture` must now be an object and must carry both keys.

4. **`compose-screenshots.py` records the pins** as a `depicts` block in
   `screenshots.manifest.json`, and treats a change to it as a manifest
   change even when the images happen to be byte-identical.

## The chosen instant: `2026-08-04 09:41:00`

Tuesday of Week 6 of the 2026 season (which runs Sat 2026-06-27 noon →
Sat 2026-08-29 noon), mid-morning, which is what the issue's comment asked
for. `09:41` echoes the Apple status-bar convention the run already sets via
`simctl status_bar`. Changing it later re-churns every screenshot, so it is
meant to stay put.

## The two deliberate exceptions

`01-season` and `07-my-day` keep their own `-uitest-freeze-now` values,
because each is coupled to data on a specific day rather than to "some day
mid-season":

- `01-season` pairs its clock with `-uitest-go-to-day 2026-07-30`, a day
  chosen for its linked-article density; the shot only reads right while
  that day is still ahead of "now."
- `07-my-day` seeds three favorite event ids that all live on 2026-07-27,
  and My Day opens on the day the starred events are on. Its 07:00 hour puts
  the whole day's plan ahead of "now" rather than half-past it.

Both now say so in their `note` in the plan file.

## What is still not pinned

- **`10-widget`**, for two independent reasons: the app is launched by hand
  from SpringBoard rather than through `simctl launch`, so no `-uitest-*`
  argument reaches it, and the widget's timeline is built in the widget
  extension against `Date()`, which nothing in the app can pin. It shows
  "next up" against the real clock and the real default season. Accepted
  as-is (a widget showing a couple of starred titles carries no visible date
  chrome), but it does mean that one capture has to be taken while the
  advertised season is still current. Recorded in its `manualNote`.
- **Event copy.** Titles, descriptions and which events carry a linked Daily
  article still come from live production, so the *content* of a given day is
  only as reproducible as the server. The dates are pinned; the prose is not.
- **The server's retention.** The year pin is a request for
  `all-events-2026.json` (and its `article-links-` / `program-links-`
  sidecars) — useful only while CloudFront still serves them.

## Verification

- Every script validation path was falsified against a deliberately
  corrupted copy of the plan, and the real plan verified to pass: run-wide
  clock, run-wide year, a shot's own clock, a shot's own year, a value living
  in `deviceLaunchArgs`, a flag left dangling at the end, a flag dangling in
  `launchArgs` that only *one* device's args happen to supply a value for,
  and a flag/value pair straddling the `launchArgs`/`deviceLaunchArgs` join
  with every device covered — the last of which must be **accepted**, since
  the app only ever sees the concatenation.

  Both of the wrong shapes that got there first validated a list no launch
  ever receives: scanning the two lists separately (rejects a straddling
  pair) and merging only the devices a shot mentions (skips the base-only
  list every unmentioned device launches with — the common case here, since
  most shots override `ipad-13` alone). The scan mirrors the capture loop's
  own merge argument for argument, which is the only correspondence that
  makes the check mean anything.
- `AppModelTests` gained 9 tests: the two parsers (present / absent /
  trailing / unparseable), the two launch entry points on an unflagged
  process, construction-time binding, the pin surviving a manifest that names
  a later default (plus a control proving the unpinned path *does* follow the
  manifest), and the pinned year being force-listed when the manifest omits
  it. Each was falsified by breaking the code it guards.
- Full unit leg: 953 tests, green.
- A real capture run against both devices, with `check-screenshots.py`'s
  byte-identical / dimmed-frame gate passing, and the manifest and review
  copies regenerated.
