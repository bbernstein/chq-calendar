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

### D1 — Controls move to the system bottom bar

Rejected: nav-bar-only (maximum space, but filtering becomes near-invisible
and the controls land in the hardest place to reach one-handed); a morphing
top header (safest, but keeps chrome out of thumb reach and expansion pushes
the list under the user's finger — the motion that caused #151's oscillation).

What shipped is not an app-drawn floating capsule: the two pills are
`ToolbarItemGroup(placement: .bottomBar)` items in the navigation container's
own bottom bar, system-drawn like Maps', Podcasts', Safari's, and Photos'
bottom groups — which is what actually makes it the strongest choice on
Harmony and Consistency, and content passing visibly beneath the bar is
textbook Hierarchy. Because it's a system-drawn bar rather than an
app-owned overlay, Liquid Glass arrives with the platform once the
deployment target allows it, with no view of ours to swap out (see "Glass
readiness").

### D2 — System bottom-bar inset, not a hand-rolled content margin

**This is the load-bearing structural decision.** The bar is real
`ToolbarItemGroup(placement: .bottomBar)` content, not an overlay, so the
list's bottom content inset is supplied by the navigation container itself —
measured at 86.0pt on iPhone 17 / iOS 26.1 with nothing of ours contributing
to it. `EventListView` deliberately adds no `contentMargins(.bottom, …)` of
its own.

Consequence: the list's geometry cannot be shifted by any state we hold,
because we hold none that affects it — there is no bar-height variable to
get out of sync with the content margin, so there is nothing to clamp,
nothing to re-trigger an expand, and nothing to oscillate. This is a
stronger guarantee than the hand-rolled constant margin it replaced: that
approach still required the app to keep its margin correctly matched to the
bar's own height by hand, where the system-supplied inset can't drift from
the bar because the same layout pass produces both. The entire class of bug
that `FilterBarCollapse` exists to prevent becomes unreachable by
construction rather than by measurement.

`FilterBarCollapse.swift` (350 lines) and `FilterBarCollapseTests.swift` are
deleted. #153 and #154 are closed as obsolete: there are no pinned rows to
choose between and no give-back to measure.

### D3 — Search merges into the bottom bar (correction: not `.searchable` at the top)

**Recorded as a correction, not deleted, because the branch disproved this
decision's premise partway through and the disproof is worth keeping.**

Rejected: a search pill in the bottom bar that morphs into a text field.
That would hand-build a field and forfeit Cancel, dictation, scope handling,
and the three keyboard-dismissal paths #151 verified on a physical device.

The original assumption here was that `.searchable` renders under the
navigation bar as it always has, so the bottom bar would carry only the two
filter pills and search would be untouched. On the iOS 26 SDK this app
builds against, that's false: `.searchable` itself renders as a
bottom-anchored floating field. An app-drawn bottom bar and the system
search field turned out to be two separate things competing for the same
screen edge — with the bar sitting on top of list text — rather than the
clean separation this decision assumed.

The resolution was to stop treating them as separate and merge everything
into one system-laid-out bottom group: the date pill, filter pill, and
search field all live in `.bottomBar` together, which is both the platform
idiom on iOS 26 and the only way the two coexist. A further wrinkle followed
from that merge: once *any* `.bottomBar` content is declared on iOS 26, the
system search field disappears entirely rather than sharing the bar, unless
`DefaultToolbarItem(kind: .search, placement: .bottomBar)` is declared
alongside it — verified by screenshot, since the failure mode is silent
(the list still filters; no field or magnifier renders anywhere). That's
why an `if #available(iOS 26.0, *)` block exists around a `ToolbarSpacer`
and that default search item. The deployment target stays 18.0; on the iOS
18 runtime the branch is skipped and `.searchable` renders under the
navigation bar as it always has there, so the two SDKs genuinely differ in
layout: iOS 18 keeps search under the nav bar and the pills in their own
bottom bar, iOS 26 puts all three in one bottom group.

An active search term still counts toward the filter pill's badge and
appears as a removable chip in the filter sheet.

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
list runs to the bottom edge. The two filter controls are `Button`s inside a
single `ToolbarItemGroup(placement: .bottomBar)` — system-drawn bottom-bar
toolbar items, not an app-owned floating capsule:

```
       Weeks 4–6      Filters (3)
```

On the iOS 26 SDK, the system search field (see D3) is declared into the
same `.bottomBar` group via `DefaultToolbarItem(kind: .search, placement:
.bottomBar)`, so all three — date pill, filter pill, search — lay out as one
system group. On iOS 18 the search field stays under the nav bar via
`.searchable`, and the bottom bar carries only the two pills.

There is no expanded/compact state and no scroll-driven resizing: the bar's
content is fixed, and its layout — including any abbreviation of item
labels under space pressure — is the system's to manage, not this app's.
`onScrollGeometryChange`-driven show/hide logic was one of the things the
constant system-supplied inset (D2) made unnecessary.

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

`ChromeSurface` never shipped — there is no app-owned chrome surface to
adopt Liquid Glass through. The bottom-bar chrome (D1) is system-drawn
`ToolbarItemGroup` content, so Liquid Glass arrives with the platform itself
once the deployment target reaches iOS 26, the same way it will for any
other app's toolbar. There is no file of ours behind an `@available` check
and no call site to edit.

## Components

New, in dependency order:

| Unit | Kind | Responsibility |
|---|---|---|
| `Domain/DateFilterLabel.swift` | pure | `FilterSelection` + weeks → date pill string |
| `Domain/ActiveFilterCount.swift` | pure | `FilterSelection` → badge count |
| `Features/Filters/DateFilterSheet.swift` | view | When + Weeks |
| `Features/Filters/FilterSheet.swift` | view | chips, facet clouds, favorites |
| `Features/Filters/FacetChipCloud.swift` | view | one facet's cloud + `All n →` |
| `Features/Filters/FacetAllList.swift` | view | searchable full facet list |

Rewritten: `Domain/FacetCounts.swift` (selection-aware),
`Features/Calendar/EventRow.swift`, day header extracted to
`Features/Calendar/DayHeader.swift`, `Features/Calendar/EventListView.swift`
(top inset removed, bottom-bar toolbar group added).

Deleted: `Domain/FilterBarCollapse.swift`,
`Features/Filters/FilterBarView.swift`, `Features/Filters/FacetRowView.swift`,
`Features/Filters/WeekStripView.swift`, `Features/Filters/ResetFilterRow.swift`,
and `ChqCalendarTests/FilterBarCollapseTests.swift`.

`WeekStripState` is retained, now unreferenced outside its own tests.

## Testing

The three new `Domain` units are pure and carry the bulk of the coverage —
`DateFilterLabel` in particular has six branches and boundary cases (single
week, full run, all nine, scattered at exactly 3 and 4) that are cheap to pin
and expensive to get wrong.

- `DateFilterLabelTests` — every row of the label table, plus the
  scope/week exclusivity assumption.
- `ActiveFilterCountTests` — each contributor independently and combined;
  specifically that favorites-only increments the badge (D6).
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

**PR 1 — chrome.** Bottom-bar toolbar items, both sheets, `DateFilterLabel`,
`ActiveFilterCount`, selection-aware `FacetCounts`, deletion of the four
filter-bar views and the collapse driver, `EventListView` restructuring onto
the system-supplied bottom inset (D2), UI-test hook rework, screenshots.

**PR 2 — rows.** `EventRow` and `DayHeader` redesign.

Rationale: each is independently reviewable and revertable, and the bar can be
lived with on a physical device before the row treatment is committed to. Cost
accepted: two screenshot regenerations, and an intermediate state where new
chrome sits above old rows.

## Risks

- **Bottom bar occludes list content.** Mitigated by the system-supplied
  bottom content inset (D2) — the navigation container sizes it to the bar
  automatically, so the last row can always be scrolled clear of it without
  the app tracking the bar's height itself. Must be verified on a device
  with the home indicator present.
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
