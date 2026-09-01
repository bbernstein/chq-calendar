# Implementation plan — year-aware navigation (#186 + #253)

**Spec (binding authority):**
`docs/superpowers/specs/2026-08-28-year-aware-navigation-186-253-design.md`
**Queue:** item 2 in `docs/plans/2026-08-27-work-queue.md` — iOS 1.1.4.
**Branch:** `feat/year-aware-navigation-186-253`.
**Deadline:** submit ~mid-September, live before **2026-10-01**.

The spec is APPROVED and its decisions are not open for re-litigation. This
file only decomposes it into dispatchable tasks. Where this file and the spec
disagree, the spec wins.

---

## Global Constraints

Every task is bound by all of these.

1. **Never commit to `main`.** All work lands on
   `feat/year-aware-navigation-186-253`.
2. **Prove every guard by breaking the code.** A test that has not been
   watched to fail against an injected defect is not evidence. This codebase
   has repeatedly produced tests that could not fail. For every new or
   materially changed test, inject the defect, record the exact failure
   output in the report, and revert the injection. When a falsification
   unexpectedly *passes*, suspect the harness before the theory.
3. **iOS test invocation** — from `ios/`, with
   `UDID=B55BD564-C8CE-4463-B7A4-A2042CBD3655` (iPhone 17, iOS 26.0):

   ```bash
   xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
     -destination "id=$UDID" -only-testing:ChqCalendarTests \
     -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
   ```

   - **A single Swift Testing test needs the `()` suffix**:
     `-only-testing:"ChqCalendarTests/AppModelTests/someTest()"`. Without the
     parentheses xcodebuild matches nothing, reports `Executed 0 tests`, and
     exits **TEST SUCCEEDED** — a silent green indistinguishable from a pass.
     Any narrowed run must confirm a non-zero executed count.
   - `-parallel-testing-enabled NO` is load-bearing. Keep it.
   - **Never run two `xcodebuild` invocations at once**, and never run the UI
     leg while anything else is building — they contend for the one booted
     simulator and fail as "Application is not running".
   - The UI leg (`ChqCalendarUITests`) dominates wall-clock. Only the task
     that owns UI tests runs it.
4. **No `project.pbxproj` edits.** All five source folders are Xcode 26
   synchronized folder groups; a new `.swift` file is picked up on the next
   build. If Xcode rewrites `project.pbxproj` in the working tree, that churn
   is cosmetic — `git checkout -- ChqCalendar.xcodeproj/project.pbxproj`
   rather than commit it.
5. **Comments are part of the deliverable.** This project has twice shipped a
   doc comment that described a gap as live after the gap closed (#288
   survived six months behind one). Any comment your change falsifies must be
   rewritten in the same commit, not noted for later.
6. **Do not dispatch subagents.** Review arrives from the controller.
7. **Commit on completion** with a concise subject
   (`feat(ios): …` / `fix(ios): …` / `test(ios): …` / `chore: …`), one
   logical change per commit.

---

## Task 1 — `LandingState.preSeason` carries its archive year

**Files:** `ios/ChqCalendarShared/Domain/LandingState.swift`,
`ios/ChqCalendarTests/LandingStateTests.swift`, plus every site that pattern-
matches `.preSeason` (find them with
`grep -rn "preSeason" ios --include="*.swift"`).

### What to build

1. Change the case to:

   ```swift
   case preSeason(opening: Date, daysUntil: Int, archiveYear: Int?)
   ```

2. In `determine`, compute it where `.preSeason` is returned:
   `availableYears.filter { $0 < selectedYear }.max()`. `determine` already
   receives `availableYears`; no signature change.

   **The newest earlier year present in the manifest — not
   `selectedYear - 1`.** That is a decision already taken (spec, "Decisions
   taken" §2): `selectedYear - 1` can name a year `availableYears` lacks,
   whose feed 404s into an empty screen. `nil` when there is no earlier year,
   which correctly hides the button.

3. `archiveYear` (the computed projection) returns the new associated value
   for `.preSeason` and continues to return `endedSeasonYear` for
   `.postSeason`. It stays a pure projection over the case's own values — do
   not reach for `AppModel` state from it.

4. **Rewrite `archiveYear`'s doc comment.** It currently spends a paragraph
   explaining why `.preSeason` is unconditionally `nil` and calls hiding the
   button "the mitigation until a year-aware `browsePastSeason(year:)`
   exists". Every sentence of that becomes false here. Replace it with what
   the rule now is and why the manifest-derived year (not `selectedYear - 1`)
   is the one offered.

5. Update every `.preSeason` pattern match across the app, widgets and tests
   so the project builds. Most will take `_` for the new value.

### Tests

In `LandingStateTests.swift`:

- `determine` puts the newest earlier year on `.preSeason`.
- `nil` when `availableYears` holds no earlier year.
- **Skips a gap in the manifest**: `availableYears = [2024, 2027]`,
  `selectedYear = 2027` → `2024`, not `2026`.
- `archiveYear` returns the new value for `.preSeason`, and still returns
  `endedSeasonYear` for `.postSeason`.

**Adding an associated value touches every `determine` assertion in this
file.** After updating them, **re-falsify the ones you did not write**.
`landingStateIsInSeasonWithoutASnapshot` had exactly this happen during #288:
a new rule silently made an existing guard's test unfalsifiable, and only a
reviewer's aside caught it. For each pre-existing `determine` assertion you
touched, inject a defect into the rule it claims to pin and confirm it goes
red. Report any that do not — that is a finding, not a nuisance.

### Done when

The unit leg is green, every new test has been individually falsified with
the failure output recorded, and every pre-existing `determine` assertion you
edited has been re-falsified.

---

## Task 2 — `browsePastSeason(year:)` replaces `browseArchiveSeason()`

**Files:** `ios/ChqCalendar/App/AppModel.swift`,
`ios/ChqCalendar/Features/Calendar/OffSeasonLandingView.swift`,
`ios/ChqCalendarTests/AppModelTests.swift`.
**Depends on:** Task 1 (`.preSeason` must already carry `archiveYear`).

### What to build

1. **Replace** `browseArchiveSeason()` (`AppModel.swift:1104`) — do not leave
   it beside the new method:

   ```swift
   func browsePastSeason(year: Int) async {
       if year != selectedYear { await select(year: year) }
       filter = FilterSelection(dateScope: .season)
   }
   ```

   When `year == selectedYear` this is exactly today's behaviour with no
   extra fetch, so `.postSeason` is unchanged and the view needs no case
   analysis — one button, one method, both landing states. That is the whole
   reason for replacement over addition; say it in the doc comment.

2. **Doc comment.** The existing one explains at length why the button is
   hidden in `.preSeason` and names `browsePastSeason(year:)` as "the future
   path […] not implemented here (follow-up)". That is now false — rewrite
   it. Carry over `previewNextSeason()`'s `scopeResetCount` reasoning
   explicitly: no bump is needed because this always changes either
   `Key.year` (via `select`) or `dateScope` (`.next` → `.season`), both
   `PendingDayScroll.Key` fields (#254). The next reader will ask.

3. `OffSeasonLandingView.swift:126` already reads
   `if let archiveYear = model.landingState.archiveYear` — leave that
   condition alone. Only the action changes:

   ```swift
   Task { await model.browsePastSeason(year: archiveYear) }
   ```

### Tests

In `AppModelTests.swift` — `browseArchiveSeasonShowsTheEndedSeasonWhenThe
DefaultFilterHasGoneEmpty` (`:958`) is the existing coverage; rename/retarget
it rather than orphaning it.

- Switches year **and** sets `.season` when `year != selectedYear`.
- Does **not** re-fetch when already on that year (assert against the fake
  repository's call count / recorded years, whatever the existing fakes in
  this file expose — follow the established pattern, do not invent a new
  test double).
- `.postSeason`'s behaviour is unchanged: calling it with the already-selected
  year still yields `dateScope == .season` on the same year.

Falsify each: e.g. drop the `if year != selectedYear` guard and confirm the
no-refetch test goes red; drop the `await select` and confirm the cross-year
test goes red.

### Done when

Unit leg green, `browseArchiveSeason` has zero remaining referrers
(`grep -rn browseArchiveSeason ios` returns only history-free hits — i.e.
nothing), and each new test has been falsified.

---

## Task 3 — `goToDay(crossingYears:)`

**Files:** `ios/ChqCalendar/App/AppModel.swift`,
`ios/ChqCalendarTests/AppModelTests.swift`.
**Depends on:** nothing in Tasks 1-2, but lands after them on the branch.

### What to build

Leave the synchronous `goToDay(_:)` (`AppModel.swift:1495`) **untouched**.
Add an async sibling:

```swift
@discardableResult
func goToDay(crossingYears dayKey: String) async -> Bool
```

Behaviour, in order:

1. Extract the year from `dayKey` (the leading `yyyy`). The key is guaranteed
   canonical `yyyy-MM-dd` upstream by `ChqTime.isCanonicalDayKey`
   (`ChqTime.swift:148`), but this method must not crash on a malformed one —
   refuse it.
2. `year == selectedYear` → delegate to `goToDay(dayKey)`, unchanged.
3. Otherwise: refuse unless `years.contains(year)`; `await select(year:)`;
   refuse if `snapshot == nil` afterwards (the fetch failed); then
   `goToDay(dayKey)`.

**Deliberately not inside `goToDay` itself.** The rail's day keys always come
from the current year's `navigableBounds`, so only the deep-link consumer can
produce a cross-year key. Confining the change here keeps `goToDay`
synchronous and leaves the rail's hot path — every chip tap — untouched. Say
that in the doc comment; a later reader will want to "simplify" it inward.

Same `@discardableResult ... -> Bool` contract as `goToDay(_:)`, so the
existing `guard model.goToDay(dayKey) else { return }` call-site shape carries
over unchanged apart from the `await`.

### Tests

In `AppModelTests.swift`, alongside the existing `goToDay*` tests (`:1853`ff):

- Navigates across a year: on `selectedYear` 2025 with 2026 in `years`, a
  2026 key selects 2026 and lands the window on that day, returning `true`.
- Refuses a year absent from the manifest (returns `false`, `selectedYear`
  unchanged, `filter` unchanged).
- Refuses when the fetch fails (`select(year:)` leaves `snapshot == nil`) —
  returns `false`.
- Same-year keys behave exactly as `goToDay(_:)` does today, including
  refusing a day outside `navigableBounds`.
- Refuses a malformed key.
- **Window hygiene (#234/#156).** A year change must not leave
  `windowStartDayKey`/`windowEndDayKey` widened from the old year. Assert the
  post-switch window fields against the new year's bounds.
  `ViewWindow.make` clamps expansion *inputs* per-year, so this may already
  hold — **test it rather than assume it**, and if it holds, the test's doc
  comment says *why* it holds, naming the clamp that provides it. If it does
  not hold, that is a real defect: fix it here and say so in the report.

Falsify each guard.

### Done when

Unit leg green; each guard falsified with recorded output; the window-hygiene
test either fails-then-passes against a real fix, or passes with a comment
naming the mechanism that makes it hold.

---

## Task 4 — the deep-link call site, and the take-once race

**Files:** `ios/ChqCalendar/Features/Calendar/EventListView.swift`,
`ios/ChqCalendarShared/Domain/OpenDayTarget.swift`,
`ios/ChqCalendarTests/` (a test for the take-once ordering).
**Depends on:** Task 3.

### What to build

`consumePendingDayLinkIfPossible()` (`EventListView.swift:596`) is
synchronous and is called from three places — two `.onChange` and one
`.onAppear` (`EventListView.swift:311-319`). It calls `selectDay(dayKey)`
(`:519`), which calls `goToDay` and then stamps a `PendingDayScroll.Target`.

Route it through `goToDay(crossingYears:)`. Two things make that non-trivial,
and **both are load-bearing**:

1. **`PendingDayScroll.key` reads `model.selectedYear` and `model.filter`**
   (`EventListView.swift:524-525`). The year switch changes both, so the stamp
   must happen *after* the await. Stamping first would record the old year and
   the pending scroll would read as stale the moment it was armed. Make
   `selectDay` async (or give it an async sibling) and await the model call
   before building the `Target` — **do not simply wrap the existing body in a
   `Task`.**

2. **Keep taking the key synchronously.**
   `resolvePendingDayDeepLinkIfPossible()` (`AppModel.swift:752`) is a
   take-once: it sets `pendingDeepLink = nil` as it returns the key. That
   matters because `select(year:)` replaces `snapshot`, which re-fires
   `.onChange(of: model.snapshot?.fetchedAt)` *during the await* and calls
   `consumePendingDayLinkIfPossible()` again. With the take still synchronous
   the re-entrant call finds nothing pending and no-ops, which is correct.
   **Move the take inside the `Task` and that stops being true** — the
   re-entrant call takes the same key a second time and navigates twice.

So the shape is: take the key synchronously, then
`Task { await selectDay(crossingYears: dayKey) }`.

3. **Rewrite `OpenDayTarget`'s type doc comment.** It currently documents the
   #253 failure as "a known gap, not a guarantee this type closes. Fixing that
   is a design change (year-switching) outside this intent's scope." That
   becomes false the moment this lands. #288 shipped behind exactly such a
   comment and the divergence survived six months; do not repeat it one file
   over. State what now happens: the intent still resolves against
   `IntentDataSource.defaultYear()`, and the app switches to the key's year
   when it consumes the link — the key is year-qualified, so nothing crosses
   the process boundary.

### Tests

**The pending day key is consumed exactly once across the year switch.** A
snapshot replacement mid-`select(year:)` re-fires
`.onChange(of: model.snapshot?.fetchedAt)` and calls the consumer again; the
key must not be taken, or navigated, twice.

This is the spec's own emphasis: it spends more words on this race than on
anything else and would otherwise pin none of it. **Writing a trap down is not
guarding it.**

The ordering it depends on is *invisible* in the finished code — a later
reader tidying `consumePendingDayLinkIfPossible()` by inlining the take into
the `Task`, which reads as a simplification, breaks it silently and nothing
fails. So **falsify this one by performing exactly that edit**: inline the
take into the `Task`, watch the test go red, revert.

If the race is not reachable from a unit test against `AppModel` alone,
pin what *is* — that `resolvePendingDayDeepLinkIfPossible()` returns the key
once and `nil` on every subsequent call, and that a second call during an
in-flight year switch yields `nil` — and say plainly in the report which half
of the race the unit test covers and which half Task 5's UI test must carry.
Do not claim coverage you do not have.

### Done when

Unit leg green; the take-once test falsified by the inlining edit described
above; `OpenDayTarget`'s comment rewritten.

---

## Task 5 — a multi-year UI-test fixture, and the two paths proved end to end

**Files:** `ios/ChqCalendar/Data/UITestFixtureAPI.swift`,
`ios/ChqCalendarUITests/` (extend an existing suite or add one).
**Depends on:** Tasks 1-4.
**This is the only task that runs the UI leg.**

### Why

`UITestFixtureAPI.swift:83` serves
`{ "years": [2026], "defaultYear": 2026, "generated": … }`, so **no cross-year
path is reachable from a UI test at all** — which is why neither of these
features has ever been exercised end to end, and why
`docs/superpowers/specs/2026-08-24-off-season-landing-269-design.md` §A3 can
still say the rail-over-landing path "has never been exercised." The work
queue has flagged this gap twice. Close it here.

### What to build

1. Extend the fixture to a multi-year manifest. The shape that makes both
   features reachable:
   - an **archived** year with events (the existing 2026 season is the natural
     one to keep as-is), and
   - a **later** year that is announced in `years` but serves **no events**,
     so `LandingState.determine` reaches `.preSeason` for it (rule 1 sends a
     year with upcoming events to `.inSeason`, so a populated future year
     would *not* reach the state under test — this is the trap that makes the
     naive fixture useless).

   Keep `UITestFixture`'s existing constants and day math working for every
   test that already depends on them: `firstDay`, `lastDay`, `year`,
   `allDays`, `eventDays` are asserted against across
   `DayRailUITests` and `DayRailAccessibilityUITests`. Extending must not
   move them. Run the full UI leg to prove it.

2. The launch hooks you need already exist — use them, do not add new ones
   unless a gap is real:
   - `-uitest-pin-year <year>` (`AppModel.swift:1794`ff) selects the year.
   - `-uitest-freeze-now "yyyy-MM-dd HH:mm:ss"` pins the clock.
   - `-uitest-go-to-day <yyyy-MM-dd>` feeds `model.pendingDeepLink =
     .day(key:)` (`CalendarView.swift:336`) — **the same channel
     `OpenDayIntent` writes through `PendingIntentLink`**, so a UI test using
     it covers the real pipeline rather than a shortcut around it. This is the
     cross-year Siri path.

### The two tests this exists for

- **#186 — the pre-season archive button.** Launch pinned to the empty future
  year with a frozen clock before its season start: the off-season landing
  renders, the "Browse the _ season" button is present and labelled with the
  archived year from the manifest, and tapping it lands the reader in that
  year's season with events on screen.
- **#253 — the cross-year deep link.** Launch pinned to one year with
  `-uitest-go-to-day` naming a day in the *other*: the app switches year and
  lands on that day. Assert the day actually rendered, not merely that no
  crash occurred.

Also worth one test if it is cheap: the rail-over-landing path §A3 says has
never been exercised.

### Constraints specific to this task

- Run the unit leg first and keep it green; only then run the UI leg.
- **Do not run the UI suite while anything else builds.** One booted
  simulator; contention fails as "Application is not running".
- Expect the UI leg to take ~20+ minutes. Budget for it; do not narrow it
  away — the point of this task is that the full UI leg still passes with a
  changed fixture.
- If a UI test cannot reach a state, say so explicitly in the report with
  what blocked it. A UI test that passes without exercising its path is the
  exact failure this codebase keeps producing.

### Done when

Both legs green — full `ChqCalendarTests` **and** full `ChqCalendarUITests` —
and each new UI test falsified (revert the Task 2 or Task 4 change it covers,
watch it go red, restore).

---

## Task 6 — web parity: the pre-season archive button

**Files:** `frontend/src/lib/utils/landingState.ts`,
`frontend/src/components/layout/OffSeasonLanding.tsx`, their callers and
tests.
**Depends on:** nothing (web-only), but lands after the iOS tasks.

### Why this is in scope

`OffSeasonLanding.tsx:96` gates the whole button block on
`state.kind === 'post-season'`, so a pre-season web reader gets a countdown
and no way back to the last season — **the same dead end #186 describes**.
Fixing iOS alone re-opens exactly the class of gap #288 just closed, and
`ChqCalendarShared` is ported code where the port is a promise. The spec left
this as "file a follow-up or fold it in"; the controller ruled: **fold it
in.**

### What to build

Mirror Tasks 1 + 2 on the web, rule for rule:

- `LandingState`'s `pre-season` variant (`landingState.ts:24`) gains
  `archiveYear: number | null`, computed in `determineLandingState` as the
  newest available year strictly less than the selected year — the same
  manifest-derived rule, **not** `selectedYear - 1`.
- `OffSeasonLanding` renders the "Browse the _ season" button whenever an
  archive year is available, in `pre-season` as well as `post-season`. The
  "Preview the _ season" button stays `post-season`-only.
- The browse handler becomes year-aware the same way
  `browsePastSeason(year:)` did: switch to that year, then apply season
  scope. Follow whatever the existing `onBrowseArchiveSeason` /
  `onPreviewNextSeason` callers already do for a year switch
  (`onPreviewNextSeason` already takes a year — mirror it).
- **Both platforms' module headers must say the rule is shared.** The
  `LandingState.swift` ↔ `landingState.ts` pair is one of the declared
  ports; state the parity in both headers so the next divergence is visible.

### Tests

Vitest, next to the source, in the established style: the `determine` rules
(newest earlier year, `null` when none, manifest gap skipped) and the
component rendering the button in both states with the right label and
handler argument. Falsify each.

### Done when

`cd frontend && npm run build` passes (it runs validate + the unit suite),
and each new test has been falsified.

---

## Task 7 — release chores for 1.1.4

**Files:** `ios/ChqCalendar.xcodeproj/project.pbxproj` (version bump only),
`docs/app-store/listing-fields.json`, `docs/plans/2026-08-27-work-queue.md`,
the two memory-adjacent design docs named below.
**Depends on:** Tasks 1-6.

### What to build

1. **`MARKETING_VERSION` → `1.1.4`** across the app and widget targets. The
   two test bundles sit at `1` and do not ship — leave them. Bump
   `CURRENT_PROJECT_VERSION` on the app and widget targets consistently with
   how 1.1.3 build 6 did it (read the history rather than guessing).
   This is the **one** sanctioned `project.pbxproj` edit; make it surgically
   and confirm the diff contains nothing else. Xcode's cosmetic churn
   (renamed exception sets, reordered group entries) must not ride along.

2. **`whatsNew`** — `docs/app-store/listing-fields.json:8` still describes
   1.1.3's chrome consolidation. Rewrite it for what 1.1.4 actually ships:
   browsing a past season from the pre-season screen, and Siri day requests
   working when you are parked on a different year.

   **Controller ruling, already made:** the queue calls `whatsNew` "blocked
   on the #285 decision". It is not. #285 (whether iOS follows web in
   deleting date filtering) implements in **1.1.5**; 1.1.4's release note
   describes only 1.1.4's own changes, which #285 cannot invalidate. Do not
   mention date filtering, scope chips, or the week grid. #285 remains open
   as queue item 6.

3. **Correct the stale claims the spec names**, since a wrong doc is what
   this whole item is cleaning up after:
   - `docs/superpowers/specs/2026-08-24-off-season-landing-269-design.md` §A3
     — the rail-over-landing path is exercised now (if Task 5 covered it).
   - Any design doc still claiming `.preSeason` hides its archive button.

4. **Update the work queue.** Mark item 2 `DONE` with the squash sha left as
   a placeholder for the controller, move it to the Completed section per the
   file's own instructions ("update its `Status` line, move it to the bottom
   section, update the glance table, do not delete it — the reasoning is
   worth keeping"). Record the web-parity fold-in so item 6/#285 is not
   confused with it.

### Screenshots

**Take the opt-out; do not regenerate.** This touches `Features/` visibly,
but the new button appears only off-season and all ten shots in
`ios/Scripts/screenshot-plan.json` are in-season screens, so no covered shot
can depict it. "Regenerate and confirm no change" is **not reachable** until
**#294** is fixed — `capture-screenshots.sh:308-309` passes `--time "9:41"`,
which is not an ISO string, so `simctl` pins the time but never the date, and
the iPad status bar renders the date: nine files churn on every run
regardless of what changed.

So: **do not run the screenshot scripts, and do not commit manifest churn.**
Write the PR-description opt-out line into the report for the controller to
use verbatim:

```
[skip-screenshots: the new archive button renders only on the off-season
landing; all ten shots in screenshot-plan.json are in-season screens, so no
covered shot can depict it. Regenerate-and-diff is unreachable until #294 —
the iPad status bar carries the capture date and churns nine files per run.]
```

### Done when

`cd ios && xcodebuild -project ChqCalendar.xcodeproj -showBuildSettings
-scheme ChqCalendar | grep MARKETING_VERSION` reports 1.1.4, the
`project.pbxproj` diff contains only the version lines, and no screenshot
asset is modified (`git status docs/app-store/screenshots*` is clean).
