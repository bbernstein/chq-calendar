# iOS UX — scroll-first redesign

**Status:** Design, approved 2026-08-03. Supersedes the filter-bar layout
shipped in [#151](https://github.com/bbernstein/chq-calendar/pull/151) while
keeping its filtering *semantics* (exclusive date scopes, live list updates,
keyboard-dismissal behavior) intact.

**Scope:** iOS app chrome and event rows. No backend, web, or data changes.

## Problem

The calendar screen spends roughly 150pt — about a third of an iPhone's list
area — on four permanently-stacked filter rows. The primary activity is
scrolling a filtered list of events, and that activity is the one the current
layout serves worst. #151 addressed this by collapsing rows on scroll, which
works but leaves three open questions ([#153](https://github.com/bbernstein/chq-calendar/issues/153),
[#154](https://github.com/bbernstein/chq-calendar/issues/154)) and a 350-line
driver whose whole job is to avoid an oscillation the layout invites.

The rows are the other half. A fixed 44pt time gutter carrying `10:45 AM`, a
star *button* on every one of ~1,500 rows, full-bleed separators, and a grey
day-header band read as an app from an earlier era, and cost height that the
list needs.

## Goals

1. The scrolling list is the app. Standing chrome is two pills.
2. Filter state is always legible without opening anything — the date range
   and the number of active filters are readable at a glance.
3. Either indicator expands to the full control it summarizes.
4. More events visible per screen than today, not fewer.
5. Follow Apple's stated principles — Hierarchy, Harmony, Consistency
   ([HIG](https://developer.apple.com/design/human-interface-guidelines/design-principles)).

## Non-goals

- **Liquid Glass itself.** It is an iOS 26 API surface; the deployment target
  stays at iOS 18.0. The design is *glass-ready* (see "Glass readiness") but
  ships on materials.
- Raising the deployment target. #151 already stranded iOS 17 on version 1.0;
  this design adds no further floor pressure.
- `EventDetailView`. Out of scope by decision.
- The web app. iOS only.

## Decisions

Each was an explicit choice during design; the rejected alternative is
recorded because the reasoning matters more than the outcome.

### D1 — Controls move to a floating bar at the bottom

Rejected: nav-bar-only (maximum space, but filtering becomes near-invisible
and the controls land in the hardest place to reach one-handed); a morphing
top header (safest, but keeps chrome out of thumb reach and expansion pushes
the list under the user's finger — the motion that caused #151's oscillation).

The bottom edge is where iOS 26 put floating control groups (Maps, Podcasts,
Safari, Photos), which makes it the strongest on Harmony and Consistency, and
content passing visibly beneath the bar is textbook Hierarchy. It is also the
shape Liquid Glass was designed around, so it is the cheapest future swap.

### D2 — Overlay with a constant inset, not a `safeAreaInset`

**This is the load-bearing structural decision.** The bar is
`.overlay(alignment: .bottom)` and the list carries a *constant* bottom
content margin sized for the bar's fixed height. The bar's expanded and
compact states differ in label text and width only — never height.

Consequence: the list's geometry does not change when the bar changes state.
Collapse cannot clamp content, cannot re-trigger an expand, and cannot
oscillate. The entire class of bug that `FilterBarCollapse` exists to prevent
becomes unreachable by construction rather than by measurement.

`FilterBarCollapse.swift` (350 lines) and `FilterBarCollapseTests.swift` are
deleted. #153 and #154 are closed as obsolete: there are no pinned rows to
choose between and no give-back to measure.

### D3 — Search stays in `.searchable` at the top

Rejected: a search pill in the bottom bar that morphs into a text field.
That would hand-build a field and forfeit Cancel, dictation, scope handling,
and the three keyboard-dismissal paths #151 verified on a physical device.

The system field already auto-hides on scroll and returns on a short
pull-down, which is exactly the behavior wanted. It keeps the bottom bar at
two pills. An active search term still counts toward the filter pill's badge
and appears as a removable chip in the filter sheet.

### D4 — Filters apply live; the sheet's button is a dismiss

The list re-filters on every tap, visible behind a `.medium` detent. The
footer button reads `Show 184 events` and only closes the sheet. No
apply/cancel semantics and no staged selection state to reconcile.

### D5 — Facet counts respect the current selection

The sheet puts every facet's number on one screen, where season-wide totals
that ignore the user's other filters read as broken. This makes
[#152](https://github.com/bbernstein/chq-calendar/issues/152) part of the
work rather than a deferral.

### D6 — Favorites moves into the sheet

Rejected: keeping a permanent star pill in the bar. If favorites-only can be
active while the filter pill reads `2`, the pill is lying — and a single
honest number is the entire premise of the design. Cost: toggling favorites
goes from one tap to three, accepted.

### D7 — The row's star button becomes an indicator

The per-row star *button* is removed: ~1,500 buttons off the scroll surface,
the largest single "fewer widgets" win available. Favoriting moves to the
leading swipe action and the long-press context menu, both already built and
both device-verified during #151.

**A filled star still renders on any favorited row.** It is an indicator, not
a control — favorited events stay identifiable at a glance while scrolling.

### D8 — Cards were considered and rejected

A card-per-event layout is the obvious "modern" move and costs roughly 18pt
per event in radius and gaps, showing *fewer* events than the current design.
It would spend the entire chrome saving on decoration. Recorded so it is not
re-proposed.

## Design

### Chrome

Nav bar is unchanged: inline title, year menu, overflow menu. Below it, the
system search field. The list runs to the bottom edge, overlaid by a
content-hugging translucent capsule, horizontally centered, ~12pt above the
home indicator:

```
                􀉉 Weeks 4–6      􀌉 Filters · 3
```

Two states, driven by scroll direction from the existing
`onScrollGeometryChange` stream:

- **Expanded** — at rest, at the top of the list, or scrolling up. Both pills
  show full labels.
- **Compact** — scrolling down past a threshold. The filter pill drops its
  word (`􀌉3`); the date pill's label never abbreviates, because that label is
  precisely what a scrolling user wants to keep reading.

Height is constant in both states (44pt minimum touch target). Transition is
a width/opacity change; under Reduce Motion it is a cross-fade.

### Date pill label

`DateFilterLabel` is a pure function from `FilterSelection` (plus the season's
week list) to a string. Date scope and week selection are mutually exclusive,
per #151, so no compound labels are needed.

| Selection | Label |
|---|---|
| Scope only | `Now` · `Today` · `This Week` · `All Dates` |
| Exactly one week | `Week 6` |
| Contiguous run of 2+ | `Weeks 4–6` (en dash) |
| Non-contiguous, ≤3 | `Weeks 3, 6, 8` (comma-space) |
| Non-contiguous, 4+ | `5 Weeks` |
| All nine weeks | `All Weeks` |

`All Weeks` is deliberately distinct from `All Dates`: the first is the whole
season selected by week, the second is no date filter at all.

### Filter pill badge

The count is `selectedLocations + selectedCategories + (searchText.isEmpty ? 0 : 1) + (showFavoritesOnly ? 1 : 0)`.
Date and week are excluded — they have their own pill. When the count is zero
the pill reads `Filters` with no badge.

### Sheets

Both pills present a sheet with `.presentationDetents([.medium, .large])`,
`.presentationDragIndicator(.visible)`, and
`.presentationBackgroundInteraction(.enabled(upThrough: .medium))` so the list
behind stays live and scrollable. Both end in a footer button reading
`Show <n> events`.

**Date sheet** — two sections: *When* (four scope chips) and *Weeks* (a 3×3
grid of the nine season weeks). Selecting in one clears the other.

**Filter sheet** — in order:

1. Active-filter chips (removable, `ActiveFilterChips` as it exists today,
   extended to include favorites).
2. *Venues* — a wrapped chip cloud: selected chips first with a checkmark,
   then the highest-count remaining chips filling about two rows, then
   `All <n> →`, where `<n>` is that facet's distinct value count for the
   loaded season. (The current feed carries 76 distinct venues and ~54 raw
   category values across all cached years — the long tail is the reason the
   cloud is capped and a drill-down exists at all.)
3. *Categories* — same treatment.
4. *Only show* — a `Favorites` chip.

`All … →` pushes a searchable full list **inside the sheet's own
`NavigationStack`**, taking the large detent. The sheet never dismisses and
the list underneath keeps its scroll position. That sub-list carries the only
facet-scoped search field in the app, one level down from the event search
and unambiguously about one facet.

The recents strip is retired — selected-first plus count-ordering does the
same job without the stale-name problem, closing #157.

### Rows

```
 9:15a   Ecumenical Worship
         Amphitheater · Faith & Spiritual

10:45a   Morning Lecture: Ken Burns              ★
         Amphitheater · Lectures 􀉚
```

- Time right-aligned in a 40pt gutter, `10:45a` form, tabular figures,
  `.caption` weight semibold, secondary.
- Title `.subheadline` weight medium; strikethrough when cancelled.
- Second line: `Venue · Category`, truncating tail. Cancelled/rescheduled
  badges take precedence on this line when present. The article-links
  newspaper glyph stays.
- Filled star, trailing, **only when favorited**. Not a button.
- Separators are hairlines inset to the title's leading edge.

Day header is sticky, `Thu, Jul 16` in an uppercase caption, with the day's
event count trailing. The `Wk 4` badge is removed — the bottom bar now states
the week range permanently, and the badge was the header's widest element.

Banners (countdown, offline), the `n of m events` caption, and the
`Show next day` footer stay as list rows.

### Glass readiness

Every chrome surface goes through a single `ChromeSurface` view modifier,
today `.regularMaterial` clipped to a capsule with a hairline border. When the
deployment target reaches iOS 26, adopting Liquid Glass is an edit to that one
file behind an `@available` check — no call sites change.

## Components

New, in dependency order:

| Unit | Kind | Responsibility |
|---|---|---|
| `Domain/DateFilterLabel.swift` | pure | `FilterSelection` + weeks → date pill string |
| `Domain/ActiveFilterCount.swift` | pure | `FilterSelection` → badge count |
| `Domain/BarPresentation.swift` | pure | scroll samples → `.expanded` / `.compact` |
| `Features/Chrome/ChromeSurface.swift` | view | the one material/shape definition |
| `Features/Chrome/FloatingFilterBar.swift` | view | the capsule and its two pills |
| `Features/Filters/DateFilterSheet.swift` | view | When + Weeks |
| `Features/Filters/FilterSheet.swift` | view | chips, facet clouds, favorites |
| `Features/Filters/FacetChipCloud.swift` | view | one facet's cloud + `All n →` |
| `Features/Filters/FacetAllList.swift` | view | searchable full facet list |

Rewritten: `Domain/FacetCounts.swift` (selection-aware),
`Features/Calendar/EventRow.swift`, day header extracted to
`Features/Calendar/DayHeader.swift`, `Features/Calendar/EventListView.swift`
(top inset removed, bottom overlay added).

Deleted: `Domain/FilterBarCollapse.swift`,
`Features/Filters/FilterBarView.swift`, `Features/Filters/FacetRowView.swift`,
`Features/Filters/WeekStripView.swift`, `Features/Filters/ResetFilterRow.swift`,
and `ChqCalendarTests/FilterBarCollapseTests.swift`.

`WeekStripState` is retained if the date sheet's week grid reuses it;
otherwise deleted with its tests.

## Testing

The three new `Domain` units are pure and carry the bulk of the coverage —
`DateFilterLabel` in particular has six branches and boundary cases (single
week, full run, all nine, scattered at exactly 3 and 4) that are cheap to pin
and expensive to get wrong.

- `DateFilterLabelTests` — every row of the label table, plus the
  scope/week exclusivity assumption.
- `ActiveFilterCountTests` — each contributor independently and combined;
  specifically that favorites-only increments the badge (D6).
- `BarPresentationTests` — direction changes, threshold, and that no input
  sequence produces a height change.
- `FacetCountsTests` — rewritten for selection-awareness, including the exact
  #152 repro (Week 6 + Amphitheater must not report the season-wide total).
- `ActiveFilterChipsTests` — extended for the favorites chip.
- `EventRowTests` — star renders when favorited, absent otherwise, and is not
  a button.

Existing `EventFilterTests`, `EventGroupingTests`, `SeasonCalendarTests`, and
`UserStateStoreTests` must pass unchanged — this design alters presentation,
not filtering semantics. Any failure there is a regression, not a test to
update.

## App Store assets

This changes nearly every visible pixel, so the rule in `CLAUDE.md` applies in
full and cannot be opted out of:

1. Regenerate via `ios/Scripts/capture-screenshots.sh` and
   `python3 ios/Scripts/compose-screenshots.py`; commit the updated manifest
   and review copies.
2. Re-read `docs/app-store/listing-copy.md` and `listing-fields.json` for
   claims this invalidates — the listing describes the filter UI.
3. **The `-uitest-show-filters` hook must be reworked.** It currently expands
   a Venues facet panel that will not exist; it must present the filter sheet
   instead, or the screenshot pass silently captures the wrong state.

## Phasing

Two PRs, chrome first.

**PR 1 — chrome.** `FloatingFilterBar`, both sheets, `DateFilterLabel`,
`ActiveFilterCount`, `BarPresentation`, `ChromeSurface`, selection-aware
`FacetCounts`, deletion of the four filter-bar views and the collapse driver,
`EventListView` restructuring, UI-test hook rework, screenshots.

**PR 2 — rows.** `EventRow` and `DayHeader` redesign.

Rationale: each is independently reviewable and revertable, and the bar can be
lived with on a physical device before the row treatment is committed to. Cost
accepted: two screenshot regenerations, and an intermediate state where new
chrome sits above old rows.

## Risks

- **Bottom bar occludes list content.** Mitigated by the constant bottom
  content margin — the last row can always be scrolled clear of the bar. Must
  be verified on a device with the home indicator present.
- **Losing tap-to-favorite hurts discoverability.** Accepted (D7). The star
  indicator keeps favorites legible; swipe and long-press remain. Worth
  revisiting if it reads as a regression on a device.
- **Selection-aware counts add a per-tap computation** over ~1,500 events per
  facet. Needs memoization keyed on the selection, or the sheet will stutter
  while chips are tapped. This is the one genuine performance surface in the
  design.
- **`presentationBackgroundInteraction` behavior inside a
  `NavigationSplitView`** (iPad) is less exercised than on iPhone and needs
  explicit checking.
- **Screenshot hook rework is easy to forget** and fails silently — the
  capture succeeds, just of the wrong screen.

## Deferred

- **Live date pill during scroll** — showing `Thu Jul 16` (the day at the top
  of the viewport) while moving, settling back to the filter summary at rest.
  Purely additive; deferred so it can be judged on a device rather than
  designed blind. File as a follow-up issue.
- **Liquid Glass adoption**, gated on the deployment target reaching iOS 26.
- [#156](https://github.com/bbernstein/chq-calendar/issues/156) (`extraDays`
  not reset by `selectScope`) is adjacent and cheap; fold into PR 1 if it
  falls out naturally, otherwise leave it filed.
- [#155](https://github.com/bbernstein/chq-calendar/issues/155) (week-strip
  auto-scroll) likely resolves as a side effect of the week grid moving into a
  freshly-constructed sheet. Verify rather than assume.
