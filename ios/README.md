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
`NavigationSplitView` on iPad) so the list, filter bar, search, and
loading/offline/empty states never diverge between form factors.

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
│   └── DisplayNames.swift       # Category/location display-name mapping
├── Features/
│   ├── Calendar/                # CalendarView (root), EventListView
│   │                             # (shared list/filter-bar/empty-states),
│   │                             # EventRow
│   ├── Detail/                  # EventDetailView, AddToCalendarView
│   │                             # (EventKit integration)
│   ├── Filters/                 # FilterBarView, FacetRowView,
│   │                             # WeekStripView
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
