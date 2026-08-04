# CHQ Calendar — iOS App

A native SwiftUI client for the [Chautauqua Calendar](https://www.chqcal.org)
— the same event data as the web app (`../frontend/`), presented as an
iPhone/iPad app with offline caching and pull-to-refresh.

## Opening and running in Xcode

1. `open ios/ChqCalendar.xcodeproj`
2. Pick the **ChqCalendar** scheme (top toolbar, next to the run/stop
   buttons).
3. Pick a destination: any iPhone or iPad simulator works out of the box.
   To run on a physical device, select it as the destination and, in the
   target's **Signing & Capabilities** tab, choose your personal team under
   **Team** (Xcode will provision automatically).
4. **⌘R** to build and run.

The project uses an Xcode 26+ **synchronized folder** group
(`PBXFileSystemSynchronizedRootGroup`) for `ChqCalendar/` — new files added
under that folder on disk (e.g. via `git`, or any editor) are picked up by
Xcode automatically. No manual "Add Files to project" step, and no
`project.pbxproj` edits, are needed when adding a `.swift` file under an
existing group.

### Debugging

Breakpoints, the variable inspector, and the view debugger (`Debug ▸ View
Debugging ▸ Capture View Hierarchy`) all work normally — nothing about this
project's structure requires special debugging steps. `AppModel` is
`@Observable @MainActor`, so state changes are visible on the main thread
in the debugger.

## CLI build & test

```bash
cd ios

# Build only
xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO

# Full test suite (unit tests, no UI tests)
xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Swap the `-destination` name/OS for whatever simulators are installed
locally (`xcrun simctl list devices available`). `CODE_SIGNING_ALLOWED=NO`
avoids needing a signing identity for simulator builds.

**CI does not build or test this app.** The repository's GitHub Actions
workflows run on Linux runners (frontend/backend only); Xcode requires
macOS, and a macOS runner for this project has been deliberately deferred.
Run the commands above locally before pushing changes under `ios/`.

### Screenshot scripts

`ios/Scripts/capture-screenshots.sh` and
`ios/Scripts/compose-screenshots.py` (see the "App Store listing upkeep"
rule in the root `CLAUDE.md`) have two local prerequisites that are easy to
hit and not obvious from the scripts' own output:

- **Pillow.** `compose-screenshots.py` imports `PIL` to frame/caption the
  raw screenshots. Install with `pip3 install Pillow` (or via whatever
  Python environment `python3` resolves to) if it isn't already present —
  check with `python3 -c "import PIL"`.
- **`capture-screenshots.sh` needs Homebrew's bash, not the system one.**
  Its shebang is `#!/usr/bin/env bash`, which resolves to whatever `bash`
  is first on `PATH`. macOS ships bash 3.2 at `/usr/bin/bash` for licensing
  reasons; if `/usr/bin` precedes Homebrew's bin directory on `PATH`, the
  system bash silently shadows the (much newer) Homebrew bash the script
  is written against. Confirm with `bash --version` — Homebrew's bash is
  5.x — and fix the ordering (or invoke the script with an explicit
  `/opt/homebrew/bin/bash ios/Scripts/capture-screenshots.sh`) rather than
  editing the shebang.

## Architecture

The app is a small, single-module SwiftUI client structured around one
`@Observable @MainActor` model (`AppModel`) that owns all app state —
snapshot data, filters, favorites, refresh/offline status — and is read
directly by views via `@Bindable`/plain reads. Data flows one way:
`EventRepository` (an `actor`) fetches and decodes JSON from the CDN,
`DiskCache` persists it with TTL + ETag metadata, `AppModel` exposes derived,
already-filtered/grouped state (`dayGroups`, `visibleCategories`, etc.) that
views render directly — there's no separate view-model layer per screen.
Views live under `Features/`, one folder per screen area; `EventListView`
(under `Features/Calendar/`) is shared between the two navigation
containers `CalendarView` picks between (`NavigationStack` on iPhone,
`NavigationSplitView` on iPad) so the list, bottom-bar filter controls,
search, and loading/offline/empty states never diverge between form
factors.

### Filter chrome

There is no dedicated filter-bar view. `EventListView` puts two controls —
a date-range button (label from `Domain/DateFilterLabel.swift`, e.g. "Now"
or "Weeks 4–6") and a `Filters (n)` button (count from
`Domain/ActiveFilterCount.swift`) — into a single
`ToolbarItemGroup(placement: .bottomBar)`, alongside the system search
field. Tapping either button presents one of two sheets,
`Features/Filters/DateFilterSheet.swift` (scope chips + week grid) or
`Features/Filters/FilterSheet.swift` (active-filter chips, venue/category
chip clouds, favorites, `Clear Filters`), both at `.medium`/`.large`
detents with `presentationBackgroundInteraction` enabled up through
`.medium` so the list stays visible and live behind the sheet.
`Domain/FacetCounts.swift` recomputes venue/category counts against the
*current* selection (each facet's own dimension excluded) whenever the
selection, favorites, or snapshot changes — not once per snapshot — so a
facet count can never read the season-wide total after another filter has
narrowed the list.

**This bottom-bar layout exists because of an iOS 26 SDK quirk, not
preference.** On iOS 26, `.searchable` renders as its own bottom-anchored
floating field rather than docking under the navigation bar as it does on
iOS 18 — the original design for this branch assumed the older placement
and, when combined with a separate floating filter bar, produced two
stacked floating bars overlapping the list. Worse, once an app declares
*any* `.bottomBar` toolbar content on iOS 26, the system search field
disappears entirely unless the app also declares
`DefaultToolbarItem(kind: .search, placement: .bottomBar)` — confirmed by
screenshot: without it, search filtered the list but drew no visible field
anywhere. `EventListView`'s toolbar has a small
`if #available(iOS 26.0, *)` block that adds that item so search rejoins
the group. Net effect: on iOS 18 the search field sits under the
navigation bar with the date/filter pills in the bottom bar; on iOS 26 all
three share one bottom-bar group. The deployment target stays 18.0 either
way — this is an availability-guarded adoption, not a floor change.

```
ChqCalendar/
├── App/
│   ├── ChqCalendarApp.swift     # @main entry point, wires up AppModel
│   └── AppModel.swift           # Single source of truth: snapshot, filter,
│                                 # favorites, refresh/offline state, actions
├── Data/
│   ├── CalendarAPI.swift        # RemoteResource paths + CalendarAPIClient
│   │                             # (ETag-conditional URLSession fetches)
│   ├── DiskCache.swift          # On-disk cache: payload + {etag,fetchedAt}
│   ├── EventRepository.swift    # actor: fetch→decode→cache orchestration,
│   │                             # stale-while-revalidate policy
│   └── UserStateStore.swift     # Persists filters/favorites/recents
│                                 # (UserDefaults), 30-day expiry
├── Domain/
│   ├── EventFilter.swift        # Search/date/week/location/category logic
│   ├── EventGrouping.swift      # Groups events into day-keyed DayGroups
│   ├── SeasonCalendar.swift     # Week-number math for the summer season
│   ├── DisplayNames.swift       # Category/location display-name mapping
│   ├── FacetCounts.swift        # Venue/category counts vs. current
│   │                             # selection, own dimension excluded
│   ├── DateFilterLabel.swift    # Date pill's summary text ("Now",
│   │                             # "Weeks 4–6", ...)
│   └── ActiveFilterCount.swift  # Filter pill's badge count
├── Features/
│   ├── Calendar/                # CalendarView (root), EventListView
│   │                             # (shared list, bottom-bar filter
│   │                             # controls, empty-states), EventRow
│   ├── Detail/                  # EventDetailView, AddToCalendarView
│   │                             # (EventKit integration)
│   ├── Filters/                 # DateFilterSheet, FilterSheet,
│   │                             # FacetChipCloud, FacetAllList
│   └── Shared/                  # Banners.swift (countdown/offline banners)
├── Models/
│   ├── Event.swift               # Event (Decodable, Hashable), custom
│   │                             # decoding for the web API's JSON shape
│   └── Sidecars.swift            # ArticleLink, WeeklyTheme, YearsManifest
├── Support/
│   ├── ChqTime.swift             # NY-timezone-pinned date parsing/formatting
│   └── HTMLEntities.swift        # Decodes HTML entities in titles/details
└── Assets.xcassets/              # App icon, accent color, etc.
```

## Data endpoints

All requests go to `https://www.chqcal.org` (no separate iOS backend):

| Resource | Path |
|---|---|
| Available years | `/cache/calendar-cache/years.json` |
| Events for a year | `/cache/calendar-cache/all-events-{year}.json` |
| Chautauquan Daily article links | `/cache/calendar-cache/article-links-{year}.json` |
| Weekly themes | `/data/weekly-themes/{year}.json` |
| Deploy version check | `/version.json` |

These are the same static, CloudFront-cached JSON files the web app
consumes — the iOS app has no bespoke API surface.

## Caching semantics

- **Events, article links, weekly themes**: cached to disk with a **1 hour
  TTL**. `EventRepository.needsRefresh` treats a cached payload as fresh
  until it's older than the TTL; `cachedSnapshot` always returns instantly
  from whatever's on disk regardless of age, so the UI never blocks on the
  network for a warm cache.
- **ETag revalidation**: every fetch (fresh or stale) sends the stored
  `ETag` as `If-None-Match`. A `304 Not Modified` response just refreshes
  the cache entry's `fetchedAt` timestamp (resetting the TTL clock) without
  re-decoding or rewriting the payload. A malformed `200` body is decoded
  *before* it's allowed to overwrite the cache, so a bad deploy can't poison
  a previously-good local cache.
- **Sidecar fetches are best-effort and non-fatal**: article links and
  weekly themes are fetched in parallel with the main events payload, each
  with its own **3 second timeout**. Any failure (timeout, network error,
  bad JSON) falls back to whatever's cached for that sidecar, or an empty
  result if nothing is cached — it never blocks or fails the main events
  refresh.
- **User state (filters, favorites)**: persisted via `UserStateStore` with
  a **30-day expiry** — state older than that is treated as stale and
  discarded on load, so a long-dormant install doesn't resurrect last
  season's filters. `searchText` and the "show next day" counter are
  session-only and are never persisted.

### Weekly themes

Weekly themes (`WeeklyTheme`/`WeeklyThemesFile` in `Models/Sidecars.swift`)
are fetched from the `/data/weekly-themes/{year}.json` sidecar with the
same best-effort, non-fatal semantics as article links: a 3 second
timeout, falling back to cache or an empty result on any failure, never
blocking the main events refresh. They're surfaced in
`Features/Calendar/WeekThemeBadge.swift`, the `Wk N` capsule in each day
header — tapping it opens `WeekThemePopover` with that week's title and
description. A themed badge is a button and tints its whole capsule
(background and text) in the accent colour; a badge for a week with no
theme renders as plain, inert text, identical to how it looked before
this feature existed. That distinction matters because theme coverage is
year-dependent — the 2026 season has themes for all nine weeks, but 2025
has none (its sidecar 404s), so every badge across the 2025 season is
grey and does nothing.
