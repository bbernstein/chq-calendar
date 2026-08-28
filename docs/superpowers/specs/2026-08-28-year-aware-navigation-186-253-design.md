# Year-aware navigation — #186 + #253

**Status:** APPROVED, NOT IMPLEMENTED. Design agreed 2026-08-28; implementation
deferred to a fresh session.
**Issues:** #186 (pre-season archive button), #253 (Siri on an archived year).
**Queue:** item 2 in `docs/plans/2026-08-27-work-queue.md`. #288 is already
merged (`01fa4e3`); these two are what remain of iOS 1.1.4.
**Deadline:** submit ~mid-September so it clears review before **2026-10-01**,
when the server flips `defaultYear` to 2027.

All line numbers below were verified on `main` at `51a086d`. Re-check them
before building — this repo's issue bodies have been wrong about their own
premises more than once, and that is what the "verify at the named symbol"
rule in the queue exists for.

---

## Why these are one job

Each issue needs *a navigation that changes the year it navigates in*. Built
once, both close. Built separately, it gets built twice.

| | today | wanted |
|---|---|---|
| **#186** | `browseArchiveSeason()` applies `.season` to whatever `selectedYear` already is, so a `.preSeason` button labelled with last year would show *next* year. The button is hidden rather than lie. | switch to the archived year, then scope to its season |
| **#253** | `OpenDayIntent` resolves the year from `IntentDataSource.defaultYear()`; `AppModel.goToDay` bounds against `selectedYear`. When they disagree the day key is out of bounds, `goToDay` returns `false`, and nothing moves — after Siri has already said "Opening tomorrow." | switch to the key's year, then navigate |

### The finding that makes #253 cheap

**#253's issue body assumes the intent must carry the year it resolved.** It
does not. `chqcal://day/2026-08-29` is **already year-qualified**
(`DeepLink.day(key:)`, `ChqTime.isCanonicalDayKey` at `ChqTime.swift:148`
guarantees `yyyy-MM-dd`), so the app can detect the mismatch itself when it
consumes the link. Nothing has to cross the process boundary, and the App Group
plumbing the queue warned about is not needed.

This is why the issue's option 2 ("refuse and say so") is not the cheaper half
it looks like: it would need the intent to read the app's live `selectedYear`,
which is exactly the plumbing option 1 avoids.

---

## Decisions taken

Both were put to the user on 2026-08-28 and answered.

1. **#253 — switch the year, then navigate, silently.** The reader asked to go
   somewhere; they land there. No dialog change: the intent cannot know the
   app's live year out of process, so any sentence about "leaving the 2025
   season" would be guesswork.
2. **#186 — offer the newest earlier year present in the manifest**, not
   `selectedYear - 1`. Survives a gap in `years` (offering 2025 when 2026 is
   absent rather than a year whose feed 404s), and yields `nil` when there is
   no earlier year, which correctly hides the button.

---

## Design

### 1. `LandingState.preSeason` carries its archive year

`ChqCalendarShared/Domain/LandingState.swift:38`

```swift
case preSeason(opening: Date, daysUntil: Int, archiveYear: Int?)
```

`determine` already receives `availableYears`, so it computes
`availableYears.filter { $0 < selectedYear }.max()` there. `archiveYear`
(`LandingState.swift:73`) stays a pure projection over the case's own values.

This mirrors `.postSeason` already carrying `nextSeasonYear`, and it keeps the
"which year do we offer" rule out of the view. The alternative — computing it
in `OffSeasonLandingView` from `model.years` — puts a rule in a view that has
no test of its own.

`archiveYear`'s doc comment currently explains at length why `.preSeason`
returns `nil` ("the mitigation until a year-aware `browsePastSeason(year:)`
exists"). **That comment becomes false.** Rewrite it; do not leave it.

### 2. `browsePastSeason(year:)` replaces `browseArchiveSeason()`

`ChqCalendar/App/AppModel.swift:1104`

```swift
func browsePastSeason(year: Int) async {
    if year != selectedYear { await select(year: year) }
    filter = FilterSelection(dateScope: .season)
}
```

Replaces the old method rather than sitting beside it. When
`year == selectedYear` this is exactly today's behaviour with no extra fetch,
so `.postSeason` is unchanged and the view needs no case analysis — one button,
one method, both landing states.

Mirrors `previewNextSeason()` (`AppModel.swift:1126`), including its
`scopeResetCount` reasoning: no bump is needed because this always changes
either `Key.year` (via `select`) or `dateScope` (`.next` → `.season`), both of
which are `PendingDayScroll.Key` fields (#254). Say so in the doc comment; the
next reader will ask.

### 3. `goToDay(crossingYears:)` for the deep-link path

`ChqCalendar/App/AppModel.swift:1495` keeps its synchronous `goToDay(_:)`
untouched. A new async sibling handles a key that names another year:

1. Extract the year from `dayKey` (leading `yyyy`).
2. `year == selectedYear` → delegate to `goToDay(dayKey)`, unchanged.
3. Otherwise: refuse unless `years.contains(year)`; `await select(year:)`;
   refuse if `snapshot == nil` (the fetch failed); then `goToDay(dayKey)`.

**Deliberately not inside `goToDay` itself.** The rail's day keys always come
from the current year's `navigableBounds`, so only the deep-link consumer can
produce a cross-year key. Confining the change there keeps `goToDay`
synchronous and leaves the rail's hot path — every chip tap — untouched.

```swift
@discardableResult
func goToDay(crossingYears dayKey: String) async -> Bool
```

Same `@discardableResult ... -> Bool` contract as `goToDay(_:)`, so the
existing `guard model.goToDay(dayKey) else { return }` shape at the call site
carries over unchanged apart from the `await`.

#### The call site needs restructuring, and there is a trap in it

`consumePendingDayLinkIfPossible()`
(`ChqCalendar/Features/Calendar/EventListView.swift:596`) is synchronous and is
called from three places — two `.onChange` and one `.onAppear`
(`EventListView.swift:311-319`). It calls `selectDay(dayKey)`
(`EventListView.swift:519`), which calls `goToDay` and then stamps
`PendingDayScroll.Target`.

Two things make the async step non-trivial:

1. **`PendingDayScroll.key` reads `model.selectedYear` and `model.filter`**
   (`EventListView.swift:524-525`). The year switch changes both, so the stamp
   must happen *after* the await. Stamping first would record the old year and
   the pending scroll would read as stale the moment it was armed. Make
   `selectDay` async (or give it an async sibling) and await the model call
   before building the `Target` — do not simply wrap the existing body in a
   `Task`.

2. **Keep taking the key synchronously.**
   `resolvePendingDayDeepLinkIfPossible()` (`AppModel.swift:752`) is a
   take-once: it sets `pendingDeepLink = nil` as it returns the key. That
   matters here because `select(year:)` replaces `snapshot`, which re-fires
   `.onChange(of: model.snapshot?.fetchedAt)` *during the await* and calls
   `consumePendingDayLinkIfPossible()` again. With the take still synchronous
   the re-entrant call finds nothing pending and no-ops, which is correct.
   **Move the take inside the `Task` and that stops being true** — the
   re-entrant call would take the same key a second time and navigate twice.

So: take the key synchronously, then `Task { await selectDay(crossingYears:) }`.

### 4. Un-hide the button

`ChqCalendar/Features/Calendar/OffSeasonLandingView.swift:126` already reads
`if let archiveYear = model.landingState.archiveYear`. Once `.preSeason`
supplies one, the button appears with no change to that condition — only the
action becomes `Task { await model.browsePastSeason(year: archiveYear) }`.

### 5. `OpenDayTarget`'s doc comment stops describing a live gap

`ChqCalendarShared/Domain/OpenDayTarget.swift` currently documents the #253
failure as "a known gap, not a guarantee this type closes. Fixing that is a
design change (year-switching) outside this intent's scope."

**That becomes false the moment #253 lands.** #288 shipped with a comment
claiming cross-platform parity that nobody re-checked, and that comment is how
the divergence survived six months. Do not repeat it one file over.

---

## Testing

Unit tests for each rule, and **every guard falsified by injecting the defect
and watching a named test go red.** This codebase has repeatedly produced tests
that could not fail; assume yours is one until you have seen it fail.

- `determine` puts the newest earlier year on `.preSeason`; `nil` when there is
  none; skips a gap in the manifest.
- `archiveYear` returns it for `.preSeason` and still returns
  `endedSeasonYear` for `.postSeason`.
- `browsePastSeason(year:)` switches year and sets `.season`; does **not**
  re-fetch when already on that year.
- `goToDay(crossingYears:)` navigates across a year; refuses a year absent from
  the manifest; refuses when the fetch fails.
- **Window hygiene** (the trap the queue names, #234/#156): a year change must
  not leave `windowStartDayKey`/`windowEndDayKey` widened from the old year.
  `ViewWindow.make` clamps expansion *inputs* against per-year bounds, so this
  may already hold — **test it rather than assume it**, and if it holds, the
  test says why.
- **The pending day key is consumed exactly once across the year switch.** A
  snapshot replacement mid-`select(year:)` re-fires
  `.onChange(of: model.snapshot?.fetchedAt)` and calls the consumer again; the
  key must not be taken, or navigated, twice.

  This bullet exists because the section above spends more words on that race
  than on anything else in the design and would otherwise pin none of it. The
  ordering it depends on is *invisible* in the finished code — a later reader
  tidying `consumePendingDayLinkIfPossible()` by inlining the take into the
  `Task`, which reads as a simplification, breaks it silently. Nothing would
  fail. That is precisely the shape this doc's falsification bar exists to
  catch, so falsify this one too: inline the take, and watch the test go
  red.

### Watch for a test that stops being able to fail

`landingStateIsInSeasonWithoutASnapshot` had exactly this happen during #288:
rule 3 arrived and silently made the existing guard's test unfalsifiable, and
only a reviewer's aside caught it. Adding an associated value to `.preSeason`
touches every `determine` assertion in `LandingStateTests`. After updating
them, re-run the falsification for the ones you did not write.

### Extend the UI-test fixture

`ChqCalendar/Data/UITestFixtureAPI.swift:83` serves
`{ "years": [2026], "defaultYear": 2026 }`, so **no cross-year path is
reachable from a UI test at all** — which is why neither of these features has
ever been exercised end to end, and why
`docs/superpowers/specs/2026-08-24-off-season-landing-269-design.md` §A3 can
still say the rail-over-landing path "has never been exercised."

Extending it to a multi-year manifest is what makes the pre-season landing, its
new button, and the cross-year Siri path provable. This is the gap the queue
has now flagged twice; close it here.

---

## Known divergence — decide, do not drift

**The web hides its archive button in pre-season too.**
`frontend/src/components/layout/OffSeasonLanding.tsx:96` gates the whole button
block on `state.kind === 'post-season'`, so a pre-season web reader gets a
countdown and no way back to the last season — the same dead end #186
describes.

Fixing iOS alone re-opens exactly the class of gap #288 just closed. It is not
in this design's scope, but it must be a recorded decision rather than
something noticed in six months: **either file it as a web follow-up or fold it
in.** Do not leave the two platforms silently different again.

---

## Out of scope, listed so it is not lost

- **Web pre-season button** — above.
- **`MARKETING_VERSION` → 1.1.4.** The app and widget targets carry
  `CURRENT_PROJECT_VERSION`; the two test bundles sit at 1 and do not ship.
- **`whatsNew`** — `docs/app-store/listing-fields.json:8` still describes
  1.1.3. Blocked on the **#285** decision (see the queue). Promotional Text is
  the only App Store field changeable without a review cycle.
- **Screenshots.** This touches `Features/` visibly, but the new button appears
  only off-season and all ten shots in `ios/Scripts/screenshot-plan.json` are
  in-season screens, so no covered shot can depict it. Take the
  `[skip-screenshots: <reason>]` opt-out — and note that "regenerate and
  confirm no change" is **not reachable** until **#294** is fixed, because the
  iPad status bar carries the real capture date and churns nine files on every
  run.
