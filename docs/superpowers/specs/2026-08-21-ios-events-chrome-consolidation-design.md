# iOS Events tab — chrome consolidation

**Status:** Design approved 2026-08-21. Not yet planned or implemented.
**Scope:** iOS only. The web calendar page is out of scope for this document.

## The problem

The Events tab spends ~350pt of a 956pt screen (iPhone 17 Pro Max, 440×956)
on permanent chrome — **37%** — spread across five bands owned by four
different mechanisms:

| Band | Owner | ~Height |
|---|---|---|
| Nav bar — `CHQ Calendar` · `⋯` · `2026` | `EventListView.toolbarContent` | 44 |
| Search field | `CalendarView`, `.searchable(placement: .navigationBarDrawer(displayMode: .always))` | 52 |
| Day rail — `⟳` `‹` chips `›` | `EventListView.safeAreaInset(.top)` | 64 |
| `📅 Now` / `⚌ Filters` pills | `EventListView.safeAreaInset(.bottom)` | 54 |
| Tab bar — Events · My Day · Map | `RootTabView` | 83 |

In the iPad sidebar the same chrome leaves the title truncated to
`CHQ Calend…` and the day rail showing **two** chips.

### P1 — Two controls claim "the date," and both are called "Now"

The rail's `⟳ Now` is navigation: it scrolls to today and, per its own doc
comment, "does not touch scope, weeks, categories, or search." The bottom
pill reads `Now` because that is `DateScope.next`'s label — a filter. Two
controls, ~700pt apart, same word, different operations.

This is the root cause of the rest. The screen has two date models because it
grew two date UIs, and neither can be simplified while the other exists.

### P2 — The primary controls are at the bottom, in glass, over the list

`filterPillBar` renders as Liquid Glass capsules floating above the tab bar,
overlapping event rows. They read as list content rather than chrome —
visible in `docs/app-store/screenshots/review/iphone-6.9-01-season.png`.

Nobody chose the bottom. Before the tab shell (task 16) these were a real
`ToolbarItemGroup(placement: .bottomBar)`; when `RootTabView` landed, the tab
bar painted on top of them, and they were moved to a safe-area inset — which
fixed the occlusion without ever revisiting the placement.

### P3 — Search is unconditional

`displayMode: .always` was chosen so search "stays discoverable without
knowing the pull-down gesture." That is a real concern, paid for with 52pt on
every screen forever.

### P4 — The rail is starved by its own furniture

`⟳` + `‹` + `›` sit outside the horizontal scroller — correctly, since #245
established that inside it they scroll away and become unreachable. They cost
~130pt of 440, leaving **3 chips**. The surface we want to promote to primary
date chooser has the least room on the screen.

### P5 — Week numbers are absent from the navigation surface

`Wk 5` appears only on list day headers. The nine-week strip is two taps deep
inside `DateFilterSheet`.

## The design — one control bar

```
┌──────────────────────────────────────────┐
│ CHQ Calendar  2026 ▾        🔍  ⚌·  ⋯    │
├──────────────────────────────────────────┤
│        WEEK 5        │       WEEK 6      │
│ ⟳  Mon  Tue  Wed  Thu  Fri  Sat  Sun     │
│    27   28   29   30   31   1    2       │
│    12   8    9    32   14   6    11      │
├──────────────────────────────────────────┤
│ Thursday, July 30                        │
│  7:45  CHQ Mystic Heart …                │
```

Three decisions, taken 2026-08-21:

1. **Approach A — one control bar.** Search and Filters become toolbar
   buttons beside the year and `⋯`. The bottom pill bar is deleted.
   `DateFilterSheet` is deleted. The four scopes move into `FilterSheet`.
2. **Drop the `‹ ›` step chevrons** — ~6 chips instead of 3. Empty-day skip
   is preserved as a VoiceOver rotor action (see A4).
3. **The rail stays pinned.** Only search scrolls away. The rail is both the
   date chooser and the position indicator; hiding it removes the "where am I
   in the season" answer exactly while the reader is moving through it.

### A1 — Search: change `displayMode`, not `placement`

Change `CalendarView`'s two `.searchable` calls from
`.navigationBarDrawer(displayMode: .always)` to
`.navigationBarDrawer(displayMode: .automatic)`, and add a `🔍` toolbar
button bound through `@FocusState` + `.searchFocused(_:)` (iOS 18+, and the
deployment target is iOS 18).

**Do not change `placement` to `.automatic`.** On the iOS 26 SDK the default
placement is bottom-anchored, which is the same screen edge as `RootTabView`'s
tab bar — the exact collision that moved search to `.navigationBarDrawer` in
the first place (screenshot-verified: date pill, Filters and the search item
all present but covered and unusable). Keeping `placement` and relaxing only
`displayMode` gets the scroll-away behaviour without re-entering that trap.

The `🔍` button *is* the discoverability that `.always` was buying — the same
guarantee, none of the permanent 52pt.

When a search term is active the field stays pinned, so a reader can always
see and clear what is narrowing their list.

### A2 — Filters moves to the toolbar

`⚌` (`line.3.horizontal.decrease`) with the existing count badge, in
`.topBarTrailing` beside `2026` and `⋯`. The badge is what makes it legible
at icon size — an icon alone cannot distinguish "everything" from "a slice."

`filtersAccessibilityLabel` moves with the button unchanged.

### A3 — The bottom pill bar is deleted

Remove `filterPillBar`, `pillRow`, `pillButton`, and the
`.safeAreaInset(edge: .bottom)` that mounts them.

The accessibility-size `ScrollView`/`fixedSize` pairing documented at length
on `filterPillBar` goes with them: it exists solely because two pills could
not fit side by side in that row, and there is no longer a row.

### A4 — The rail loses its chevrons and gains a week band

**Chevrons.** `DayRailView`'s Events-tab call site passes `⟳` as `leading`
and nothing as `trailing`. My Day keeps its own chevrons — they mean "go far,"
a different question, and this change must not regress that screen.

The chevrons are today the only control that *skips empty days*, and their
VoiceOver labels name the real destination (`stepLabel(for:nav:)`). Tapping an
adjacent chip does not skip. That capability is preserved as a VoiceOver
custom rotor action on the rail group ("Next day with events" / "Previous day
with events"), reusing `DayRailNavigation.stepTargets` unchanged — the logic
stays, only its control surface changes.

**Week band.** A ~14pt row above the chips, inside the same horizontal
`ScrollView` so it cannot desync from them (the same single-`scrollLeft`
argument the web rail's three stacked layers rest on). Each band spans its
week's days and is labelled `WEEK 5`.

**Tapping a band navigates** (decided 2026-08-21) — it is a chip that spans
seven days, not a filter control. Concretely it is `selectDay(target)` where
`target` is the first day in `[week.start, week.end)` that has events under
the current non-date filters, taken from the same `nav.eventDays` set the
chevrons used. It therefore inherits, for free and without a new code path:

- the edge-growth behaviour, if the target week lies outside the current view
  window;
- the pending-scroll and re-anchoring machinery;
- the invariant `⟳ Now` already holds — **navigation never touches scope,
  weeks, categories or search**. Tapping `WEEK 6` with a venue filter active
  keeps that filter.

A week with no reachable day is disabled and does not fire, matching
`disablesEmptyDays: true` on the chips. The accessibility label names the
destination ("Go to Week 6, June 27 – July 4, 84 events"), never the
direction — the rail's established convention.

Note the boundary Saturday is usually the target for week *n*, and its
section's morning belongs to week *n-1*. That is not a defect: the day header
already reads `Wk 5/6`, so the shared day is surfaced honestly rather than
hidden.

This answers P5 in the surface where the question is actually asked. It does
**not** retire `WeekRangeStrip` — see A5.

**The Saturday problem.** `SeasonCalendar` runs weeks Saturday noon → Saturday
noon, so a Saturday genuinely belongs to two weeks — that is what `Wk 8/9` on
the day headers means. A band therefore **cannot** align to whole chips. The
boundary is drawn through the horizontal centre of each Saturday chip, which
is both honest and teaches the reader the real model. Snapping to whole days
would be a small, permanent lie on the app's most-used surface.

**Out-of-season days.** `navigableBounds` extends past the season whenever an
event falls outside it, and `SeasonCalendar` has no week number for those
days. The band renders *nothing* over them — no placeholder, no guess. An
archived year with out-of-season events is the reachable case.

Past-week dimming should reuse `WeekStripState.timeState` rather than
reimplementing it.

### A5 — `DateFilterSheet` is deleted; the scopes move to `FilterSheet`

Day-level choosing is what the rail already does, so the sheet as a container
has no reason to exist. Its two contents move rather than disappear:

- **The four scopes** (`Now` · `Today` · `All Season` · `All Year`) move into
  `FilterSheet` as a `WHEN` section, lifted from
  `DateFilterSheet.section("When")` with `visibleScopes` and its
  `FilterChipState.isScopeSelected` call intact. They are not date *filters*
  the way the sheet frames them — they are "where do I land and how much
  loads."
- **`WeekRangeStrip` moves with them, into the same `WHEN` section.**

That second point follows directly from the band navigating rather than
filtering. Week-as-a-filter — including `WeekStripDrag`'s range selection,
which the band has no gesture for — is a capability the app has today and
this design must not silently drop. The band answers "take me to week 6"; the
strip answers "show me only weeks 3–5." Two questions, two controls.

The mutual exclusion between scope and week selection (`AppModel.selectScope`
/ `AppModel.setWeekSelection`) is unchanged and, for the first time, both of
its controls are in the same view — which should make it easier to render
honestly, not harder.

`FilterBarSheet` collapses to a single case; `activeSheet` can become a plain
`Bool` or stay an enum if a future sheet is likely.

**`FilterSheet`'s "Clear Filters" must stay `clearNonDateFilters()`.** Its
current doc comment warns against "fixing" it to also reset dates. Moving the
scopes into the same sheet makes that warning much easier to trip over, so it
needs restating at the new call site — the WHEN section is deliberately not
covered by that button.

**`DateFilterLabel` is not deleted.** It has ~40 tests and is user-visible
per `CLAUDE.md`, but `EventListView:1068` (the pill's `dateLabel`) is its only
rendering site. It becomes the `WHEN` section's subtitle and part of the
Filters toolbar button's accessibility label, so the tests keep describing
something real instead of being orphaned.

## Blast radius

| File | Change |
|---|---|
| `CalendarView.swift` | `displayMode` `.always` → `.automatic`; `@FocusState` + `.searchFocused` |
| `EventListView.swift` | delete `filterPillBar`/`pillRow`/`pillButton` + bottom inset; add `🔍`/`⚌` toolbar items; `dayRail` drops `trailing`, leading is `⟳` only; `FilterBarSheet` loses `.date` |
| `DayRailView.swift` | week band; Events call site's furniture; rotor actions |
| `DateFilterSheet.swift` | **deleted** |
| `FilterSheet.swift` | gains `WHEN` section: four scopes + `WeekRangeStrip` |
| `WeekRangeStrip.swift` | unchanged; re-parented from `DateFilterSheet` to `FilterSheet` |
| `DayRailUITests.swift:447` | asserts `day-step-previous` is disabled at a boundary |
| `DayRailAccessibilityUITests.swift:40,164` | audit filter names both chevron identifiers |

Unaffected: `DateScope`, `ViewWindow`, `EffectiveScope`, the widgets, and
Siri's `IntentTimeframe` — the scopes keep their meaning and their storage,
they only move presentation. That is what keeps this smaller than approach C.

## Known costs

**Web/iOS scope-UI divergence.** The four-scope set was deliberately converged
with the web in phase 2. Demoting its presentation on iOS alone re-diverges
the two. Phases 3a/3b already established the ship-one-platform-then-follow
pattern (running web→iOS); this runs the other way. It is recoverable, and it
is a real cost, not a free move.

**App Store assets.** This changes `ios/ChqCalendar/Features/**` in ways a
user can see, so `.github/workflows/app-store-assets.yml` requires
regenerating screenshots and re-reading `docs/app-store/listing-copy.md`.
`01-season` and `02-filters` both change. `02-filters`' caption ("Narrow it to
what you actually want.") survives; `01-season`'s ("Jump to any day with
events.") is arguably *better* served by the new rail.

## Verification

Beyond the unit suite, three things this design cannot be trusted on without
a device/simulator pass, all drawn from recorded failures on the rail:

1. **The week band's alignment under scroll**, including the Saturday
   half-chip boundary. The web rail's equivalent seam was only ever caught by
   a browser pass, never by a unit test.
2. **`performAccessibilityAudit()` on the rail at default text size.** Phase
   3b's on-device audit found 18 contrast failures and 21 Dynamic-Type
   warnings on chips that had passed every unit test — and the fix (an opaque
   named colour asset, not `.secondarySystemBackground`) was route-sensitive
   in a way no test predicted. A new band row over the same background is
   exactly the shape of change that reopens it.
3. **`.searchable` behaviour on the iOS 26 SDK inside the tab shell**, by
   screenshot. The `.always` → `.automatic` change is small, and the
   surrounding history says this specific modifier has surprised the project
   before.

## Resolved during design

**Tapping a week band navigates; it does not filter** (2026-08-21). Every
control on the rail is now navigation without exception — chips, `⟳ Now`, and
bands — and every filter lives in one sheet behind one toolbar button. The
rail/filter split that P1 identified as the root cause is now a property of
*which surface a control is on*, which is the version of the rule a reader can
actually learn.

The consequence is recorded in A5: `WeekRangeStrip` survives, re-parented into
`FilterSheet`'s `WHEN` section, because week-as-a-filter (and its drag-range
selection) is a real capability that a navigating band does not replace.

## Open at design time

- Whether the band label is `WEEK 5` or `WK 5` at the narrower iPad-sidebar
  width, and what it does at accessibility text sizes.
- Whether a band should render at all over days outside the season. A4 says
  the band renders nothing there; an alternative is a muted `OFF SEASON` span.
  Low stakes, but it should be decided rather than fall out of the layout.
