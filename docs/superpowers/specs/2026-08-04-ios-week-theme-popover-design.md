# iOS — weekly themes from the day-header week badge

**Status:** Design, approved 2026-08-04.

**Scope:** iOS app only. No backend, web, or data changes. Small — one pure
display model, one popover view, and a badge that becomes a button.

## Problem

The Chautauqua season is organised around a theme per week — "Icons and
Instigators: Women Who Change the World" is the headline of Week 1, and it is
what a regular attendee plans around. The web app surfaces these: clicking the
`Wk 6` badge on a day, or long-pressing a week chip in the filters, opens a
popover with the theme.

**The iOS app already fetches, caches, and decodes weekly themes** —
`EventRepository` pulls `/data/weekly-themes/{year}.json` as a best-effort
sidecar, `CalendarSnapshot.themes` carries them, and `AppModel.themes` and
`AppModel.theme(forWeek:)` both exist. **No view has ever read any of it.** The
data pipeline is complete and the feature is invisible.

## What the data actually contains

Verified against production on 2026-08-04, because it changes the design:

- **2026** returns 9 themes. Titles are present, up to 83 characters. **Every
  `description` is an empty string.**
- **2025** returns **404** — no themes at all, for a year the app can select.

So the payload worth showing today is a title and a date range. This is not
assumed to be permanent, but the design does not speculate on it either.

## Goals

1. The theme for a week is reachable from the indicator the user already sees
   while scrolling, without leaving the list.
2. A badge that cannot show a theme does not pretend it can.
3. Nothing about the list's density or scroll behavior regresses.

## Non-goals

- **Themes on the Dates-sheet week chips.** Considered and rejected — see D1.
- **Rendering theme descriptions.** Considered and rejected — see D3.
- Fetching, caching, or changing the themes data. That already works.
- Any change to the day header's layout, which a separate decision keeps as-is.

## Decisions

### D1 — The day-header badge is the only surface

Rejected: also putting themes on the Dates-sheet week chips (full web parity),
and putting them only there.

The web attaches the popover to both its `WeekBadge` and its `WeekSelector`. On
the selector it must use long-press or right-click, because **tap already
selects the week** — and that conflict carries over to iOS exactly. The web can
soften it with hover text and a right-click menu; iOS has neither, so a
long-press on a filter chip would be a feature almost nobody discovers.

The day-header badge has no action today, so its tap is free. It is also the
indicator visible constantly while scrolling, which is where curiosity about a
week's theme actually arises.

### D2 — A popover anchored to the badge

Rejected: a medium-detent sheet (disproportionate for two lines, and it covers
the list you were reading); inline expansion under the header (pushes content
under the user's finger mid-scroll — the exact motion this app's redesign has
been removing everywhere else).

A popover keeps the list visible and in place, points at the thing that was
tapped, and dismisses on an outside tap. On iPhone, `.presentationCompactAdaptation(.popover)`
(iOS 16.4+) renders a true popover rather than adapting to a sheet.

### D3 — Title and date range only; no description rendering

Rejected: the web's conditional description block.

Every 2026 description is empty. Building a conditional branch — and tests for
both sides of it — for data that does not exist is speculative. If descriptions
are populated later, adding them is a few lines against a design that already
has room.

**`WeeklyTheme.description` stays in the model and stays decoded.** It costs
nothing, and removing it from the `Decodable` struct would be a latent break if
the feed's shape is ever validated against it. Its non-display is deliberate and
is commented as such, so it is not "cleaned up" later.

### D4 — The chq.org link stays

The web's popover ends with a link to the weekly-themes page. It survives the
cut precisely *because* descriptions do not exist: with no detail in the app, the
link is the only route to it. One line, no layout risk.

### D5 — Affordance is conditional on having a theme

A badge that looks tappable and does nothing is worse than one that never
invited the tap. When no theme exists for any of a day's weeks — all of 2025,
or a week missing from the file — the badge renders exactly as it does today:
plain secondary text, not a button, no accessibility action.

When a theme does exist, the badge's text takes the accent colour. This mirrors
what the web signals with a dotted underline.

## Design

### Interaction

Tapping a themed `Wk 6` badge presents a popover anchored to it. Tapping outside
dismisses. Nothing navigates; the list keeps its scroll position.

A day that falls on a week boundary carries two week numbers
(`SeasonCalendar.weekNumbers(spanningDayOf:year:)`). The popover then shows both
themes stacked, in ascending week order, separated by a divider — matching the
web.

### Content

```
WEEK 6 · AUG 1–8
Icons and Instigators: Women Who Change the World

                                        View on chq.org ↗
```

The header line is a caption in secondary colour; the title is the emphasis.
The link is `https://www.chq.org/things-to-do/events/weekly-themes/`, the same
destination the web uses.

### Date range formatting

`startDate` and `endDate` are date-only `yyyy-MM-dd` strings. They are parsed as
strings, **not** through `ChqTime.parse`, which expects a datetime — so the
formatting is pure and needs no clock.

- Same month: `Aug 1–8`
- Crossing a month: `Jul 28–Aug 4`
- En dash, not a hyphen.

This is a deliberate divergence from the web, which always renders both months
(`Aug 1–Aug 8`). The collapsed form reads better in a narrow popover.

A malformed or unparseable date yields no range rather than a crash or a raw ISO
string: the header line degrades to `WEEK 6`.

### Accessibility

The badge becomes a real `Button`, so VoiceOver and Switch Control both reach it.
Its label names the week and the theme (`"Week 6 theme: Icons and Instigators…"`)
rather than reading `"Wk 6"`, which conveys nothing about what activating it
does. When there is no theme the badge is not a button and gains no action.

## Components

| Unit | Kind | Responsibility |
|---|---|---|
| `Domain/WeekThemeSummary.swift` | pure, `nonisolated` | `weekNumbers` + `[WeeklyTheme]` → ordered display models (`weekLabel`, `dateRange`, `title`). Empty when nothing matches. Owns the date-range formatting. |
| `Features/Calendar/WeekThemePopover.swift` | view | Renders one or more summaries and the chq.org link. |
| `Features/Calendar/EventListView.swift` | modify | `dayHeader(for:)` — badge becomes a `Button` presenting the popover when summaries are non-empty. |

`WeekThemeSummary` is where the testable logic lives; the views hold none.

## Testing

`WeekThemeSummaryTests` covers:

- One week with a theme → one summary, correct label, range, and title.
- A boundary day with two week numbers → two summaries, ascending week order.
- A week with **no** matching theme → empty result. This is the 2025 case and
  the one that drives the whole conditional affordance.
- A day whose two weeks have only one theme between them → one summary, not two.
- Same-month range collapses (`Aug 1–8`); cross-month does not (`Jul 28–Aug 4`).
- A malformed date string degrades to no range rather than crashing.
- An empty `description` is ignored (it is never rendered, but this pins that
  the summary does not accidentally start depending on it).

Existing suites must pass unchanged; this feature adds a view and a pure type and
changes no filtering, grouping, or persistence behaviour.

**Not covered by tests:** the popover's presentation and anchoring. This project
has no snapshot or UI testing, so that rests on a device check — tap a badge on a
themed week, tap one on 2025 and confirm nothing happens.

## Sequencing

Independent of the in-flight PR 2 (`feat/ios-rows-and-day-headers`), which
changes `EventRow` and explicitly leaves the day header alone. Either order
works.

Both regenerate App Store screenshots, so running them back to back saves one
capture pass. Neither blocks the other.

## Risks

- **`.presentationCompactAdaptation(.popover)` on iPhone** is less exercised than
  sheets in this app. If it adapts to a sheet on some configuration, the result
  is merely heavier, not broken — but it needs a device look.
- **A popover anchored to a row inside a `List`** can behave oddly if the anchor
  scrolls out of view while presented. Worth checking that scrolling with the
  popover open dismisses it or keeps it sensibly placed.
- **The feature is invisible for 2025.** That is correct behaviour given no data
  exists, but a user who switches years and sees the affordance disappear may
  read it as a bug. Acceptable, and noted here so it is not "fixed" by showing a
  dead badge.
