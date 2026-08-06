# iOS: surface recently-used filters in the filter sheet

**Status:** Approved, not yet implemented
**Issue:** [#172](https://github.com/bbernstein/chq-calendar/issues/172)
**Date:** 2026-08-06
**Branch:** `feat/ios-recent-filter-chips`

## Problem

On iOS, `FacetChipCloud` orders each facet's chips by event count descending
and shows the top 8. Count-ordering is stable across sessions and identical
for every user, so a venue you personally use constantly never rises if the
whole season doesn't agree with you.

The motivating example from the issue is Lenna Hall. In the real 2026 feed it
ranks **21st of 64 venues** (25 events), so no amount of repeat use will ever
put it in the visible eight. Reaching it costs a drill-down into
`FacetAllList` every single time.

## What already exists

The persistence half of this feature shipped and then lost its UI:

- `RecentFilters` (`Data/UserStateStore.swift`) stores the last 10 venues and
  the last 10 categories, most-recent-first, case-insensitively de-duplicated.
- `AppModel.toggleLocation` / `toggleCategory` already promote a name to the
  front of recents **on select only**, never on deselect. No change needed.
- `AppModel.recentNames(_:)` already exposes the list per facet.
- `UserStateStore.loadRecents` / `saveRecents` round-trip it with a 30-day
  expiry.

The strip that consumed this was removed in PR #151. The reason is recorded in
`FacetChipCloud.swift:12` and in issue #157: a remembered name from a
different year rendered identically to a live one, so tapping it silently
produced an empty list. **This design has to answer #157, not re-open it.**

## Decisions

### Placement: recents win the ordering tie-break; no new section

Three placements were mocked at the sheet's real medium detent:

| | Approach | Outcome |
|---|---|---|
| A | A "Recent" row above each facet's cloud (what the web does) | Two extra rows push Categories entirely below the fold |
| **B** | **Recents sort to the front of the existing cloud, marked with a dot** | **Zero extra vertical space; both facets stay visible** |
| C | One "Recent" section at the top mixing both facets | Best for combos, but mixes two kinds of thing and still costs a section |

**B is chosen.** The medium detent is the binding constraint — it currently
fits Venues plus about two Categories chips — and B is the only option that
adds recents without spending any of it.

### Density: 36 pt chips

Chips are currently `.subheadline` (15 pt) at `minHeight: 44`. Drawn to scale
against the real venue list, **36 pt is the threshold at which both Venues and
Categories clear the fold together.** That is the whole prize: selecting a
venue *and* a category — the "concerts in Lenna Hall" combo case in the issue —
stops involving a scroll.

44 pt is the HIG floor for *isolated* controls, which a dense grid of
same-kind, adjacent, non-destructive targets is not; system filter clouds
routinely sit below it. Treat 36 pt as a judgement call to confirm by thumb on
device, not as a measured platform constant. 32 pt was mocked and
rejected: it only wins by dropping the per-chip count, and the count is what
tells you a filter won't strand you on an empty list.

### Stale recents are hidden, not greyed

A recent value absent from `available(facet)` for the currently-viewed year is
**omitted** from the ordering. It stays in `RecentFilters`, so switching back
to that year brings it back. This closes #157 without changing what is
remembered — which #157 explicitly ruled out changing.

## Behavior

Ordering becomes **selected → recent → count-descending**:

```
selected = all.filter(isSelected)                      // in available() order
recent   = recentNames
             .compactMap { canonical(in: all, $0) }     // case-insensitive resolve
             .filter { !isSelected($0) }                // selected already lead
             .prefix(recentLimit)                       // 5
rest     = all.filter { !isSelected($0) && !recent.contains($0) }
             .sorted { count($0) > count($1) }
result   = selected + recent
             + rest.prefix(max(0, visibleLimit - selected.count - recent.count))
```

- `recentLimit` = **5** (per the issue; storage stays at 10).
- `visibleLimit` = 8 → **12**, so 5 recents still leave a real count-ordered
  tail rather than evicting it.
- All selected and all surviving recents render even if that exceeds
  `visibleLimit`; only the count-ordered tail is truncated. This matches the
  existing treatment of selected values.
- `FacetChipCloud`'s existing `ordered.count < allNames.count` condition for
  showing the "All 64" link is derived from what actually renders, so it
  continues to work untouched.

### Casing must be resolved against the snapshot

`AppModel.normalizePersistedFilterCasing()` (`AppModel.swift:562`) normalizes
`filter.selectedLocations` / `selectedCategories` against the snapshot — but
**not** `recents`. A stored recent can therefore carry casing the current
snapshot does not use. Precisely what breaks:

- `count(for:in:)` lowercases its key (`AppModel.swift:446`), so **the count is
  unaffected**.
- `DisplayNames.location` / `.category` are exact-match dictionary lookups on
  the feed's original casing, so an unresolved recent **renders with raw feed
  casing instead of its shortcut** — `"elizabeth s. lenna hall"` rather than
  `"Lenna Hall"`.
- Toggling an unresolved name writes that casing into `filter.selectedLocations`,
  so the Active chip carries it too until the next snapshot load normalizes it.

The label is the visible defect; the count is not. Test accordingly.

Each recent must be resolved to the snapshot's canonical casing by
case-insensitive lookup into `all`, and the resolved name used for display,
counting, and toggling. The existing `AppModel.normalizedCasing(_:against:)`
helper already does exactly this; the resolve doubles as the
"does it exist this year" filter, since a name with no match drops out.

## Components

### `Domain/FacetChipOrder.swift` (new)

The ordering is a private computed var inside a SwiftUI view today, which is
why it has no tests. Extract it to a pure `nonisolated enum`, matching the
existing `ActiveFilterChips` / `FilterChipState` pattern (both of which have
test files):

```swift
nonisolated enum FacetChipOrder {
    struct Entry: Equatable, Identifiable {
        let name: String       // canonical, snapshot casing
        let isRecent: Bool
        var id: String { name }
    }

    static func build(
        all: [String],
        isSelected: (String) -> Bool,
        recent: [String],
        count: (String) -> Int,
        recentLimit: Int = 5,
        visibleLimit: Int = 12
    ) -> [Entry]
}
```

Closures rather than materialised dictionaries so the view keeps reaching the
model the way it does now, and so no per-render `O(n)` dictionary build is
introduced. Both are non-escaping and the type stays trivially testable.

### `FacetChipCloud`

Drops its private `ordered` var in favour of `FacetChipOrder.build`, and passes
each entry's `isRecent` through to the chip. `FlowLayout` spacing 8 → 6.

### `SheetChip` (in `DateFilterSheet.swift`)

- `.font(.subheadline…)` → `.footnote`
- `.padding(.horizontal, 12)` → `10`
- **add** `.padding(.vertical, 6)` — the 44 pt frame is currently the only
  source of vertical breathing room, so shrinking it without this crowds the
  text at large Dynamic Type sizes
- `.frame(minHeight: 44)` → `36`, kept as a **floor** so chips still grow with
  Dynamic Type
- new `var isRecent: Bool = false`

**Blast radius, accepted deliberately:** `SheetChip` is shared with
`DateFilterSheet`'s scope chips and week chips, and with `FilterSheet`'s
Favorites chip. All shrink together. This is intended — chips should be uniform
across both sheets — but it is a wider visual change than the issue implies.
`FilterSheet.activeSection`'s remove-chips move 44 → 36 to match.

### The recent marker

A 5 pt `Color.accentColor` circle before the label, on **unselected** recents
only. A selected chip is already accent-filled with a checkmark and has moved
to the front group, so a dot inside it would be noise.

## Accessibility

The dot is a decorative `Circle` with no implicit VoiceOver label, so without
explicit handling the recency distinction would be purely visual. When
`isRecent`, `SheetChip` sets an explicit `.accessibilityLabel` appending
"recently used" while **preserving the count** in the announcement — the count
is currently part of the inferred label and must not be lost. The existing
`.accessibilityAddTraits(.isSelected)` is unchanged.

## Testing

New `ios/ChqCalendarTests/FacetChipOrderTests.swift`:

1. Selected values lead, in `available()` order.
2. Recents follow, in recency order, ahead of higher-count non-recents.
3. A recent absent from `all` is omitted (#157).
4. A recent whose stored casing differs from the snapshot's resolves to the
   snapshot's canonical casing, so the emitted `Entry.name` is the value
   `DisplayNames` can match.
5. The 5-recent cap holds when more than 5 recents are live.
6. `visibleLimit` truncates only the count-ordered tail; selected and recents
   both survive exceeding it.
7. A value that is both selected and recent appears exactly once, in the
   selected group.
8. With empty recents, the result is exactly selected-then-count-descending —
   today's rule, at the new `visibleLimit` (regression guard).

Existing `AppModelTests` / `UserStateStoreTests` already cover the recording
and persistence path; no changes expected there.

## Screenshots

Shot `02-filters` in `ios/Scripts/screenshot-plan.json` launches with
`-uitest-show-filters` and captures this exact sheet, so this is **not** a
`[skip-screenshots:]` change. Regenerate and commit:

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

Commit the updated `docs/app-store/screenshots.manifest.json` and the
`docs/app-store/screenshots/review/` copies. Per `CLAUDE.md`, these land in the
repo at merge time and upload at the next version submission.

Also re-read `docs/app-store/listing-copy.md` for claims this invalidates —
expected to be none, since no feature is added or removed from the listing's
point of view.

## Verification

```bash
xcodebuild test -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'
```

Plus a device/simulator check of the two things a test cannot assert: that both
facets genuinely clear the fold at the medium detent, and that a 36 pt chip
still feels comfortable under a thumb.

## Out of scope

- **`FacetAllList` gets no recents section.** Drilling into the full list is
  the "I already know the name" path, and its search field serves that better.
- **No filter *combos*.** Explicitly rejected during design: the user's
  preference is to surface individual values and let picking two or three of
  them be how a combo gets repeated. No saved-search objects, no naming or
  management UI.
- **Storage still caps at 10** while display caps at 5. Deliberate — the extra
  five absorb stale entries filtered out by the `available` check.

## Follow-ups

### 1. Expand in place instead of pushing to `FacetAllList` — do this next

This is the largest remaining gap with the web app, and the reason the web
"feels easier to manage". `LocationFilter.tsx:66` renders **all 64** venues
into a fixed-height scroll box, so the web never navigates away. iOS shows 8
and makes "All 64" a navigation push, which costs you sight of Categories and
your place in the sheet.

The fix is to make "All 64" **expand the cloud inline**, letting the sheet ride
up to its large detent — same content, no screen change, one continuous scroll
like the web page.

Do **not** copy the web's bounded scroll box literally. A scrollable box nested
inside a scrollable sheet is a gesture conflict on touch; it works on the web
only because a trackpad disambiguates by pointer position. This is very likely
why the push exists today.

Deferred from #172 deliberately: it removes a navigation destination, rewrites
`FacetAllList`'s role, and needs its own screenshot regeneration. Not yet filed
as a GitHub issue.

### 2. Consider more `DisplayNames.locationShortcuts` entries

Only two venue shortcuts exist today (`Elizabeth S. Lenna Hall`,
`Smith Wilkes Hall`). The width hogs in the real feed render in full:
"Chapel of the Good Shepherd", "Randell Chapel, UCC Headquarters",
"Hurlbut Church sanctuary", "Hall of Philosophy Grove". Shortening these is the
cheapest remaining density win after the 36 pt change, and needs no code — only
dictionary entries. Left out of #172 because naming is a content decision, not
an engineering one.
