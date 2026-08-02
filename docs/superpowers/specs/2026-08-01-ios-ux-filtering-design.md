# iOS UX — Filtering, Week Strip, Active Filters, and Density

**Status:** Design approved 2026-08-01. Not yet implemented.
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
3. **Repeat filtering is slow.** Every venue filter costs a sheet presentation,
   a scroll past the full category list, and a tap. There is no memory of what
   the user filtered by last time, even though venue affiliation is the single
   most repeated filter in practice.
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
   Entering a term and then adjusting scope, week, or venue is a normal thing to
   want, and right now it is awkward.

Search *matching* is explicitly not a problem. `EventFilter.searchScore` already
mirrors the web's per-word scoring across title, location, filter tokens,
details, and presenter, and `.searchable` is wired with a 200 ms debounce in
`CalendarView`. The scoring, the debounce, and the field's placement are all
left as they are — only focus behavior changes.

## Non-goals

- No change to `EventFilter`'s pipeline order or search scoring.
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

### C. Recent filters

Recents are persisted state but not filter input, so they live beside
`FilterSelection` rather than inside it — `EventFilter`, `activeCount`, and
`isDefault` are untouched.

New type in `Data/UserStateStore.swift`:

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
appended to inside `toggleLocation` / `toggleCategory` **only on the
transition into selected** — deselecting does not reorder recents. This mirrors
the web's `addToRecent` calls in `useFilterState`'s `TOGGLE_TAG` /
`TOGGLE_LOCATION` cases. Names are stored in their original display casing;
comparison stays case-insensitive throughout.

Two surfaces consume them: `FilterChipsRow` (section C2) and
**`FilterSheetView`**, restructured to a type-to-filter field at the top
matching against display names, a "Recent" section when non-empty, then
**Venues**, then Categories. Venues move above Categories because venue is the
more frequently repeated filter and the category list is long enough to bury it.

### C2. Active filters, merged with recents

Active filters and recents occupy **one** row — the third and last row of
`FilterBarView` — because they are two halves of the same gesture: chips to the
left are on and tap to remove, chips to the right are off and tap to apply.

```
⊗ Clear all │ Keep dates │ "Burns" ×│ Amphitheater ×│ ┃ │Hall of Philosophy│ │CSO│
└─ resets ──┘            └─ active (accent fill, ×) ─┘ ┃ └── recent (plain, tap to add) ──┘
```

Ordering: "Clear all" pill, then "Keep dates" when applicable, then active chips,
a hairline divider, then recents. Recents that are *currently active* are omitted
from the recents half — they already appear as active chips. The whole row is
hidden when nothing is active and there are no recents.

Date scope and week are deliberately **not** chips: their own controls sit
directly above and already show selection, so a chip would be the same state
rendered twice. They are still cleared by "Clear all". This is the one place the
design departs from the web, where the date/week buttons and their chips are
both visible; on a phone the duplicated row is not worth the height.

A new `Domain/ActiveFilterChips.swift` builds the list as a pure function:

```swift
nonisolated struct ActiveFilterChip: Identifiable, Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case search
        case location(String)   // the lowercased key, for removal
        case category(String)
        case favorites
    }
    let id: String
    let kind: Kind
    let label: String           // display-cased, DisplayNames shortcut applied
}

nonisolated enum ActiveFilterChips {
    /// Order mirrors the web's `buildActiveChips`: search, locations,
    /// categories, favorites.
    static func build(
        selection: FilterSelection,
        availableLocations: [String],
        availableCategories: [String]
    ) -> [ActiveFilterChip]
}
```

The `available*` parameters are not optional convenience — they are required for
correctness. `FilterSelection.selectedLocations` / `.selectedCategories` hold
**lowercased** keys (that is what `EventFilter` compares against), while
`DisplayNames.location(_:)` / `.category(_:)` are exact-match dictionaries keyed
on the feed's original casing. Passing a lowercased key straight through would
both miss the shortcut and render `elizabeth s. lenna hall` instead of
`Lenna Hall`. So `build` resolves each key back to its original casing by
case-insensitive lookup in `availableLocations` / `availableCategories` (which
come from `DisplayNames.visibleLocations` / `.visibleCategories`, original
casing) before applying the shortcut, falling back to the raw key when the
current snapshot no longer contains it.

A whitespace-only search produces no chip, matching the web's `searchTerm.trim()`
guard in `buildActiveChips` and `hasNonDateFilters`.

`FilterSelection` gains the two predicates the row's buttons key off, mirroring
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
non-surprising reading, and it matches the web. The filter sheet's "Clear All
Filters" button and the no-matches empty state both rewire to `clearAll()`.

**Not in scope:** the web's `RECONCILE_FILTERS`, which drops selections absent
from the newly loaded year's data. iOS has never had it, and the raw-key
fallback above keeps a stale selection legible rather than crashing or blanking.
Worth a follow-up, not worth widening this change.

### C3. Match count

When any filter is active, the first row of the list reads
`412 of 1,470 events` as a secondary caption with its separator hidden, scrolling
away with the content rather than consuming pinned height.

The filtered count is derived from the **already-computed** `dayGroups` (summing
`day.events.count`), not from a second `EventFilter.apply` call — `dayGroups`
recomputes the entire pipeline on every access, so `EventListView` binds it to a
local once and uses that local for both the count and the sections. The total is
`snapshot.events.count`. Both are formatted with a grouping separator.

### D. Top-of-screen density

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

The resulting layout, top to bottom: status bar, 44pt inline title bar
(title left, year menu and ⋯ menu right), scope chips, week strip,
`FilterChipsRow` when non-empty, then the list. The `.searchable` field keeps its
system-default position; only its focus behavior changes, per D2 below.

Three pinned filter rows is the ceiling. If the row heights measure taller than
budgeted once assembled, the fix is tightening spacing further — not adding a
fourth row.

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
   `toggleFavoritesOnly`, and opening the filter sheet) first resigns first
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
| `AppModelTests.swift` (extend) | `selectScope` clears weeks; re-tapping the active scope is a no-op; current-week tap sets `.thisWeek`; non-current-week tap while `.next` yields `.all` + `[n]`; multi-week toggle accumulates; deselecting the last week leaves `.all`; recents push on select but not on deselect; `clearAll` clears the search term and sets `.all`; `clearNonDateFilters` clears search/venues/categories/favorites while leaving scope and weeks intact |
| `ActiveFilterChipsTests.swift` (new) | Chip order matches the web's; empty selection yields none; whitespace-only search yields none; a lowercased key resolves to original casing **and** through the `DisplayNames` shortcut (`elizabeth s. lenna hall` → `Lenna Hall`); a key absent from the snapshot falls back to the raw key rather than vanishing |
| `FilterSelectionTests.swift` (new) | `hasDateFilters` / `hasNonDateFilters` / `hasFilters` across each facet, including that a whitespace-only search counts as no filter |
| `UserStateStoreTests.swift` (extend) | `RecentFilters` round-trip, MRU ordering, case-insensitive dedupe, cap at 10, 30-day expiry, and that a missing `chq-recents` key yields empty lists without disturbing `loadFilters` |
| `AboutInfoTests.swift` (extend) | `quickLinks` ids, titles, and URLs |

Per `CLAUDE.md`, this changes `ios/ChqCalendar/Features/**` in user-visible
ways, so `ios/Scripts/capture-screenshots.sh` and
`ios/Scripts/compose-screenshots.py` must be re-run and
`docs/app-store/screenshots.manifest.json` committed. Shots `01-season`,
`02-filters`, and `03-search` all change. `docs/app-store/listing-copy.md` gets
re-read for claims this invalidates — the current copy describes filtering and
search generally and is expected to survive, but that must be checked rather
than assumed.

## Sequencing

One branch (`feat/ios-ux-filtering`), seven commits:

1. `FilterChipState` + `selectScope`/`selectWeek` + tests, wired into `FilterBarView` and `WeekStripView`
2. `WeekStripState` + chip styling + auto-scroll + tests
3. Inline title + filter-bar density + search keyboard dismissal
4. `RecentFilters` persistence + `FilterSheetView` restructure + tests
5. `ActiveFilterChips` + `clearAll`/`clearNonDateFilters` + `FilterChipsRow` + match count + tests
6. Quick-links menu + tests
7. Screenshot regeneration + listing-copy review

Commits 1–3 and 4–6 split cleanly into two PRs ("date filtering & header
density", "filter chips, recents & quick links") if review size warrants it;
commit 7 lands with whichever PR is last.
