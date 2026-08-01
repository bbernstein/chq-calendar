# CHQ Calendar iOS App — Design Spec

**Date:** 2026-07-31
**Status:** Approved (autonomous session — user directed full execution without input)
**Deliverable:** Native iOS app in `ios/`, buildable/runnable/debuggable in Xcode, feature-parity with the web app's read-only calendar experience.

## 1. Goals

- Launch fast and feel as snappy as the web app: cached data renders instantly, network refresh happens in the background.
- One-touch filtering: date scope (Now/Today/This Week/All), season weeks 1–9, categories, locations, favorites, plus search.
- "What's happening next" is the default view, exactly like the web app's `next` filter.
- Same caching semantics as the web app (1-hour event TTL, 30-day user-state expiry) plus caching of sidecar data: chqdaily article links and weekly themes.
- Swift + SwiftUI, latest standard components, optimized for iPhone, correct and pleasant on iPad.
- No backend changes: consumes the existing public production endpoints read-only.

**Non-goals:** feedback form, publisher portal, admin, event submission, push notifications, offline map. Webcal/ICS generation is replaced by native EventKit add-to-calendar.

## 2. Approaches considered

| Approach | Verdict |
|---|---|
| **SwiftUI + Observation, single app target, URLSession data layer with disk cache** | **Chosen.** Latest-standard UI, minimal build complexity, everything editable in Xcode. |
| Local SPM package (ChqCalKit) for core logic + app shell | More isolation, but complicates the hand-authored project and adds no value at this scale. Logic isolation is achieved with plain folders + protocol seams instead. |
| UIKit / hybrid web view | Rejected — user requires native latest-standard components; a WKWebView wrapper would not meet the snappiness or nativeness bar. |

## 3. Platform & toolchain

- **Xcode project:** `ios/ChqCalendar.xcodeproj`, hand-authored in the Xcode 16+ `PBXFileSystemSynchronizedRootGroup` format (objectVersion 77) so the pbxproj is small and files added on disk appear automatically in Xcode.
- **Targets:** `ChqCalendar` (app), `ChqCalendarTests` (unit tests, Swift Testing framework).
- **Deployment target:** iOS 17.0 (enables `@Observable`, `NavigationSplitView` refinements, `ContentUnavailableView`; covers all devices Apple still supports).
- **Language:** Swift, Swift 6 language mode, strict concurrency. No third-party dependencies.
- **Devices:** iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`), all orientations on iPad, portrait-primary on iPhone.
- **Appearance:** system light/dark (matches web's `prefers-color-scheme` behavior). Accent color `#5B7F95` (web brand/theme color).
- **Bundle id:** `org.chqcal.calendar`. Display name **CHQ Calendar**. Simulator builds run unsigned (`CODE_SIGNING_ALLOWED=NO` in CI/CLI); Xcode users can select a personal team for device runs.

## 4. Data contract (verified against production 2026-07-31)

Base URL `https://www.chqcal.org`. All endpoints public, read-only, JSON.

| Data | URL | Notes |
|---|---|---|
| Years manifest | `/cache/calendar-cache/years.json` | `{years:[2025,2026,2027], defaultYear:2026, generated}` |
| Events | `/cache/calendar-cache/all-events-{year}.json` | Envelope `{data:[Event], timestamp, expiry, cacheKey}`; 2026 ≈ 4.9 MB, 1,637 events; served with `ETag` |
| Article links | `/cache/calendar-cache/article-links-{year}.json` | `{generatedAt, matcherVersion, links: {eventId: [{title,url,kind:"preview"|"recap",pubDate}]}}` |
| Weekly themes | `/data/weekly-themes/{year}.json` | `{year, scrapedAt, source, weeks:[{number,title,description,startDate,endDate}]}` |
| Version | `/version.json` | `{version:"<git-sha>"}`, fetched no-store; used as data-refresh hint on foreground |

**Event fields used** (all others in the feed are ignored): `id`, `title`, `startDate`, `endDate` (naive `"YYYY-MM-DD HH:MM:SS"` — **must be parsed as America/New_York**, not device zone), `description?`, `location?`, `venue? {name, id?, address?, showMap?}`, `category?`, `categories? [{name, …}]`, `tags? [String]`, `presenter?`, `cost?`, `url?`, `image? {url, sizes{…}}`, `status?` (`scheduled|cancelled|rescheduled` — feed also contains `publish`, treated as scheduled), `featured?`, `week?` (precomputed 1–9, used as fallback only; canonical week math is computed locally, see §7).

Display location = `venue.name ?? location`. HTML entities in title/description/location are decoded on ingest (the feed contains `&amp;`-style entities).

## 5. Architecture

```
ChqCalendar/
├── App/            ChqCalendarApp (entry), AppModel (root @Observable)
├── Models/         Event, EventEnvelope, ArticleLink(s), WeeklyTheme(s),
│                   YearsManifest, SeasonWeek, value types only (Codable, Sendable)
├── Data/
│   ├── CalendarAPI      URLSession endpoints, typed errors
│   ├── DiskCache        generic file cache: payload + metadata (etag, fetchedAt)
│   ├── EventRepository  stale-while-revalidate orchestration (actor)
│   └── UserStateStore   filters + favorites persistence (UserDefaults, 30-day expiry)
├── Domain/
│   ├── SeasonCalendar   week math (Sat-before-4th-Sun-of-June, noon boundaries)
│   ├── EventFilter      filter pipeline (search scoring, date scope, weeks,
│   │                    locations, categories, favorites)
│   └── DisplayNames     location/category shortcut names
├── Features/
│   ├── Calendar/        CalendarView (root list), DayFooter/headers, EventRow
│   ├── Filters/         FilterBarView, WeekStripView, FilterSheetView, ActiveFilterChips
│   ├── Detail/          EventDetailView, ArticleLinksSection, AddToCalendar (EventKitUI)
│   └── Shared/          CountdownBanner, OfflineBanner, badges, formatting helpers
└── Support/         Assets.xcassets, Info.plist keys, Date/TimeZone helpers
```

- **State:** `@Observable` classes (`AppModel`, `FilterState`); no external state library. `EventRepository` is an `actor`; decoding runs off the main actor.
- **Dependency seams:** `CalendarAPI` and `DiskCache` sit behind protocols so tests inject fixtures; no network in unit tests.

## 6. Caching design (parity + native idioms)

- **Disk cache** in `Library/Caches/chq-data/`: one file per resource (`events-2026.json`, `article-links-2026.json`, `themes-2026.json`, `years.json`) plus a metadata sidecar (`{etag, fetchedAt, sourceVersion}`).
- **Read path (launch):** repository returns disk-cached data immediately regardless of age → UI renders on first frame; if `fetchedAt` older than **1 hour** (web `CACHE_EXPIRY_MS`), a background refresh runs with `If-None-Match` (304 ⇒ touch `fetchedAt` only — avoids re-downloading ~5 MB).
- **Sidecars** (article links, themes) fetch in parallel with events, 3-second timeout, failures non-fatal (matching web). Cached with the same TTL mechanism.
- **Foreground refresh:** on `scenePhase == .active`, fetch `/version.json` (no-store); if the sha changed since last fetch or events are stale, refresh in background. Never blocks UI.
- **Pull-to-refresh** forces a full refetch (bypasses TTL, keeps ETag).
- **User state:** filters, favorites, recent selections in `UserDefaults` stamped `lastSaved`; discarded when older than **30 days** (web `USER_STATE_EXPIRY_MS`). Favorites stored as event-id strings, matching web semantics.
- **Offline:** cached data + a subtle "Showing saved data" banner when a refresh fails with no connectivity.

## 7. Domain logic (ported behavior)

- **Season weeks:** Week 1 starts the Saturday before the fourth Sunday of June at **12:00 noon** America/New_York; 9 consecutive 7-day weeks (Sat-noon → Sat-noon). Membership: `start ≤ eventDate < end`. 2026: Week 1 = Sat Jun 27 12:00 → Sat Jul 4 12:00 … Week 9 ends Sat Aug 29 12:00.
- **Date scopes:** `all | today | next | thisWeek`; default **next**: events from `now − 1h` forward, window expanded day-by-day until ≥ 50 events, snapped to end of day; "Show next day" appends one calendar day per tap. Non-current years force `all`.
- **Search:** case-insensitive **per-word** weighted scoring (web parity: the query is split on spaces first; there is no whole-phrase stage). Each word scores independently — title 100, location 90, each tag/category token 85, description 50, presenter 25 — plus, for words longer than 2 chars, a bonus tier of 10/9/7/5/3 on the same fields; word scores sum. Events with score > 0 are kept; ordering stays chronological via grouping. The `.next` adaptive window is always computed from the full unfiltered event set (search never shrinks it). 200 ms debounce.
- **Grouping:** by local (America/New_York) calendar day, ascending; within a day ascending by start time; each day tagged with its week number(s).
- **Categories:** derived at runtime from the data (union of `categories[].name` + `category`), `Week …` pseudo-categories excluded from UI. Display shortcuts: CSO, CHQ Program, CLSC, Climate Change Program, and the location shortcuts (Lenna Hall, Smith Wilkes, …).
- **Cancelled / rescheduled:** red/yellow badges, strikethrough title when cancelled.

## 8. UI design

**Root: `CalendarView`** — `NavigationStack` (compact) / `NavigationSplitView` (regular width, list + detail):

- **`List` grouped by day**, native sticky section headers ("Saturday, July 4" + week badge), `.searchable` search field, `ScrollViewReader` used only when jumping (e.g., clearing filters returns to top of upcoming).
- **Filter bar** pinned under the navigation bar (safe-area inset): a horizontal row of date-scope chips (Now · Today · This Week · All), a favorites star chip with count, and a **week strip** (9 numbered chips; current week outlined; tap = toggle; long-press/context-menu shows the week's theme title + description in a popover). All single-touch.
- **Filter sheet** (toolbar filter icon, badge shows active count): categories and locations as multi-select rows with per-item event counts, recent selections surfaced first, Clear-all. Presented as a medium/large detent sheet.
- **Event row:** time (h:mm a), title, location (short name), star (tap to favorite, no navigation), small badges (Cancelled/Rescheduled, 📰 when article links exist). Swipe-leading: favorite. Contextual menu: favorite, add to calendar, open chq.org page, share.
- **`EventDetailView`:** push (compact) / detail column (regular). Hero image (AsyncImage, only when available), title, date/time, venue with address, cost, presenter, full description, category chips, **"In the Chautauquan Daily"** article links (preview/recap + date, opens in `SFSafariViewController`/`Link`), buttons: **Add to Calendar** (EventKitUI `EKEventEditViewController`, write-only access `NSCalendarsWriteOnlyAccessUsageDescription`), **Open on chq.org**, **Share**.
- **Pre-season:** countdown banner ("Season starts in N days") when current date < Week 1 start of the default year.
- **Empty/edge states:** `ContentUnavailableView` for no-results (with Clear Filters action) and first-launch-offline.
- **Year switching:** toolbar menu listing manifest years (default from manifest); non-current year hides time-relative scopes, exactly like the web.
- **iPad:** split view with detail placeholder; filter bar and grid scale with size classes; keyboard shortcuts not in scope.
- **App icon:** rasterized from the web app's `chq-calendar-icon-256.svg` → 1024 pt single-size asset (fallback: flat `#5B7F95` calendar glyph rendered at build-authoring time, committed as PNG).

## 9. Error handling

- Repository surfaces a typed `LoadState` (`loading`, `loaded(stale:)`, `failed(cachedAvailable:)`); UI always prefers showing data over spinners; errors appear as banners, never alerts, except first-launch-with-no-network which gets a retry `ContentUnavailableView`.
- Sidecar failures are silent (web parity): the calendar renders without article links/themes.
- Decoding is tolerant: per-event decode failures skip the event (lossy array decoding) rather than failing the whole feed.

## 10. Testing

Swift Testing (`@Test`) in `ChqCalendarTests`, fixtures under `Fixtures/` (trimmed real JSON):

- Model decoding (envelope, event with/without optionals, HTML-entity decode, naive-date → America/New_York parsing, lossy array behavior).
- `SeasonCalendar`: 2026 week boundaries (Jun 27 noon…), out-of-season nil, membership edges at noon boundaries.
- `EventFilter`: search weights/ordering, each date scope incl. adaptive-50 window and next-day extension, week/location/category/favorites combinators.
- `EventRepository` with mocked API/cache: fresh-cache no-network path, stale-cache background-refresh path, 304 handling, sidecar timeout non-fatal, force refresh.
- `UserStateStore`: round-trip, 30-day expiry discard.

CI: not wired into GitHub Actions in this phase (repo CI is Linux; iOS build requires macOS runners — deferred, noted in plan).

## 11. Risks & mitigations

- **Naive dates vs. device timezone:** all parsing/grouping pinned to `America/New_York` via one `ChqTime` helper; tests run with a non-Eastern local zone to prove independence.
- **5 MB feed on cellular:** ETag revalidation + 1 h TTL keeps re-downloads rare; decode ~1,600 events off-main (measured target < 300 ms on A15).
- **Hand-authored pbxproj:** synchronized-folder format keeps it ~150 lines; verified by `xcodebuild build test` in the plan's first task before any feature code.
