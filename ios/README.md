# CHQ Calendar — iOS App

A native SwiftUI client for the [Chautauqua Calendar](https://www.chqcal.org)
— the same event data as the web app (`../frontend/`), presented as an
iPhone/iPad app with offline caching and pull-to-refresh. The app is a
three-tab shell (Events / My Day / Map — see `RootTabView` under
Architecture below).

## Capabilities

Beyond browsing/filtering/search (the original 1.0 feature set), the app
added the following for the 4.2 resubmission (issues #177–#182):

- **Reminders** (#178) — star an event to schedule a local notification
  30 minutes, 1 hour, or the night before (8 PM); a default preset is set
  in the About screen, overridable per event from the detail view.
- **Home Screen + Lock Screen widgets** (#179) — "Next Up" (configurable
  by venue, category, or starred-only) and "Starred", reading the same
  on-disk cache the app uses via the `group.org.chqcal.app` App Group.
- **Siri, Shortcuts, and Spotlight** (#180) — three Shortcuts actions
  (What's Next, Today at Chautauqua, Open Event) plus Spotlight indexing
  of the season and starred events.
- **My Day tab** (#181) — starred events laid out on a timeline, flagging
  schedule overlaps and tight walking gaps between venues.
- **Map tab** (#182) — every venue plotted, a venue sheet with its next
  events and walking directions via Apple Maps. No location permission is
  requested for any of this.
- **Off-season landing** (#177) — outside the summer season, a countdown
  to next season, a preview of next season's announced events, and
  browsable past seasons, in place of an empty screen.

All of the above is local-only: no push notifications, no server-side
scheduling, and no new network calls beyond the existing CDN fetches.

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

### Targets

The project has three targets:

- **ChqCalendar** — the app. Building/running this scheme also builds and
  embeds **ChqCalendarWidgets** (see below), so a plain **⌘R** or the
  `xcodebuild build` command above exercises both.
- **ChqCalendarTests** — the unit test bundle (`xcodebuild test` above).
  Covers app-target logic plus everything in `ChqCalendarShared` and the
  widget/intent logic that reads through it (e.g.
  `WidgetTimelineBuilderTests`, `WidgetConfigOptionsTests`,
  `ReminderPlannerTests`, `SpotlightIndexerTests`).
- **ChqCalendarWidgets** — the Home Screen/Lock Screen widget extension
  (`WidgetKit`). It has no test target of its own; its pure logic
  (`WidgetTimelineBuilder`, `WidgetConfigOptions`) lives in
  `ChqCalendarShared` specifically so `ChqCalendarTests` can exercise it
  without launching the extension process. There is no simulator-only way
  to "run" a widget the way you run the app — after a normal build, add
  the widget from the Home Screen or Lock Screen editor on the simulator
  or device to see it render, or use Xcode's **Debug ▸ Simulate Widget**
  gallery preview from within `NextUpWidget.swift`/`StarredWidget.swift`.

`ChqCalendarShared` (see the file tree below) is a synchronized source
folder shared by all three targets, not a target itself — it holds the
model/domain/data code that the app, its tests, and the widget extension
all need without duplicating it or creating a circular dependency between
the app and the extension.

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
Views live under `Features/`, one folder per screen area. The root view is
`RootTabView` (`Features/Root/`), an Events / My Day / Map tab shell; the
Events tab hosts `CalendarView`, and `EventListView` (under
`Features/Calendar/`) is shared between the two navigation containers
`CalendarView` picks between (`NavigationStack` on iPhone,
`NavigationSplitView` on iPad) so the list, the filter pill bar, search,
and loading/offline/empty states never diverge between form factors.

### Filter chrome

There is no dedicated filter-bar view. `EventListView` puts two controls —
a date-range button (label from `Domain/DateFilterLabel.swift`, e.g. "Now"
or "Weeks 4–6") and a `Filters (n)` button (count from
`Domain/ActiveFilterCount.swift`) — into a pill bar floated above the tab
bar via `.safeAreaInset(edge: .bottom)` (Liquid Glass pills on iOS 26, a
material capsule on iOS 18). Tapping either button presents one of two
sheets,
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

**This layout exists because of how iOS 26 treats the bottom edge, not
preference — and it has been redone once already.** On iOS 26,
`.searchable`'s default placement is a bottom-anchored floating field, and
declaring *any* `.bottomBar` toolbar content makes that field disappear
unless the app also declares
`DefaultToolbarItem(kind: .search, placement: .bottomBar)`. The pre-tab
design (see git history) therefore kept the date/filter pills and the
search item together in one `.bottomBar` toolbar group. The tab shell
(task 16 of the 4.2-resubmission branch) broke that arrangement: the iOS
26 tab bar owns the bottom edge and renders ON TOP of any app-declared
`.bottomBar` content — screenshot-verified: date pill, Filters, and the
search item were all present but covered and untappable. Current
arrangement, screenshot-verified: `.searchable` is pinned to
`.navigationBarDrawer(displayMode: .always)` in `CalendarView` (top of
screen, always visible), and the date/filter pills live in a
`.safeAreaInset(edge: .bottom)` bar, which the tab bar's safe-area
contribution stacks *above* rather than under. On iPadOS 26 the tab bar
renders at the top, so there is no bottom-edge contention there; the
split view and sidebar pills are unchanged. The deployment target stays
18.0 either way — this is an availability-guarded adoption, not a floor
change.

```
ChqCalendar/                      # App target
├── App/
│   ├── ChqCalendarApp.swift      # @main entry point, wires up AppModel
│   ├── AppModel.swift            # Single source of truth: snapshot, filter,
│   │                             # favorites, refresh/offline/reminder/
│   │                             # widget state, actions
│   ├── NotificationDelegate.swift  # Routes a tapped local-notification
│   │                             # reminder to the right event (#178)
│   ├── SpotlightIndexing.swift   # Seam protocol over SpotlightIndexer
│   └── WidgetReloading.swift     # Requests a WidgetKit timeline reload
│                                 # after state changes that affect widgets
├── Data/
│   ├── CalendarAPI.swift         # RemoteResource paths + CalendarAPIClient
│   │                             # (ETag-conditional URLSession fetches)
│   ├── EventRepository.swift     # actor: fetch→decode→cache orchestration,
│   │                             # stale-while-revalidate policy
│   ├── IntentDataSource.swift    # Cache reads for the App Intents (#180)
│   ├── ReminderCenter.swift      # Schedules/cancels local notifications
│   │                             # for starred events (#178)
│   └── SpotlightIndexer.swift    # Indexes season + starred events into
│                                 # Core Spotlight (#180)
├── Intents/                      # App Intents / Siri / Shortcuts (#180)
│   ├── ChqShortcuts.swift        # AppShortcutsProvider — registers the
│   │                             # 3 phrases (What's Next, Today at
│   │                             # Chautauqua, Open Event)
│   ├── EventEntity.swift         # AppEntity wrapping Event for Shortcuts
│   └── EventIntents.swift        # NextEventsIntent, TodayEventsIntent,
│                                 # OpenEventIntent
├── Features/
│   ├── Root/                     # RootTabView (root): Events / My Day /
│   │                             # Map tab shell + deep-link tab routing
│   ├── Calendar/                 # CalendarView (Events tab), EventListView
│   │                             # (shared list, filter pill bar,
│   │                             # empty-states), EventRow,
│   │                             # OffSeasonLandingView (#177: countdown,
│   │                             # next-season preview, past-season
│   │                             # archive browsing), WeekThemeBadge/Popover
│   ├── MyDay/                    # MyDayView (#181): starred events on a
│   │                             # timeline, overlap + walking-time flags
│   ├── Map/                      # GroundsMapView (#182): every venue
│   │                             # plotted, venue sheet with next events,
│   │                             # walking directions via Apple Maps —
│   │                             # no location permission
│   ├── Detail/                   # EventDetailView (incl. the per-event
│   │                             # reminder-preset row and "Show on Map"),
│   │                             # AddToCalendarView (EventKit integration)
│   ├── Filters/                  # DateFilterSheet, FilterSheet,
│   │                             # FacetChipCloud, FacetAllList
│   ├── About/                    # AboutView (disclaimer, default reminder
│   │                             # preset setting), AboutInfo
│   └── Shared/                   # Banners.swift (countdown/offline banners)
└── Assets.xcassets/               # App icon, accent color, etc.

ChqCalendarShared/                 # Synchronized folder shared by all 3 targets
├── Data/
│   ├── AppGroup.swift             # group.org.chqcal.app identifier +
│   │                              # shared UserDefaults/container helpers
│   ├── DiskCache.swift            # On-disk cache: payload + {etag,fetchedAt}
│   ├── SharedSnapshotLoader.swift # Reads the cached snapshot from the App
│   │                              # Group container (what the widgets and
│   │                              # intents read, without a network call)
│   └── UserStateStore.swift       # Persists filters/favorites/recents
│                                  # (UserDefaults), 30-day expiry
├── Domain/
│   ├── EventFilter.swift          # Search/date/week/location/category logic
│   ├── EventGrouping.swift        # Groups events into day-keyed DayGroups
│   ├── SeasonCalendar.swift       # Week-number math for the summer season
│   ├── DisplayNames.swift         # Category/location display-name mapping
│   ├── FacetCounts.swift          # Venue/category counts vs. current
│   │                              # selection, own dimension excluded
│   ├── DateFilterLabel.swift      # Date pill's summary text ("Now",
│   │                              # "Weeks 4–6", ...)
│   ├── ActiveFilterCount.swift    # Filter pill's badge count
│   ├── DayPlan.swift              # My Day's overlap/walking-time
│   │                              # transition logic (#181)
│   ├── VenueAtlas.swift           # Venue coordinates + inter-venue walking
│   │                              # times (#181/#182)
│   ├── MapVenueEvents.swift       # Venue sheet's "next events" query (#182)
│   ├── LandingState.swift         # Off-season countdown/preview/archive
│   │                              # decision logic (#177)
│   ├── ReminderSettings.swift     # ReminderPreset enum + fire-time math
│   │                              # (#178)
│   ├── ReminderPlanner.swift      # Which events need a reminder scheduled/
│   │                              # cancelled, given current state (#178)
│   ├── WidgetConfigOptions.swift  # Venue/category picker options shared by
│   │                              # the widget config intent and Siri (#179)
│   └── WidgetTimelineBuilder.swift  # Builds widget timeline entries from
│                                  # a snapshot + config (#179)
├── Models/
│   ├── Event.swift                # Event (Decodable, Hashable), custom
│   │                              # decoding for the web API's JSON shape
│   └── Sidecars.swift             # ArticleLink, WeeklyTheme, YearsManifest
└── Support/
    ├── ChqTime.swift              # NY-timezone-pinned date parsing/formatting
    └── HTMLEntities.swift         # Decodes HTML entities in titles/details

ChqCalendarWidgets/                 # Widget extension target (#179)
├── ChqCalendarWidgets.swift        # @main WidgetBundle: NextUpWidget +
│                                   # StarredWidget
├── NextUpWidget.swift              # Home Screen (small/medium) + Lock
│                                   # Screen (rectangular/inline); configurable
│                                   # by venue, category, or starred-only
├── StarredWidget.swift             # Home Screen (small) + Lock Screen
│                                   # (rectangular); always starred-only
├── WidgetConfigIntent.swift        # "Configure CHQ Widget" — the
│                                   # NextUpWidget configuration intent
├── WidgetDataSource.swift          # Widget-side read of the shared cache
├── WidgetViews.swift               # SwiftUI views rendered inside the
│                                   # widget families above
└── Info.plist
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
header — tapping it opens `WeekThemePopover`, which shows the week label,
its date range, the theme title, and a link out to chq.org. It does not
show a description: `WeeklyTheme.description` decodes but is deliberately
never rendered, because every description in the real feed is an empty
string (see `WeekThemeSummary`'s doc comment). A themed badge is a button
and tints its whole capsule
(background and text) in the accent colour; a badge for a week with no
theme renders as plain, inert text, identical to how it looked before
this feature existed. That distinction matters because theme coverage is
year-dependent — the 2026 season has themes for all nine weeks, but 2025
has none (its sidecar 404s), so every badge across the 2025 season is
grey and does nothing.
