# Cross-platform date navigation — design

**Status:** Approved design, not implemented. Supersedes the design
sections of issues [#225](https://github.com/bbernstein/chq-calendar/issues/225)
(web) and [#226](https://github.com/bbernstein/chq-calendar/issues/226)
(iOS), which remain the authoritative record of the *problem* and of the
code archaeology behind it.

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

Then:

```
start = min(base.start, expandedStart)
end   = max(base.end,   expandedEnd)
```

clamped to **navigable bounds** = the season, widened to contain every day
that has an event (web) and every starred day (iOS —
`DayWindow.bounds(year:starredDays:)` already does exactly this widening).

Because those bounds contain every event day by construction, the clamp is
a no-op for `all` and a real constraint only for the scopes that can be
expanded past a season edge.

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
      - 'docs/**'
      - 'ios/**'
      - '**/*.md'
      - '.github/ISSUE_TEMPLATE/**'
```

`paths-ignore` is OR-semantics: a push touching both `docs/**` and
`frontend/**` still runs, which is correct.

`docs/**` is safe to ignore — verified. The publisher docs that are live
content are served from `frontend/publish/docs/index.html`, a Vite entry
(`vite.config.ts:154`), not from `docs/publisher/`.

**Split the job by area** via `dorny/paths-filter`:

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
message skips both deploy jobs. The reason is **required** — matched as
`\[skip-deploy: *[^\]]+\]`, so a bare `[skip-deploy]` does not skip. This
mirrors the existing `[skip-screenshots: <reason>]` idiom in
`app-store-assets.yml`: opting out is a recorded decision rather than
silence.

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

- **Screenshots.** Phases 3b and 4 change visible pixels on the Events tab
  and My Day. `ios/Scripts/capture-screenshots.sh` then
  `ios/Scripts/compose-screenshots.py`; commit
  `docs/app-store/screenshots.manifest.json` and
  `docs/app-store/screenshots/review/`. `DateFilterLabel` and
  `MyDayChipContent` are in `ChqCalendarShared/**` and matched by
  `.github/workflows/app-store-assets.yml`.
- **Version 1.1.3.** The app and widget targets are at `1.1.3`;
  `CURRENT_PROJECT_VERSION` remains `5`, consistent with the earlier
  decision not to increment a build that was never uploaded. The **test
  bundle `org.chqcal.calendarTests` is still at `1.1.2`**
  (`project.pbxproj:375`, `:393`) — the same incompleteness as the 1.1.2
  bump. Fix in phase 4. Every version reference in docs, plans and the
  App Store listing uses 1.1.3.
- **Listing copy.** `docs/app-store/listing-copy.md` and
  `listing-fields.json` describe the current date story and must be
  re-read against the shipped behaviour in phase 4. `whatsNew` must
  describe the new navigation.
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
