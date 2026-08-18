# Date navigation phase 3b — iOS day rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iOS Events tab the same day rail the web shipped in phase
3a — a horizontal strip of day chips pinned above the list, spanning the whole
navigable season, that moves the reader by one day or many without re-picking a
date filter.

**Architecture:** Four layers, bottom-up. (1) A deterministic, DEBUG-only data
path (`-uitest-fixture`) plus a `ChqCalendarUITests` target, because the three
defects that phase 3a's browser pass caught — a rail that was not pinned, a tap
that dragged the list, a distant tap that landed a thousand points short — are
all invisible to unit tests, and there is no UI-test target in this repo today.
(2) Pure rules in `ChqCalendarShared`: `DayRailNavigation` mirrors the web's
`dayRailNavigation.ts`, and `MyDayChipContent` generalises from "starred count"
to "a count with a style". (3) `AppModel` gains the navigation data (which days
are reachable, how many events each holds) and the navigation actions
(`goToDay`, `expandWindowStart`, corrected `expandWindowEnd`, `resetToNow`).
(4) The view: `DayRailView` extracted from My Day's chip strip, mounted on the
Events tab with `.safeAreaInset(edge: .top)` — the mirror of how `filterPillBar`
already floats at the bottom — with day sections carrying `.id(dayKey)` for
`ScrollViewReader`.

**Tech Stack:** Swift 6, SwiftUI, iOS 18 deployment target, Xcode 26+
(synchronized folder groups). Swift Testing (`@Test` / `#expect`) for unit
tests; XCTest/XCUITest for the new UI-test target.

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`
(the "iOS surface" section, plus "What the browser pass caught that eleven task
reviews did not" — that section is the reason Tasks 1, 2, 8, 9 and 10 exist in
the shape they do).

**Reference implementation:** the shipped web rail. Read these before starting
— this plan mirrors them deliberately, and where it departs it says so:
- `frontend/src/app/dayRailNavigation.ts` — the pure navigation rules
- `frontend/src/lib/utils/dayWindow.ts:322-366` — `eventDayKeys`, `navigationTargets`
- `frontend/src/app/page.tsx:126-172` — how the nav-matching set is derived
- `frontend/src/components/calendar/DayRail.tsx` — labelling and ARIA

---

## Scope

**In:** the Events-tab day rail, backward window expansion, the `AppModel`
navigation API, deleting the "Show next day" button, the UI-test target, and
the App Store screenshot regeneration that `app-store-assets.yml` forces.

**Out, deliberately, decided with the user 2026-08-18:**

- **Siri routing.** `IntentTimeframe.tomorrow`/`.nextWeek` through the same
  `goToDay` stays in phase 4, together with the on-device Siri checklist that
  [[siri-vocabulary-193-status]] already owes.
- **The 1.1.3 version sweep**, including the test bundle `org.chqcal.calendarTests`
  still stranded at 1.1.2 (`project.pbxproj:375`, `:393`). Phase 4.
- **`listing-copy.md` / `listing-fields.json` re-read.** Phase 4.
- **Removing `DateScope.thisWeek`.** It is already absent from
  `DateFilterSheet.visibleScopes` (`:13`), so no user can select it; what
  remains is the read path for a value persisted by an older build. Deleting it
  means a `UserStateStore` migration and re-pinning `FilterChipState`, which is
  real risk for no visible payoff and touches nothing the rail needs.
- **`stepWeek`.** The spec's `AppModel` list names it; the web rail shipped
  without a week step and `WeekRangeStrip` already owns week navigation. A
  second, differently-shaped week control on the same screen is the ambiguity
  the rail exists to remove.
- **Swipe to change day.** The spec already defers it; `EventRow` has leading
  swipe actions (`EventRow.swift:59-66`) and a list-wide horizontal gesture is
  a genuine ambiguity risk.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Never commit to `main`.** Create `feat/date-nav-phase-3b-ios-day-rail` off
  `main` before Task 1 and stay on it. Open a PR; do not fast-forward `main`.
- **Verification command**, run from `ios/` after every task that changes Swift:

  ```bash
  cd ios && xcodebuild test \
    -project ChqCalendar.xcodeproj \
    -scheme ChqCalendar \
    -destination "id=$SIMULATOR_UDID" \
    -parallel-testing-enabled NO \
    CODE_SIGNING_ALLOWED=NO
  ```

  Resolve `SIMULATOR_UDID` once per session with
  `xcrun simctl list devices available | grep iPhone` and export it. **Never
  pin `OS=` in the destination** — the runner image's runtimes differ from any
  laptop's ([[no-ios-tests-in-ci]]).
- **`-parallel-testing-enabled NO` is load-bearing**, not preference. Hosted
  `macos-15` runners are 3-core; with Swift Testing's default parallelism the
  suite fails non-reproducibly. Do not drop it, and do not add a UI-test
  configuration that re-enables it.
- **`CODE_SIGNING_ALLOWED=NO` is required**, not cosmetic:
  `AppGroupTests.containerURLIsNilInTheUnitTestHost` asserts there is *no* App
  Group entitlement, which is exactly the condition this flag creates.
- **Day keys are `yyyy-MM-dd`, Institution-local, zero-padded.**
  Lexicographic order is chronological, so plain `String` comparison is a
  correct date comparison. Step days with `ChqTime.day(_:offsetBy:)`, never
  `+86_400` — a DST day is 23 or 25 hours.
- **Windows are half-open**: `start <= x < endExclusive`. Never inclusive with
  a subtracted epsilon — exact on web (integer ms), wrong here (`Date` wraps a
  `Double`).
- **Clamp expansion *inputs*, never the merged window.** `ViewWindow.make`
  already does this; nothing in this plan may clamp after merging.
- **Window state is session-only.** `windowStartDayKey` / `windowEndDayKey` are
  absent from `PersistedFilters` and must stay absent. The anchor day is view
  state: it lives in `@State`, is never persisted, and never filters.
- **Shared domain code lives in `ios/ChqCalendarShared/`** and is compiled into
  the app *and* the widget extension. Everything there must be `nonisolated`
  and `Sendable`, and must not import SwiftUI.
- **Swift Testing for unit tests** (`import Testing`, `@Test`, `#expect`,
  `try #require`). XCTest only inside `ChqCalendarUITests`, which XCUITest
  requires.
- **DEBUG-only code compiles out of Release.** Every UI-test hook added by this
  plan sits inside `#if DEBUG`. Do not add a JSON resource file for fixture
  data — synchronized folder groups would bundle it into Release builds too;
  the fixture is generated in Swift inside `#if DEBUG` instead.
- **Screenshot obligation applies.** This plan touches
  `ios/ChqCalendar/Features/**` and `ios/ChqCalendarShared/**` visibly, so
  `.github/workflows/app-store-assets.yml` requires a regenerated
  `docs/app-store/screenshots.manifest.json`. Task 12 does it. Do not reach for
  `[skip-screenshots:]`.
- **Prove every guard by breaking the code.** Before claiming a test protects
  something, revert the implementation (`git stash`) and watch it fail. When a
  falsification *passes*, suspect the harness, not the code
  ([[falsify-guards-and-suspect-the-harness]]).
- **Never assert on the wall clock.** Every UI test pins time with
  `-uitest-freeze-now` and data with `-uitest-fixture`. CI runs UTC and this app
  treats the device clock as Chautauqua event-time; two web e2e assertions
  silently depended on the hour and were red on `main` for weeks
  ([[browser-checks-e2e-time-dependence]]).

---

## File Structure

**New — shared domain (app + widgets, no SwiftUI):**
- `ios/ChqCalendarShared/Domain/DayRailNavigation.swift` — the pure navigation
  rules: what a chip tap does, where a chevron goes, when a pending scroll is
  abandoned. Mirrors `frontend/src/app/dayRailNavigation.ts`.
- `ios/ChqCalendarShared/Domain/DayChipCountStyle.swift` — how a chip's count
  is spoken and symbolised, so one chip type serves My Day (stars) and the
  Events rail (events).

**New — app:**
- `ios/ChqCalendar/Features/Shared/DayRailView.swift` — the horizontal chip
  strip, extracted from `MyDayView.dayChipsRow`, with accessory slots at each
  end.
- `ios/ChqCalendar/Data/UITestFixtureAPI.swift` — DEBUG-only deterministic
  `CalendarAPIClient` + in-memory cache.

**New — tests:**
- `ios/ChqCalendarUITests/` — new XCUITest target: `DayRailUITests.swift`,
  `LaunchFixtureUITests.swift`, `UITestApp.swift` (launch helper).
- `ios/ChqCalendarTests/DayRailNavigationTests.swift`
- `ios/ChqCalendarTests/NavMatchingTests.swift`

**Modified:**
- `ios/ChqCalendarShared/Domain/MyDayChipContent.swift` — `starCount` → `count`
  plus a `style`.
- `ios/ChqCalendar/App/AppModel.swift` — `navMatching` cache; `goToDay`,
  `expandWindowStart`, corrected `expandWindowEnd`, `resetToNow`.
- `ios/ChqCalendar/Features/Calendar/EventListView.swift` — mount the rail,
  `.id` on day sections, delete the "Show next day" button, last-section
  auto-expand.
- `ios/ChqCalendar/Features/MyDay/MyDayView.swift` — use `DayRailView`.
- `ios/ChqCalendar/App/ChqCalendarApp.swift` — DEBUG fixture composition.
- `.github/workflows/ios.yml` — run the UI-test target.
- `ios/ChqCalendar.xcodeproj/project.pbxproj` — the new target.

---

## Suggested PR boundaries

One PR is fine and mirrors 3a. If it grows unwieldy, split at:

- **Tasks 1–2** — test infrastructure only. Ships a deterministic launch mode
  and a UI-test target with one smoke test. Independently valuable: phase 4 and
  the Watch app both inherit it.
- **Tasks 3–7** — model and extraction. No visible change; My Day is
  byte-identical, the Events tab is untouched.
- **Tasks 8–12** — the rail itself.

---

### Task 1: A deterministic data path for UI tests

The app fetches live data from CloudFront. A UI test asserting "tapping the
chip for August 22 lands on August 22" against live data is a test that changes
its mind when the feed does, and dies at the end of the season. This task adds
a DEBUG-only launch mode that replaces the network client with a generated
fixture and the disk cache with an in-memory one, so every UI test in Task 2
and later starts from an identical, frozen world.

Generated in Swift rather than loaded from a bundled JSON file **on purpose**:
Xcode 26 synchronized folder groups add any file under `ios/ChqCalendar/` to the
target automatically, including Release builds — a `#if DEBUG` block cannot
exclude a resource, but it does exclude code.

**Files:**
- Create: `ios/ChqCalendar/Data/UITestFixtureAPI.swift`
- Modify: `ios/ChqCalendar/App/ChqCalendarApp.swift:26-43`
- Test: `ios/ChqCalendarTests/UITestFixtureAPITests.swift`

**Interfaces:**
- Produces: `UITestFixture.isActive: Bool`;
  `UITestFixture.makeRepository() -> EventRepository`;
  `UITestFixtureAPI: CalendarAPIClient`; `UITestMemoryCache: DataCaching`.
  The fixture season is **2026**, events run **2026-06-27 … 2026-08-23**, and
  every third day is deliberately empty.
- Consumes: `CalendarAPIClient`, `RemoteResource`, `FetchResult`,
  `CalendarAPIError`, `DataCaching`, `CacheEntry`, `EventRepository`.

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/UITestFixtureAPITests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// The fixture is the ground truth every UI test asserts against, so its
/// shape is pinned here rather than discovered by a failing UI test — a
/// XCUITest failure tells you "the chip was not found", never "the fixture
/// stopped emitting that day".
struct UITestFixtureAPITests {
    @Test func eventsPayloadDecodesThroughTheRealRepositoryPath() async throws {
        let repo = UITestFixture.makeRepository()
        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(!snapshot.events.isEmpty)
        let days = Set(snapshot.events.map { ChqTime.dayKey(for: $0.start) })
        #expect(days.contains("2026-06-27"))
        #expect(days.contains("2026-08-23"))
    }

    /// Empty days are what make a rail interesting: a chip with no events is
    /// not a destination, and the chevrons must skip it. If the fixture were
    /// dense, Task 11's "step past the gap" assertion would pass for the
    /// wrong reason.
    @Test func everyThirdDayIsEmptySoGapsAreExercised() async throws {
        let repo = UITestFixture.makeRepository()
        let snapshot = try await repo.refresh(year: 2026, force: true)
        let days = Set(snapshot.events.map { ChqTime.dayKey(for: $0.start) })

        #expect(!days.contains("2026-06-29"))
        #expect(days.contains("2026-06-30"))
    }

    @Test func yearsManifestNamesTwentyTwentySixAsDefault() async {
        let repo = UITestFixture.makeRepository()
        let manifest = await repo.availableYears()

        #expect(manifest.defaultYear == 2026)
        #expect(manifest.years.contains(2026))
    }

    /// Sidecars are not part of what the rail shows, and `EventRepository`
    /// already degrades gracefully when they fail — pinned here so a future
    /// reader does not "fix" the fixture by inventing sidecar payloads.
    @Test func sidecarResourcesFailWithoutBreakingTheSnapshot() async throws {
        let repo = UITestFixture.makeRepository()
        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(snapshot.articleLinks.isEmpty)
        #expect(snapshot.programLinks.isEmpty)
    }
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run the verification command, or narrow with
`-only-testing:ChqCalendarTests/UITestFixtureAPITests`.
Expected: FAIL to compile — `cannot find 'UITestFixture' in scope`.

- [ ] **Step 3: Write the fixture client**

Create `ios/ChqCalendar/Data/UITestFixtureAPI.swift`:

```swift
#if DEBUG
import Foundation

/// The deterministic world a `-uitest-fixture` launch lives in.
///
/// **Why this exists.** The three defects phase 3a's browser pass caught were
/// integration defects — a rail that was not pinned, a tap that dragged the
/// page, a distant tap that landed short. Catching their iOS equivalents
/// needs a running app, and a running app that fetches live CloudFront data
/// gives a UI test no stable ground to assert against: the feed changes, and
/// after the season ends every date assertion in it is off-season and wrong.
///
/// **Why it is generated, not a bundled JSON file.** Xcode 26 synchronized
/// folder groups add every file under `ios/ChqCalendar/` to the target,
/// including Release builds. `#if DEBUG` can exclude code; it cannot exclude
/// a resource. So the payload is built in Swift and this entire file
/// disappears from a Release build.
///
/// **The shape, which UI tests assert against.** Season 2026. Days run
/// `2026-06-27` through `2026-08-23` inclusive. Every third day (index % 3 ==
/// 2) is left empty, because a rail's interesting cases are the gaps: an
/// empty chip is not a destination, and a chevron must step past it. Each
/// non-empty day carries three events at 09:00, 13:00 and 19:00 so day
/// sections are tall enough for a scroll to be a real scroll.
nonisolated enum UITestFixture {
    static let firstDay = "2026-06-27"
    static let lastDay = "2026-08-23"
    static let year = 2026

    /// True when the app was launched with `-uitest-fixture`.
    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains("-uitest-fixture")
    }

    /// Every day the fixture covers, in order.
    static var allDays: [String] {
        ChqTime.dayKeys(from: firstDay, through: lastDay)
    }

    /// The days that actually carry events — what navigation can reach.
    static var eventDays: [String] {
        allDays.enumerated().compactMap { index, day in
            index % 3 == 2 ? nil : day
        }
    }

    /// A repository wired to the fixture client and an in-memory cache.
    ///
    /// The in-memory cache matters as much as the client: `DiskCache.standard()`
    /// is the real app's cache, so a fixture launch sharing it would write
    /// synthetic events into the container the next real launch reads.
    static func makeRepository() -> EventRepository {
        EventRepository(api: UITestFixtureAPI(), cache: UITestMemoryCache())
    }

    static func eventsJSON() -> Data {
        var entries: [String] = []
        for day in eventDays {
            for (slot, time) in ["09:00:00", "13:00:00", "19:00:00"].enumerated() {
                entries.append("""
                {
                  "id": "\(day)-\(slot)",
                  "title": "Fixture Event \(slot + 1)",
                  "description": "A deterministic fixture event.",
                  "startDate": "\(day) \(time)",
                  "endDate": "\(day) \(time)",
                  "timezone": "America/New_York",
                  "venue": { "name": "Amphitheater", "id": 1, "showMap": false },
                  "location": "Amphitheater",
                  "categories": [
                    { "name": "Lecture", "parent": 0, "id": 1,
                      "taxonomy": "tribe_events_cat", "slug": "lecture" }
                  ]
                }
                """)
            }
        }
        return Data("{ \"data\": [\(entries.joined(separator: ","))] }".utf8)
    }

    static func yearsJSON() -> Data {
        Data("""
        { "years": [2026], "defaultYear": 2026, "generated": "2026-01-01T00:00:00Z" }
        """.utf8)
    }
}

/// Serves `UITestFixture`'s payloads and fails every other resource.
///
/// Sidecars (article links, program links, weekly themes) fail deliberately.
/// `EventRepository.fetchSidecarLinks` and its siblings already treat a
/// failed sidecar as "keep what's cached", which for a cold in-memory cache
/// is an empty map — so the snapshot is well-formed without this file having
/// to invent three more payload shapes that nothing in the rail reads.
nonisolated struct UITestFixtureAPI: CalendarAPIClient {
    func fetch(
        _ resource: RemoteResource, ifNoneMatch: String?, timeout: TimeInterval?
    ) async throws -> FetchResult {
        switch resource {
        case .events(let year) where year == UITestFixture.year:
            return .success(data: UITestFixture.eventsJSON(), etag: "fixture")
        case .years:
            return .success(data: UITestFixture.yearsJSON(), etag: "fixture")
        default:
            throw CalendarAPIError.transport("uitest fixture serves no \(resource.path)")
        }
    }
}

/// A `DataCaching` that forgets everything when the process exits.
final class UITestMemoryCache: DataCaching, @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String: CacheEntry] = [:]

    func read(_ key: String) -> CacheEntry? {
        lock.lock(); defer { lock.unlock() }
        return entries[key]
    }

    func write(_ key: String, data: Data, etag: String?, fetchedAt: Date) {
        lock.lock(); defer { lock.unlock() }
        entries[key] = CacheEntry(
            data: data, metadata: CacheMetadata(etag: etag, fetchedAt: fetchedAt))
    }

    func touch(_ key: String, fetchedAt: Date) {
        lock.lock(); defer { lock.unlock() }
        guard let existing = entries[key] else { return }
        entries[key] = CacheEntry(
            data: existing.data,
            metadata: CacheMetadata(etag: existing.metadata.etag, fetchedAt: fetchedAt))
    }

    func remove(_ key: String) {
        lock.lock(); defer { lock.unlock() }
        entries[key] = nil
    }
}
#endif
```

**Before writing this, read `ios/ChqCalendar/Data/EventRepository.swift`'s
`DataCaching` / `CacheEntry` / `CacheMetadata` declarations and
`CalendarAPIError`'s cases, and match them exactly** — the names above are
written from the shapes `MockCache` (`ios/ChqCalendarTests/TestSupport.swift:168`)
conforms to, and a mismatch is a compile error, not a runtime surprise.

- [ ] **Step 4: Run the test to verify it passes**

Run the verification command narrowed to
`-only-testing:ChqCalendarTests/UITestFixtureAPITests`.
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the fixture into app launch**

In `ios/ChqCalendar/App/ChqCalendarApp.swift`, replace the repository
construction inside `init()`:

```swift
    init() {
        let now = AppModel.launchNow()
        let reminderCenter = ReminderCenter(scheduler: UNUserNotificationCenter.current(), now: now)

        // A `-uitest-fixture` launch swaps the whole data layer: a generated
        // payload instead of CloudFront, an in-memory cache instead of the
        // real container (so a fixture launch cannot poison the next real
        // one), and a throwaway `UserDefaults` suite so filters persisted by
        // an earlier run cannot decide what a UI test sees.
        #if DEBUG
        let repository = UITestFixture.isActive
            ? UITestFixture.makeRepository()
            : EventRepository(api: LiveCalendarAPI(), cache: DiskCache.standard())
        let store = UITestFixture.isActive
            ? UserStateStore(defaults: UserDefaults(suiteName: "uitest-\(UUID().uuidString)")!, now: now)
            : UserStateStore()
        #else
        let repository = EventRepository(api: LiveCalendarAPI(), cache: DiskCache.standard())
        let store = UserStateStore()
        #endif

        let model = AppModel(
            repository: repository,
            store: store,
            now: now,
            reminderCenter: reminderCenter,
            widgetReloader: LiveWidgetReloading(),
            spotlightIndexer: LiveSpotlightIndexing()
        )
        _model = State(initialValue: model)

        notificationDelegate.onOpenEvent = { eventID in
            model.pendingDeepLink = .event(id: eventID)
        }
        UNUserNotificationCenter.current().delegate = notificationDelegate
    }
```

Check `UserStateStore`'s initialiser signature before writing this — the test
suite calls `UserStateStore(defaults:now:)` (`AppModelTests.swift:29`), so both
labels exist, but confirm the `now` parameter's type is
`@escaping @Sendable () -> Date` and not `Date`.

- [ ] **Step 6: Verify the fixture launch by hand, once**

```bash
cd ios
xcodebuild build -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination "id=$SIMULATOR_UDID" -derivedDataPath /tmp/chq-3b CODE_SIGNING_ALLOWED=NO
xcrun simctl boot "$SIMULATOR_UDID" 2>/dev/null || true
xcrun simctl install "$SIMULATOR_UDID" \
  /tmp/chq-3b/Build/Products/Debug-iphonesimulator/ChqCalendar.app
xcrun simctl launch "$SIMULATOR_UDID" org.chqcal.app \
  -uitest-fixture -uitest-freeze-now "2026-07-15 10:00:00"
sleep 3
xcrun simctl io "$SIMULATOR_UDID" screenshot /tmp/chq-3b-fixture.png
```

Open the screenshot. Expected: the events list showing "Fixture Event 1/2/3"
rows under July day headers — **not** a spinner, not "No events", not real
Chautauqua programming. If you see real events, `isActive` is false: `simctl
launch` passes arguments after the bundle id, and they must not be quoted as
one string.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/Data/UITestFixtureAPI.swift \
        ios/ChqCalendar/App/ChqCalendarApp.swift \
        ios/ChqCalendarTests/UITestFixtureAPITests.swift
git commit -m "test(ios): deterministic -uitest-fixture data path

A UI test that asserts on dates cannot run against live CloudFront data:
the feed changes under it, and after the season ends every date in it is
off-season. This adds a DEBUG-only launch mode that swaps the API client
for a generated payload, the disk cache for an in-memory one, and the
UserDefaults suite for a throwaway, so the app starts from an identical
world every launch.

Generated in Swift rather than bundled as JSON because synchronized folder
groups add resources to Release builds too; #if DEBUG excludes code, not
resources."
```

---

### Task 2: The `ChqCalendarUITests` target

There is no UI-test target in this repo — `capture-screenshots.sh:6` says so
explicitly, and the screenshot harness drives DEBUG launch hooks through
`simctl` precisely to avoid needing one. Screenshots prove a screen *renders*;
they cannot prove a rail *stays pinned while you scroll*. This task creates the
target with one smoke test, and wires it into CI, so Tasks 8–11 have somewhere
to put the assertions that matter.

**Files:**
- Create: `ios/ChqCalendarUITests/UITestApp.swift`
- Create: `ios/ChqCalendarUITests/LaunchFixtureUITests.swift`
- Modify: `ios/ChqCalendar.xcodeproj/project.pbxproj`
- Modify: `ios/ChqCalendar.xcodeproj/xcshareddata/xcschemes/ChqCalendar.xcscheme`
- Modify: `.github/workflows/ios.yml:160-166`

**Interfaces:**
- Produces: `func launchFixtureApp(now:extraArgs:) -> XCUIApplication` — every
  later UI test starts here.

- [ ] **Step 1: Create the target in Xcode**

This is the one step in this plan that is easier in the IDE than in a text
editor, and hand-editing `project.pbxproj` for a new target is a
well-known way to produce a project that opens but does not build.

In Xcode: **File → New → Target → UI Testing Bundle**. Name it
`ChqCalendarUITests`. Target to be tested: `ChqCalendar`. Team: none.
Then, in the target's Build Settings, set `CODE_SIGNING_ALLOWED` to `NO` for
both configurations, matching what CI passes on the command line.

Delete the boilerplate `ChqCalendarUITests.swift` and
`ChqCalendarUITestsLaunchTests.swift` Xcode generates — the launch-performance
test in particular takes a screenshot on every run and adds nothing here.

Verify the target exists and the scheme runs it:

```bash
cd ios && xcodebuild -project ChqCalendar.xcodeproj -list
```

Expected: `ChqCalendarUITests` appears under Targets, and the `ChqCalendar`
scheme's test action includes it.

- [ ] **Step 2: Write the launch helper**

Create `ios/ChqCalendarUITests/UITestApp.swift`:

```swift
import XCTest

/// Launches the app in its deterministic fixture world.
///
/// Every UI test in this target goes through here. Two arguments are
/// non-negotiable and are why this helper exists rather than each test
/// building its own argument list:
///
/// - `-uitest-fixture` replaces CloudFront with a generated payload
///   (`UITestFixture`), so assertions name days that will still exist next
///   season.
/// - `-uitest-freeze-now` pins the clock. CI runs UTC and this app treats the
///   device clock as Chautauqua event-time; two of the web e2e checks
///   silently depended on the wall-clock hour and were red on `main` for
///   weeks before anyone noticed. A UI test that reads "Today" must be told
///   what today is.
func launchFixtureApp(
    now: String = "2026-07-15 10:00:00",
    extraArgs: [String] = []
) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest-fixture", "-uitest-freeze-now", now] + extraArgs
    app.launch()
    return app
}
```

- [ ] **Step 3: Write the failing smoke test**

Create `ios/ChqCalendarUITests/LaunchFixtureUITests.swift`:

```swift
import XCTest

final class LaunchFixtureUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The whole target's foundation: if the app does not reach a list of
    /// fixture events, nothing else in this target can mean anything.
    func testFixtureLaunchReachesTheEventList() {
        let app = launchFixtureApp()
        let firstEvent = app.staticTexts["Fixture Event 1"].firstMatch

        XCTAssertTrue(
            firstEvent.waitForExistence(timeout: 20),
            "The fixture event list never appeared — check that -uitest-fixture reached UITestFixture.isActive")
    }
}
```

- [ ] **Step 4: Run it**

```bash
cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination "id=$SIMULATOR_UDID" -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO -only-testing:ChqCalendarUITests
```

Expected: PASS. If it fails on code signing, the target's
`CODE_SIGNING_ALLOWED` was not set in Step 1 — the command-line override
applies to the whole build, but a UI-test target also produces a *runner* app,
and its own setting must agree.

- [ ] **Step 5: Prove the guard by breaking the code**

```bash
git stash push ios/ChqCalendar/App/ChqCalendarApp.swift
```

Re-run Step 4. Expected: FAIL — without the fixture wiring the app fetches
live data and "Fixture Event 1" never appears. Then `git stash pop`.

If it **passes** with the wiring stashed, stop: the app is reading a cached
fixture snapshot from a previous run, which means `UITestMemoryCache` is not
actually in the path. Erase the simulator (`xcrun simctl erase "$SIMULATOR_UDID"`)
and investigate before continuing.

- [ ] **Step 6: Wire CI**

In `.github/workflows/ios.yml`, the existing `xcodebuild test` step already
runs the whole scheme, so adding the target to the scheme (Step 1) is enough to
run it. Add a comment above the step recording *why* the UI tests must stay
serial, and bump the job timeout:

```yaml
    timeout-minutes: 60
```

and, in the "Build and test" step's comment block, append:

```
        # ChqCalendarUITests (added in phase 3b) runs in this same invocation.
        # UI tests are slow — each one boots the app — so the timeout above is
        # 60 rather than 45. They are also the reason
        # -parallel-testing-enabled NO matters twice over: two XCUITest
        # classes running concurrently on a 3-core runner contend for the
        # single booted simulator, which fails as "Application is not
        # running" rather than as anything resembling the real cause.
```

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendarUITests ios/ChqCalendar.xcodeproj .github/workflows/ios.yml
git commit -m "test(ios): add a UI-test target with a fixture launch smoke test

Screenshots prove a screen renders; they cannot prove a rail stays pinned
while you scroll, that a tap does not drag the list, or that a distant tap
lands on its target. Those are exactly the three defects phase 3a's browser
pass caught after eleven green task reviews, and phase 3b's rail has iOS
equivalents of all three.

The scheme runs the new target in the same xcodebuild invocation, so
-parallel-testing-enabled NO continues to cover it."
```

---

### Task 3: One chip type, two meanings — `DayChipCountStyle`

`MyDayChipContent` counts stars. The Events rail counts events. Rather than a
second near-identical chip type, the count becomes a value plus a style: what
symbol sits beside it, how it is spoken, and whether the chip is a destination
("Go to Sunday, August 16, 4 events") or a selector ("Sunday, August 9, today,
3 starred events").

My Day's rendered output must not change by a character. That is what the
existing `MyDayChipContentTests` are for, and they are updated mechanically
here — every assertion string stays identical.

**Files:**
- Create: `ios/ChqCalendarShared/Domain/DayChipCountStyle.swift`
- Modify: `ios/ChqCalendarShared/Domain/MyDayChipContent.swift`
- Modify: `ios/ChqCalendar/Features/MyDay/MyDayView.swift:187-196`, `:523-531`
- Test: `ios/ChqCalendarTests/MyDayChipContentTests.swift`

**Interfaces:**
- Produces:
  ```swift
  struct DayChipCountStyle { let symbol: String?; let singular: String
                             let plural: String; let zero: String
                             let actionPrefix: String? }
  static let starred: DayChipCountStyle   // symbol "star.fill", no prefix
  static let events: DayChipCountStyle    // no symbol, prefix "Go to"
  MyDayChipContent.count: Int             // was starCount
  MyDayChipContent.symbol: String?
  MyDayChipContent.make(dayKey:todayKey:count:style:includingYear:)
  MyDayChipContent.makeAll(days:todayKey:counts:style:includingYear:)
  ```
- Consumes: `ChqTime.dayTitle(for:includingYear:)`, `ChqTime.weekdayLabel(for:)`,
  `ChqTime.monthDayLabel(for:)`, `ChqTime.isCanonicalDayKey(_:)`.

- [ ] **Step 1: Write the failing tests**

Append to `ios/ChqCalendarTests/MyDayChipContentTests.swift`:

```swift
    // MARK: - Count styles

    /// The Events rail's chips are destinations, so a day with matches is
    /// named as one. A day with none is named as a fact: a control that says
    /// "Go to" while going nowhere is the defect this wording exists to
    /// avoid — the same rule the web rail's `dayChips` follows.
    @Test func eventStyleNamesANonEmptyDayAsADestination() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-16", todayKey: "2026-08-15",
            count: 4, style: .events, includingYear: false))

        #expect(content.accessibilityLabel == "Go to Sunday, August 16, 4 events")
        #expect(content.symbol == nil)
    }

    @Test func eventStyleNamesAnEmptyDayAsAFactNotADestination() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-16", todayKey: "2026-08-15",
            count: 0, style: .events, includingYear: false))

        #expect(content.accessibilityLabel == "Sunday, August 16, no events")
        #expect(content.isEmpty)
    }

    @Test func eventStyleStillCarriesTodayInTheText() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-15", todayKey: "2026-08-15",
            count: 2, style: .events, includingYear: false))

        #expect(content.topLine == "Today")
        #expect(content.accessibilityLabel == "Go to Saturday, August 15, today, 2 events")
    }

    /// The starred style is My Day's existing behaviour, unchanged. This is
    /// the guard that the generalisation did not quietly reword a screen
    /// nobody is looking at during this phase.
    @Test func starredStyleIsUnchangedFromBeforeTheGeneralisation() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-08-09",
            count: 3, style: .starred, includingYear: false))

        #expect(content.accessibilityLabel == "Sunday, August 9, today, 3 starred events")
        #expect(content.symbol == "star.fill")
    }

    @Test func singularCountsAreSpokenInTheSingular() throws {
        let events = try #require(MyDayChipContent.make(
            dayKey: "2026-08-16", todayKey: "2026-08-15",
            count: 1, style: .events, includingYear: false))
        let starred = try #require(MyDayChipContent.make(
            dayKey: "2026-08-16", todayKey: "2026-08-15",
            count: 1, style: .starred, includingYear: false))

        #expect(events.accessibilityLabel == "Go to Sunday, August 16, 1 event")
        #expect(starred.accessibilityLabel == "Sunday, August 16, 1 starred event")
    }
```

Then rewrite the file's existing calls: every `starCount:` argument label
becomes `count:`, and each gains `style: .starred`. **Do not change a single
expected string** — that is the point of this task.

- [ ] **Step 2: Run them to make sure they fail**

Run the verification command narrowed to
`-only-testing:ChqCalendarTests/MyDayChipContentTests`.
Expected: FAIL to compile — `cannot find 'DayChipCountStyle' in scope` and
`incorrect argument label 'count:'`.

- [ ] **Step 3: Add the style type**

Create `ios/ChqCalendarShared/Domain/DayChipCountStyle.swift`:

```swift
import Foundation

/// How a day chip's count is symbolised and spoken.
///
/// One chip type serves two screens with different subjects — My Day counts
/// starred events, the Events rail counts matching events — and the
/// difference is entirely in the labelling. Splitting it out keeps
/// `MyDayChipContent` free of `if isMyDay` branches and makes the wording
/// testable on its own.
nonisolated struct DayChipCountStyle: Equatable, Sendable {
    /// SF Symbol rendered beside the count, or `nil` for a bare number.
    let symbol: String?
    let singular: String
    let plural: String
    /// How a zero count is spoken — "no events", not "0 events".
    let zero: String
    /// Prefixed to a **non-empty** day's spoken label ("Go to Sunday, August
    /// 16, 4 events"). `nil` for My Day, whose chips select a day rather than
    /// navigate to one.
    ///
    /// Never applied to an empty day, whatever the style says: an empty day
    /// is not a destination, so it is named as a fact. This is the rule the
    /// web rail arrived at after three review findings, recorded in
    /// `DayChip.label`'s doc comment.
    let actionPrefix: String?

    static let starred = DayChipCountStyle(
        symbol: "star.fill",
        singular: "starred event", plural: "starred events",
        zero: "no starred events", actionPrefix: nil)

    static let events = DayChipCountStyle(
        symbol: nil,
        singular: "event", plural: "events",
        zero: "no events", actionPrefix: "Go to")

    /// `"4 events"` / `"1 event"` / `"no events"`.
    func phrase(for count: Int) -> String {
        switch count {
        case 0: return zero
        case 1: return "1 \(singular)"
        default: return "\(count) \(plural)"
        }
    }
}
```

- [ ] **Step 4: Generalise the chip content**

In `ios/ChqCalendarShared/Domain/MyDayChipContent.swift`, rename `starCount`
to `count`, add `symbol`, and thread the style through both factories. The
doc comments that describe the four-signal encoding stay as they are — the
encoding has not changed, only what the count counts:

```swift
    let count: Int
    /// SF Symbol beside the count, from the style. `nil` renders a bare
    /// number, which is what the Events rail wants: an events count needs no
    /// icon to say what it counts, and a symbol on 58 chips is visual noise.
    let symbol: String?
    let isToday: Bool
    let accessibilityLabel: String

    var isEmpty: Bool { count == 0 }

    static func make(
        dayKey: String,
        todayKey: String,
        count: Int,
        style: DayChipCountStyle,
        includingYear: Bool
    ) -> MyDayChipContent? {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return nil }

        let isToday = dayKey == todayKey
        let title = ChqTime.dayTitle(for: date, includingYear: includingYear)
        // The prefix rides the title rather than the whole phrase so it reads
        // as "Go to Sunday, August 16, 4 events" and not "Go to Sunday,
        // August 16, today, 4 events" losing its verb somewhere in the
        // middle. Empty days never take it — see `actionPrefix`.
        let head = (count > 0 ? style.actionPrefix : nil).map { "\($0) \(title)" } ?? title
        let spokenParts = [head, isToday ? "today" : nil, style.phrase(for: count)]
            .compactMap { $0 }

        return MyDayChipContent(
            topLine: isToday ? "Today" : ChqTime.weekdayLabel(for: date),
            dateLine: ChqTime.monthDayLabel(for: date),
            count: count,
            symbol: style.symbol,
            isToday: isToday,
            accessibilityLabel: spokenParts.joined(separator: ", "))
    }
```

And `makeAll`, whose doc comment about `nil`-swallowing and the DEBUG trap is
unchanged and must be preserved verbatim:

```swift
    static func makeAll(
        days: [String],
        todayKey: String,
        counts: [String: Int],
        style: DayChipCountStyle,
        includingYear: Bool
    ) -> [Entry] {
        days.compactMap { day in
            assert(
                ChqTime.isCanonicalDayKey(day),
                "non-canonical day key \"\(day)\" reached the My Day strip — check day-key generation")
            guard let content = make(
                dayKey: day,
                todayKey: todayKey,
                count: counts[day] ?? 0,
                style: style,
                includingYear: includingYear
            ) else { return nil }
            return Entry(day: day, content: content)
        }
    }
```

- [ ] **Step 5: Update My Day's two call sites**

`MyDayView.swift:187` — `starredCounts: starredCounts` becomes
`counts: starredCounts, style: .starred`.

`MyDayView.swift:523-531` — `MyDayChip.countLine` reads `content.starCount`;
change to `content.count`, and render the symbol from the content rather than
hardcoding `"star.fill"`:

```swift
    @ViewBuilder
    private var countLine: some View {
        if content.count > 0 {
            if let symbol = content.symbol {
                Label("\(content.count)", systemImage: symbol)
                    .font(.caption2)
                    .labelStyle(.titleAndIcon)
            } else {
                Text("\(content.count)").font(.caption2)
            }
        } else {
            Text(" ").font(.caption2)
        }
    }
```

- [ ] **Step 6: Run the whole suite**

Run the verification command.
Expected: PASS. In particular `MyDayChipContentTests` passes with every
pre-existing expected string untouched — if one had to change, the
generalisation altered My Day and must be reworked, not the test
(`CLAUDE.md`: ask before changing a test to make it pass).

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DayChipCountStyle.swift \
        ios/ChqCalendarShared/Domain/MyDayChipContent.swift \
        ios/ChqCalendar/Features/MyDay/MyDayView.swift \
        ios/ChqCalendarTests/MyDayChipContentTests.swift
git commit -m "feat(ios): a day chip counts by style, not by stars

The Events rail needs the same chip My Day already has, counting a
different subject. Rather than a second near-identical type, the count
becomes a value plus a DayChipCountStyle: what symbol sits beside it, how
it is spoken, and whether the chip is a destination or a selector.

My Day's rendered output is unchanged to the character — every pre-existing
expected string in MyDayChipContentTests is untouched, which is what pins
that."
```

---

### Task 4: `DayRailNavigation` — the rules, with no view attached

The rules for what a chip tap does, where a chevron goes, and when a pending
scroll should be abandoned already exist, debugged, on the web
(`frontend/src/app/dayRailNavigation.ts`). This is that file in Swift. It lives
in `ChqCalendarShared` and touches no SwiftUI, so all of it is testable without
a view host — which is the point, because the parts of the rail that *do* need
a view host are expensive to test and are covered in Tasks 8–11.

**Files:**
- Create: `ios/ChqCalendarShared/Domain/DayRailNavigation.swift`
- Test: `ios/ChqCalendarTests/DayRailNavigationTests.swift`

**Interfaces:**
- Produces:
  ```swift
  enum DayRailNavigation {
      struct Plan: Equatable, Sendable {
          let expandStart: String?
          let expandEnd: String?
          let scrollTo: String
      }
      static func plan(target:window:bounds:) -> Plan?
      static func shouldAbandonScroll(target:window:) -> Bool
      static func stepTargets(anchor:eventDays:) -> (previous: String?, next: String?)
      static func edgeTargets(eventDays:window:) -> (earlier: String?, later: String?)
      static func eventDays(_ events: [Event]) -> [String]
      static func reachableTodayKey(_ today: String?, bounds: ClosedRange<String>) -> String?
  }
  ```
- Consumes: `ViewWindow` (`startDay`, `endDay`), `Event.start`,
  `ChqTime.dayKey(for:)`.

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/DayRailNavigationTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// The Swift half of a rule set the web already ships
/// (`frontend/src/app/dayRailNavigation.ts`). Where the two must agree, the
/// test names say so — a divergence here is a cross-platform behaviour bug,
/// not a local preference.
struct DayRailNavigationTests {
    private let bounds = "2026-06-27"..."2026-08-23"

    private func window(_ start: String, _ end: String) -> ViewWindow {
        let from = ChqTime.parse("\(start) 00:00:00")!
        let through = ChqTime.parse("\(ChqTime.day(end, offsetBy: 1)!) 00:00:00")!
        return ViewWindow(startDay: start, endDay: end, range: from..<through)
    }

    // MARK: - plan

    @Test func aTargetInsideTheWindowIsAScrollAndNothingElse() throws {
        let plan = try #require(DayRailNavigation.plan(
            target: "2026-07-15", window: window("2026-07-10", "2026-07-20"), bounds: bounds))

        #expect(plan.expandStart == nil)
        #expect(plan.expandEnd == nil)
        #expect(plan.scrollTo == "2026-07-15")
    }

    @Test func aTargetBeforeTheWindowGrowsTheStartEdgeToIt() throws {
        let plan = try #require(DayRailNavigation.plan(
            target: "2026-07-01", window: window("2026-07-10", "2026-07-20"), bounds: bounds))

        #expect(plan.expandStart == "2026-07-01")
        #expect(plan.expandEnd == nil)
    }

    @Test func aTargetAfterTheWindowGrowsTheEndEdgeToIt() throws {
        let plan = try #require(DayRailNavigation.plan(
            target: "2026-08-01", window: window("2026-07-10", "2026-07-20"), bounds: bounds))

        #expect(plan.expandStart == nil)
        #expect(plan.expandEnd == "2026-08-01")
    }

    /// The window only ever grows, so one tap never expands both edges. If it
    /// did, the scope button — the thing that shrinks the window back — would
    /// be the only way out of a window the reader widened by accident.
    @Test func noSingleTapEverExpandsBothEdges() throws {
        for target in ["2026-06-27", "2026-07-15", "2026-08-23"] {
            let plan = try #require(DayRailNavigation.plan(
                target: target, window: window("2026-07-10", "2026-07-20"), bounds: bounds))
            #expect(plan.expandStart == nil || plan.expandEnd == nil)
        }
    }

    /// Refusing is honest: clamping would move the window to an edge and then
    /// scroll to a day that is not there.
    @Test func aTargetOutsideTheNavigableBoundsIsRefused() {
        #expect(DayRailNavigation.plan(
            target: "2026-06-01", window: window("2026-07-10", "2026-07-20"), bounds: bounds) == nil)
        #expect(DayRailNavigation.plan(
            target: "2026-09-30", window: window("2026-07-10", "2026-07-20"), bounds: bounds) == nil)
    }

    /// A scope that resolves to no window at all cannot be rescued by
    /// expansion — `ViewWindow.make` returns nil out of `base` before it ever
    /// reads the expansion inputs. Announcing a destination and then doing
    /// nothing is the exact class of defect the web branch spent three
    /// findings removing.
    @Test func aNilWindowRefusesEveryTap() {
        #expect(DayRailNavigation.plan(
            target: "2026-07-15", window: nil, bounds: bounds) == nil)
    }

    // MARK: - shouldAbandonScroll

    @Test func aPendingScrollIsAbandonedOnceTheWindowCoversItsTarget() {
        // The expansion landed and the day still has no section, which means
        // it has no matching events — an ordinary empty day, not a commit
        // still in flight.
        #expect(DayRailNavigation.shouldAbandonScroll(
            target: "2026-07-15", window: window("2026-07-10", "2026-07-20")))
    }

    @Test func aPendingScrollWaitsWhileTheExpansionHasNotLandedYet() {
        #expect(!DayRailNavigation.shouldAbandonScroll(
            target: "2026-08-01", window: window("2026-07-10", "2026-07-20")))
    }

    @Test func aPendingScrollIsAbandonedWhenThereIsNoWindowToLandIn() {
        #expect(DayRailNavigation.shouldAbandonScroll(target: "2026-07-15", window: nil))
    }

    // MARK: - stepTargets

    /// A chevron steps to the nearest day that has something to show, not the
    /// adjacent calendar day. With Favourites on, or any search that leaves
    /// gaps, the adjacent day usually has no matches: no section mounts, the
    /// pending scroll gives up, and the anchor never moves. Pressing again
    /// recomputes the identical dead target — the initiative's own wall,
    /// rebuilt inside the control meant to escape it.
    @Test func aStepSkipsDaysWithNothingToShow() {
        let days = ["2026-07-01", "2026-07-05", "2026-07-09"]
        let step = DayRailNavigation.stepTargets(anchor: "2026-07-05", eventDays: days)

        #expect(step.previous == "2026-07-01")
        #expect(step.next == "2026-07-09")
    }

    @Test func aStepFromAnAnchorWithNothingBeyondItReturnsNil() {
        let days = ["2026-07-01", "2026-07-05"]
        let step = DayRailNavigation.stepTargets(anchor: "2026-07-05", eventDays: days)

        #expect(step.previous == "2026-07-01")
        #expect(step.next == nil)
    }

    @Test func aStepWithNoAnchorHasNoTargets() {
        let step = DayRailNavigation.stepTargets(
            anchor: nil, eventDays: ["2026-07-01", "2026-07-05"])

        #expect(step.previous == nil)
        #expect(step.next == nil)
    }

    /// The anchor itself is neither the previous nor the next target, even
    /// though it is in `eventDays`. A step that returns where you already are
    /// is a dead control.
    @Test func theAnchorIsNeverItsOwnStepTarget() {
        let days = ["2026-07-01", "2026-07-05", "2026-07-09"]
        let step = DayRailNavigation.stepTargets(anchor: "2026-07-05", eventDays: days)

        #expect(step.previous != "2026-07-05")
        #expect(step.next != "2026-07-05")
    }

    // MARK: - edgeTargets

    @Test func edgeTargetsNameTheNearestEventDayBeyondEachEdge() {
        let days = ["2026-07-01", "2026-07-05", "2026-07-15", "2026-08-01", "2026-08-10"]
        let edges = DayRailNavigation.edgeTargets(
            eventDays: days, window: window("2026-07-10", "2026-07-20"))

        #expect(edges.earlier == "2026-07-05")
        #expect(edges.later == "2026-08-01")
    }

    @Test func edgeTargetsAreNilWhenTheWindowAlreadyReachesTheEnds() {
        let days = ["2026-07-15"]
        let edges = DayRailNavigation.edgeTargets(
            eventDays: days, window: window("2026-06-27", "2026-08-23"))

        #expect(edges.earlier == nil)
        #expect(edges.later == nil)
    }

    // MARK: - eventDays

    @Test func eventDaysAreSortedUniqueAndInInstitutionTime() throws {
        let events = [
            makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-15 19:00:00"))),
            makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 09:00:00"))),
            makeEvent(id: "c", start: try #require(ChqTime.parse("2026-07-01 09:00:00"))),
        ]

        #expect(DayRailNavigation.eventDays(events) == ["2026-07-01", "2026-07-15"])
    }

    // MARK: - reachableTodayKey

    /// Off-season, today is outside the navigable bounds for roughly ten
    /// months of the year, and `plan` refuses a target outside them. An
    /// unclamped today would render a "Now" button that is visible, enabled,
    /// and does nothing.
    @Test func todayIsReachableOnlyInsideTheNavigableBounds() {
        #expect(DayRailNavigation.reachableTodayKey("2026-07-15", bounds: bounds) == "2026-07-15")
        #expect(DayRailNavigation.reachableTodayKey("2026-02-01", bounds: bounds) == nil)
        #expect(DayRailNavigation.reachableTodayKey(nil, bounds: bounds) == nil)
    }
}
```

`ViewWindow`'s memberwise initialiser is internal to the module — confirm it is
reachable from the test target under `@testable import`. If it is not, build
the fixture windows through `ViewWindow.make` with a `.day`-scoped selection
instead, and say so in a comment.

- [ ] **Step 2: Run them to make sure they fail**

Run the verification command narrowed to
`-only-testing:ChqCalendarTests/DayRailNavigationTests`.
Expected: FAIL to compile — `cannot find 'DayRailNavigation' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendarShared/Domain/DayRailNavigation.swift`:

```swift
import Foundation

/// What the day rail's controls do, expressed once and without a view.
///
/// The Swift half of `frontend/src/app/dayRailNavigation.ts` — same rules,
/// same refusals, same reasons. Where the two platforms must agree, the
/// tests name it; a divergence here is a cross-platform behaviour bug.
///
/// There is deliberately **no** "go to day" action on the model. Tapping a
/// chip decomposes exactly into the window expansion that already exists
/// plus a scroll, and a third action would be a synonym for the two.
nonisolated enum DayRailNavigation {
    /// What a tap resolves to: at most one edge to grow, and the day to
    /// scroll to once it has.
    struct Plan: Equatable, Sendable {
        let expandStart: String?
        let expandEnd: String?
        let scrollTo: String
    }

    /// *Take me to that day.* If it is already inside the window this is a
    /// scroll and nothing more; if it lies past an edge, that edge grows to
    /// include it and then we scroll. The window only ever grows — the scope
    /// button is what shrinks it back — so "widen or move" never arises.
    ///
    /// Returns `nil` for a target outside `bounds`: `ViewWindow.make` would
    /// clamp such a value anyway, but clamping moves the window to an edge
    /// and then scrolls to a day that is not there. Refusing is honest.
    ///
    /// Returns `nil` for a `nil` window too. Expansion cannot rescue a scope
    /// that matches nothing — `ViewWindow.make` returns `nil` out of `base`
    /// before it ever reads the expansion inputs, so a plan that grew both
    /// edges would widen nothing, mount nothing, and leave a pending scroll
    /// waiting on a day that can never appear.
    static func plan(
        target: String, window: ViewWindow?, bounds: ClosedRange<String>
    ) -> Plan? {
        guard bounds.contains(target), let window else { return nil }
        return Plan(
            expandStart: target < window.startDay ? target : nil,
            expandEnd: target > window.endDay ? target : nil,
            scrollTo: target)
    }

    /// Whether a pending scroll target should be given up rather than waited
    /// for.
    ///
    /// A pending target that is never cleared survives every later commit and
    /// hijacks one of them, scrolling the reader to a day they tapped under a
    /// different scope minutes ago. Two cases end the wait: there is no
    /// window to land in, or the window already covers the target and the day
    /// still has no section — an ordinary empty day, not a commit in flight.
    static func shouldAbandonScroll(target: String, window: ViewWindow?) -> Bool {
        guard let window else { return true }
        return target >= window.startDay && target <= window.endDay
    }

    /// The nearest day with events on either side of `anchor`.
    ///
    /// `eventDays` is every day that has an event under the current
    /// **non-date** filters, sorted — so a step always lands somewhere that
    /// will actually render. A raw ±1 calendar day cannot: with Favourites
    /// on, or any search or venue filter that leaves gaps, the adjacent day
    /// usually has no matches, so no section mounts, the pending scroll gives
    /// up, and the anchor never moves.
    static func stepTargets(
        anchor: String?, eventDays: [String]
    ) -> (previous: String?, next: String?) {
        guard let anchor else { return (nil, nil) }
        var previous: String?
        var next: String?
        // Sorted, so the last key below the anchor wins (the walk keeps
        // overwriting `previous`) and the first key above it wins (guarded by
        // the nil check).
        for key in eventDays {
            if key < anchor { previous = key }
            else if key > anchor, next == nil { next = key }
        }
        return (previous, next)
    }

    /// The nearest event day beyond each edge of `window` — what
    /// "show earlier" / auto-expand-forward reach for. Same walk as
    /// `stepTargets`, applied to a window's two edges rather than one day.
    static func edgeTargets(
        eventDays: [String], window: ViewWindow?
    ) -> (earlier: String?, later: String?) {
        guard let window else { return (nil, nil) }
        var earlier: String?
        var later: String?
        for key in eventDays {
            if key < window.startDay { earlier = key }
            else if key > window.endDay, later == nil { later = key }
        }
        return (earlier, later)
    }

    /// Every day carrying at least one of `events`, sorted, each once.
    static func eventDays(_ events: [Event]) -> [String] {
        Set(events.map { ChqTime.dayKey(for: $0.start) }).sorted()
    }

    /// Today's key, but only where navigation can actually reach it.
    ///
    /// `plan` refuses a target outside the navigable bounds, and off-season
    /// today is outside them for roughly ten months of the year — so an
    /// unclamped today renders a "Now" control that is visible, enabled, and
    /// does nothing when pressed. Returning `nil` removes the control
    /// instead, which is the treatment an archived year already gets.
    static func reachableTodayKey(
        _ today: String?, bounds: ClosedRange<String>
    ) -> String? {
        guard let today, bounds.contains(today) else { return nil }
        return today
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the verification command narrowed to
`-only-testing:ChqCalendarTests/DayRailNavigationTests`.
Expected: PASS, 17 tests.

- [ ] **Step 5: Prove two guards by breaking the code**

Change `guard bounds.contains(target)` to `guard true` and re-run:
`aTargetOutsideTheNavigableBoundsIsRefused` must fail. Restore it.

Change `else if key > anchor, next == nil` to `else if key > anchor` and
re-run: `aStepSkipsDaysWithNothingToShow` must fail (it would return the
*last* later day rather than the nearest). Restore it.

If either falsification passes, the test is not testing what it claims —
fix the test before continuing.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DayRailNavigation.swift \
        ios/ChqCalendarTests/DayRailNavigationTests.swift
git commit -m "feat(ios): DayRailNavigation — the rail's rules, without a view

The Swift half of the web's dayRailNavigation.ts: what a chip tap does,
where a chevron steps, when a pending scroll is abandoned, and which taps
are refused outright. Same rules and same refusals as the shipped web rail,
including the two that exist because announcing a destination and then
doing nothing is worse than offering nothing.

A step targets the nearest day that HAS events under the non-date filters,
never the adjacent calendar day — the correction phase 2 learned and the
current expandWindowEnd still gets wrong (fixed in a later task)."
```

---

### Task 5: What navigation can reach — `navMatching`

The rail spans the whole navigable season, not the current window. Counting
chips from `dayGroups` would therefore mark every day outside the current scope
"no events" and turn the rail into a readout of the filter it exists to
navigate past. What it needs instead is the same pipeline re-run with the date
stage wide open — web's `navMatchingEvents` (`page.tsx:153-164`).

That is a full extra `EventFilter.apply` pass, so it is **cached**, not
computed on access. `dayGroups` is deliberately uncached and re-runs six stages
over ~1,637 events every time it is read; a second uncached derivation read by
58 chips per render would multiply that.

**Files:**
- Modify: `ios/ChqCalendar/App/AppModel.swift:39,60,67,102,111,1266`
- Test: `ios/ChqCalendarTests/NavMatchingTests.swift`

**Interfaces:**
- Produces:
  ```swift
  struct NavMatching: Equatable, Sendable {
      let eventDays: [String]
      let countsByDay: [String: Int]
      let bounds: ClosedRange<String>
  }
  AppModel.navMatching: NavMatching?     // nil until a snapshot exists
  AppModel.navigableBounds: ClosedRange<String>
  AppModel.currentWindow: ViewWindow?
  ```
- Consumes: `EventFilter.apply`, `ViewWindow.navigableBounds`,
  `ViewWindow.make`, `DayWindow.bounds`, `DayRailNavigation.eventDays`.

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/NavMatchingTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// `navMatching` is what the day rail is drawn from: every day the *non-date*
/// filters admit, anywhere navigation can reach. Getting its independence
/// from the date scope wrong is silent — the rail still renders, it just
/// reports the filter it exists to escape.
@MainActor
struct NavMatchingTests {
    private func makeDefaults() -> UserDefaults { UserDefaults(suiteName: UUID().uuidString)! }

    /// Events on three separate days, one of which is well outside a `.next`
    /// window, so "independent of the scope" is actually exercised.
    private func makeModel(defaults: UserDefaults) throws -> AppModel {
        let now = try #require(ChqTime.parse("2026-07-15 12:00:00"))
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() }),
            now: { now })
        let events: [Event] = [
            makeEvent(id: "a1", start: try #require(ChqTime.parse("2026-07-15 13:00:00")),
                      title: "Opera Talk", location: "Amphitheater"),
            makeEvent(id: "a2", start: try #require(ChqTime.parse("2026-07-15 19:00:00")),
                      title: "Evening Lecture", location: "Amphitheater"),
            makeEvent(id: "b1", start: try #require(ChqTime.parse("2026-07-20 09:00:00")),
                      title: "Morning Walk", location: "Norton Hall"),
            makeEvent(id: "c1", start: try #require(ChqTime.parse("2026-08-20 09:00:00")),
                      title: "Closing Concert", location: "Amphitheater"),
        ]
        model.snapshot = CalendarSnapshot(
            year: 2026, events: events, articleLinks: [:], programLinks: [:],
            themes: [], fetchedAt: now)
        return model
    }

    @Test func countsEveryDayWithEventsRegardlessOfTheDateScope() throws {
        let model = try makeModel(defaults: makeDefaults())
        model.selectScope(.today)

        let nav = try #require(model.navMatching)
        #expect(nav.eventDays == ["2026-07-15", "2026-07-20", "2026-08-20"])
        #expect(nav.countsByDay["2026-07-15"] == 2)
        #expect(nav.countsByDay["2026-08-20"] == 1)
    }

    /// The non-date filters DO constrain it: search, venue, category, weeks
    /// and favourites all say where navigation is allowed to go. Only the
    /// scope is ignored, because escaping the scope's own edge is the point.
    @Test func theNonDateFiltersStillNarrowIt() throws {
        let model = try makeModel(defaults: makeDefaults())
        model.toggleLocation("Norton Hall")

        let nav = try #require(model.navMatching)
        #expect(nav.eventDays == ["2026-07-20"])
    }

    @Test func windowExpansionDoesNotChangeIt() throws {
        let model = try makeModel(defaults: makeDefaults())
        let before = try #require(model.navMatching)

        model.goToDay("2026-08-20")

        #expect(model.navMatching == before)
    }

    /// Two derivations of the same fact must not drift: the cached array and
    /// the pure rule that Task 4 tests in isolation.
    @Test func theCachedDayListAgreesWithThePureRule() throws {
        let model = try makeModel(defaults: makeDefaults())
        let snapshot = try #require(model.snapshot)
        let nav = try #require(model.navMatching)

        #expect(nav.eventDays == DayRailNavigation.eventDays(snapshot.events))
    }

    @Test func boundsCoverEveryEventDayIncludingOnesOutsideTheSeason() throws {
        let model = try makeModel(defaults: makeDefaults())
        let nav = try #require(model.navMatching)

        #expect(nav.bounds.contains("2026-07-15"))
        #expect(nav.bounds.contains("2026-08-20"))
    }

    @Test func thereIsNoNavMatchingBeforeASnapshotLoads() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        #expect(model.navMatching == nil)
    }
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run the verification command narrowed to
`-only-testing:ChqCalendarTests/NavMatchingTests`.
Expected: FAIL to compile — `value of type 'AppModel' has no member 'navMatching'`.

- [ ] **Step 3: Add the type and the cache**

In `ios/ChqCalendar/App/AppModel.swift`, above the `AppModel` declaration:

```swift
/// Everything the **non-date** filters admit, anywhere navigation can reach —
/// the day rail's source of truth.
///
/// The rail spans the navigable bounds, not the current window, so counting
/// from `dayGroups` would mark every day outside the current scope "no events"
/// and make the rail a readout of the filter it exists to navigate past.
///
/// Cached rather than computed on access: building it is a full
/// `EventFilter.apply` pass, and the rail reads it once per chip.
nonisolated struct NavMatching: Equatable, Sendable {
    /// Days with at least one matching event, sorted. Navigation steps
    /// through exactly this set, so a step always lands somewhere that will
    /// render.
    let eventDays: [String]
    /// How many matching events each of `eventDays` holds. A day absent from
    /// this map has none.
    let countsByDay: [String: Int]
    /// The outer limit of everything navigation can reach.
    let bounds: ClosedRange<String>
}
```

Inside `AppModel`, beside `facetCounts`:

```swift
    /// See `NavMatching`. `nil` until a snapshot exists — there is no rail to
    /// draw before then.
    private(set) var navMatching: NavMatching?
```

- [ ] **Step 4: Build it alongside the facet counts**

Rename `rebuildFacetCounts()` to `rebuildDerivedCounts()` at all five call
sites (`:39`, `:60`, `:67`, `:102`, `:111`) and at its definition (`:1266`),
and have it drive both derivations:

```swift
    /// Recomputes everything derived from (snapshot × filter × favorites ×
    /// year): the facet counts behind the filter sheet, and the navigation
    /// data behind the day rail.
    ///
    /// Both are rebuilt only when an input actually changes — never on
    /// render. Together they are three `EventFilter.apply` passes over the
    /// snapshot, which is affordable at that cadence and would not be
    /// per-render.
    private func rebuildDerivedCounts() {
        rebuildFacetCounts()
        rebuildNavMatching()
    }

    /// The filter pipeline re-run with the date stage wide open.
    ///
    /// `.all` rather than "skip the stage": there is one date stage and it is
    /// driven by the scope, so opening it is expressed the same way the user
    /// would. `selectedDayKey` and both window keys are cleared with it —
    /// leaving them set would let a `.day` selection or a previous expansion
    /// narrow the very set that decides how far navigation may go.
    ///
    /// `selectedWeeks` deliberately stays. Weeks are a filter the reader
    /// chose, not a scope edge to escape, and the web's `nonDateFilterOpts`
    /// keeps them for the same reason.
    private func rebuildNavMatching() {
        guard let snapshot else {
            navMatching = nil
            return
        }

        var open = filter
        open.dateScope = .all
        open.selectedDayKey = nil
        open.windowStartDayKey = nil
        open.windowEndDayKey = nil

        let matching = EventFilter.apply(
            open, to: snapshot.events, favorites: favorites,
            now: now(), year: selectedYear, isCurrentYear: isCurrentYear)

        var counts: [String: Int] = [:]
        for event in matching {
            counts[ChqTime.dayKey(for: event.start), default: 0] += 1
        }

        navMatching = NavMatching(
            eventDays: counts.keys.sorted(),
            countsByDay: counts,
            bounds: ViewWindow.navigableBounds(
                year: selectedYear, events: snapshot.events, starredDays: []))
    }
```

- [ ] **Step 5: Add the two derived accessors**

```swift
    /// Everything navigation can reach. Falls back to the season-only range
    /// before a snapshot exists, so a control asking "is this day reachable"
    /// never has to handle a missing answer.
    var navigableBounds: ClosedRange<String> {
        navMatching?.bounds ?? DayWindow.bounds(year: selectedYear, starredDays: [])
    }

    /// The window the list is currently showing, or `nil` when the scope
    /// resolves to no window at all. The rail's controls all key off this:
    /// a nil window refuses every tap, because expansion cannot rescue it.
    var currentWindow: ViewWindow? {
        guard let snapshot else { return nil }
        return ViewWindow.make(
            selection: filter, events: snapshot.events, now: now(),
            year: selectedYear, isCurrentYear: isCurrentYear, bounds: navigableBounds)
    }
```

- [ ] **Step 6: Run the tests**

Run the verification command.
Expected: `NavMatchingTests` fails only on `model.goToDay` — that arrives in
Task 6. Comment out `windowExpansionDoesNotChangeIt` with a `// Task 6` note
and confirm the other six pass, then restore it at the end of Task 6.
Everything else in the suite must still pass; the rename touches five call
sites and a missed one is a compile error, not a silent bug.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/App/AppModel.swift ios/ChqCalendarTests/NavMatchingTests.swift
git commit -m "feat(ios): cache what navigation can reach

The rail spans the navigable season, not the current window, so its chip
counts cannot come from dayGroups: outside the current scope every day would
read 'no events' and the rail would report the filter it exists to navigate
past. navMatching re-runs the pipeline with the date stage wide open, and is
cached beside facetCounts because dayGroups is deliberately uncached and 58
chips per render would multiply it."
```

---

### Task 6: The navigation actions

Four actions on `AppModel`, all of which decompose into the window fields that
already exist. **`expandWindowEnd()` changes behaviour here** — see the
prominent note below, which needs a human decision if you disagree with it.

The spec's `AppModel` list also names `stepDay` and `stepWeek`. Neither is
added: a step is `DayRailNavigation.stepTargets` followed by `goToDay`, which
the rail computes from data it already holds (exactly as `page.tsx:365` does),
and `stepWeek` is out of scope per this plan's Scope section.

> **⚠️ Behaviour change requiring sign-off.** `expandWindowEnd()` today widens
> by one *calendar* day (`AppModel.swift:1241-1253`). This task changes it to
> the next day that **has events under the non-date filters**. The reason is
> the one Task 4's `stepTargets` documents: with Favourites on, or any search
> that leaves gaps, the adjacent calendar day usually has no matches, so
> nothing new mounts and the control reads as dead. The web rail ships the
> corrected version.
>
> **This breaks an existing test.**
> `AppModelTests.expandWindowEndSetsWindowEndDayKeyOneDayAtATime` (`:1399`)
> asserts `2026-08-04` then `2026-08-05` against a fixture
> (`makeInSeasonModelWithSeedEvents`, `:988`) whose fifty events all sit on
> `2026-08-03`. Under the corrected rule there is no later event day, so both
> calls are correctly no-ops. Per `CLAUDE.md` the test is not to be edited to
> make the code pass — so the fixture is extended with events on `2026-08-06`
> and `2026-08-09`, and the test asserts the new rule *and its point*: that it
> skips `08-04` and `08-05`, which have nothing to show. If the reviewer wants
> the old semantics kept, stop and raise it rather than proceeding.

**Files:**
- Modify: `ios/ChqCalendar/App/AppModel.swift:1241-1253`
- Test: `ios/ChqCalendarTests/AppModelTests.swift:988-1001, 1397-1424`

**Interfaces:**
- Produces: `AppModel.goToDay(_:) -> Bool` (`@discardableResult`),
  `AppModel.expandWindowStart()`, `AppModel.expandWindowEnd()`,
  `AppModel.resetToNow()`.
- Consumes: `DayRailNavigation.plan`, `DayRailNavigation.edgeTargets`,
  `AppModel.currentWindow`, `AppModel.navigableBounds`, `AppModel.navMatching`.

- [ ] **Step 1: Extend the shared fixture**

In `ios/ChqCalendarTests/AppModelTests.swift`, `makeInSeasonModelWithSeedEvents`
(`:988`) gains two later days. Update its doc comment to say why:

```swift
    /// Same fixture as `makeInSeasonModel`, plus a snapshot of 50 events
    /// packed into the hour before `now` — enough to satisfy the `.next`
    /// scope's `adaptiveEndDate` `minCount` on day 0 itself, so its base
    /// window settles at `2026-08-03` rather than the empty-snapshot
    /// fallback (the 90-day cap, which sits past the season's `bounds` and
    /// would make `expandWindowEnd()` a no-op — see `expandWindowEnd`'s test
    /// coverage below for that edge case in isolation).
    ///
    /// Plus one event each on `2026-08-06` and `2026-08-09`, with `08-04`,
    /// `08-05`, `08-07` and `08-08` deliberately empty. `expandWindowEnd()`
    /// steps to the next day that HAS events, so a fixture with no later
    /// event days at all could not tell a working implementation from a
    /// no-op one.
    private func makeInSeasonModelWithSeedEvents(defaults: UserDefaults) throws -> AppModel {
        let model = try makeInSeasonModel(defaults: defaults)
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let from = now.addingTimeInterval(-3600)
        var events: [Event] = try (0..<50).map { i in
            makeEvent(
                id: "seed\(i)",
                start: try #require(ChqTime.calendar.date(byAdding: .minute, value: i, to: from)))
        }
        events.append(makeEvent(
            id: "later-06", start: try #require(ChqTime.parse("2026-08-06 10:00:00"))))
        events.append(makeEvent(
            id: "later-09", start: try #require(ChqTime.parse("2026-08-09 10:00:00"))))
        model.snapshot = CalendarSnapshot(
            year: 2026, events: events, articleLinks: [:], programLinks: [:],
            themes: [], fetchedAt: now)
        return model
    }
```

- [ ] **Step 2: Write the failing tests**

Replace `expandWindowEndSetsWindowEndDayKeyOneDayAtATime` (`:1399-1407`) and
append the rest, in the same `// MARK: - expandWindowEnd` section:

```swift
    /// The correction phase 2 learned, applied to the model: a step lands on
    /// a day that will actually render. `2026-08-04` and `2026-08-05` are
    /// empty in this fixture and are skipped — widening onto them would move
    /// the edge, add nothing to the list, and read as a broken control.
    @Test func expandWindowEndStepsToTheNextDayThatHasEvents() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(model.filter.windowEndDayKey == nil)
        model.expandWindowEnd()
        #expect(model.filter.windowEndDayKey == "2026-08-06")
        model.expandWindowEnd()
        #expect(model.filter.windowEndDayKey == "2026-08-09")
    }

    @Test func expandWindowEndStopsWhenNothingIsLeftBeyondTheEdge() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.expandWindowEnd()
        model.expandWindowEnd()

        model.expandWindowEnd()

        #expect(model.filter.windowEndDayKey == "2026-08-09")
    }

    /// The non-date filters constrain where expansion can go, because they
    /// constrain what could possibly render there.
    @Test func expandWindowEndRespectsTheOtherFilters() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.filter.searchText = "nothing matches this"

        model.expandWindowEnd()

        #expect(model.filter.windowEndDayKey == nil)
    }

    // MARK: - expandWindowStart

    @Test func expandWindowStartStepsBackToTheNearestEarlierEventDay() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.browseDay("2026-08-06")

        model.expandWindowStart()

        #expect(model.filter.windowStartDayKey == "2026-08-03")
    }

    @Test func expandWindowStartIsANoOpAtTheEarliestEventDay() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.browseDay("2026-08-03")

        model.expandWindowStart()

        #expect(model.filter.windowStartDayKey == nil)
    }

    // MARK: - goToDay

    @Test func goToDayInsideTheWindowChangesNoState() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        let before = model.filter

        #expect(model.goToDay("2026-08-03"))

        #expect(model.filter == before)
    }

    @Test func goToDayBeyondTheEndGrowsTheEndEdgeToIt() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(model.goToDay("2026-08-09"))

        #expect(model.filter.windowEndDayKey == "2026-08-09")
        #expect(model.filter.windowStartDayKey == nil)
    }

    /// An empty day is a legal target at the *rule* layer even though Task 9
    /// disables its chip: the rail decides what to offer, `goToDay` decides
    /// what is representable, and phase 4's Siri routing will name days the
    /// rail does not offer. Keeping the rule permissive and the affordance
    /// strict is deliberate — the reverse (a rule that refuses) would make
    /// "go to tomorrow" fail silently on a quiet Tuesday.
    @Test func goToDayAcceptsAnEmptyDayEvenThoughTheRailDisablesItsChip() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(model.goToDay("2026-08-05"))

        #expect(model.filter.windowEndDayKey == "2026-08-05")
    }

    @Test func goToDayOutsideTheNavigableBoundsIsRefused() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(!model.goToDay("2027-01-01"))

        #expect(model.filter.windowEndDayKey == nil)
        #expect(model.filter.windowStartDayKey == nil)
    }

    // MARK: - resetToNow

    /// `selectScope(.next)` cannot do this job: it early-returns when the
    /// scope is already `.next`, leaving whatever expansion the reader
    /// accumulated in place — which is exactly the state ⟳ Now exists to
    /// undo.
    @Test func resetToNowClearsExpansionEvenWhenAlreadyOnNow() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.expandWindowEnd()
        #expect(model.filter.windowEndDayKey == "2026-08-06")

        model.resetToNow()

        #expect(model.filter.dateScope == .next)
        #expect(model.filter.windowEndDayKey == nil)
        #expect(model.filter.windowStartDayKey == nil)
    }

    @Test func resetToNowClearsWeeksAndAnyBrowsedDay() throws {
        let defaults = makeDefaults()
        let model = try makeInSeasonModelWithSeedEvents(defaults: defaults)
        model.browseDay("2026-08-09")
        model.setWeekSelection([3])

        model.resetToNow()

        #expect(model.filter.dateScope == .next)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.selectedDayKey == nil)
        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()
        #expect(reloaded?.dateScope == .next)
    }
```

- [ ] **Step 3: Run them to make sure they fail**

Run the verification command narrowed to
`-only-testing:ChqCalendarTests/AppModelTests`.
Expected: FAIL — `goToDay`, `expandWindowStart` and `resetToNow` do not exist,
and `expandWindowEndStepsToTheNextDayThatHasEvents` gets `2026-08-04`.

- [ ] **Step 4: Replace `expandWindowEnd` and add the other three**

In `ios/ChqCalendar/App/AppModel.swift`, replace the existing
`expandWindowEnd()` (`:1241-1253`) with:

```swift
    /// Widens the window backward to the nearest earlier day that has
    /// events under the current non-date filters.
    func expandWindowStart() {
        guard let earlier = DayRailNavigation.edgeTargets(
            eventDays: navMatching?.eventDays ?? [], window: currentWindow).earlier
        else { return }
        filter.windowStartDayKey = earlier
    }

    /// Widens the window forward to the nearest later day that has events
    /// under the current non-date filters.
    ///
    /// **Not the next calendar day**, which is what this did before phase 3b.
    /// With Favourites on, or any search or venue filter that leaves gaps,
    /// the adjacent day usually has no matches: the edge moves, nothing new
    /// mounts, and the control reads as dead. Pressing again recomputes the
    /// same dead target. The web rail ships the corrected rule and
    /// `DayRailNavigation.stepTargets` documents why.
    func expandWindowEnd() {
        guard let later = DayRailNavigation.edgeTargets(
            eventDays: navMatching?.eventDays ?? [], window: currentWindow).later
        else { return }
        filter.windowEndDayKey = later
    }

    /// *Take me to that day.* Grows at most one edge of the window to include
    /// `dayKey`, then leaves the scrolling to the view.
    ///
    /// Returns whether the target was accepted, so a caller can decide not to
    /// queue a scroll for a day that will never arrive. A target outside the
    /// navigable bounds, or any target at all while the scope resolves to no
    /// window, is refused rather than clamped: clamping would move the window
    /// to an edge and then scroll to a day that is not there.
    ///
    /// Unlike an empty *step*, an empty *day* is a legal target. The reader
    /// asked for that day by name and the rail's own label already told them
    /// it has nothing; landing there is honest, and it is how they get to the
    /// days on either side.
    ///
    /// The window is assembled and assigned once. `filter`'s `didSet` rebuilds
    /// every derived count, so two assignments would run the pipeline twice
    /// for one tap.
    @discardableResult
    func goToDay(_ dayKey: String) -> Bool {
        guard let plan = DayRailNavigation.plan(
            target: dayKey, window: currentWindow, bounds: navigableBounds)
        else { return false }

        var next = filter
        if let start = plan.expandStart { next.windowStartDayKey = start }
        if let end = plan.expandEnd { next.windowEndDayKey = end }
        filter = next
        return true
    }

    /// Back to Now, from wherever navigation has wandered to.
    ///
    /// Deliberately not `selectScope(.next)`: that early-returns when the
    /// scope is already `.next` with no weeks, which leaves every accumulated
    /// expansion in place — precisely the state this control exists to undo.
    func resetToNow() {
        filter.dateScope = .next
        filter.selectedWeeks = []
        clearScopeLocalDateState()
        persistFilter()
    }
```

- [ ] **Step 5: Restore the deferred test**

Un-comment `NavMatchingTests.windowExpansionDoesNotChangeIt` from Task 5 Step 6.

- [ ] **Step 6: Run the whole suite**

Run the verification command.
Expected: PASS. `expandWindowEndIsANoOpWhenTheBaseWindowAlreadyExceedsBounds`
(`:1417`) should still pass unchanged — with no snapshot there are no event
days, so `edgeTargets` yields nothing and the method is a no-op for a *second*
reason now. Update its doc comment to say both, so a later reader does not
think the bounds clamp is still what is being exercised.

- [ ] **Step 7: Prove the correction by breaking it**

Change `expandWindowEnd` back to `ChqTime.day(window.endDay, offsetBy: 1)` and
re-run: `expandWindowEndStepsToTheNextDayThatHasEvents` must fail on
`2026-08-04`. Restore.

- [ ] **Step 8: Commit**

```bash
git add ios/ChqCalendar/App/AppModel.swift ios/ChqCalendarTests/AppModelTests.swift
git commit -m "feat(ios): goToDay, backward expansion, and a corrected forward step

expandWindowEnd widened by one calendar day, which with Favourites on or any
search that leaves gaps moves the edge without mounting anything — a control
that reads as dead and recomputes the same dead target when pressed again.
It now steps to the next day that has events under the non-date filters,
matching the shipped web rail.

goToDay grows at most one edge and refuses (never clamps) a target outside
the navigable bounds. resetToNow exists rather than reusing selectScope(.next)
because that early-returns when the scope is already Now, leaving the
expansion it is meant to undo."
```

---

### Task 7: `DayRailView` — extract My Day's strip

My Day's chip strip is already the rail, minus a screen. This task lifts it
into `Features/Shared` with accessory slots at each end, and leaves My Day
rendering identically — the chevrons it passes in are the same
`MyDayExpandControl`s doing the same job.

Nothing about the Events tab changes here. Keeping the extraction separate from
the mounting is what makes the diff for each reviewable: if My Day regresses,
it regressed in this commit.

**Files:**
- Create: `ios/ChqCalendar/Features/Shared/DayRailView.swift`
- Modify: `ios/ChqCalendar/Features/MyDay/MyDayView.swift:167-226, 484-537`

**Interfaces:**
- Produces:
  ```swift
  struct DayRailView<Leading: View, Trailing: View>: View {
      init(entries: [MyDayChipContent.Entry],
           selectedDay: String?,
           accessibilityLabel: String,
           onSelect: @escaping (String) -> Void,
           @ViewBuilder leading: () -> Leading,
           @ViewBuilder trailing: () -> Trailing)
      func scrollTarget(_ day: String?) -> Self   // re-anchors on change
  }
  struct DayChip: View            // was MyDayChip, moved verbatim
  ```
- Consumes: `MyDayChipContent.Entry`.

- [ ] **Step 1: Move the chip view**

Create `ios/ChqCalendar/Features/Shared/DayRailView.swift` and move
`MyDayChip` (`MyDayView.swift:484-537`) into it **verbatim**, renamed to
`DayChip` and made internal rather than `private`. Keep its whole doc comment:
the four-signal encoding it describes is exactly as load-bearing on the Events
rail as on My Day. Apply Task 3's `countLine` change if it has not landed
already.

Add an accessibility identifier so UI tests can find one chip by day:

```swift
        .accessibilityLabel(content.accessibilityLabel)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityIdentifier("day-chip-\(dayKey)")
```

which needs `let dayKey: String` on `DayChip`.

- [ ] **Step 2: Write the strip**

In the same file:

```swift
import SwiftUI

/// A horizontal strip of day chips with an optional control at each end.
///
/// Extracted from My Day (#192), which had it first, so the Events tab's day
/// rail is the same surface rather than a lookalike. The two screens differ
/// only in what the chips count (`DayChipCountStyle`) and what sits at the
/// ends: My Day's chevrons reveal the rest of the season, the Events rail's
/// step one day at a time. Both, not one replacing the other — "go far" and
/// "go one" are different questions.
///
/// **Scroll-to-selection lives here**, because getting it wrong is invisible
/// until a real device: expanding an end prepends or appends chips, which
/// shifts the content under the reader, and re-anchoring on the same day is
/// what holds the selection still so that revealing the past never moves you.
struct DayRailView<Leading: View, Trailing: View>: View {
    let entries: [MyDayChipContent.Entry]
    let selectedDay: String?
    /// Names the strip as a whole for VoiceOver. A group of links or buttons
    /// needs a group role and a label; a bare container's label is dropped
    /// (the lesson from the web header menu, PR #228/#219).
    let accessibilityLabel: String
    let onSelect: (String) -> Void
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing

    /// Extra values that must re-anchor the strip when they change — the
    /// expand toggles on My Day. Passed as an opaque list rather than the
    /// booleans themselves so the Events rail, which has no such toggles,
    /// does not have to invent them.
    var reanchorOn: [AnyHashable] = []

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    leading()
                    ForEach(entries) { entry in
                        DayChip(
                            dayKey: entry.day,
                            content: entry.content,
                            isSelected: entry.day == selectedDay
                        ) {
                            onSelect(entry.day)
                        }
                        .id(entry.day)
                    }
                    trailing()
                }
                .padding(.horizontal)
            }
            .onAppear { scroll(proxy, to: selectedDay) }
            .onChange(of: selectedDay) { _, day in scroll(proxy, to: day) }
            .onChange(of: reanchorOn) { _, _ in scroll(proxy, to: selectedDay) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityIdentifier("day-rail")
    }

    private func scroll(_ proxy: ScrollViewProxy, to day: String?) {
        guard let day else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(day, anchor: .center)
        }
    }
}
```

- [ ] **Step 3: Rewrite My Day's `dayChipsRow` over it**

`MyDayView.swift:167-220` becomes:

```swift
    private func dayChipsRow(
        window: DayWindow, selectedDay: String, todayKey: String, starredCounts: [String: Int]
    ) -> some View {
        DayRailView(
            entries: MyDayChipContent.makeAll(
                days: window.days,
                todayKey: todayKey,
                counts: starredCounts,
                style: .starred,
                includingYear: !model.isCurrentYear),
            selectedDay: selectedDay,
            accessibilityLabel: "Days",
            onSelect: { self.selectedDay = $0 },
            leading: {
                if window.canExpandEarlier {
                    MyDayExpandControl(
                        direction: .earlier,
                        isExpanded: showsEarlier,
                        hiddenCount: window.hiddenEarlierCount
                    ) {
                        showsEarlier.toggle()
                    }
                }
            },
            trailing: {
                if window.canExpandLater {
                    MyDayExpandControl(
                        direction: .later,
                        isExpanded: showsLater,
                        hiddenCount: window.hiddenLaterCount
                    ) {
                        showsLater.toggle()
                    }
                }
            })
        // Expanding an end prepends or appends chips, which shifts the
        // content under the user. Re-anchoring on the same day holds the
        // selection still, so revealing the past never moves you.
        .reanchoring(on: [showsEarlier, showsLater])
    }
```

with a tiny modifier beside `DayRailView` so `reanchorOn` stays a `let`-shaped
API at the call site:

```swift
extension DayRailView {
    func reanchoring(on values: [AnyHashable]) -> Self {
        var copy = self
        copy.reanchorOn = values
        return copy
    }
}
```

Delete `MyDayChip` and the old `scroll(_:to:)` from `MyDayView.swift`.

- [ ] **Step 4: Run the suite**

Run the verification command.
Expected: PASS, no test changes. `MyDayChipContentTests` and `MyDayModelTests`
cover the labelling and the window; the view extraction is behaviour-preserving
by construction.

- [ ] **Step 5: Confirm My Day by eye**

```bash
xcrun simctl launch "$SIMULATOR_UDID" org.chqcal.app \
  -uitest-fixture -uitest-freeze-now "2026-07-15 10:00:00" -uitest-tab my-day
sleep 3
xcrun simctl io "$SIMULATOR_UDID" screenshot /tmp/chq-3b-myday.png
```

Compare against `docs/app-store/screenshots/review/` for the My Day shot.
Expected: identical layout — chip widths, spacing, the chevrons at each end,
the selected chip centred. This is a view extraction; anything visibly
different is a regression, not an improvement.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/Features/Shared/DayRailView.swift \
        ios/ChqCalendar/Features/MyDay/MyDayView.swift
git commit -m "refactor(ios): extract My Day's chip strip as DayRailView

My Day had the rail first; the Events tab should get the same surface, not a
lookalike. The strip moves to Features/Shared with a @ViewBuilder slot at
each end, so My Day keeps its expand-to-season-edge chevrons ('go far') and
the Events rail can add its own one-day steps ('go one').

Behaviour-preserving: no test changed, and the My Day screenshot is
unchanged."
```

---

### Task 8: Mount the rail on the Events tab

The rail goes above the list via `.safeAreaInset(edge: .top)` — the mirror of
how `filterPillBar` already floats at the bottom, and the reason there is no
iOS equivalent of 3a's sticky-containing-block trap: a `safeAreaInset` bar is
not inside the scroll view at all.

This task also deletes the "Show next day" button and replaces it with the
auto-expand trigger, and gives day sections the `.id` that Task 9's scrolling
needs.

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift:44-50, 165-192`
- Create: `ios/ChqCalendarUITests/DayRailUITests.swift`

**Interfaces:**
- Produces: a rail whose container carries `accessibilityIdentifier("day-rail")`
  and whose chips carry `day-chip-<yyyy-MM-dd>`; day sections carry
  `.id(day.dayKey)`.
- Consumes: `AppModel.navMatching`, `AppModel.expandWindowEnd()`,
  `MyDayChipContent.makeAll`, `DayRailView`.

- [ ] **Step 1: Write the failing UI test**

Create `ios/ChqCalendarUITests/DayRailUITests.swift`:

```swift
import XCTest

/// The seams. Every assertion here is one that a green unit suite cannot
/// make: phase 3a shipped a rail past eleven clean task reviews that was not
/// pinned, dragged the page on every tap, and landed a thousand points short
/// of a distant target. All three needed a running app to see.
final class DayRailUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Seam 1: the rail is chrome, not content. If it scrolls away, the
    /// reader loses the only control that gets them back — which is the
    /// filter-access bug this initiative already fixed once on the web.
    func testTheRailStaysPutWhileTheListScrolls() {
        let app = launchFixtureApp()
        let rail = app.otherElements["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        let before = rail.frame.origin.y
        app.swipeUp(velocity: .fast)
        app.swipeUp(velocity: .fast)

        XCTAssertEqual(
            rail.frame.origin.y, before, accuracy: 1,
            "The rail moved with the list — check that it is mounted via .safeAreaInset on `content`, not inside the List")
    }

    /// The rail spans the navigable season, not the current window: a chip
    /// for a day far outside a `.next` window must exist, or the rail is a
    /// readout of the filter it exists to navigate past.
    func testTheRailSpansTheWholeSeasonNotTheCurrentWindow() {
        let app = launchFixtureApp(now: "2026-07-15 10:00:00")
        XCTAssertTrue(app.otherElements["day-rail"].waitForExistence(timeout: 20))

        XCTAssertTrue(app.buttons["day-chip-2026-06-27"].exists)
        XCTAssertTrue(app.buttons["day-chip-2026-08-23"].exists)
    }
}
```

`app.buttons[...]` assumes a chip is exposed as a button. If the chips land in
`otherElements` instead — `.buttonStyle(.plain)` sometimes does that — adjust
the query and note it in a comment rather than fighting the accessibility tree.
A chip must remain a real `Button`; do not "fix" a query by turning it into a
tap-gesture `View`.

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination "id=$SIMULATOR_UDID" -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO -only-testing:ChqCalendarUITests/DayRailUITests
```

Expected: FAIL — no element `day-rail` exists.

- [ ] **Step 3: Build the rail on the Events tab**

In `ios/ChqCalendar/Features/Calendar/EventListView.swift`, add a state field
for the highlighted day (Task 10 makes it follow scroll; for now it follows the
window's start so the rail has something to centre on):

```swift
    /// Which day the rail highlights. View state: derived from what is on
    /// screen, never persisted, and never part of the filter.
    @State private var anchorDay: String?
```

Add the rail beside the existing bottom inset in `body`:

```swift
            .safeAreaInset(edge: .top) {
                if model.snapshot != nil, let nav = model.navMatching {
                    dayRail(nav)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.snapshot != nil {
                    filterPillBar
                }
            }
```

and the builder itself:

```swift
    /// The day rail: every day navigation can reach, with how many events
    /// each holds under the current non-date filters.
    ///
    /// Mounted on `content` via `.safeAreaInset(edge: .top)` — the mirror of
    /// `filterPillBar` at the bottom — so it is chrome rather than content.
    /// A `safeAreaInset` bar contributes its height to the scroll view's safe
    /// area exactly as a toolbar would, so the list insets its own content
    /// and its scroll indicator to clear it without any margin of ours.
    ///
    /// The span is `navigableBounds`, deliberately independent of the current
    /// scope: in `Today` it still shows the week around you, because the rail
    /// is a navigation surface, not a filter readout.
    private func dayRail(_ nav: NavMatching) -> some View {
        DayRailView(
            entries: MyDayChipContent.makeAll(
                days: ChqTime.dayKeys(from: nav.bounds.lowerBound, through: nav.bounds.upperBound),
                todayKey: ChqTime.dayKey(for: model.now()),
                counts: nav.countsByDay,
                style: .events,
                includingYear: !model.isCurrentYear),
            selectedDay: anchorDay,
            accessibilityLabel: "Days in the season",
            onSelect: { _ in },   // Task 9
            leading: { EmptyView() },
            trailing: { EmptyView() })
        .background(.bar)
    }
```

- [ ] **Step 4: Give day sections an identity, and delete "Show next day"**

In `list(days:)`, the `ForEach` gains `.id` and the auto-expand trigger, and
the trailing `Button("Show next day")` block (`:180-192`) — together with its
`EffectiveScope.resolve` comment — is deleted:

```swift
            ForEach(days) { day in
                Section {
                    ForEach(day.events) { event in
                        row(for: event)
                            .onAppear {
                                autoExpandIfAtTheEnd(day: day, event: event, days: days)
                            }
                    }
                } header: {
                    #if DEBUG
                    dayHeader(for: day, uiTestThemeTarget: uiTestThemeTarget)
                    #else
                    dayHeader(for: day)
                    #endif
                }
                .id(day.id)
            }
```

and, beside it:

```swift
    /// Auto-expand forward, replacing the "Show next day" button.
    ///
    /// Fires when the final row of the final day appears. `autoExpandedThrough`
    /// is what stops it cascading: expansion appends a new final day, whose
    /// final row appears immediately, which would expand again — walking to
    /// the end of the season in one gesture. Recording the day we expanded
    /// *from* allows exactly one expansion per newly-reached last day, which
    /// is the same cadence the button had, minus the tap.
    ///
    /// Forward only. Backward stays explicit (the ⟨ chevron in Task 11): the
    /// reader scrolling down has asked for more; the reader arriving at the
    /// top has not asked for the past.
    private func autoExpandIfAtTheEnd(day: DayGroup, event: Event, days: [DayGroup]) {
        guard day.id == days.last?.id,
              event.id == day.events.last?.id,
              autoExpandedThrough != day.id
        else { return }
        autoExpandedThrough = day.id
        model.expandWindowEnd()
    }
```

with `@State private var autoExpandedThrough: String?` beside `anchorDay`.

- [ ] **Step 5: Run the UI tests**

Run the Step 2 command.
Expected: PASS, 2 tests.

- [ ] **Step 6: Prove the pinning guard by breaking it**

Move the rail from `.safeAreaInset(edge: .top)` to the first row inside the
`List` and re-run: `testTheRailStaysPutWhileTheListScrolls` must fail. Restore.

This is the falsification that matters most in the whole plan — it is the
direct analogue of the defect that survived eleven reviews on the web. If it
passes with the rail inside the list, the frame query is wrong (a stale
`rail.frame` captured before the swipe, or an element that no longer exists
resolving to `.zero`); fix the test before continuing.

- [ ] **Step 7: Check the auto-expand cadence by eye**

Launch with the fixture, scroll to the bottom, and watch the day headers.
Expected: one new day arrives per arrival at the bottom, and pulling to refresh
mid-expansion does not double-load (spec risk #5). If a single flick walks to
the end of the season, `autoExpandedThrough` is not being consulted.

- [ ] **Step 8: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendarUITests/DayRailUITests.swift
git commit -m "feat(ios): mount the day rail above the events list

Via .safeAreaInset(edge: .top), the mirror of how filterPillBar floats at
the bottom, so the rail is chrome and not content — the iOS analogue of the
sticky containing-block trap that shipped a non-sticky rail on the web past
eleven clean task reviews. A UI test asserts the rail's frame does not move
across two fast swipes, and fails when the rail is moved inside the List.

'Show next day' is deleted; the final row of the final day now expands the
window, once per newly-reached last day so a single flick cannot walk to the
end of the season."
```

---

### Task 9: Tapping a chip — expand, then land

A tap on a day already in the window is a scroll. A tap on a day past an edge
has to grow the window first, wait for the day to mount, and only then scroll —
and has to give up if it never mounts, or the pending target survives every
later commit and hijacks one of them minutes later.

Two lessons from the web rail are wired in here as constraints, not as
afterthoughts:

- **Do not animate the list scroll.** A smooth scroll does not re-target
  mid-flight; on the web a distant tap animated for ~2s while the document
  grew 1020px beneath it and landed ~1058px short.
- **An empty day is not a destination.** Its chip is disabled and its label is
  already a fact rather than an invitation ("Sunday, August 16, no events").
  `AppModel.goToDay` still *accepts* an empty day — the rule layer stays honest
  for phase 4's Siri routing, which can name a day the rail does not offer —
  but the rail does not present one as tappable.

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`
- Modify: `ios/ChqCalendar/Features/Shared/DayRailView.swift`
- Modify: `ios/ChqCalendarUITests/DayRailUITests.swift`

**Interfaces:**
- Produces: `EventListView.selectDay(_:)`; `DayChip` gains
  `.disabled(content.isEmpty)`.
- Consumes: `AppModel.goToDay(_:)`, `DayRailNavigation.shouldAbandonScroll`.

- [ ] **Step 1: Write the failing UI tests**

Append to `ios/ChqCalendarUITests/DayRailUITests.swift`:

```swift
    /// Seam 2: the tap that phase 3a got wrong. The target is far outside the
    /// current window, so the window has to grow, the day has to mount, and
    /// only then can the list move — and the move must land, not merely
    /// start.
    func testADistantChipTapLandsOnThatDay() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.otherElements["day-rail"].waitForExistence(timeout: 20))

        app.buttons["day-chip-2026-08-21"].tap()

        // The fixture titles every day header through ChqTime.dayTitle, so
        // this is the section header for the tapped day.
        let header = app.staticTexts["Friday, August 21"]
        XCTAssertTrue(
            header.waitForExistence(timeout: 10),
            "The tapped day never mounted — the window did not grow, or the pending scroll was abandoned too early")
        XCTAssertTrue(
            header.isHittable,
            "The day mounted but the list never scrolled to it — check that the scroll is retried after the expansion commits")
    }

    /// The pending-scroll retry must not outlive its usefulness: a target set
    /// under one scope and never cleared hijacks a later commit and teleports
    /// a reader who has moved on.
    func testTappingAnAlreadyVisibleDayDoesNotQueueALingeringScroll() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.otherElements["day-rail"].waitForExistence(timeout: 20))

        app.buttons["day-chip-2026-07-01"].tap()
        app.swipeUp(velocity: .fast)
        app.swipeUp(velocity: .fast)
        let afterScrolling = app.staticTexts["Wednesday, July 1"].exists

        // Give any lingering pending scroll a commit to hijack.
        app.swipeUp(velocity: .fast)

        XCTAssertEqual(
            app.staticTexts["Wednesday, July 1"].exists, afterScrolling,
            "Something scrolled the reader back to a day they tapped before scrolling away")
    }

    /// An empty day is named as a fact, not offered as a destination — the
    /// rule the web rail arrived at after three review findings. A control
    /// that says 'Go to' while going nowhere is what this prevents.
    func testAnEmptyDaysChipIsNotTappable() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.otherElements["day-rail"].waitForExistence(timeout: 20))

        // UITestFixture leaves every third day empty; 2026-06-29 is index 2.
        XCTAssertFalse(app.buttons["day-chip-2026-06-29"].isEnabled)
    }
```

Confirm the day-header strings against `ChqTime.dayTitle(for:)` before
running — if it renders `"Fri, Aug 21"` rather than `"Friday, August 21"`, use
what it actually produces. Do not weaken the assertion to a `CONTAINS`
predicate to dodge the question.

- [ ] **Step 2: Run them to make sure they fail**

Run the Task 8 Step 2 command.
Expected: FAIL — `onSelect` is still `{ _ in }`, so nothing happens on tap.

- [ ] **Step 3: Wire the tap**

In `EventListView.swift`, replace the placeholder `onSelect` with
`selectDay`, and add the pending-scroll machinery:

```swift
    /// A day the reader has asked for that has not mounted yet.
    ///
    /// Set by a tap, cleared when the day arrives — or when waiting becomes
    /// pointless. A target that is never cleared survives every later commit
    /// and hijacks one of them, scrolling the reader to a day they tapped
    /// under a different scope, minutes ago.
    @State private var pendingScrollDay: String?

    private func selectDay(_ dayKey: String) {
        guard model.goToDay(dayKey) else { return }
        anchorDay = dayKey
        pendingScrollDay = dayKey
    }

    /// Land a pending target if its day has mounted; give up if it never
    /// will.
    ///
    /// **Deliberately unanimated.** A smooth scroll does not re-target
    /// mid-flight: on the web the equivalent animation ran ~2s while the
    /// document grew 1020px beneath it, and the tap landed ~1058px short of
    /// its target. Growing content plus a smooth scroll is a race the scroll
    /// loses.
    private func landPendingScroll(_ proxy: ScrollViewProxy, days: [DayGroup]) {
        guard let target = pendingScrollDay else { return }

        if days.contains(where: { $0.id == target }) {
            proxy.scrollTo(target, anchor: .top)
            pendingScrollDay = nil
            return
        }

        if DayRailNavigation.shouldAbandonScroll(target: target, window: model.currentWindow) {
            pendingScrollDay = nil
        }
    }
```

Wrap the `List` in `list(days:)` with a `ScrollViewReader` and drive the retry
off the day list actually being rendered — **not** off `model.dayGroups`, which
re-runs the whole filter and group pipeline on every access:

```swift
    private func list(days: [DayGroup]) -> some View {
        let filtered = days.reduce(0) { $0 + $1.events.count }
        #if DEBUG
        let uiTestThemeTarget = model.uiTestFirstThemedWeek(in: days)
        #endif

        return ScrollViewReader { proxy in
            List(selection: selection) {
                // … unchanged …
            }
            .listStyle(.plain)
            // … the existing modifiers, unchanged …
            .onChange(of: days.map(\.id)) { _, _ in
                landPendingScroll(proxy, days: days)
            }
            .onAppear {
                landPendingScroll(proxy, days: days)
            }
        }
    }
```

`days.map(\.id)` is ~30 strings and is already in hand; comparing it is what
tells the retry that a commit brought new days.

- [ ] **Step 4: Disable empty chips**

In `DayRailView.swift`, on `DayChip`'s `Button`:

```swift
        .buttonStyle(.plain)
        // An empty day is not a destination: there is nothing to go to, and
        // its accessibility label already says so as a fact rather than an
        // invitation. Disabling it and labelling it honestly are the same
        // decision, made in two places — `DayChipCountStyle.actionPrefix`
        // owns the wording, this owns the affordance.
        .disabled(content.isEmpty)
        .accessibilityLabel(content.accessibilityLabel)
```

On My Day this is a **behaviour change**: an empty day's chip was tappable
there, because selecting an empty day is how you reach its "Browse …" action
(#192). So the disabling must not be unconditional — add
`let disablesEmptyDays: Bool` to `DayRailView`, defaulting to `false`, passed
`true` only by the Events rail, and thread it into `DayChip`. Pin it:

```swift
    /// My Day's empty chips stay tappable — selecting an empty day is how the
    /// reader reaches its "Browse …" action (#192). The Events rail's do not:
    /// there is no section to land on. Same chip, two answers, so the screen
    /// decides rather than the chip.
    var disablesEmptyDays: Bool = false
```

- [ ] **Step 5: Run the UI tests**

Run the Task 8 Step 2 command.
Expected: PASS, 5 tests in `DayRailUITests`.

- [ ] **Step 6: Run the whole suite**

Run the verification command.
Expected: PASS. If a My Day test now fails on an untappable empty chip,
`disablesEmptyDays` is being passed `true` from `MyDayView` — fix the call
site, not the test.

- [ ] **Step 7: Prove the retry by breaking it**

Delete the `.onChange(of: days.map(\.id))` retry and re-run:
`testADistantChipTapLandsOnThatDay` must fail on `isHittable` (the day mounts,
the list never moves). Restore.

Then make `landPendingScroll` animate (`withAnimation { proxy.scrollTo(...) }`)
and run the same test three times. If it starts failing intermittently, that is
the web's 1058px defect reproduced — keep it unanimated and record the
observation in the commit message.

- [ ] **Step 8: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendar/Features/Shared/DayRailView.swift \
        ios/ChqCalendarUITests/DayRailUITests.swift
git commit -m "feat(ios): tapping a day chip expands the window, then lands

A tap on a day past an edge grows the window, waits for the day to mount,
and only then scrolls — retried on each commit that brings new days, and
abandoned once the window covers the target and the day still has no
section (an ordinary empty day, not a commit in flight). An uncleared
target would otherwise hijack a later commit and teleport a reader who had
moved on.

The scroll is deliberately unanimated: a smooth scroll does not re-target
mid-flight, and on the web the same animation lost a ~1020px race against
growing content and landed ~1058px short.

Empty chips are disabled on the Events rail and stay tappable on My Day,
where selecting an empty day is how you reach its Browse action."
```

---

### Task 10: The highlight follows the reader

The rail's highlight is the answer to "where am I?", so it has to track scroll
rather than only the last tap. This is the one piece of the plan whose
mechanism is *not* decided in advance, for a specific reason: this project
already knows that `List` recycles a `GeometryReader` sentinel — that discovery
is why the deployment target moved to iOS 18 — so the obvious way to measure a
section's position is the way that is known to be unreliable here.

So: probe first, in the simulator, then implement whichever survives. Record
the outcome in the code, because the next reader will otherwise re-derive it.

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`
- Modify: `ios/ChqCalendarUITests/DayRailUITests.swift`

**Interfaces:**
- Produces: `anchorDay` maintained from scroll position.
- Consumes: `DayGroup.id`.

- [ ] **Step 1: Write the failing UI test**

Append to `ios/ChqCalendarUITests/DayRailUITests.swift`:

```swift
    /// The highlight answers "where am I?", so scrolling must move it. A
    /// highlight that only follows taps is a highlight that lies as soon as
    /// the reader uses the list.
    func testTheHighlightFollowsTheReaderDownTheList() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        let firstChip = app.buttons["day-chip-2026-07-01"]
        XCTAssertTrue(firstChip.waitForExistence(timeout: 20))
        XCTAssertTrue(firstChip.isSelected, "The rail did not start on the day at the top of the list")

        for _ in 0..<4 { app.swipeUp(velocity: .fast) }

        XCTAssertFalse(
            firstChip.isSelected,
            "The highlight stayed on the first day while the reader scrolled past it")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'day-chip-'"))
                .allElementsBoundByIndex.contains { $0.isSelected },
            "Nothing is highlighted at all — the anchor was cleared rather than moved")
    }
```

- [ ] **Step 2: Run it to make sure it fails**

Run the Task 8 Step 2 command.
Expected: FAIL — `anchorDay` only changes on tap.

- [ ] **Step 3: Probe the two mechanisms**

Implement **A** first, because it uses `List`'s own lifecycle and adds no
geometry:

```swift
    /// Day sections currently on screen. The anchor is the earliest of them —
    /// the day whose section is at the top of the viewport.
    @State private var visibleDays: Set<String> = []
```

on the section header:

```swift
                } header: {
                    dayHeader(for: day)
                        .onAppear { visibleDays.insert(day.id) }
                        .onDisappear { visibleDays.remove(day.id) }
                }
```

and derive:

```swift
    private var scrollAnchor: String? { visibleDays.min() }
```

feeding `selectedDay: pendingScrollDay ?? scrollAnchor ?? anchorDay` into the
rail — a pending tap wins until it lands, then scroll takes over.

Now measure, in the simulator, before deciding it works:

```bash
xcrun simctl launch "$SIMULATOR_UDID" org.chqcal.app \
  -uitest-fixture -uitest-freeze-now "2026-07-01 10:00:00"
```

Scroll slowly and watch the highlight. Record three things:
1. Does the highlight move at all?
2. Does it move at the right time — when a new day's header reaches the top,
   not two days early?
3. Does it ever go *backwards* while scrolling forwards? That is the recycling
   signature: a header re-appearing off-screen inserts a stale earlier key.

If all three are clean, keep A and go to Step 4.

If any is not, switch to **B**: `.onScrollGeometryChange(for: CGFloat.self)`
(iOS 18) on the `List` reading `geometry.contentOffset.y`, combined with each
section reporting its offset through a preference key, anchor = the last
section whose offset is `<= 0`. B is more code and more per-frame work; adopt
it only with the evidence from this step written into the commit message.

**Whichever wins, write the finding into the code**, e.g.:

```swift
    /// Maintained from section-header appearance rather than geometry.
    ///
    /// `List` recycles views, and a recycled `GeometryReader` sentinel is
    /// what made this project raise its deployment target — so a geometry
    /// probe per section is the approach with a known failure mode here.
    /// Measured on <device/OS> on 2026-08-…: <what you saw>.
```

- [ ] **Step 4: Run the UI test**

Run the Task 8 Step 2 command.
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the guard by breaking it**

Freeze the anchor (`private var scrollAnchor: String? { nil }`) and re-run:
`testTheHighlightFollowsTheReaderDownTheList` must fail on the first assertion
after scrolling. Restore.

- [ ] **Step 6: Check the rail does not fight the reader**

With the highlight tracking scroll, the rail re-centres on every anchor change
(`DayRailView.scroll(_:to:)` on `selectedDay`). Scroll the list continuously
and watch the rail: it should follow smoothly, not stutter or fight a
horizontal drag of its own.

If it fights a manual horizontal drag of the rail, suppress the re-centre while
the rail is being dragged rather than removing it — the web hit the same thing
and solved it by detecting a peek through **scroll divergence**, not by event
type ([[rail-scroll-linked-highlight-241-status]]).

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendarUITests/DayRailUITests.swift
git commit -m "feat(ios): the rail's highlight follows the reader

A highlight that only follows taps lies as soon as the reader uses the
list. The anchor is now the earliest day section on screen, maintained from
section-header appearance rather than a per-section geometry probe: List
recycles views, and a recycled GeometryReader sentinel is why this project
raised its deployment target — so geometry is the approach with a known
failure mode here. Measured in the simulator before choosing; see the doc
comment for what was observed.

A pending tap outranks the scroll anchor until it lands, so a tap does not
flicker back to where the reader was."
```

---

### Task 11: Chevrons and ⟳ Now, named by target

Three controls at the ends of the rail, all labelled by **where they go**,
never by direction — "Go to Sunday, August 16, 4 events", not "Next day". A
control named for its direction tells a screen-reader user nothing about
whether pressing it is worth doing.

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`
- Create: `ios/ChqCalendar/Features/Shared/DayStepControl.swift`
- Modify: `ios/ChqCalendarUITests/DayRailUITests.swift`

**Interfaces:**
- Produces: `DayStepControl` (symbol + accessibility label + action, disabled
  when its target is `nil`).
- Consumes: `DayRailNavigation.stepTargets`,
  `DayRailNavigation.reachableTodayKey`, `MyDayChipContent.make` for labelling.

- [ ] **Step 1: Write the failing UI tests**

Append to `ios/ChqCalendarUITests/DayRailUITests.swift`:

```swift
    /// Named by target, never by direction — and the target is the nearest
    /// day that HAS events, so pressing it always changes what is on screen.
    /// UITestFixture leaves 2026-07-02 empty, so a correct control skips it.
    func testTheForwardStepIsNamedForTheDayItGoesTo() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.otherElements["day-rail"].waitForExistence(timeout: 20))

        let step = app.buttons["day-step-next"]
        XCTAssertTrue(step.exists)
        XCTAssertEqual(step.label, "Go to Friday, July 3, 3 events")
    }

    func testTheBackwardStepIsDisabledAtTheEarliestReachableDay() {
        let app = launchFixtureApp(now: "2026-06-27 10:00:00")
        XCTAssertTrue(app.otherElements["day-rail"].waitForExistence(timeout: 20))

        XCTAssertFalse(app.buttons["day-step-previous"].isEnabled)
    }

    func testNowReturnsToTodayAfterNavigatingAway() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.otherElements["day-rail"].waitForExistence(timeout: 20))
        app.buttons["day-chip-2026-08-21"].tap()
        XCTAssertTrue(app.staticTexts["Friday, August 21"].waitForExistence(timeout: 10))

        app.buttons["day-rail-now"].tap()

        XCTAssertTrue(
            app.staticTexts["Wednesday, July 1"].waitForExistence(timeout: 10),
            "⟳ Now did not return the reader to today")
    }

    /// Off-season, today is outside the navigable bounds, and a target
    /// outside them is refused — so a Now button there would be visible,
    /// enabled, and inert.
    func testNowIsAbsentOutsideTheSeason() {
        let app = launchFixtureApp(now: "2026-02-01 10:00:00")
        // The rail may not exist at all off-season; either way, no Now button.
        XCTAssertFalse(app.buttons["day-rail-now"].waitForExistence(timeout: 10))
    }
```

The expected label string must match what `MyDayChipContent.make(style: .events)`
produces for that day — verify against Task 3's unit tests rather than guessing,
and if the fixture's third day is not `2026-07-03`, recompute it from
`UITestFixture.eventDays`.

- [ ] **Step 2: Run them to make sure they fail**

Run the Task 8 Step 2 command.
Expected: FAIL — no `day-step-next` element.

- [ ] **Step 3: Write the control**

Create `ios/ChqCalendar/Features/Shared/DayStepControl.swift`:

```swift
import SwiftUI

/// One end-cap on the day rail: a symbol, an action, and a label naming
/// **where it goes**.
///
/// Never "next day"/"previous day". A control named for its direction tells a
/// screen-reader user nothing about whether pressing it is worth doing, and
/// on this rail a step can be several calendar days — the nearest day that
/// actually has events — so the direction is not even the whole truth.
///
/// `nil` label means there is nowhere to go, and the control is disabled
/// rather than hidden: a control that appears and disappears as the window
/// grows is harder to aim at than one that greys out.
struct DayStepControl: View {
    let symbol: String
    let identifier: String
    /// The full spoken name of the destination, or `nil` when there is none.
    let destinationLabel: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                // 44pt to meet the HIG minimum tap target; height matches
                // `DayChip`, same as `MyDayExpandControl` does on My Day.
                .frame(width: 44, height: 62)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(destinationLabel == nil)
        .accessibilityLabel(destinationLabel ?? "No further days in this direction")
        .accessibilityIdentifier(identifier)
    }
}
```

- [ ] **Step 4: Wire the three controls into the rail**

In `EventListView.dayRail(_:)`:

```swift
    private func dayRail(_ nav: NavMatching) -> some View {
        let todayKey = ChqTime.dayKey(for: model.now())
        let anchor = pendingScrollDay ?? scrollAnchor ?? anchorDay
        let step = DayRailNavigation.stepTargets(anchor: anchor, eventDays: nav.eventDays)
        let reachableToday = DayRailNavigation.reachableTodayKey(
            model.isCurrentYear ? todayKey : nil, bounds: nav.bounds)

        return DayRailView(
            entries: MyDayChipContent.makeAll(
                days: ChqTime.dayKeys(from: nav.bounds.lowerBound, through: nav.bounds.upperBound),
                todayKey: todayKey,
                counts: nav.countsByDay,
                style: .events,
                includingYear: !model.isCurrentYear),
            selectedDay: anchor,
            accessibilityLabel: "Days in the season",
            disablesEmptyDays: true,
            onSelect: selectDay,
            leading: {
                if let reachableToday {
                    Button {
                        model.resetToNow()
                        selectDay(reachableToday)
                    } label: {
                        Label("Now", systemImage: "arrow.clockwise")
                            .labelStyle(.iconOnly)
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 44, height: 62)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(stepLabel(for: reachableToday, nav: nav, prefix: "Go to today"))
                    .accessibilityIdentifier("day-rail-now")
                }
                DayStepControl(
                    symbol: "chevron.left",
                    identifier: "day-step-previous",
                    destinationLabel: step.previous.map { stepLabel(for: $0, nav: nav) }
                ) {
                    if let previous = step.previous { selectDay(previous) }
                }
            },
            trailing: {
                DayStepControl(
                    symbol: "chevron.right",
                    identifier: "day-step-next",
                    destinationLabel: step.next.map { stepLabel(for: $0, nav: nav) }
                ) {
                    if let next = step.next { selectDay(next) }
                }
            })
        .background(.bar)
    }

    /// A step control's spoken name, built from the same chip content the
    /// rail's own chips use — so a control and the chip it points at can
    /// never describe the same day differently.
    private func stepLabel(for dayKey: String, nav: NavMatching, prefix: String? = nil) -> String {
        let content = MyDayChipContent.make(
            dayKey: dayKey,
            todayKey: ChqTime.dayKey(for: model.now()),
            count: nav.countsByDay[dayKey] ?? 0,
            style: .events,
            includingYear: !model.isCurrentYear)
        guard let content else { return prefix ?? dayKey }
        guard let prefix else { return content.accessibilityLabel }
        // "Go to today, Wednesday, July 1, 3 events" — the chip's own label
        // already carries "Go to", so strip it rather than saying it twice.
        let body = content.accessibilityLabel.hasPrefix("Go to ")
            ? String(content.accessibilityLabel.dropFirst("Go to ".count))
            : content.accessibilityLabel
        return "\(prefix), \(body)"
    }
```

`⟳ Now` calls `resetToNow()` *and* `selectDay(today)`: the reset restores the
Now scope and drops every expansion, and the scroll is what actually returns
the reader — resetting alone leaves them wherever they were in a freshly
narrowed list.

- [ ] **Step 5: Run the UI tests, then the whole suite**

Run the Task 8 Step 2 command, then the full verification command.
Expected: PASS.

- [ ] **Step 6: Prove the skip-empty-days guard by breaking it**

Change the forward step's target to `ChqTime.day(anchor, offsetBy: 1)` and
re-run: `testTheForwardStepIsNamedForTheDayItGoesTo` must fail with a label
naming `July 2` (an empty day). Restore.

- [ ] **Step 7: VoiceOver pass**

Enable VoiceOver in the simulator (Settings → Accessibility) and swipe through
the rail. Expected: the strip announces as a group named "Days in the season";
each chip announces its full destination phrase; the step controls announce
their target, not their direction; an empty chip announces as a fact and is
reported unavailable.

- [ ] **Step 8: Commit**

```bash
git add ios/ChqCalendar/Features/Shared/DayStepControl.swift \
        ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendarUITests/DayRailUITests.swift
git commit -m "feat(ios): rail chevrons and Now, named by target

Every control on the rail is labelled by where it goes — 'Go to Friday,
July 3, 3 events' — never by direction. On this rail a step can cross
several calendar days, because it targets the nearest day that has events,
so the direction is not even the whole truth.

Now is absent off-season rather than inert: today is outside the navigable
bounds for most of the year, and a target outside them is refused, so an
unclamped button would be visible, enabled, and do nothing. It resets the
scope and scrolls, because resetting alone leaves the reader wherever they
were in a freshly narrowed list."
```

---

### Task 12: The pass that decides whether this shipped

Phase 3a's lesson, in one line: eleven green task reviews and the rail still
did not work. Every task above ends green; this task is where the branch is
judged as a whole, on a running app.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md` (status banner)
- Modify: `docs/app-store/screenshots.manifest.json` and
  `docs/app-store/screenshots/review/` (regenerated, not hand-edited)
- Modify: the memory files named in Step 6

- [ ] **Step 1: The whole-branch review**

Use `superpowers:requesting-code-review` against the full branch diff, not the
individual tasks. What the per-task reviews structurally cannot see:

- the rail, the day headers and the filter pills competing for the top and
  bottom insets on the smallest supported iPhone;
- auto-expand racing `.refreshable` (spec risk #5) — a refresh mid-expansion
  must not double-dispatch;
- `.id` on day sections interacting with `List`'s recycling and with the
  `selection` binding used by the iPad split layout;
- the rail on iPad, where `EventListView` is the sidebar column;
- Dynamic Type at the largest accessibility size, where a 62pt chip is no
  longer 62pt.

- [ ] **Step 2: The device matrix pass**

Run each of these with the fixture, take a screenshot, and look at it:

| State | Launch |
|---|---|
| In season, Now scope | `-uitest-fixture -uitest-freeze-now "2026-07-15 10:00:00"` |
| Season edge (first day) | `… "2026-06-27 08:00:00"` |
| Season edge (last day) | `… "2026-08-23 20:00:00"` |
| Off season | `… "2026-02-01 10:00:00"` |
| Filtered to a sparse set | add `-uitest-search "Fixture Event 2"` |
| Archived year | switch the year in-app after launch |
| iPad split layout | boot an iPad simulator |

Expected in every case: the rail is present iff there is something to
navigate; no control is enabled that does nothing; the chevrons disable at the
ends; nothing overlaps the day headers.

- [ ] **Step 3: Dynamic Type and VoiceOver**

Repeat the in-season state at the largest accessibility text size. Expected:
chips grow, the rail scrolls horizontally rather than truncating, the day
headers still clear it, and the list is still reachable. This is the iOS
equivalent of the web's 200% text-zoom requirement, which is why
`--day-rail-h` was measured rather than hardcoded there.

- [ ] **Step 4: Regenerate the App Store screenshots**

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

Commit `docs/app-store/screenshots.manifest.json` and
`docs/app-store/screenshots/review/`. The `app-store-assets` workflow checks
that the manifest changed since the merge base — it is a git-diff check, so a
hand-edited manifest would satisfy it and must not be produced. If the manifest
genuinely does not change because `ios/Scripts/screenshot-plan.json` covers no
screen this branch touched, that is a valid opt-out and is recorded as
`[skip-screenshots: regenerated, no covered shot changed]` in the PR
description — but check first whether the plan *should* now cover the rail,
since it is on the Events tab that shots 01–03 already show.

- [ ] **Step 5: Update the spec's status banner**

At the top of `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`,
move 3b from "Remaining" into the completed list, and record — briefly, in the
spec's own voice — what the iOS pass caught that the task reviews did not.
That section is the most-read part of the document; keep it factual and keep
the numbers.

- [ ] **Step 6: Update the memory files**

- `date-navigation-225-226-status.md` — 3b done, what remains in phase 4.
- Create a `date-nav-phase-3b-ios-rail-status.md` with the findings that
  outlive the phase, and link it from `MEMORY.md`.
- `no-ios-tests-in-ci.md` — the UI-test target now exists and runs in
  `ios.yml`; note the timeout change and that UI tests are a second reason
  `-parallel-testing-enabled NO` matters.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/date-nav-phase-3b-ios-day-rail
gh pr create --title "feat(ios): day rail on the events list (phase 3b)" --body "…"
```

The body must state the `expandWindowEnd` behaviour change from Task 6 and the
test it replaced, so a reviewer does not have to find it in the diff. Then
iterate per `CLAUDE.md`: address review comments, re-request AI reviews, and
**read Copilot's `Suppressed comments` block** — it reported "no new comments"
on four of five passes during phase 2 while carrying real findings there.

- [ ] **Step 8: Do not merge**

Report status and request the merge from the user.

---

## Self-review

**Spec coverage.** The spec's "iOS surface" section maps as: the `.day`
exemption collapse — already done in phase 1b, nothing owed here; the rail —
Tasks 7, 8, 9, 10, 11; `MyDayChipContent.starCount` generalising to a count
plus an optional symbol — Task 3; `.safeAreaInset(edge: .top)` mounting — Task
8; `.id(dayKey)` on day sections — Task 8; deleting the `.next`-only "Show next
day" button in favour of last-section `.onAppear` — Task 8; My Day keeping its
expand-to-season-edge chevrons — Task 7 (they are passed as the leading/trailing
accessories, unchanged). The `AppModel` list is covered by Tasks 5 and 6 with
two documented departures (`stepDay`, `stepWeek`). The spec's remaining iOS
items — Siri routing, screenshots beyond the mandatory regeneration, the 1.1.3
sweep, listing copy — are explicitly deferred to phase 4 in the Scope section
above, per the decision taken 2026-08-18.

**Known gap, stated rather than hidden.** The spec's phase 3 also names the
scope-set change; on iOS `DateFilterSheet.visibleScopes` already reads
`[.next, .today, .season, .all]`, so the visible change was made before this
phase and only the dead `.thisWeek` read path remains. That is out of scope by
decision, not by oversight.

**Type consistency.** `MyDayChipContent.count` / `.symbol` (Task 3) are what
Tasks 7, 8 and 11 read. `NavMatching.eventDays` / `.countsByDay` / `.bounds`
(Task 5) are what Tasks 6, 8 and 11 read. `DayRailNavigation.plan` /
`.stepTargets` / `.edgeTargets` / `.shouldAbandonScroll` / `.eventDays` /
`.reachableTodayKey` (Task 4) are consumed by Tasks 5, 6, 9 and 11 under those
exact names. `DayRailView`'s `entries` / `selectedDay` / `disablesEmptyDays` /
`onSelect` / `leading` / `trailing` (Tasks 7 and 9) match both call sites.
`AppModel.goToDay` returns `Bool` and every caller either checks it (Task 9) or
discards it deliberately.

**Risk that remains.** Task 10's mechanism is chosen by measurement rather than
specified, and Task 2 creates an Xcode target through the IDE rather than
through a text edit. Both are deliberate: the first because this codebase has a
recorded failure mode for the obvious approach, the second because hand-editing
`project.pbxproj` for a new target produces projects that open and do not build.
