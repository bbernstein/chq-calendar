# The day strip owns all date navigation (web)

**Status:** Design approved 2026-08-25. Implementation not started.
**Issue:** #274. Builds on #272 / PR #273 (site header returns on scroll up).
**Supersedes in part:** `2026-08-16-web-filter-reveal-design.md` and
`2026-08-17-web-filter-panel-dismissal-design.md` — see "What stands and what
does not" at the end.

---

## The problem

The web has two date UIs, and the filter panel is anchored to the wrong piece
of chrome. Three symptoms, one root cause:

1. **The day rail carries a filter control.** `DayRail` renders a funnel
   toggle inside its own chip row (D5 of the dismissal design). It went there
   because the rail was the only sticky thing on the page. It is the one
   control on a navigation surface that does not navigate, and it costs chip
   width on exactly the screen where width is scarcest.

2. **The filter card says "when" a second time.** `DateFilter` (Now · Today ·
   All Season · All Year) plus the nine-week `WeekSelector` duplicate what the
   rail already expresses — and worse, the scope *constrains* the rail.
   `viewWindow` is derived from `dateFilter`, so a rail tap outside the scope
   has to grow the window first (`expandWindowStart`/`expandWindowEnd`), and
   `buildActiveChips` then has to explain the result with a "When: Jul 4 – Jul
   12" chip meaning "the scope, plus wherever you navigated".

3. **There is no way to jump to a week.** The rail is a day-at-a-time strip
   spanning `navigableBounds` (~70 chips). Week 2 to week 8 is a long
   horizontal scroll, or a trip back to the top of a document that can be
   ~31,000px away (measured while working on #238).

This is the machinery iOS deleted in #256/#258, when `DateFilterSheet` went
away and "Now" stopped meaning two different things.

## The target state

**Every control on the day strip navigates. Every filter lives in the filter
panel. The list always contains every event of the selected year.**

---

## Phase map

Four phases, four PRs, one spec. The order is chosen so that no phase ships a
regression:

| Phase | Change | Why it sits here |
|---|---|---|
| 1 | Week band on the day rail | Purely additive. A band tap is `goToDay`, which already handles window expansion. Nothing is deleted. |
| 2 | Week chooser (3×3 icon → 3×3 grid) | Any week reachable in two interactions **before** `WeekSelector` is deleted in phase 4. |
| 3 | Filters moves to the site header; panel becomes a fixed overlay | The rail loses the funnel, so every rail control navigates. |
| 4 | `dateFilter`/`selectedWeeks` deleted; render window rewritten; landing and state migration | Riskiest, and it lands last — on a navigation surface that is already fully capable. |

Each phase gets its own implementation plan under `docs/plans/` and its own PR.

### A primitive that already exists

`weekNumbersForCalendarDate(date, seasonWeeks)` in `lib/utils/dateHelpers.ts`
is already the day-granular "which week(s) does this calendar day belong to"
model — one or two entries, empty off-season — and is already what the day
header's `Wk 5/6` badge and the week filter (#257) use. It is the exact
counterpart of iOS's `SeasonCalendar.weekNumbers(spanningDayOf:)`. The band
reuses it; no new date primitive is needed.

Nine weeks is structural on both platforms (`for (let i = 0; i < 9; i++)` in
`getChautauquaSeasonWeeks`; `SeasonCalendar.weeks` "always returns nine"), so
a 3×3 chooser is sound. The chooser still derives its cells from
`seasonWeeks.length` rather than a literal 9, so a hypothetical non-nine
season degrades to an odd-shaped grid rather than dropping weeks.

---

## Phase 1 — the week band

Following iOS `ios/ChqCalendarShared/Domain/WeekBands.swift` (#258).

### New pure module: `frontend/src/lib/utils/weekBands.ts`

Transcribed from `WeekBands.swift` so that `WeekBandsTests.swift` transcribes
with it. *Which* spans the band covers is decided here; where they land in
pixels is the view's problem.

```ts
export interface WeekBandSegment {
  dayKey: DayKey;
  /** Ascending. Two entries = a boundary Saturday. Empty = outside the season. */
  weekNumbers: number[];
  /** (n - 1) / (weeks - 1) per entry, same order. Drives the lightness ramp. */
  rampSteps: number[];
  /** The week a tap navigates to; null when shared or outside the season. */
  navigationTarget: number | null;
  /** The week whose `WEEK n` label this segment draws. At most one per week. */
  labelledWeek: number | null;
}

export function weekBandSegments(
  dayKeys: DayKey[], seasonWeeks: SeasonWeek[]
): WeekBandSegment[];

export interface WeekBandDestination { dayKey: DayKey; label: string }

export function weekBandDestinations(o: {
  seasonWeeks: SeasonWeek[];
  eventDays: DayKey[];          // sorted; the days navigation can reach
  bounds: NavigableBounds;
  countsByDay: Map<DayKey, number>;
}): Map<number, WeekBandDestination>;

export function weekBandUnreachableLabel(week: number): string;

/** Whether the fill runs on through the gutter after `index`. */
export function bridgesGutter(index: number, segments: WeekBandSegment[]): boolean;
```

Rules carried over verbatim from iOS, each of which has a test:

- **One segment per day chip**, so the band aligns with the chips by
  construction rather than by two layouts agreeing. A single pixel of drift
  shows as a seam through a week boundary.
- **Day-granular, not noon-granular.** A Chautauqua week turns over at
  Saturday *noon*, but splitting a 44px chip at its centre is a distinction no
  reader can use at swipe speed. Same model as the `Wk 5/6` badge.
- **A shared Saturday carries no `navigationTarget`.** It opens one week and
  closes another, so a tap on it cannot mean one week. Each week's six
  non-shared days carry its navigation instead, plus week 1's opening Saturday
  and the final week's closing Saturday, which have no neighbour to share
  with.
- **`WEEK n` is drawn at most once per week, against the *visible* run.** The
  rail spans `navigableBounds`, which can start or end mid-week, so label
  placement follows the visible non-shared days (`indices[indices.count / 2]`)
  rather than a fixed offset from a week start that may be off screen. Never
  on a boundary Saturday, where it would have to pick one of two weeks and
  would sit on the split fill.
- **`weekBandDestinations`' three branches, in order:** the full Saturday that
  opens the week when it holds events under the current filters; otherwise the
  week's first day that does, because the rail never announces a destination
  it cannot reach; otherwise absent from the map, which is the signal the band
  is **disabled**. Absent ≠ "nothing is reachable" — an absent *map* means "no
  reachability information yet".
- **`bridgesGutter`** compares full `weekNumbers` sets on both sides, not
  `first == first`: a boundary Saturday's `[1, 2]` shares its *second* entry
  with the week after it, which a first-only shortcut would miss.

`weekBandDestinations` takes `seasonWeeks` once and loops, rather than
rebuilding the season per week — the same fix #256 needed after a ~70-chip
rail cost ~70 season rebuilds per scroll tick.

### What a tap does

Two lookups, deliberately separate, because they answer different questions:

```
tap a segment
  → segment.navigationTarget   ── which week does this day unambiguously mean?
                                  (null on a shared Saturday, or off-season → no-op)
  → weekBandDestinations.get(n) ── which day of that week can we actually reach?
                                  (absent → the week is disabled)
  → goToDay(destination.dayKey)
```

`navigationTarget` is a property of the *calendar* — it depends only on the
day and the season. `weekBandDestinations` is a property of the current
*filters* — it depends on which days hold matching events. Keeping them apart
is what lets the band's segmentation be tested as a pure function of the
season while reachability is tested against event sets.

### Placement: inside `DayRail`'s own root

The band renders inside the element `rootRef` lands on. `useDayRailHeight`
measures only that root and publishes `--day-rail-h`, which day headers
(`dayHeaderTop()`) and `useDayAnchor` compute their clearance against.
Persistent chrome added in a sibling element widens the actual stuck header
without widening the variable, undercounting that clearance. This is already
written up on `DayRail`'s `filtersToggle` prop; the same argument applies to
the band, and unlike the toggle the band is unconditionally present.

### Alignment by construction

Each day becomes a column inside the existing `w-max` scroller content:

```
<div class="flex flex-col">      ← one per day; width = widest child = the chip
  <div class="band-segment" />   ← ~14px tall (matching iOS's 14pt)
  <button data-chip="…">…</button>
</div>
```

The segment's width **equals** the chip's because both are block-level
children of the same column and the chip is the wider. That is structural, not
measured.

Two things are allowed out of the box, and only these two:

- **The painted fill.** It bridges half a gutter on each bridged side, so two
  bridged neighbours meet exactly at the gutter's midpoint with no hairline and
  no overlap seam. Web mirrors `RailMetrics`: one place for the chip gutter,
  with the bleed *derived* from it (`gutter / 2`) rather than a second literal
  that happens to match today. The break between two weeks' runs is drawn
  through the middle of the boundary Saturday they share and is deliberately
  *narrower* than a chip gutter — it is the only gap left in the band, so it
  does not need to shout.
- **The `WEEK n` label.** Absolutely positioned, allowed to overhang its
  neighbours (clipped only by the scroller). The label names a whole week, so
  overhanging is correct; widening one column of the rail is not — a label
  that widened its column would pull the band out of line with the chips it
  labels, and with it the chip below.

Neither may change the segment's own box.

### Two identified risks, both in `useRailHighlight`

1. **Pill geometry.** The highlight pill is `absolute inset-y-0` against the
   content container. With a band above the chips it would paint over the
   band. It must re-base to the chip row's top — and the clipped copy row must
   grow the same column wrapper with a transparent band-height spacer, or the
   two layers desync and produce the seam through a digit that the shared
   `chipBoxClass` exists to prevent. Both layers keep sharing one class for
   the box; the band spacer joins that shared contract.

2. **Accessibility exposure.** iOS exposes only the *labelled* segment per
   week to VoiceOver while keeping the tap target on every segment — nine
   elements reading "Week 1" through "Week 9" is the band's actual content;
   exposing all ~64 would put sixty-odd mostly-unlabelled stops in front of a
   reader swiping the rail, and an unlabelled element is itself what an audit
   flags. On web that means **one real `<button>` per week** (the labelled
   segment, carrying the accessible name) and `aria-hidden` decorative
   segments carrying the pointer handler — the same "must be a `<div>`, never
   a `<button>`" call the clipped copy row already makes, and for the same
   reason: it must not answer to a selector looking for a control. axe's
   `aria-hidden-focus` rule is the thing to prove clean in the browser pass,
   not to assume.

### Colour

A **lightness** ramp, not a hue ramp: adjacent weeks always differ, and it
survives colour-vision deficiency. Web ports the iOS ramp endpoints
(`WeekBandStart` / `WeekBandEnd`, each with a dark-mode variant) as CSS
custom properties, interpolated by `rampStep`.

It must hold deliberate contrast distance from the selected-chip colour
(`bg-blue-600`, `#2563EB`). An earlier iOS palette computed **1.196:1**
against `DayChipSelected`, which made the band and the selected chip merge
into one shape at week 9. A unit test mirroring `WeekBandContrastTests` pins
the minimum ratio across all nine steps in both themes.

### Unreachable and empty

A week the band cannot reach (absent from `weekBandDestinations`) is dimmed
and inert, mirroring the dashed empty chips directly beneath it, rather than
looking ordinary and silently refusing. Named as a fact, not an offer:
`"Week 4, no events"`, exactly as an empty day chip reads
`"Monday, July 6, no events"` rather than `"Go to …"`.

A reachable week is named by destination, never by direction, and says
"opens" only when the target really is the week's opening Saturday:
`"Go to Week 6, opens Saturday, June 27, 84 events"` versus
`"Go to Week 6, first events Monday, June 29, 12 events"`.

### Decided: the band scrolls with the chips

Issue open question 3. Pinned, the band would always name the current week;
scrolling, it stays aligned with the chips by construction.

The pinned option's only advantage disappears in phase 2, where the week
chooser names the current week outright. Scrolling keeps alignment
structural — the property that makes seams impossible — and is what the iOS
design chose.

---

## Phase 2 — the week chooser

### The trigger: a 3×3 icon with the current cell lit

At the right end of the rail, ~44px square — the cheapest control on the
strip, and a literal miniature of what it opens. The lit cell gives
position-in-season *spatially*, which a numeral gives only once the reader
relates it to a nine-week season.

The lit cell takes that week's tone from the band's ramp, so the icon reads as
a legend for the band beside it.

- Current week resolved from `anchorDay` through `weekNumbersForCalendarDate`.
  A shared Saturday lights the later of its two weeks (the one the reader is
  scrolling into); the accessible name says which.
- Off-season, or on a pre/post-season day inside `navigableBounds`, the anchor
  is in no week: no cell lights, and the accessible name is
  `"Choose a week"`. This mirrors `⟳ Now` disappearing on an archived year
  rather than rendering a control that means nothing.
- Accessible name when a week is current: `"Week 6 of 9, choose a week"`. A
  `title` carries the same words for sighted mouse users. On touch there is no
  tooltip, but the first tap opens a grid of numbered weeks, which
  self-explains.

Accepted risk: a bare 3×3 is also the generic apps/grid icon, so "weeks"
comes from context — the lit cell moving as the reader scrolls, the `WEEK n`
band immediately beside it, and the grid itself on first tap.

### The popover: a 3×3 grid

Nine 44px cells in a row is 396px, wider than a 390px phone. Nine in a 3×3 is
a 132px square with real touch targets. This is a straight win over a 1×9
strip independent of the trigger's shape.

Built from `WeekSelector`'s existing markup, repurposed from a filter into a
jump control: `onTap` becomes
`goToDay(weekBandDestinations.get(n).dayKey)` instead of `setSelectedWeeks`.
Reachability comes from the same `weekBandDestinations` map the band uses, so
an unreachable week is dimmed and inert here too, from one source of truth.

`WeekThemePopover` comes along unchanged — long-press, right-click and
Shift+F10 all keep working. **This is what keeps week themes reachable when
the week strip leaves the filter panel in phase 4.** The other route,
`WeekBadge` on the day header, is untouched throughout.

Keyboard: the grid is two-dimensional, so Left/Right move by one and Up/Down
move by three (`seasonWeeks.length` per row, in practice 3). Escape closes and
returns focus to the trigger. `useFloatingCoords` already handles viewport
clamping; the popover portals to `document.body` as `WeekSelector`'s does
today.

### Acceptance

Any week of the season is reachable in **two** interactions from anywhere in
the list: reveal the header is not needed — the chooser is on the sticky rail,
so it is one tap to open the grid and one to pick the week.

### Addendum, 2026-08-25 — how the popover was actually built

Phase 2 built the grid from `WeekSelector`'s *behaviour*, extracted into
`hooks/useWeekThemePopover.tsx`, rather than from its markup. The two controls
share only "nine numbered buttons that can open a theme popover": a cell in the
filter strip means selected/not and greys for being in the past, a cell in the
chooser means reachable/not and greys for having no matching events, and the
chooser adds a two-dimensional keyboard walk the strip never had. One component
doing both would carry grid code down the filter path and drag code down the
navigation path for two phases, and the drag half is deleted in phase 4 anyway.

**Consequence for phase 4:** `components/filters/WeekSelector.tsx` is deleted
outright, not preserved inside the chooser. `useWeekThemePopover` and
`WeekThemePopover` are what keep week themes reachable once the week strip
leaves the filter panel, together with `WeekBadge` on the day header.

---

## Phase 3 — Filters in the site header, panel as a fixed overlay

### The move

`FiltersIcon` moves into `Header`, keeping the active-filters dot.
`useFilterPanel` stays owned by `page.tsx`; the toggle's props are passed down
to `Header` the way they are passed to `DayRail` today. `DayRail`'s
`filtersToggle` prop is deleted.

Because #272's header returns on any upward flick, the filters are one small
gesture away from anywhere in the list — the reachability the rail toggle was
invented to provide, now provided by the thing that was missing.

### The panel is always fixed, never in flow

This is the load-bearing decision, and it is what makes the change *smaller*
than it looks.

`filterHeaderLayout.ts` records the measured failure: removing the filter card
from flow mid-scroll changed document height above the reader, scroll
anchoring corrected for it, and 40 slow wheel ticks (2400px requested)
advanced the page **0px**, returning to the top 20 times, in both Chromium and
WebKit. The root cause was the *toggle* between in-flow and not — a ~290px
header cannot collapse after 64px of scrolling, because there is not enough
room above the reader to absorb it.

A panel that is `position: fixed` in **both** states never contributes to
document height at all, so there is nothing for scroll anchoring to correct
and nothing to collapse. Mounting and unmounting it is free.

**This must be stated as an invariant in code, not left as an implementation
detail**: the filter panel is never in flow. A future change that makes it
in-flow "just at the top of the page" reintroduces exactly the toggle that
broke scrolling.

### An open panel holds the header revealed

New coupling, and the only genuinely new behaviour in this phase. The panel
hangs off the header; if the reader scrolled down with the panel open, the
header would hide and leave the panel floating detached from nothing.

`useSiteHeaderReveal` gains a "hold revealed" input, driven by
`filtersOpen`. `useFilterPanel`'s existing `useDismissOnScrollGesture` already
dismisses on a scroll gesture, so the sequence is:

> scroll gesture → panel dismisses → header resumes its normal reveal/hide

No new gesture handling. The hold is released by the panel closing, in the
same commit.

### What this deletes

All of it exists only to manage an in-flow card that no longer exists:

- `useFilterCardHeight`, `--filter-card-h`
- `filterHeaderTop`'s `PARKED_TOP` expression, and `filterHeaderTop` itself
- `filterCardParked`
- `useScrolledPastFilters` and its sentinel `<div>`
- `useElementOutOfView`
- the exit-rect freeze trio — `filtersExitRect`, `filtersExitScrolledPast`,
  `filtersExitingVisible` — and the in-flow-to-fixed switch they choreograph.
  The exit becomes a plain CSS transition on an element that never was in
  flow.
- `DayRail`'s `filtersToggle` prop
- the `data-filter-header` sticky wrapper in `page.tsx`

### What survives, and what to re-verify

`DayRail`'s own root becomes the sticky element, at
`top: var(--site-header-offset)`, with `<main>` still its containing block.
**Re-verify in the browser**: `position: sticky` is bounded by its element's
containing block, and in #238 a wrapper `<div>` sized to fit only the rail
*became* that containing block and gave sticky zero travel. Eleven green task
reviews missed it; the browser pass caught it.

`FilterPanelCaret` stays and becomes unconditional — the panel now always
overlays. The internal height cap and internal scrolling also become
unconditional, sized against the viewport below the revealed header, since the
panel is always an overlay.

Focus: on open, focus moves into the panel; Escape closes and returns focus to
the header toggle via the existing `toggleRef`. The `inert` treatment the
parked card needed is gone with the parking, but the panel still needs to be
absent from the tab order while closed — which `display: none` now provides
for free, safely, precisely because it was never in flow.

`dayHeaderTop()` is unchanged: `calc(var(--site-header-offset) + var(--day-rail-h))`.

### Accepted cost

The top of the page no longer shows a filter card, so search lives behind the
funnel everywhere. The funnel is in the header, and the header is revealed at
the top of the page, so it is always one tap away. This is what iOS does, and
it gives the list the space back.

---

## Phase 4 — date filters deleted

### Gated on a measurement

Before phase 4's plan is written, **spike whether the render window can be
deleted outright.** Mount all ~1,470 events (~64 day sections, roughly 45k DOM
nodes) on a throttled mobile CPU profile and measure first paint, long tasks,
scroll jank and memory.

- **If it holds:** `EventList` collapses to a plain map over `groupedEvents`.
  The bottom sentinel, `renderEndIndex`/`extendRenderEndIndex`,
  `renderResetKey`, the prepend correction, the settle window and its
  `ResizeObserver` reassert, `revealDay`, and `pendingScroll` all disappear.
  This is by far the largest deletion available anywhere in this issue.
- **If it does not hold:** fall back to the documented alternative — the
  render window becomes a **two-way range anchored on day keys**
  (`[startKey, endKey]` rather than `[0, endIdx]`), initial anchor today or
  the next day with events, grown forward automatically by the bottom sentinel
  as now and backward by an explicit "Show earlier" press as now. Anchoring on
  day keys, never indices, is non-negotiable either way: growing backward
  prepends groups and shifts every index, and an index-based window would keep
  the same numeric bounds over different content and silently unmount the day
  the reader was looking at.

Automatic two-way growth is explicitly **rejected** as the fallback: it makes
content arriving above the reader an ordinary consequence of scrolling up,
which is the geometry the prepend correction was written to survive and where
the 0px-progress bug lived. Backward growth stays an explicit press.

**The measurement result is written into this spec as an addendum** before
phase 4's plan is written, so the choice is a recorded decision rather than an
inference from the code that ships.

### Addendum, 2026-08-26 — the gating measurement

Run on the branch `spike/274-phase-4-render-window`, against a production
`vite build` served by `vite preview` with `/cache` proxied to the live CDN,
at 390×844, under Chromium CPU throttling of 4× and 6× (a fast and a mid-tier
phone; the machine is an Apple-silicon Mac, so these are the honest proxies,
not absolutes). Three runs per configuration, medians reported. The harnesses live on the
spike branch at `f606a73` and are not merged, because each of them drives URL
flags that exist only there: `measure-render-window.mjs` (the table below),
`measure-scroll-trace.mjs` (timeline attribution), `measure-scroll-profile.mjs`
(JS self time, needs a `--minify false` build), `spike-rerender.mjs` (render
counts), `spike-cv-seams.mjs` and `spike-midjump.mjs` (the seams). Phase 4
re-runs an adapted `measure-render-window.mjs` against the shipped build, where
"full mount" is simply the app. The scroll figure is forty real 600px wheel
gestures, 50ms apart. The clock is deliberately not pinned:
`'all'` spans `navigableBounds` whatever the hour is.

**First, the premise was understated.** This spec says "~1,470 events, ~64 day
sections". The 2026 feed served today puts **1,687 events across 89 day
sections**, January 3 to September 10 — 31 days in July, 31 in August, and 26
scattered across the rest of the year from other publishers. `'all'` is a
*calendar year*, not a season, and phase 4's list is the calendar year. Every
number below is against 89 sections and 45,311 DOM nodes, not 64 and 45k.

#### It does not hold as the code stands — and the DOM is not the reason

Full mount, unchanged code, 6× (windowed today in brackets):

| | full mount | windowed today |
|---|---|---|
| frame interval p95 | 299ms | 75ms |
| worst frame | 659ms | 101ms |
| long tasks during the scroll | 15, 4,725ms | 18, 1,295ms |
| wall time for the same 24,000px | 7.7s | 3.3s |

`Performance.getMetrics` accounts for only ~550ms of that 5–8s as script,
style and layout put together. The timeline trace puts 2,628ms in
`FireAnimationFrame` against 94 frames — 28ms of work per frame — and the CPU
profile names the functions: `chqParts` (631ms), `chqDateAt` (328ms), Preact's
diff, and `EventCard` itself.

**The cost is a whole-page re-render on every anchor update.** `useDayAnchor`
holds `anchorDay` in `page.tsx`, so each rAF-throttled scroll measurement that
moves the anchor re-renders the page, `EventList`, `EventListView` and every
mounted card, each card re-running its `Intl` date formatting. Counted
directly, with a render counter in `EventCard`: a forty-tick scroll costs
**26,992 card renders** at full mount (16 list renders × 1,687 cards) against
3,378 windowed. The render window is not protecting the reader from the DOM's
size; it is capping the blast radius of a re-render that should not be
happening at all.

#### Two changes make it hold

1. **Memoize the list subtree.** Wrapping `EventListView` in `memo` takes the
   scroll from 26,992 card renders to **0** — the props `page.tsx` hands down
   are already stable across an anchor-only change, so nothing further is
   needed to make it bite.
2. **`content-visibility: auto` with `contain-intrinsic-size` on each day
   section.** The whole list stays in the DOM; the browser skips layout and
   paint for what is off screen.

At 4×, forty wheel gestures:

| | windowed today | full + memo | full + memo + CV |
|---|---|---|---|
| frame p50 / p95 | 8.4 / 41.8ms | 10.0 / 31.8ms | **8.3 / 17.4ms** |
| worst frame | 100.5ms | 107.3ms | **48.3ms** |
| frames over 50ms | 6 of 200 | 5 of 192 | **0 of 253** |
| long tasks | 6, 360ms | 4, 356ms | **1, 51ms** |

At 6× the same ordering holds: p95 73.8 → 59.9 → **34.6ms**, worst frame
116.7 → 142.8 → **83ms**, long tasks 18/1,289ms → 15/1,121ms → **5/335ms**.

**Scrolling the whole season is not merely survivable, it is better than what
ships today** — because today's scroll pays for render-window growth and for
the same unnecessary re-render, and the full-mount page pays for neither.

#### What full mount still costs, and it is not nothing

| | windowed today | full + memo + CV |
|---|---|---|
| DOM nodes | 7,808 | 45,311 |
| JS heap | 12.8MB | 22MB |
| longest blocking task at load, 4× | 755ms | 1,067ms |
| longest blocking task at load, 6× | 1,182ms | 1,649ms |
| first day section on screen, 4× | 2,211ms | 2,637ms |
| first day section on screen, 6× | 3,370ms | 4,008ms |

`content-visibility` does not help here: it skips layout and paint, and the
load cost is DOM construction plus two Preact passes over 1,687 cards (3,374
card renders at load with the memo, 6,748 without). **The price of the
deletion is roughly +0.4s at 4× and +0.6s at 6× before the reader sees a list,
and +9MB of heap.** Phase 4's collapse of `navMatchingEvents` and
`filteredEvents` into one filter pass claws back part of the script share of
that (~140–230ms total at load today), but not the DOM construction.

#### Seams measured rather than assumed

- **A rail jump lands exactly, anywhere in the list, with CV on.** Jumps from
  the top to the day at 25%, 50% and 75% of the year each put the target at
  **140px — the sticky offset, to the pixel — and it had drifted 0px** 2.5
  seconds later, with or without CV. The first version of this check jumped to
  the *last* day and proved less than it looked: the browser clamps at maximum
  scroll, which would mask any error.

  **The reason it holds is load-bearing for phase 4.** `scrollToDay` scrolls
  by a *relative* delta — the target's own `getBoundingClientRect().top` minus
  `stickyOffset()` — and reading that rect forces the browser to lay the target
  out for real. Estimated heights above it never enter the arithmetic. An
  absolute `scrollTo(y)` computed by summing offsets would drift, and the
  document does shift under CV as estimates are replaced by real sizes
  (174,324 → 172,429px across three jumps without CV; 160,643 → 160,066px with
  it). **Phase 4 lands every reader mid-list on every load, so this is the
  difference between landing on today and landing near it: never compute an
  absolute offset from a list whose sizes are estimates.**
- **Keyboard focus reaches a control inside a skipped section**; the browser
  un-skips on focus.
- **With CV, off-screen sections are absent from the accessibility tree.**
  Measured through `Accessibility.getFullAXTree`: at the top of the list the
  last day's heading is present without CV and absent with it. This is *not* a
  regression against what ships — today those days are not in the DOM at
  all — but it is the one thing full mount could have bought and CV gives
  back. Full mount **without** CV is the only configuration in which the whole
  year is in the accessibility tree at once, and it costs the scroll numbers
  in the middle column above.

#### The memo is worth having whatever phase 4 decides

Applied to today's windowed code it takes the scroll from 3,378 card renders
to 953, p95 from 73.8 to 56.4ms and long tasks from 18 to 11 (6×). It is a
small, independent improvement that does not depend on this issue at all.

#### Decision

**The render window is deleted outright — the "if it holds" branch — with the
two changes above as part of phase 4 rather than as follow-ups.** The
documented alternative (a two-way day-keyed range) is **not** taken.

`EventListView` is memoized and day sections carry `content-visibility: auto`
with a `contain-intrinsic-size` derived from the section's event count. The
accepted cost is +0.4–0.6s to first list on a throttled phone and +9MB of
heap; what it buys is the deletion listed above plus a measurably smoother
scroll than ships today. The `contain-intrinsic-size` estimate is a guess
about card height and must be stated as one in the code — it is right at the
time of writing and nothing enforces it, so a browser check asserts the
document height against the measured sections rather than trusting it.

### The collapse is larger than it first appears

Once the view window *is* `navigableBounds` — and `navigableBounds` is already
widened to contain every event of the year — the date stage of `filterEvents`
admits everything. It is a no-op, so it goes. That cascades:

- `nonDateFilterOpts` and `filterOpts` merge into one options object.
- `navMatchingEvents` becomes `filteredEvents`. Today they are two full filter
  passes over ~1,470 events; they become one.
- `navEventDays` and `navDayCounts` derive from that single filtered set,
  which removes the standing hazard that the rail could become a readout of
  the filter it exists to navigate past.
- `railTarget` reduces to "reveal and scroll" — no expansion planning.
- `shouldAbandonScroll`'s wait-for-expansion case disappears; abandoning
  becomes "the day has no matching events".
- `viewWindow`, `baseWindow`, `WindowOptions`, `clampToBounds` and the
  `adaptiveEndDate` plumbing (`getAdaptiveEndDate`) all go from
  `dayWindow.ts`. `navigableBounds`, `dayKeys`, `dayChips`,
  `eventCountsByDay`, `eventDayKeys`, `formatDayLabel`, `formatDayRange`,
  `addDays`, `startOfDay`, `dayAfter` and `DayKey` all stay.
- `scopeHasWindow` goes from `DayRail` — the null-window case it guards
  (off-season `'this-week'` restored from localStorage) ceases to exist.

### `useFilterState` shrinks

Removed: `dateFilter`, `selectedWeeks`, `windowStartDay`, `windowEndDay`, and
the actions `SET_DATE_FILTER`, `SET_SELECTED_WEEKS`, `EXPAND_WINDOW_START`,
`EXPAND_WINDOW_END`, `RESET_WINDOW`, `CLEAR_NON_DATE_FILTERS`. Removed
derived values: `hasDateFilters`, `hasNonDateFilters`,
`clearNonDateFilters`. `hasNonDefaultFilters` collapses into `hasFilters` —
with no default scope, "default" simply means "no filters", and the long
comment explaining why the two had to differ can go with them.

`RECONCILE_FILTERS` keeps reconciling categories and locations against the new
year's available sets, and stops touching scope and weeks.

### localStorage migration

`chq-calendar-user-state` must tolerate a payload written by the **current**
version (CLAUDE.md's rule about not breaking the state schema without handling
migration). `loadInitialState` simply stops reading `dateFilter` and
`selectedWeeks`: an old `dateFilter: 'this-week'` is ignored, not restored into
a field that no longer means anything.

The reverse direction is also safe and worth stating: an old build reading a
*new* payload finds `parsed.dateFilter === undefined` and falls back to
`'next'` via its existing `|| 'next'`, so a reader who downgrades gets the old
default rather than a crash.

Test: a payload written by the current version loads without error and
restores nothing date-shaped.

### Where the page lands on load

- Current year, in or out of season: **today, or the next day with events.**
  With no scope, this has to be an explicit behaviour rather than a side effect
  of `dateFilter: 'next'`.
- Archived year: **the season start.**
- **Never restore a last-viewed day**, even inside the 30-day
  `USER_STATE_EXPIRY_MS` window. This is the reasoning `useFilterState`
  already records for `windowStartDay`/`windowEndDay` being deliberately
  session-only — "a date pinned days ago and silently restored on launch would
  be worse than no restore" — and it matches iOS's `selectedDayKey`. Scroll
  position is not restored either.

### The off-season landing is re-expressed on a date basis

**This is the consequence the issue does not name, and it is a regression risk
against #269, which shipped 2026-08-24 against a hard date.**

Today `OffSeasonLanding` and `CountdownBanner` appear because
`dateFilter: 'next'` yields zero events and `page.tsx`'s empty-list branch
fires. With the whole year always listed, an off-season visit to 2026 lists
all 1,470 summer events — the list is never empty, so the landing and the
countdown would silently never appear again.

**Decision: drive the branch from `landingState` directly.**
`determineLandingState` is already date-based and filter-free — it takes `now`,
`selectedYear`, `availableYears` and `yearHasEvents`, and deliberately reads
`events` rather than `filteredEvents` so a failed feed fetch during the season
is not reported as "See you next season". The branch becomes:

> out of season **and** no filters → `OffSeasonLanding` *instead of* the list
> in season, **or** any filter applied → the list

The landing stops being an emergent side effect of an empty result set and
becomes a stated branch — which is what #269 always meant. Readers see exactly
what they see today, with no new UI.

`EmptyState` keeps its own job: a filter that matches nothing.

The landing's two buttons re-express as navigation, since there is no scope
left to set:

- `previewNextSeason(year)` sets the year and nothing else. Today it also sets
  `dateFilter: 'all'` because `next`'s adaptive window has nothing to adapt to
  that far ahead; with no scope there is nothing to open up, and the landing
  rule above lands the reader at that season's start.
- `browseArchiveSeason()` deliberately does not change the year (the year on
  screen is already the one that ended). Today it sets `dateFilter: 'season'`;
  it becomes "land at the season start" — navigation, not filtering.

### The filter panel's final contents

1. `SearchBar`;
2. `LocationFilter`, `CategoryFilter` as they are now, plus favourites-only —
   which moves out of `DateFilter`'s scope row, where the `★ N` button lives
   today;
3. **"Filtering by:"** — `ActiveFilters`, minus the date and week chips, with
   one Clear all.

`onClearNonDateFilters` ("Keep dates, show all") loses its reason to exist:
with no date filters there is nothing to keep, so there is one Clear, not two.
`ActiveFilters` loses `hasDateFilters`/`hasNonDateFilters`.

### Deletions

`components/filters/DateFilter.tsx`; `components/filters/WeekSelector.tsx`
outright — phase 2 built the chooser from its *behaviour*, not its markup,
so nothing of the component itself survives (see the addendum above);
`useWeekDragSelection` in `hooks/useScrollState.ts` and the `weekDrag` prop
chain; the `date` and `week` branches of `buildActiveChips.ts`, along with its
`viewWindow`, `windowExpanded` and `resetWindow` inputs; `isWeekHighlighted`
in `page.tsx`.

---

## Testing

### Unit

- **`weekBands.test.ts`**, transcribed from `ios/ChqCalendarTests/WeekBandsTests.swift`:
  segmentation; `WEEK n` placed once per week against the *visible* run; a rail
  starting or ending mid-week; shared Saturdays carrying no `navigationTarget`;
  ramp steps; `weekBandDestinations`' three branches (opening Saturday, first
  day with events, absent); a week entirely outside `bounds`;
  `bridgesGutter` across a boundary Saturday's two-entry set.
- **Contrast test** mirroring `WeekBandContrastTests`: minimum ratio between
  every ramp step and `bg-blue-600`, in both themes.
- **Week chooser**: current-week resolution from `anchorDay`, including a
  shared Saturday and an out-of-season anchor (no cell lit); unreachable weeks
  inert; 2-D keyboard walk.
- **Phase 3**: the panel is never in flow in either state; an open panel holds
  the header revealed; a scroll gesture dismisses and releases the hold.
- **Phase 4**: the localStorage migration test above; landing-on-load for
  current year in season, current year out of season, and archived year; the
  `landingState`-driven branch, including the in-season-with-failed-feed case
  that must *not* say "See you next season"; whichever `renderWindow` shape
  the spike selects.

### Browser (`frontend/e2e/`)

- `verify-rail.mjs` gains band checks: every segment's box width equals its
  chip's; the fill bridges within a week and breaks at a boundary Saturday;
  `WEEK n` appears once per week; an unreachable week is dimmed and its tap
  does nothing; the highlight pill does not paint over the band, and the
  clipped copy has no seam.
- New week-jump checks: open the chooser from a deep scroll position, jump
  from week 2 to week 8, confirm the landing day and that the lit cell
  followed.
- New: open the filters from a deep scroll position (phase 3).
- **The slow-scroll check re-runs in phases 3 and 4** — one wheel tick at a
  time, in Chromium *and* WebKit, asserting steady progress. Both phases touch
  the sticky geometry. A gesture is not one scroll event: WebKit on Linux
  delivers one wheel tick as several frames, so the check drives real frames
  rather than a single synthetic tick, or it is green on macOS and broken in
  CI.
- An axe pass over the rail with the band present, specifically
  `aria-hidden-focus`.
- The clock is pinned with `setFixedTime` (never `install`) for anything
  date-dependent. Once today's last event and `Now`'s one-hour grace pass,
  today legitimately leaves any window — the boundary moves date to date, so
  an unpinned check is a time bomb.

### Falsification

Every new guard is proven by breaking the code first. When injecting a defect
to falsify a **browser** check, build with `npx vite build` and grep the output
to confirm the injection landed — `npm run build` gates the bundle on the unit
suite, so a defect that fails a unit test silently serves the *previous*
bundle and the browser check passes for the wrong reason. When a falsification
passes unexpectedly, suspect the harness and re-run it against the old code.

---

## What stands and what does not

From `2026-08-16-web-filter-reveal-design.md` and
`2026-08-17-web-filter-panel-dismissal-design.md`:

**Stands.**
- The reader must be able to reach the filters from anywhere in the list
  without scrolling to the top. This design changes *which* chrome provides
  that (the site header, not the rail), not the requirement.
- The dismissal model: Escape, a scroll gesture, the caret, and the toggle
  itself, with focus returning to the toggle.
- The active-filters dot, meaning "you are looking at a slice, not
  everything".
- The panel caps its own height and scrolls internally rather than letting its
  bottom controls fall off a phone screen.
- The measured scroll-anchoring failure and its cause. It is the reason the
  panel is fixed in both states rather than in flow at the top.

**Does not stand.**
- D5's funnel toggle **on the rail**. It moves to the site header in phase 3.
- The sticky container wrapping the filter card *and* the rail, and the
  negative-`top` parking that goes with it (`--filter-card-h`,
  `filterCardParked`, `useScrolledPastFilters`, `useElementOutOfView`, the
  exit-rect freeze). The panel never being in flow removes the problem those
  solved.
- The filter card as in-flow content at the top of the document.
- The `Now · Today · All Season · All Year` scope row and the nine-week filter
  strip, and with them the "When: Jul 4 – Jul 12" chip and the two-Clear
  split.

## References

- #272 / PR #273 — the header this depends on
- #256 / #258 — the iOS version of this consolidation, and `WeekBands.swift`
- #257 — the day-granular overlapping-Saturday week model
- #269 / PR #270 — the off-season landing this must not regress
- #238 — the day rail, and the wrapper-div-kills-sticky lesson
- `2026-08-15-cross-platform-date-navigation-design.md` — the shared
  `ViewWindow` model phase 4 collapses on the web side
