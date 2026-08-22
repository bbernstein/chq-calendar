# iOS Events tab — chrome consolidation

**Status:** Implemented and shipped in 1.1.3 (PR #258, 2026-08-22). Kept as the
record of why the Events tab is shaped this way — several decisions here are
load-bearing and easy to undo by accident, notably the `.navigationBarDrawer`
placement (A1), the day-granular Saturday model (A4), and the colour ramp's
distance from `DayChipSelected` (A4).
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
│ ▒▒▒ WEEK 5 ▒▒▒▒▒▒▒▒▒░▓▓▓ WEEK 6 ▓▓▓▓▓▓▓▓ │
│ ⟳  Wed  Thu  Fri  Sat  Sun  Mon  Tue     │
│    29   30   31   1    2    3    4       │
│    9    32   14   6    11   27   18      │
├──────────────────────────────────────────┤
│ Thursday, July 30                        │
│  7:45  CHQ Mystic Heart …                │
```

The Saturday sits in **both** weeks — it closes week 5 and opens week 6 — so
its band segment carries both tones. Each week's fill is one step of a
nine-step ramp across the season, so a boundary is unmistakable at swipe speed
and the ramp's position answers "how far into the summer am I."

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

**Tapping a band navigates** (decided 2026-08-21) — it is a chip that spans a
week, not a filter control. **The target is the full Saturday that opens the
week** — `selectDay(Sat_start)` — not the first day with events. A reader
tapping `WEEK 6` is asking to be put at the top of week 6, and week 6 opens on
that Saturday.

Two fallbacks, in order, because the rail never announces a destination it
cannot reach:

1. If that Saturday has no events under the current non-date filters, target
   the first day in the week that does (`nav.eventDays`).
2. If no day in the week does, the band is **disabled** and does not fire,
   matching `disablesEmptyDays: true` on the chips.

It therefore inherits, for free and without a new code path:

- the edge-growth behaviour, if the target week lies outside the current view
  window;
- the pending-scroll and re-anchoring machinery;
- the invariant `⟳ Now` already holds — **navigation never touches scope,
  weeks, categories or search**. Tapping `WEEK 6` with a venue filter active
  keeps that filter.

The accessibility label names the destination ("Go to Week 6, opens Saturday
June 27, 84 events"), never the direction — the rail's established
convention.

The target Saturday's section shows its morning events too, which belong to
week *n-1*. That is not a defect: the day header already reads `Wk 5/6`, and
the band's split fill on that chip says the same thing.

This answers P5 in the surface where the question is actually asked. It does
**not** retire `WeekRangeStrip` — see A5.

**The Saturday problem, and the two-model answer.** `SeasonCalendar` runs
weeks Saturday noon → Saturday noon, so a Saturday genuinely belongs to two
weeks — that is what `Wk 8/9` on the day headers means.

Decided 2026-08-21: **the band uses day granularity, and a Saturday belongs to
both of its weeks.** Week *n*'s band spans the day keys
`Sat_start … Sat_end` **inclusive** — eight chips — and adjacent bands share
their boundary Saturday. An earlier draft drew the boundary through the
centre of the Saturday chip; that is rejected as too fine a distinction to
read on a 44pt chip while swiping.

**This is the model the app already displays.**
`SeasonCalendar.weekNumbers(spanningDayOf:)` — which feeds `day.weekNumbers`
and therefore the `Wk 5/6` day-header badge — is already day-granular and
already returns both weeks for a boundary Saturday. The band adopts it rather
than inventing anything.

The **week filter** does not yet: `EventFilter` splits the Saturday at noon,
so the app can say "this day is in weeks 5 and 6" and then hand back half of
it when you filter to week 5. That inconsistency predates this design and is
fixed separately in **#257**, which points both platforms' week filters at the
day-granular helper each already ships.

An earlier draft of this document argued the filter *must* stay noon-granular
because `GatePassPolicy` depends on it. That was wrong: `GatePassPolicy` reads
only `weeks.first.start` and `weeks.last.end` — the season's **outer** bounds —
and never touches per-week boundaries. The record is kept here because it is
the kind of objection that sounds decisive and is worth not re-raising.

What genuinely stays noon-based, in both this design and #257:

- **`SeasonCalendar.weeks`' bounds themselves** — they are when the
  Institution's weekly gate program turns over.
- **`currentWeekNumber(at:)`** — it must stay single-valued, because Siri's
  "what's the theme this week" cannot answer with two and
  `FilterChipState.isWeekSelected` reads it.

Neither is a *day membership* question, which is the only thing the band and
the filter care about.

**#257 does not block this design**, and this design does not block #257 — the
band renders identically either way. They are listed together because shipping
the band while the filter still splits at noon would put the inconsistency on
a more prominent surface than the day-header badge it currently hides behind.

**The shared Saturday is marked**, not merely spanned twice — a split fill
across the chip's band segment, carrying both weeks' tones, so "this day is in
both" is visible rather than inferred. Week 1's opening Saturday and week 9's
closing Saturday have no neighbour to share with and render as ordinary
single-week segments.

**Colour: a nine-step ramp in one hue** (decided 2026-08-21).

Adjacent weeks always differ, so a boundary is unmistakable while swiping —
and because the ramp is monotonic across the season it also answers "am I
early or late in the summer" at a glance, which alternation cannot. It varies
in **lightness rather than hue**, so it survives colour-vision deficiency,
and it needs two colorset endpoints plus interpolation rather than eighteen
hand-tuned values.

Nine distinct hues were considered and rejected: they buy week *identity*
rather than boundary legibility, one of them inevitably lands near
`DayChipSelected`'s blue, and nine hues collapse to four or five
distinguishable buckets under red-green CVD. Should per-week identity ever be
wanted, tying it to the week's fetched `WeekTheme` is the better route than
nine static colours.

Constraints on the ramp, all of which the on-device audit will test:

- The `WEEK n` label is **always** present, so colour is never the only
  signal carrying week identity. This is what makes the ramp safe.
- The ramp endpoints must clear contrast against the label at **both** ends
  and in both themes — the classic failure is a ramp that is legible in the
  middle and fails at week 1 and week 9. If the label cannot clear the fill at
  the extremes, the fill becomes a thin rule beneath a normally-coloured
  label rather than a filled band behind it.
- The ramp must not read as the selection. `DayChipSelected` is the only
  saturated fill on the rail and must stay that way; the band's hue should be
  distinct from it, or the ramp desaturated enough that no step competes.
- Dark mode inverts the ramp's direction relative to the background, not its
  order: week 1 stays the "start" end in both themes.

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
| `ChqCalendarShared/Domain/` | **new** — week-band spans (day-granular, overlapping on Saturdays), their labels, and the ramp step per week. Pure and unit-testable; the view renders it. Note this directory is inside the App Store screenshot rule's watched paths. |
| `Assets.xcassets` | **new** — two colorsets for the ramp endpoints (light + dark each) |
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

1. **The week band's alignment under scroll**, including the shared-Saturday
   split fill at both of a week's ends. The web rail's equivalent seam was
   only ever caught by a browser pass, never by a unit test. Which *spans* a
   band covers is pure and belongs in unit tests; where those spans land in
   pixels does not.
2. **`performAccessibilityAudit()` on the rail at default text size, and at
   both ends of the ramp.** Phase 3b's on-device audit found 18 contrast
   failures and 21 Dynamic-Type warnings on chips that had passed every unit
   test — and the fix (an opaque named colour asset, not
   `.secondarySystemBackground`) was route-sensitive in a way no test
   predicted. A new band row *plus nine new fills* over that same background
   is squarely the shape of change that reopens it. Audit week 1 and week 9
   specifically: a ramp that passes in the middle and fails at the extremes is
   the expected failure, and a mid-season spot check would miss it.
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

**The band is day-granular and a Saturday is in both its weeks**
(2026-08-21). Bands overlap on their shared Saturday rather than splitting it
at noon, and that chip carries a split fill. This is the model
`SeasonCalendar.weekNumbers(spanningDayOf:)` and the `Wk 5/6` badge already
use. The week *filter* is brought into line with it in **#257**, split out
because it is a cross-platform behaviour change with nothing to do with
chrome.

**Tapping a band lands on the full opening Saturday** (2026-08-21), falling
back to the week's first day with events, then to disabled.

**Colour is a nine-step ramp in one hue** (2026-08-21), not nine hues — it
serves boundary legibility and season position rather than week identity, and
it degrades gracefully under colour-vision deficiency.

## Open at design time

- Whether the band label is `WEEK 5` or `WK 5` at the narrower iPad-sidebar
  width, and what it does at accessibility text sizes.
- Whether a band should render at all over days outside the season. A4 says
  the band renders nothing there; an alternative is a muted `OFF SEASON` span.
  Low stakes, but it should be decided rather than fall out of the layout.
- Which hue the ramp uses, and whether it is a filled band or a rule beneath
  a normally-coloured label. A4 makes that contingent on whether the label
  clears the fill at both ends of the ramp — a question for the device, not
  the design.
