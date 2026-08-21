# Cross-platform date navigation — design

**Status:** Phases 0, 1a, 1b, 2, **3a (web)**, **3b (iOS)** and **4 (iOS
consolidation)** are complete.
Phase 3a is on `feat/date-nav-phase-3a-web-day-rail`: it deletes `VITE_NAV_V2`
and the legacy list container, converges the scope set on Now · Today · All
Season · All Year, and ships the sticky day rail. **`VITE_NAV_V2` was deleted
rather than set** — a `VITE_*` flag is build-time, so flipping it still
requires a redeploy and buys no rollback that `git revert` does not, while
keeping it would have forced the rail to be gated too and two list containers
to keep working. That commit is the real release of phase 2, which had been
dark in production. Phase 3b is on
`feat/date-nav-phase-3b-ios-day-rail`: the same rail on the Events tab and
My Day, sharing `DayRailView` between them.

**Phase 4 (iOS consolidation) is complete.** Part 1 — Siri routing — shipped
as PR #250 (`d827903`): a new `OpenDayIntent` ("Show a Day") resolves an
`IntentTimeframe` to a canonical day key, writes it as a `chqcal://day/<key>`
deep link, and that link is consumed by the exact same
`EventListView.selectDay(_:)` a rail-chip tap calls — see the Siri section
below for what that guarantees. Part 2 was release prep, done on
`chore/ios-1.1.3-release-prep`: the 1.1.3 version sweep (`76a8ce2`, every
target including both test bundles now at 1.1.3, app and widgets at build 6
— `ChqCalendarUITests` previously had neither version key at all; verified
by a full suite run, 884 unit + 21 UI tests green); listing copy and this
spec's own phase-4 amendment (`7321117`); the lead screenshot (`01-season`)
reworked into a day-navigation shot with its clock pinned (`64ef74b`) — it
had been the last shot still capturing live production data with no
`-uitest-freeze-now`; a My Day/Events attribution correction in the release
checklist and an extended listing description covering the rail and the
Siri day action (`257fdd5`); a genuine bug the rework surfaced — on iPad the
lead shot's detail pane showed an event from a different day than the rail,
because `-uitest-select-event-index` picked from a season-wide pool with no
knowledge of `-uitest-go-to-day` — fixed by scoping the selection to the
landed day when both flags are present, with two new unit tests (`c07646c`,
884 total); and the App Store review notes refreshed for 1.1.3, then trimmed
under App Store Connect's 4,000-character cap with a `reviewNotes` length
guard added to `appStoreListing.test.ts`, which had never checked that field
before (`4f63b8a`, `3148281`). An on-device pass on a booted simulator then
walked every `whatsNew` bullet, including running the "Show a Day" intent
from the Shortcuts app; no bullet needed correction.

**Two items remain, both outside what a spec or a branch can close:**
archiving and uploading build 6 to App Store Connect, and verifying Siri's
*spoken* invocation of "Show a Day" on a physical device — the simulator
pass above drove the intent through the Shortcuts app, not through Siri
itself, and on-device Siri has no simulator equivalent. The `this-week`
off-season divergence between platforms — `null` on web, a rolling 7-day
window on iOS — is deliberately left standing and documented in
`ViewWindow.swift`; phase 4 does not reconcile it.

### What the iOS device pass caught that the task reviews did not

Unlike phase 3a's rail, the mechanism itself held up under the device
matrix — in-season, both season edges, off-season, a search narrowed to
zero matches, an archived year, iPad split view and the smallest supported
iPhone all rendered correctly on a running app: the rail present iff there
was something to navigate, chevrons and `⟳ Now` disabled or absent exactly
at the bounds, no overlap with the day headers. What the pass caught instead
was adjacent to the mechanism:

- **`performAccessibilityAudit()` against the in-season rail, at the OS's own
  default text size** (not even the largest accessibility size), returned 18
  contrast failures and 17 near-fails across every day-chip variant —
  selected/accent-fill and unselected/`.thinMaterial` alike — plus 21 "Dynamic
  Type font sizes are partially unsupported" warnings spanning the rail and
  the list, and 2 clipped-text findings (the search field's placeholder and
  the bottom `Filters` pill). No unit test renders real system materials or
  fonts, so none of this was previously visible. At the largest accessibility
  text size the `Filters` pill's label visibly truncates to `…` — pre-existing
  `pillButton` code, untouched by this branch's diff, but only surfaced by an
  actual on-device render at that size.
- **The rail's `⟳ Now` and step chevrons started out inside the same
  horizontally scrolling content as the day chips, and that was a real defect
  — since fixed.** The device pass recorded it as working-as-built and merely
  "easy to mistake for a bug from a single screenshot". That reading was
  wrong: for most of the season the controls are genuinely off-screen, so
  returning to today means swiping until you find it, which across a whole
  season is a lot of swiping. A reader reported exactly that. They are now
  pinned outside the horizontal `ScrollView` — `leading()`/`trailing()` are
  siblings of it in `DayRailView`, with only the chips scrolling between —
  so all three controls are always reachable. **Do not "restore" them into
  the scrolling content on the strength of an older note.**
- **The App Store screenshot pipeline itself was timing-fragile against live
  production data.** Shot `03-search`'s fixed 6-second settle, adequate when
  it was written, twice produced a broken capture against today's 1,686-event
  production feed — once fully blank, once showing the unfiltered list with
  the search field still empty. `model.start()` had finished both times;
  `applyUITestHooks()`, which runs after it, simply hadn't landed yet.
  Raised to 12 seconds (matching the map shot) in `screenshot-plan.json`;
  reproduced twice before the fix, clean on the next two runs after it.

### The ~55–59px residual is fixed, and the fix below was not sufficient on its own

The prepend correction now tracks a day section's own
`getBoundingClientRect().top` instead of total document height, as this spec
recommended. **That alone did not fix the drift.** Measured with the
reference-node rewrite in place and nothing else: **−48px** scrolled, **+103.5px**
unscrolled.

**This spec's claim that the reference-node approach is "correct regardless of
what else changes height (above, below, or asynchronously after the
measurement)" is an overstatement.** One measurement taken in a layout effect
cannot see height that has not arrived yet. Instrumenting `window.scrollBy`
showed the correction landing the reference day back on its exact original
`top` — and then, **one frame later**, content above the reader growing ~104px
and staying there. What was needed was a settle window: a `ResizeObserver` on
the list that re-asserts the reference day's position until the reader takes
over (cancelled by `wheel`/`touchstart`/`keydown`, deliberately never by
`scroll`, which the correction's own `scrollBy` fires). With both, drift is
**0.0px** scrolled and **−0.5px** unscrolled.

**The recorded suspect was also wrong.** This spec blamed a re-render of the
button's own label; a later theory blamed `EventCard`'s image `onError` hiding
a broken hotlinked image. Neither survives: zero images were hidden, a
`MutationObserver` saw no DOM additions after the prepend's own cards, and only
already-loaded system fonts are in use. The cause is a pure re-layout one frame
after commit, still unidentified — which is precisely why the fix is a general
settle window rather than something targeted at a mechanism we cannot name.

### What the browser pass caught that eleven task reviews did not

Every phase-3a task shipped with green unit tests and a clean independent
review, and the rail's headline behaviour still did not work:

- **The rail was not sticky at all.** It was wrapped in a `<div>` that existed
  only to hold a measurement ref, and `position: sticky` is bounded by its
  containing block — a wrapper exactly the rail's height gives it zero travel.
  Measured while scrolling: `railTop` 423 → 223 → −77 → −777 → −2577. This also
  silently made the sticky day-header offset pointless, since the headers were
  clearing a rail that was not there.
- **The rail scrolled the page.** `scrollIntoView({ block: 'nearest' })`
  minimises but does not forbid vertical movement; with the rail off-screen it
  dragged the page back 167px per call.
- **A distant chip tap landed ~1058px short**, target off-screen: the smooth
  animation ran ~2s while the document grew 1020px beneath it, and a smooth
  scroll does not re-target mid-flight.

All three are integration defects invisible to any single task. **The browser
pass is not a formality at the end of the plan — it is the only thing that tests
the seams.** After fixes, 34/34 automated browser checks pass: the tapped day
lands at exactly the sticky offset (64.0px against a 64px rail), and the stuck
header sits flush under the rail at 320px width and at 200% text zoom — which is
what measuring `--day-rail-h` rather than hardcoding it buys.

Supersedes the design sections of issues
[#225](https://github.com/bbernstein/chq-calendar/issues/225) (web) and
[#226](https://github.com/bbernstein/chq-calendar/issues/226) (iOS), which
remain the authoritative record of the *problem* and of the code archaeology
behind it.

**Date:** 2026-08-15

---

## Problem

Neither platform lets you move by a day or a week without opening a filter
control and re-picking a date.

- **Web** has `Now` / `Today` / `This Week`. Only `Now` has any stepping at
  all — a "Show next day" button. There is no backward affordance anywhere,
  in any mode.
- **iOS** has `Now` / `Today` / `All Season` / `All Year` plus the nine-week
  strip. `showNextDay()` has the same `.next`-only limitation. My Day can
  move a day by tapping an adjacent chip, but its only fast-travel controls
  jump to the *season edge* — a "go far" affordance with no "go one"
  complement.

The two platforms also disagree on which shortcuts exist, so the same user
gets different vocabulary on their phone and their laptop.

The underlying cause is the same on both: **date is modelled as a filter,
and filters are walls.** Reaching the edge of what you asked for is a dead
end that can only be escaped by asking a different question.

## Decisions

Four decisions were taken during design. Each is recorded with its
rationale so it is not relitigated.

### D1 — Stepping scrolls if it can, and widens if it must

One control with one user-facing meaning: *take me to the next day.* If
that day is already in the loaded canvas it scrolls there; if it lies past
the current window's edge, the window grows to include it and then scrolls.

Rejected: "move the window" (replace), which makes every tap a filter
change and jumps rather than flows; and "widen only" (append), which never
provides fast travel to Week 7.

### D2 — A day rail on both platforms

A horizontal strip of day chips directly beneath the existing nine-week
strip. Its highlight tracks the topmost visible day header as you scroll;
tapping a chip scrolls to that day.

Chosen over bare ±1 steppers because the actual complaint is *disorientation*
— "where am I in the season" — which a stepper does not answer. iOS
already owns the component (`MyDayChipContent`, `DayWindow`), both are
already `ChqCalendarShared` and already unit-tested. The rail also gives
past seasons a day-level control they currently lack entirely, since the
relative buttons are hidden for non-current years.

### D3 — Auto-continue forward, explicit backward

Scrolling past the bottom keeps loading days with no button. The date chip
stops claiming "Today" and names what is actually on screen.

Two distinct escapes, deliberately not conflated: the date chip's `✕`
**resets the window** back to the scope's base, and `⟳ Now` **returns you
to today** without touching the window. See "`⟳ Now` is navigation, never a
filter change" below.

Scrolling *up* stays explicit — a "Show earlier" control. Auto-loading
upward is the one thing that reliably makes the page jump under the user's
thumb, and the asymmetry costs nothing: the backward use case ("what did I
miss yesterday?") is deliberate, not incidental.

### D4 — Two rails; only the day rail is sticky

Week strip above, day rail below — coarse above fine. The day rail sticks
to the top of the viewport as the rest of the filter block scrolls away.

Net vertical cost on mobile web is approximately zero: the retired "This
Week" button and the static `Selected: …` line both free up space.

Rejected: merging both into one zoomable strip, because the week strip
carries drag-range, shift-click and cmd-click semantics
(`useScrollState.ts:87-181`) that would have to survive the merge or be
dropped.

---

## Shared model

Everything in this section is implemented identically on both platforms.
The surfaces differ; the model does not.

### The scope set converges on iOS's four

`Now` · `Today` · `All Season` · `All Year`, plus weeks 1–9 on the strip,
mutually exclusive with the scope.

**Web changes:** add `season`; relabel `all` → "All Year"; remove the
**This Week button**.

Removing that button costs no capability. `isThisWeek` (`dateHelpers.ts:59`)
and `isInChautauquaWeek` compute identical bounds, and `page.tsx:118`
already treats `selectedWeeks === [currentWeek]` as "This Week active" — so
tapping the current week on the strip has always been the same operation.
iOS reached this conclusion first: `.thisWeek` is in the `DateScope` enum
but deliberately absent from `DateFilterSheet.visibleScopes`.

`'this-week'` therefore stays in the web's `DateFilter` union — this is a
**button** removal, not a union-member removal — so a value persisted in
`localStorage` keeps working and renders as the current week highlighted on
the strip. This mirrors iOS exactly.

**iOS changes:** none to the scope set.

Web also gains the mutual-exclusion rule that iOS already enforces in
`setWeekSelection`: selecting weeks forces the scope to `all`, and
selecting a scope clears the weeks.

### ViewWindow

Both platforms gain a derived `ViewWindow = { startDayKey, endDayKey }`.
It is **derived on every read, never stored**.

Base window, by scope:

| Scope | Base window |
|---|---|
| `now` | today → the adaptive ≥50-event day |
| `today` | today → today |
| `season` | season start → season end |
| `all` | first event day → last event day |
| weeks *n…m* | week *n* start → week *m* end |
| `day` (iOS only) | that day → that day |

Then, clamp the *expansion inputs* — not the merged result — to
**navigable bounds** = the season, widened to contain every day that has
an event (web) and every starred day (iOS —
`DayWindow.bounds(year:starredDays:)` already does exactly this widening):

```
expandedStart = clamp(expandedStart, to: navigableBounds)
expandedEnd   = clamp(expandedEnd,   to: navigableBounds)

start = min(base.start, expandedStart)
end   = max(base.end,   expandedEnd)
```

The clamp has to land before the merge: the bounds limit how far
*navigation* can reach, and say nothing about a scope the user hasn't
navigated. Clamping the merged result instead inverts the window
(`start > end`) whenever the base window itself sits outside the bounds —
which off-season `now`/`today` does for most of the year.

**The list renders exactly the events inside this window. Nothing else.**

The window derivation becomes the single owner of the non-current-year
downgrade — the rule that a time-relative scope means nothing in an
archived season.

### `extraDays` is deleted on both platforms

`extraDays` *is* `expandedEnd`, expressed as an offset that only ever meant
something under one scope. Replacing it with an explicit day key eliminates
the bug class behind #156 (a widened `.next` window surviving a scope
change) **by construction** rather than by the
`clearScopeLocalDateState()` convention that currently holds it.

### State changes

**Web — `FilterState` (`useFilterState.ts:6-19`):**

- remove `extraDays: number`
- add `windowStartDay: string | null` (a `yyyy-mm-dd` day key)
- add `windowEndDay: string | null`

Actions replacing `ADD_EXTRA_DAY` / `CLEAR_EXTRA_DAYS`:
`EXPAND_WINDOW_START`, `EXPAND_WINDOW_END`, `RESET_WINDOW`, `GO_TO_DAY`.

`GO_TO_DAY` expands the window to *contain* the target day and does nothing
else. The scroll that follows is a view concern, owned by `useDayAnchor` —
the reducer never knows about scroll position.

**iOS — `FilterSelection` (`UserStateStore.swift`):**

- remove `extraDays: Int`
- add `windowStartDayKey: String?`, `windowEndDayKey: String?`
- `selectedDayKey` stays — it is the `.day` scope's payload, a different
  concept from the window

**Both new fields are session-only** on both platforms, following the
settled precedent for `extraDays` and `selectedDayKey`: excluded from
`isDefault`, never persisted, cleared on year switch
(`RECONCILE_FILTERS` / `select(year:)`).

The rationale from the My Day spec (`2026-08-09-my-day-date-model-design.md:293-298`)
transfers unchanged: *a date pinned three days ago and silently restored on
launch would be worse than no restore.*

**The anchor day is not filter state.** It is derived from scroll position
and lives in the view layer (`useDayAnchor` on web, `@State` on iOS). It is
never persisted and never participates in filtering.

### Two open questions this resolves for free

**"Next calendar day, or next day with results?"** — asked in both issues.
It stops being a coin flip once the two mechanisms are distinguished:

- **Scrolling** advances to the next day *with events under the current
  filters*, because a day with no matching events produces no day group.
  Filtered to one category, you never scroll through three blank days.
- **The rail and the steppers** move by *calendar* day, and an empty day
  renders as empty. iOS already has the visual language —
  `MyDayChipContent`'s dashed-border `isEmpty` state.

**"Widen or move?"** — never surfaces. The window only ever grows; the
scope button you started from is what shrinks it back.

### `⟳ Now` is navigation, never a filter change

It scrolls to the current day, widening the window if today is not in it.
It does **not** touch scope, weeks, categories, or search.

Hidden when the anchor is already today, and absent entirely on
non-current years.

Keeping it filter-free is the premise of the whole design: the moment a
navigation control mutates filters, the user is back to the thing this
initiative exists to escape. Resetting *filters* already has a home — the
scope buttons and the active-filter chips.

### The rail, specified once

- **Span:** the full season, widened by out-of-season events —
  **independent of the current scope.** It is a navigation surface, not a
  filter readout, so in `Today` scope it still shows the week around you.
- **Highlight:** the anchor day; tracks scroll.
- **Tap:** include that day in the window, then scroll to it.
- **Chip content:** weekday abbreviation, day-of-month, month when it
  changes or on the first chip, and a count of matching events. An empty
  day gets the dashed treatment.
- **Chevrons** at both ends: precise ±1 *calendar* day, disabled at season
  bounds.
- **Accessibility:** controls are labelled by target — "Go to Sunday,
  August 16, 4 events" — never "next". A day with no matches says so.

---

## Web surface

### Two windows, and the trap of conflating them

- **View window** — data, session state, which days pass the filter.
- **Render window** — DOM, pure view concern, which of those days are
  mounted.

`EventList` stops rendering a prefix `[0, visibleCount]` and renders a
contiguous day-group slice `[firstIdx, lastIdx]` with a sentinel at **both**
ends. Initial fill still walks forward from the anchor until ≥50 events, so
first paint costs what it costs today; growth after that is day-granular.

The bottom sentinel gets two jobs — this is where D1 actually lives:

```
more day groups below in groupedEvents?  → extend render window   (cheap, no state change)
else, can the view window expand?        → dispatch EXPAND_WINDOW_END (refilter)
```

**Grow-only, no eviction.** At ~23 events/day, ±5 days ≈ 230 cards. A
full-season scroll reaches ~1,470 — which `all` mode can already reach
today by scrolling, so this is not a regression. Eviction breaks scroll
position and solves a problem that is not yet real.

### Three gotchas that must be handled

1. **`EventList` resets `visibleCount` on every `groupedEvents` change**
   (`EventList.tsx:36`). That would destroy scroll position on every
   auto-expand. It needs a `resetKey` derived from the *non-window* filters
   (search, categories, venues, favorites, scope, weeks, year), so a window
   that merely grew does not count as a new filter.
2. **Upward prepend jumps the page.** Top-sentinel growth must record
   `scrollHeight`/`scrollTop` before the prepend and restore the delta in
   `useLayoutEffect`. This is the single riskiest piece of the initiative.
3. **Sticky stacking.** The rail is sticky; day headers are already
   `sticky top-0` (`EventList.tsx:82`). Headers need `top: var(--day-rail-h)`,
   and every scroll target needs `scroll-margin-top` or it lands underneath
   the rail — the gotcha #225 called out. `--day-rail-h` is maintained by a
   `ResizeObserver` rather than hardcoded, so browser text-zoom cannot break
   the offset.

### The date stage collapses

`isToday` / `isThisWeek` / the `next` branch in `filterHelpers.ts:26-40`
all become a single range check against the window, computed once in
`page.tsx`. `FilterOptions` loses `dateFilter`-specific plumbing and gains
`viewWindow`.

### Files

**New**
- `frontend/src/lib/utils/dayWindow.ts` — `dayKeys(from, through)`,
  `addDays(dayKey, n)`, `seasonDayBounds(seasonWeeks, events)`,
  `baseWindow(...)`, `viewWindow(...)`
- `frontend/src/components/calendar/DayRail.tsx`
- `frontend/src/hooks/useDayAnchor.ts` — scrollspy + scroll-to

**Changed**
- `useFilterState.ts` — window fields, actions, `RECONCILE_FILTERS`
- `filterHelpers.ts` — single range check
- `EventList.tsx` — bidirectional window, `resetKey`, sticky offsets
- `DateFilter.tsx` — scope buttons; drop This Week, add All Season
- `buildActiveChips.ts` — the date chip names the actual window
- `page.tsx` — window derivation, anchor wiring
- `app/about/aboutContent.ts` — copy on **both** guides (`:241-245`, `:292-297`)

`addDays` must be DST-safe: construct from `(year, month, date)` parts and
`setDate(+n)`, mirroring iOS's `ChqTime.day(_:offsetBy:)`. Never
86,400-second arithmetic.

### Accessibility

The rail is a `role="group"` with an `aria-label` — **not** `role="menu"`,
and not a bare `<div>` with an `aria-label`, which is dropped by
assistive technology. Both lessons are already recorded from PR #228/#219.

Keyboard: Left/Right move focus along the rail, Enter/Space activate,
Home jumps to today.

---

## iOS surface

Substantially less work — the data model is mostly already there.

### The `.day` exemption trio collapses to one site

`EventFilter.apply`'s date stage routes through a shared
`ChqCalendarShared/Domain/ViewWindow.swift` mirroring the web module. Because
the window derivation becomes the single owner of the non-current-year
downgrade, the exemption that currently must agree across three sites —
`EventFilter.swift:42`, `DateFilterLabel.swift:74-78`, and
`FilterChipState.swift:56, 66, 92, 101` — collapses into one.

`FilterChipState` is the site where getting this wrong is a **silent
behavioural bug** rather than a compile error. It is therefore the site to
pin with tests *before* touching anything, not after.

### The rail

Extract My Day's chip strip into a shared `DayRailView` over the existing
`MyDayChipContent`. My Day passes star counts; the Events tab passes event
counts — so `MyDayChipContent.starCount` generalises to a count plus an
optional symbol.

Mounted via `.safeAreaInset(edge: .top)`, the mirror of how
`filterPillBar` already floats at the bottom. Day sections gain
`.id(dayKey)` for `ScrollViewReader`.

The `.next`-only "Show next day" button (`EventListView.swift:180-184`) is
deleted; last-section `.onAppear` replaces it as the auto-expand trigger.

### My Day keeps its expand-to-season-edge chevrons

Those are "go far"; the rail's ±1 is "go one". #226 names that missing
complement explicitly. Both, not one replacing the other. This closes
#226's phase 3 as a side effect.

### Siri routes through the same code path

`IntentTimeframe.tomorrow` and `.nextWeek` already ship as spoken targets.
Routing them through the same `goToDay` closes the inconsistency #226
records — that you can *ask* Siri for tomorrow but cannot *tap* your way
there — and guarantees voice and touch land in identical state.

**Shipped (PR #250, phase 4 part 1):** `OpenDayIntent` ("Show a Day") resolves
`IntentTimeframe` to a canonical `"yyyy-MM-dd"` day key via `OpenDayTarget`,
writes it as `DeepLink.day(key:)` (`chqcal://day/<key>`) through
`PendingIntentLink`, and `EventListView.consumePendingDayLinkIfPossible()`
hands that key to `selectDay(_:)` — the identical private function a rail
chip's `onSelect` calls. Voice and touch therefore share not just an outcome
but the literal call path: same window expansion, same pinned selection, same
queued scroll. The reachability check — `ViewWindow.navigableBounds` — lives
in `OpenDayTarget` rather than in `AppModel.goToDay` specifically so an
unreachable day can be *spoken*: `AppModel.goToDay` already refused
out-of-bounds days, but silently, and an intent that just opens the app and
does nothing is a worse experience than one that says why. On refusal,
`PendingIntentLink.clear(from:)` wipes any link a previous, not-yet-consumed
run may have left pending, so a refusal dialog is never followed by a
navigation the user was just told wouldn't happen.

### AppModel

Add `expandWindowStart`, `expandWindowEnd`, `goToDay(_:)`, `stepDay(_:)`,
`stepWeek(_:)`, `resetToNow()`. Delete `showNextDay()`.

`clearScopeLocalDateState()` loses `extraDays` and gains the window fields.

### Deferred: swipe to change day

`EventRow.swipeActions(edge: .leading)` (`EventRow.swift:59-66`) makes a
list-wide horizontal paging gesture a genuine ambiguity risk. The rail
makes swipe a nice-to-have rather than the only fast path. Prototype after
the rail ships.

---

## Phase 0 — deploy gating

`deploy-production.yml` triggers on `push: branches: [main]` with **no path
filter**, and deploys 6 Lambdas, syncs S3, invalidates CloudFront, and
triggers 3 data ingests on every merge. A docs-only or iOS-only merge does
all of that today. Phase 4 of this initiative is iOS-only; the spec commit
itself is docs-only.

Three needs are separable, and only the third wants an approval gate:

1. Merges that should deploy **nothing** → path filtering.
2. Merges that should deploy **part** → per-area job conditions.
3. Merges you want to **eyeball** → a brake.

### Changes

**Path-scope the trigger:**

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - 'ios/**'
      - '**/*.md'
      - '.github/ISSUE_TEMPLATE/**'
```

`paths-ignore` is OR-semantics: a push touching both `ios/**` and
`frontend/**` still runs, which is correct.

**`docs/**` is deliberately NOT ignored.** An earlier draft of this spec
listed it and claimed it was "safe to ignore — verified". That verification
checked whether any *served page* comes from `docs/` (none — the publisher
docs that are live content are a Vite entry at
`frontend/publish/docs/index.html`, `vite.config.ts:154`) and never checked
whether anything under `docs/` is a **build input**. Two files are:
`docs/publisher/categories.json` and `docs/publisher/venues.json` are copied
into `tools/publisher-format/dist/refs` by its `copy-refs` script, then into
`backend/dist/refs` by backend's `build:prod`, and shipped inside the admin
and publisher-ingest Lambda zips. With `docs/**` ignored, editing a venue
list merged with no workflow run at all.

The narrow fix — ignore `docs/` except `docs/publisher/` — is not
expressible: `paths-ignore` has no negation, and an enumerated allow-list of
"safe" subdirectories silently re-breaks the next time one becomes a build
input. `**/*.md` stays, so the common all-Markdown docs change still starts
no run; a non-Markdown docs push runs only the cheap `changes` job and
deploys nothing, unless it touched `docs/publisher/`, which is in
`BACKEND_PATHS`.

**Split the job by area** using plain `git diff --name-only` against
`github.event.before`, compared to two regex path filters. A third-party
action such as `dorny/paths-filter` (specified in an earlier draft) was
rejected: the logic is a handful of lines and this avoids a new
supply-chain dependency in the workflow that holds production AWS
credentials.

- `deploy-backend` — the 6 Lambda steps, the post-deploy publisher E2E and
  smoke steps, and the 3 data-sync triggers
- `deploy-frontend` — build, the two-pass S3 sync, CloudFront invalidation

**`shared/**` must be in the *frontend* filter.**
`frontend/src/lib/quickLinks.ts` imports `@shared/links.json` through a
Vite alias (`vite.config.ts:132`). Omitting it would mean editing
`links.json`, merging, and having the header silently never update — a
failure mode indistinguishable from a caching bug.

Move `concurrency` from job level to workflow level now that there is more
than one job.

**The brake:** a `[skip-deploy: <reason>]` marker in the squash commit
**subject** skips both deploy jobs. The subject only — a squash message is
the PR title plus the PR *body*, so matching the whole thing means any PR
whose description documents the marker silently skips its own deploy. The reason is **required** — matched as
`\[skip-deploy: *[^][:space:]][^]]*\]`, so a bare `[skip-deploy]` does not
skip. This mirrors the existing `[skip-screenshots: <reason>]` idiom in
`app-store-assets.yml`: opting out is a recorded decision rather than
silence.

The obvious form `\[skip-deploy: *[^]]+\]` (specified in an earlier draft)
is wrong and must not be restored: against `[skip-deploy: ]` the ` *`
backtracks to zero repetitions and `[^]]+` then consumes the space itself,
so a whitespace-only "reason" satisfies it and silently skips the deploy —
exactly the silence the required reason exists to prevent. The shipped form
forces the reason's first character to be neither `]` nor whitespace.
POSIX `[[:space:]]` rather than `\s` because the check runs under
`grep -qE`, which is POSIX ERE.

### Rejected: unconditional required reviewers

The `production` environment exists with `protection_rules: []`, so this
would be one API call and no YAML change. Rejected because approval fatigue
becomes rubber-stamping; a pending run holds the `deploy-production`
concurrency group so later merges queue behind it; and waiting approvals
expire into job failures. It is a blunt tool for "this *particular* PR is
risky", which `[skip-deploy:]` addresses precisely.

### Note on rollback

`workflow_dispatch` can only target a branch or tag, not an arbitrary SHA.
Rollback is `git revert` + merge, not "re-run the old deploy."

---

## Phasing

Five PRs, each independently shippable.

**Phase 0 — deploy gating.** The CI changes above. Lands first so every
later phase benefits, and so the spec and iOS commits stop triggering
production deploys.

**Phase 1 — shared window model, both platforms, zero UI change.**
`dayWindow.ts` + `ViewWindow.swift`; both filter pipelines route through
them; `extraDays` deleted; the `.day` exemption collapsed. Behaviour is
identical before and after. This is the de-risking step, and the one where
the `FilterChipState` tests must be written first.

**Phase 2 — web bidirectional render window + edge expansion.** No rail
yet; "Show earlier" / auto-expand-forward prove the machinery in isolation.
Shipped behind a flag (see Risks) so merge ≠ release.

**Phase 3 — the day rail and the scope-set change.** Drop This Week, add
All Season, chips, labels, `⟳ Now`, About copy on both guides. Splits into
3a-web / 3b-iOS if it proves unwieldy.

**Phase 4 — iOS consolidation and release prep.** My Day rail unification,
Siri routing, screenshot regeneration, and the 1.1.3 version sweep.

## Risks, ranked

1. **Upward-prepend scroll preservation on web.** The riskiest piece. Its
   own PR (phase 2) and its own tests.
2. **The `.day` exemption collapse.** Silent if wrong — `FilterChipState`
   has no compile-time guard. Pin with tests before touching.
3. **`ScrollViewReader.scrollTo` onto `List` section headers.**
   Historically finicky in SwiftUI; may need `.id` on a row rather than the
   header.
4. **Rail / day-header / search sticky coordination on mobile web.** Three
   stacked sticky layers on a small viewport.
5. **Auto-expand racing `.refreshable` and the `IntersectionObserver`.** A
   refresh mid-expansion must not double-dispatch.

**Mitigation for 1 and 2:** phase 2 ships behind a build-time flag
(`VITE_NAV_V2`, default off) so the new render path can be verified in
production before it is the default. The flip is a one-line follow-up. This
decouples merge from release without any further CI machinery.

## Testing

**Web** — `dayWindow.test.ts` (bounds, clamping, DST, season edges);
`useFilterState` window actions and the `'this-week'` migration path;
`filterHelpers` range check across all scopes; `DayRail` interaction and
keyboard/ARIA; `EventList` bidirectional growth, `resetKey` behaviour, and
scroll-position preservation across a prepend.

**iOS** — extend `DayWindowTests`, `MyDayModelTests`, `EventFilterTests`
(`.day` cases from `:90`), `DayPlanTests`, `AppModelTests`. New
`ViewWindowTests`. **`FilterChipState` tests written before the exemption
collapse, not after.**

Coverage floors are enforced (`.coverage-floor.json`, `docs/coverage.md`);
both must be met per PR.

## Obligations

- **Screenshots — done.** Phases 3b and 4 changed visible pixels on the
  Events tab and My Day; both regenerated via `capture-screenshots.sh` then
  `compose-screenshots.py`, with `docs/app-store/screenshots.manifest.json`
  and `docs/app-store/screenshots/review/` committed each time.
  `DateFilterLabel` and `MyDayChipContent` are in `ChqCalendarShared/**` and
  matched by `.github/workflows/app-store-assets.yml`. **Constraint that
  shaped task 8:** `ios/Scripts/screenshot-plan.json` was already at App
  Store Connect's 10-shot maximum, so the lead shot (`01-season`) was
  reworked into a day-navigation shot (`64ef74b`) rather than the set
  gaining an eleventh — an existing shot displaced, not extended. That
  rework surfaced a real bug of its own — the iPad detail pane and the rail
  could show different days — fixed in `c07646c`, with the screenshot set
  re-captured and re-composed again.
- **Version 1.1.3 — done.** Every target, including both test bundles,
  is now at `1.1.3` (`76a8ce2`, phase 4 task 7). The app and widget targets
  are at build `6`; `ChqCalendarTests` and the `ChqCalendarUITests` target
  added in phase 3b — which had shipped with **neither** version key —
  are both pinned at build `1` and must not track the app/widget build
  number. Before task 7 this bullet's older draft was stale: it claimed the
  app and widget targets were already at `1.1.3`, but they were still at
  `1.1.2` (build 5, the version live in the App Store) until task 7 ran, and
  the unit-test bundle was too — the same incompleteness the 1.1.2 bump
  left behind. `grep -n "CURRENT_PROJECT_VERSION\|MARKETING_VERSION"
  ios/ChqCalendar.xcodeproj/project.pbxproj` is now sufficient to verify the
  full set at a glance, which was the point of enumerating every target by
  hand this once.
- **Listing copy — done.** `docs/app-store/listing-copy.md` and
  `listing-fields.json` were re-read against the shipped phase-4 behaviour
  (`7321117`); `description` was extended to mention the rail and the Siri
  day action (`257fdd5`) but does not itself attribute controls per-surface.
  The per-surface attribution (My Day only shares `DayRailView`, not the
  `⟳ Now` button, the step chevrons, or auto-expand) landed in
  `docs/app-store/RELEASE_CHECKLIST.md` instead, as an internal note for
  whoever drafts the next `whatsNew`, not as App Store Connect copy.
  `listing-copy.md` itself was deliberately left unedited — it explains the
  JSON and restates no field values (see its own header), so it had nothing
  to correct or extend. `whatsNew` describes the new navigation and was
  walked bullet-by-bullet on a booted simulator with no correction needed.
  Review notes were refreshed and trimmed under the
  4,000-character cap, now guarded by a length check in
  `appStoreListing.test.ts` (`4f63b8a`, `3148281`).
- **About copy.** `frontend/src/app/about/aboutContent.ts:241-245` and
  `:292-297` describe "Three buttons cover the questions people actually
  ask". Both guides have tests that fail when documented behaviour drifts,
  so the copy change is enforced rather than optional.
- **The web has no marketing version** — `resolveAppVersion()` in
  `vite.config.ts:58` returns the git short SHA. `1.1.3` is iOS-only.

## Out of scope

- A date picker, or "jump to next Tuesday". Both issues rule this out
  explicitly; the anchor is always derived by stepping from a known origin,
  which is what makes an out-of-season or nonsense anchor unrepresentable.
- Virtualization. The grow-only render window is sufficient at ~1,470
  events; virtualization is the answer to a problem this does not yet have.
- URL representation of navigation state. Only `?year=` is encoded today
  (`hooks/useSelectedYear.ts`). Sharing a link to a specific day is a
  separate, reasonable feature — and would need the persistence question
  reopened, since a URL is a *deliberate* pin rather than a silently
  restored one.
- Swipe-to-change-day on iOS. Deferred pending a prototype against
  `EventRow`'s existing swipe actions.
