# iOS UX — Filtering, Week Strip, Active Filters, and Density

**Status:** Implemented. Shipped on `feat/ios-ux-filtering` (PR #151); see
`docs/superpowers/plans/2026-08-01-ios-ux-filtering.md` for the task-by-task
plan and `docs/plans/2026-08-02-ios-ux-filtering-follow-ups.md` for deferred
follow-ups.
**Scope:** `ios/ChqCalendar/**` only. No backend, frontend, or infrastructure changes.

## Problem

The iOS app shipped with filtering behavior that diverges from the web app in
ways that cost the user time on every session:

1. **Date-range controls stack instead of replacing each other.** `dateScope`
   (Now / Today / This Week / All) and `selectedWeeks` are independent stages in
   `EventFilter.apply`, so selecting "Now" and week 3 silently intersects them.
   The web treats them as one mutually-exclusive date-range control.
2. **The week strip is undifferentiated.** All nine chips look alike. Weeks
   already past are indistinguishable from upcoming ones, the current week's
   accent ring vanishes the moment that chip is selected (ring and fill are both
   `Color.accentColor`), and the strip always starts at week 1 — during week 6 of
   the season the user must scroll right to reach anything relevant.
3. **Picking a venue is slow and costs context.** Filtering by venue means
   opening a modal sheet, scrolling past the entire category list, and tapping —
   then dismissing the sheet to see the result. There is no memory of what was
   filtered by last time, even though venue affiliation is the most repeated
   filter in practice. Categories are equally common and equally buried.
4. **~70pt of dead space** sits between the toolbar row and the filter chips.
5. **Quick links are missing.** The web header offers Feedback, Programs, and
   Questions; iOS offers only an About sheet with Privacy / Support / CHQ.
6. **Active filters are invisible and hard to undo.** The web lists every
   active filter as a removable chip with a "Show all events" reset; iOS shows
   only a numeric badge on the Filters chip, so removing one venue means
   reopening the sheet and hunting for it. The search term is the worst case —
   once the system search field collapses, nothing on screen says a term is
   still narrowing the results.
7. **The search keyboard never gets out of the way.** The system search field
   holds first responder for as long as a term is present, so half the screen is
   keyboard and the filter bar is unreachable without abandoning the search.

Search *matching* is explicitly not a problem. `EventFilter.searchScore` already
mirrors the web's per-word scoring across title, location, filter tokens,
details, and presenter, and `.searchable` is wired with a 200 ms debounce in
`CalendarView`. The scoring, the debounce, and the field's placement are all
left as they are — only focus behavior changes.

## Non-goals

- No change to `EventFilter`'s pipeline order, its stages, or its search
  scoring. The one edit it takes is lowercasing the venue/category selection at
  the comparison site (C5), which changes where the lowercasing happens, not
  what matches.
- No change to where the search field is presented, or to how matching works.
  It stays the standard `.searchable` field in its system-default position; only
  its keyboard-focus behavior changes.
- No change to persistence semantics. "Now" remains the default only when
  nothing is persisted, which is already how `FilterSelection()` and
  `UserStateStore.loadFilters()` behave.
- No iPad-specific layout work beyond what falls out of the shared views.

## Design

### A. Date-range exclusivity

`EventFilter` needs no change. The invariant — scope and weeks are never *both*
narrowing — is enforced at the mutation site, so both stages can keep running
unconditionally.

`AppModel.setScope(_:)` and `AppModel.toggleWeek(_:)` are replaced by:

```swift
/// Selects a date scope, clearing any week selection. Tapping the
/// already-active scope is a no-op: unlike the web (which has no "All"
/// button and toggles back to it), iOS has an explicit All chip, so the
/// scope row behaves as a radio group.
func selectScope(_ scope: DateScope) {
    guard filter.dateScope != scope || !filter.selectedWeeks.isEmpty else { return }
    filter.dateScope = scope
    filter.selectedWeeks = []
    persistFilter()
}

/// Mirrors the web's `handleWeekTap` (frontend/src/hooks/useScrollState.ts).
func selectWeek(_ n: Int) {
    if n == currentWeek, filter.selectedWeeks.isEmpty {
        // The current week *is* "This Week" — same range, so express it as
        // the scope and let both chips light up.
        filter.dateScope = .thisWeek
    } else if filter.dateScope != .all {
        // A relative scope is active and the user picked a different week:
        // the week replaces the scope rather than intersecting it.
        filter.dateScope = .all
        filter.selectedWeeks = [n]
    } else if filter.selectedWeeks.contains(n) {
        filter.selectedWeeks.remove(n)
    } else {
        filter.selectedWeeks.insert(n)
    }
    persistFilter()
}
```

Deselecting the last selected week leaves `dateScope == .all`, matching the web.
Tapping the current week while `.thisWeek` is already active is idempotent — it
does not toggle off, again matching the web.

Highlighting is driven by two pure functions so it can be tested without a view
host, in a new `Domain/FilterChipState.swift`:

```swift
nonisolated enum FilterChipState {
    /// `.thisWeek` is selected when the scope says so *or* when the only
    /// selected week is the current one — the two express the same range.
    /// `.all` is selected only when no weeks are selected either.
    static func isScopeSelected(_ scope: DateScope, selection: FilterSelection, currentWeek: Int?) -> Bool

    /// A week chip is selected when it is in `selectedWeeks` *or* when it is
    /// the current week and the scope is `.thisWeek`.
    static func isWeekSelected(_ n: Int, selection: FilterSelection, currentWeek: Int?) -> Bool
}
```

These are the iOS equivalents of the web's `isThisWeekActive` and
`isWeekHighlighted` in `frontend/src/app/page.tsx`. For a non-current year,
`FilterBarView` continues to show only the `.all` chip, always selected.

### B. Week strip

A new `Domain/WeekStripState.swift` computes styling and scroll inputs as pure
functions:

```swift
nonisolated enum WeekTimeState { case past, current, upcoming }

nonisolated enum WeekStripState {
    /// `.past` when the week's `end <= now`, `.current` when it contains
    /// `now`, `.upcoming` otherwise. `now` is `nil` for a non-current year,
    /// which makes every week `.upcoming` — a past or future season has no
    /// "now" to be relative to, so the strip renders neutrally.
    static func timeState(week n: Int, now: Date?, year: Int) -> WeekTimeState

    /// The week the strip should scroll to on first appearance: the current
    /// week during the season, week 9 after it ends, and `nil` before it
    /// starts or for a non-current year (week 1 is already the right anchor).
    static func initialScrollTarget(now: Date?, year: Int) -> Int?
}
```

`WeekChip` renders from `(WeekTimeState, isSelected)`:

| state | appearance |
|---|---|
| `.past`, unselected | secondary foreground, `.ultraThinMaterial` fill, 0.55 opacity |
| `.upcoming`, unselected | today's look — `.thinMaterial` fill, primary foreground |
| `.current`, unselected | `.thinMaterial` fill, 2pt `.tint` ring, **semibold** accent-tinted text |
| any, selected | solid `Color.accentColor` fill, white text |
| `.current` **and** selected | accent fill **plus** the ring drawn on a capsule outset by 3pt, so it reads as a ring *around* the fill instead of disappearing into it |

Past weeks stay tappable — dimming communicates "this is behind you," not
"unavailable."

Auto-scroll: `WeekStripView` wraps its `HStack` in a `ScrollViewReader` and, on
first appearance, calls `scrollTo(target, anchor: .leading)` without animation
for the `initialScrollTarget`. Anchoring leading (not center) puts the current
week at the left edge with upcoming weeks to its right, which is the priority
order the user described. A `@State private var hasScrolledToInitialWeek` guard
ensures this fires once per view lifetime rather than fighting manual scrolling
on every re-render.

### C. Venue and category filtering

This section replaces `FilterSheetView` entirely. The current design — one modal
sheet holding both facets, categories first — is what makes venue filtering slow.
The web solves it with two independent, self-contained controls
(`LocationFilter.tsx`, `CategoryFilter.tsx`), and iOS adopts that structure.

#### C1. Two rows, never mixed

Venues and categories get **their own row each**. They are orthogonal and both
frequently used; interleaving their recents into one strip makes the user read
every chip to find the kind they want.

```
› Venues     (Amphitheater)(Hall of Philosophy)(Norton Hall)…›
› Categories (CHQ Program)(CSO)(Lecture)(Worship)…›
```

Each row is a leading disclosure label followed by that facet's **recents**,
horizontally scrolling, most-recently-used first. This is the web's `<summary>`
layout: the recents are visible while the control is collapsed, so applying a
repeat filter is **one tap with no preceding tap** — the property the current
design lacks and the whole point of the change.

MRU ordering does double duty: the venue you just picked is always leftmost, so
an active filter is effectively always on screen and always one tap from being
removed. Active chips render accent-filled with a checkmark; inactive ones render
plain.

The label shows a selected count when non-zero, matching the web
(`Venues (2 selected)`).

#### C2. Inline expansion replaces the sheet

Tapping the label expands that facet's **full list in place**, directly beneath
its row — a scrollable, wrapped grid capped at ~140pt, pushing the rows below it
down. Tapping again collapses. The two facets expand independently, as on the
web.

```
⌄ Venues (2 selected)  (Amphitheater✓)(Hall of Philosophy✓)(Nor…›
┌──────────────────────────────────────────────────┐
│ (Amphitheater✓ 412)(Bratton 88)(CHQ Cinema 61)  ▲│
│ (Hall of Christ 34)(Hall of Philosophy✓ 188)     │
│ (Hurlbut Church 22)(Lenna Hall 96)(Norton 74)   ▼│
└──────────────────────────────────────────────────┘
› Categories (CHQ Program)(CSO)(Lecture)…›
```

Inline rather than modal is the direct fix for "loss of context by popping open
the filter list": the event list stays visible and updates live underneath as
chips are tapped.

The wrapped layout needs a small `FlowLayout: Layout` in `Support/` — variable
chip widths make `LazyVGrid`'s fixed columns waste horizontal space, and `Layout`
is available from iOS 16. Per-item event counts carry over from the current sheet
as a lighter trailing number inside each pill.

**Deliberately omitted:** the type-to-filter field discussed earlier in this
design. It belonged to the sheet, which no longer exists; with recents covering
the repeat case and a wrapped grid showing ~9 venues per screenful, a text field
inside an expanded panel would mostly serve to reopen the keyboard we spend D2
trying to dismiss. Revisit if the venue list grows.

`FilterSheetView.swift` is deleted. The "Filters" chip leaves the scope row with
it, and `FilterSelection.activeCount` — which existed only to badge that chip —
is deleted along with its test, subject to a grep for other callers at
implementation time.

#### C3. Recents persistence

Recents are persisted state but not filter input, so they live beside
`FilterSelection` rather than inside it.

```swift
nonisolated struct RecentFilters: Codable, Equatable, Sendable {
    var locations: [String] = []
    var categories: [String] = []

    /// Most-recently-used first, case-insensitively deduped, capped at 10.
    static func adding(_ item: String, to list: [String], max: Int = 10) -> [String]
}
```

Stored under its own `UserDefaults` key (`chq-recents`) with the same 30-day
expiry as filters and favorites. A separate key rather than an extra field on
`PersistedFilters`: it avoids any decode-compatibility risk to the existing
filters payload, and it matches how favorites are already stored.

`AppModel` gains `recentLocations` / `recentCategories`, loaded in `init` and
appended to inside `toggleLocation` / `toggleCategory` **only on the transition
into selected** — deselecting does not reorder recents. This mirrors the web's
`addToRecent` calls in `useFilterState`'s `TOGGLE_TAG` / `TOGGLE_LOCATION` cases.
Names are stored in their original display casing; comparison stays
case-insensitive throughout (see C5).

A facet whose recents are empty still shows its row — the label is the entry
point to the full list, so the row is never dead space.

### C4. The reset row

When any filter is active, a final row appears below Categories:

```
(⊗ Clear all)(⊞ Keep dates)("Burns"✕)(Amphitheater✕)(CSO✕)…›
```

Full parity with the web's `ActiveFilters`: every active filter is listed in one
predictable place and removable with one tap, and the search term — which has no
other representation once the system search field collapses — is always among
them. Venues and categories therefore appear both here and as filled chips in
their own rows; that redundancy is accepted deliberately in exchange for a single
rule the user can learn ("this row lists everything narrowing your results").

Date scope and week are the exception: they stay out of this row. Their controls
are two rows up and already show selection, and unlike venues they cannot scroll
out of view. "Clear all" still clears them.

`Domain/ActiveFilterChips.swift` builds the list as a pure function:

```swift
nonisolated struct ActiveFilterChip: Identifiable, Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case search
        case location(String)   // the stored name, passed back to toggle
        case category(String)
        case favorites
    }
    let id: String
    let kind: Kind
    let label: String           // DisplayNames shortcut applied
}

nonisolated enum ActiveFilterChips {
    /// Order mirrors the web's `buildActiveChips`: search, locations,
    /// categories, favorites.
    static func build(selection: FilterSelection) -> [ActiveFilterChip]
}
```

A whitespace-only search produces no chip, matching the web's `searchTerm.trim()`
guard in `buildActiveChips` and `hasNonDateFilters`.

`FilterSelection` gains the predicates the row's buttons key off, mirroring
`useFilterState`:

```swift
var hasDateFilters: Bool     // dateScope != .all || !selectedWeeks.isEmpty
var hasNonDateFilters: Bool  // trimmed search, locations, categories, or favorites-only
var hasFilters: Bool         // either
```

Two reset actions on `AppModel`, replacing `clearFilters()`:

```swift
/// "Show all events" — clears every filter including the search term, and
/// drops the scope to `.all`. Matches the web's CLEAR_FILTERS.
func clearAll()

/// "Keep dates, show all" — clears search, venues, categories, and
/// favorites-only, leaving scope and weeks intact. Matches the web's
/// CLEAR_NON_DATE_FILTERS. Surfaced only when both halves are active.
func clearNonDateFilters()
```

This is a deliberate behavior change: today's `clearFilters()` preserves
`searchText` and resets scope to `.next`. With the search term now visible and
individually removable as its own chip, "Clear all" clearing it is the
non-surprising reading, and it matches the web. The no-matches empty state
rewires to `clearAll()`.

### C5. Selection storage — match the web

`ActiveFilterChips.build` takes nothing but the selection because the stored
names are already display-ready. That requires changing how `FilterSelection`
holds them, adopting the web's model exactly:

```swift
// before                                  // after
var selectedLocations: Set<String>         var selectedLocations: [String]
var selectedCategories: Set<String>        var selectedCategories: [String]
// lowercased keys, unordered              // original feed casing, selection order
```

Two defects motivate this beyond parity:

- **Casing.** `DisplayNames.location(_:)` / `.category(_:)` are exact-match
  dictionaries keyed on the feed's original casing. A chip built from a
  lowercased key would both miss the shortcut and render
  `elizabeth s. lenna hall` instead of `Lenna Hall`. The web never has this
  problem because `toggleInList` stores the name as given and only lowercases
  for comparison.
- **Order.** `Set<String>` has no stable iteration order, so a chips row built
  from it would reshuffle between renders. Arrays in selection order fix that
  and make the tests deterministic.

The lowercasing moves to the comparison sites, mirroring the web's
`selectedTagsLowerSet` / `selectedLocationsLowerSet` memos:

- `EventFilter.apply` builds `Set(sel.selectedLocations.map { $0.lowercased() })`
  once per call (alongside the existing single `SeasonCalendar.weeks` hoist) and
  matches against that. Pipeline order and search scoring are untouched.
- `AppModel.toggleLocation(_:)` / `.toggleCategory(_:)` compare
  case-insensitively, append the original-cased name, and remove
  case-insensitively — the web's `toggleInList`.
- The expanded-panel and recents chips test selection case-insensitively.

**Persistence:** no migration is needed. `Set<String>` and `[String]` both encode
as a JSON array, so an existing `chq-filters` payload decodes cleanly into the
new type. Values saved by the current build are lowercased, so a returning user
sees lowercase chip labels for already-selected venues until they toggle one,
after which it is stored correctly. That is cosmetic, self-healing, and bounded
by the store's existing 30-day expiry — not worth a migration path. A test pins
the decode so the change can't silently drop a user's selections.

**Not in scope:** the web's `RECONCILE_FILTERS`, which drops selections absent
from the newly loaded year's data. iOS has never had it. Worth a follow-up, not
worth widening this change.

### C6. Match count

When any filter is active, the first row of the list reads
`412 of 1,470 events` as a secondary caption with its separator hidden, scrolling
away with the content rather than consuming pinned height.

The filtered count is derived from the **already-computed** `dayGroups` (summing
`day.events.count`), not from a second `EventFilter.apply` call — `dayGroups`
recomputes the entire pipeline on every access, so `EventListView` binds it to a
local once and uses that local for both the count and the sections. The total is
`snapshot.events.count`. Both are formatted with a grouping separator.

### D. Top-of-screen density and collapse-on-scroll

The wasted band is the navigation title area. `EventListView` switches to an
inline title:

```swift
.navigationTitle("CHQ Calendar")
.navigationBarTitleDisplayMode(.inline)
```

"CHQ Calendar" rather than "Chautauqua Calendar" — it matches the web header's
`<h1>` and fits an inline centered title alongside two trailing toolbar items.

`FilterBarView` tightens to `VStack(spacing: 6)` and `.padding(.vertical, 6)`.
Chip hit targets stay at `minHeight: 44` — the density comes from the gaps, not
from shrinking touch targets below the accessibility floor.

The full bar is four rows (scope, weeks, venues, categories) plus the conditional
reset row: roughly 206pt, which is too much to pin permanently on a phone. The
web sidesteps this because its filter block scrolls away with the page; on iOS
the bar is a `safeAreaInset` and never moves.

So the bar **collapses on scroll**. Scrolling down past a threshold hides the
venue, category, and reset rows (and closes any expanded panel), leaving scope
and weeks — ~106pt. Scrolling back up restores them, as does reaching the top of
the list.

```
at top (≈206pt):          scrolled down (≈106pt):
┌───────────────────┐     ┌───────────────────┐
│ CHQ Cal   2026⌄ ⋯ │     │ CHQ Cal   2026⌄ ⋯ │
│ (Now)(Today)(Wk)  │     │ (Now)(Today)(Wk)  │
│  1 2 3 4 5(6)7 8 9│     │  1 2 3 4 5(6)7 8 9│
│ › Venues (Amph)…  │     ├───────────────────┤
│ › Categories (CSO)│     │ 8:30 Song, Prayer │
│ (⊗Clear)("Burns"✕)│     │ 9:15 Morning Wor. │
├───────────────────┤     │ 10:45 Lecture     │
│ Sat, August 1     │     │ 12:15 Brown Bag   │
└───────────────────┘     └───────────────────┘
```

The decision is a pure state machine with hysteresis, so it is testable and
cannot flap on small scroll jitter:

```swift
nonisolated enum FilterBarCollapse {
    /// Collapses after `threshold` points of cumulative downward scroll since
    /// the last direction change, expands after the same upward, and always
    /// expands at or above the top of the list.
    static func next(
        isCollapsed: Bool, offset: CGFloat, pivot: CGFloat, threshold: CGFloat = 40
    ) -> (isCollapsed: Bool, pivot: CGFloat)
}
```

Scroll offset was first attempted via a zero-height `GeometryReader` in the
list's first row publishing through a `PreferenceKey`, to avoid
`onScrollGeometryChange` (iOS 18+) against what was then an iOS 17 floor.
That approach shipped, then failed on a physical device: `List` recycles
rows once they scroll out of view, so the sentinel row stops contributing
its preference as soon as it scrolls off-screen, `onPreferenceChange` falls
back to `ScrollOffsetKey.defaultValue` (0), and `FilterBarCollapse.next`
reads that as "back at the top" — the bar never collapsed, even though the
list content was visibly scrolling. The technique is reliable in a plain
`ScrollView` (whose content isn't recycled) but not in `List`. The fix was
to raise the deployment target to iOS 18.0 and use the supported
`onScrollGeometryChange(for:of:action:)` API directly on the `List`
instead.

Transitions animate with `.easeInOut(duration: 0.2)`, suppressed under
`accessibilityReduceMotion`. Collapse is a display concern only: no filter state
changes, and VoiceOver users reach the hidden rows by scrolling to the top, the
same as everyone else.

The first implementation task measures the band in the simulator before and
after, to confirm the inline title accounts for the whole gap rather than only
part of it. If a residual gap remains, that is a separate defect to diagnose on
its own evidence, not to paper over with negative padding.

### D2. Search keyboard dismissal

The term stays applied; only first-responder status is given up. Three
independent triggers, because each covers a gesture the others miss:

1. **Scrolling the list** — `.scrollDismissesKeyboard(.immediately)` on the
   `List` in `EventListView`. Covers the most common intent: type, then browse.
2. **The return key** — `.submitLabel(.search)` plus `.onSubmit(of: .search)`
   resigning focus. Covers the user who finishes typing deliberately.
3. **Any filter interaction** — every mutation routed through `AppModel`
   (`selectScope`, `selectWeek`, `toggleLocation`, `toggleCategory`,
   `toggleFavoritesOnly`, the resets, and expanding a facet) first resigns first
   responder. Covers the case the other two miss entirely: reaching straight
   from the keyboard to a chip.

Trigger 3 needs a UIKit escape hatch, since `@FocusState` cannot be bound to the
system search field:

```swift
/// Resigns first responder app-wide without dismissing the search field or
/// clearing its text.
///
/// Deliberately *not* the `dismissSearch` environment action: that tears down
/// the whole search interaction and clears the term, when all we want is to
/// put the keyboard away while the search stays applied.
@MainActor
enum KeyboardDismisser {
    static func dismiss() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
        )
    }
}
```

Placed in `Support/`, called from the view layer at the chip-tap sites rather
than from inside `AppModel` — `AppModel` is the domain model and stays free of
UIKit imports so its tests keep running without a UI host.

This is view-level behavior with no pure logic to unit test; it is verified
manually in the simulator (type a term, confirm the keyboard leaves on scroll,
on return, and on a chip tap, and that the term stays applied in each case).

### E. Quick links

`AboutInfo` gains a second link list, using the same URLs as the web header
(`frontend/src/components/layout/Header.tsx`):

```swift
static let quickLinks: [Link] = [
    Link(id: "feedback",  title: "Feedback",  url: URL(string: "https://www.chqcal.org/feedback")!),
    Link(id: "programs",  title: "Programs",  url: URL(string: "https://programs.chq.org/")!),
    Link(id: "questions", title: "Questions", url: URL(string: "https://questions.chq.org/")!),
]
```

The standalone ⓘ toolbar button becomes an `ellipsis.circle` `Menu` containing
the three links, a divider, and "About" (which presents the existing sheet
unchanged, still carrying the unaffiliated disclaimer and the Privacy / Support
/ CHQ links). The year menu remains its own toolbar item.

## Testing

Logic stays out of SwiftUI bodies, matching the existing convention of testing
domain types rather than view hierarchies. All tests use Swift Testing
(`@Test`), as the current suite does.

| File | Coverage |
|---|---|
| `FilterChipStateTests.swift` (new) | `.thisWeek` selected via both paths; `.thisWeek` *not* selected when the current week is one of several selected weeks; `.all` not selected while weeks are selected; nil `currentWeek` (out of season) |
| `WeekStripStateTests.swift` (new) | `timeState` at each boundary (noon Saturday transitions), `nil` now → all `.upcoming`, `initialScrollTarget` before / during / after season and for a non-current year |
| `FilterBarCollapseTests.swift` (new) | Collapses only past the threshold; expands on the reverse; jitter below the threshold changes nothing; always expanded at or above the top; a direction reversal resets the pivot |
| `AppModelTests.swift` (extend) | `selectScope` clears weeks; re-tapping the active scope is a no-op; current-week tap sets `.thisWeek`; non-current-week tap while `.next` yields `.all` + `[n]`; multi-week toggle accumulates; deselecting the last week leaves `.all`; recents push on select but not on deselect; `clearAll` clears the search term and sets `.all`; `clearNonDateFilters` leaves scope and weeks intact |
| `ActiveFilterChipsTests.swift` (new) | Chip order matches the web's (search → locations → categories → favorites) and follows selection order within each group; empty selection yields none; whitespace-only search yields none; `DisplayNames` shortcut applied (`Elizabeth S. Lenna Hall` → `Lenna Hall`); a name with no shortcut passes through unchanged |
| `FilterSelectionTests.swift` (new) | `hasDateFilters` / `hasNonDateFilters` / `hasFilters` across each facet, including that a whitespace-only search counts as no filter |
| `EventFilterTests.swift` (extend) | Venue/category matching is unchanged by the storage move: an original-cased selection still matches a lowercased `displayLocation`/`filterToken`, and a differently-cased duplicate does not double-narrow |
| `UserStateStoreTests.swift` (extend) | `RecentFilters` round-trip, MRU ordering, case-insensitive dedupe, cap at 10, 30-day expiry, and that a missing `chq-recents` key yields empty lists without disturbing `loadFilters`; plus a pinning test that a `chq-filters` payload written in the current `Set<String>` shape decodes into the new `[String]` fields without dropping selections |
| `AboutInfoTests.swift` (extend) | `quickLinks` ids, titles, and URLs |

Per `CLAUDE.md`, this changes `ios/ChqCalendar/Features/**` in user-visible
ways, so `ios/Scripts/capture-screenshots.sh` and
`ios/Scripts/compose-screenshots.py` must be re-run and
`docs/app-store/screenshots.manifest.json` committed. Shots `01-season`,
`02-filters`, and `03-search` all change — and `02-filters`' `-uitest-show-filters`
hook, which presents the deleted sheet, must be repointed at the inline
expansion. `docs/app-store/listing-copy.md` gets re-read for claims this
invalidates.

## Sequencing

One branch (`feat/ios-ux-filtering`), eight commits:

1. `FilterChipState` + `selectScope`/`selectWeek` + tests, wired into `FilterBarView` and `WeekStripView`
2. `WeekStripState` + chip styling + auto-scroll + tests
3. Inline title + filter-bar density + search keyboard dismissal
4. Selection storage → original casing, ordered arrays (C5), with the
   lowercasing moved into `EventFilter` + tests. Lands before anything that
   renders a name, since every later commit depends on the labels being
   display-ready.
5. `RecentFilters` persistence + the Venues/Categories rows + `FlowLayout` +
   inline expansion; deletes `FilterSheetView`, the Filters chip, and
   `activeCount` + tests
6. `ActiveFilterChips` + `clearAll`/`clearNonDateFilters` + reset row + match
   count + tests
7. `FilterBarCollapse` + scroll observation + quick-links menu + tests
8. Screenshot regeneration (including the `02-filters` hook) + listing-copy review

Commits 1–4 and 5–7 split cleanly into two PRs ("date filtering & header
density", "venue/category filtering & quick links") if review size warrants it;
commit 8 lands with whichever PR is last.
