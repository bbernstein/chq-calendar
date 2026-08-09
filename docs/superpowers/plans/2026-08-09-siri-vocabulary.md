# Siri Interaction Vocabulary (#193) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rich Siri phrase vocabulary for the iOS app — kind-of-event, timeframe, venue, week-theme, and my-schedule queries, plus "Chautauqua" as an alternative app name — per `docs/superpowers/specs/2026-08-09-siri-vocabulary-design.md`.

**Architecture:** Pure vocabulary/selection/dialog logic lives in `ChqCalendarShared` (plain Swift, unit-tested, no AppIntents import). The app target's `Intents/` layer adds thin `AppEnum`/`AppEntity` conformances and intents that compose the shared engine. Phrases are registered in `ChqShortcuts`; each phrase parameterizes at most ONE slot (hard toolchain rule).

**Tech Stack:** Swift 6 / SwiftUI, AppIntents framework, Swift Testing (`@Test`/`#expect`/`#require`), Xcode 26 (iOS 26.5 SDK), deployment target iOS 18.

## Global Constraints

- **Branch:** work on `siri-vocabulary-193` (already exists, has the spec). NEVER commit to `main`.
- **One parameter per phrase.** `appintentsmetadataprocessor` halts the build on a phrase with two `\(\.$param)` slots ("Multiple parameters detected in phrase"). Literal words are unrestricted.
- **Fixed phrases cannot preset parameter values** — a no-slot phrase runs the intent with all parameters nil. Spec's "fixed phrases" are therefore delivered as two tiny dedicated intents (`WhoIsSpeakingIntent`, `ShowTimeIntent`). Total App Shortcuts: 7 (system cap 10).
- **Enum case display titles are baked verbatim into generated Siri utterances** → titles are natural plurals ("movies"); singulars go in `synonyms`.
- **`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`:** every shared domain type and every AppIntents conformance type must be `nonisolated` (see doc comments in `IntentDataSource.swift`/`EventEntity.swift` for why). EXCEPTION: an `AppIntent` struct with `@Parameter` vars must NOT be marked `nonisolated` (mutable stored properties reject it — verified in the spike).
- **AppEnum `caseDisplayRepresentations` must be a LITERAL dictionary** in the conformance (the metadata processor const-extracts it; the spike verified literals export synonyms). A unit test cross-checks the literal against the shared enum's data.
- **Test/build command** (swap simulator name/OS for what `xcrun simctl list devices available` shows):
  ```bash
  cd ios && xcodebuild test \
    -project ChqCalendar.xcodeproj -scheme ChqCalendar \
    -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
    CODE_SIGNING_ALLOWED=NO
  ```
- **All times are NY time** via `ChqTime` (`ChqTime.zone`, `ChqTime.calendar`, `parse("yyyy-MM-dd HH:mm:ss")`, `dayKey`, `dayTitle`, `timeString`, `endOfDay`). Tests construct dates with `ChqTime.parse`, never `Date()`.
- **Fixtures:** use the existing `makeEvent(id:start:title:location:categories:tags:details:presenter:end:week:status:)` helper from `ChqCalendarTests/TestSupport.swift`.
- Commit after every task with the message given in the task. Do not push `main`; push the feature branch.

## File Structure

| File | Responsibility |
|---|---|
| `ios/ChqCalendarShared/Domain/EventKind.swift` (new) | Kind vocabulary: cases, plural display titles, spoken synonyms, feed-token matching rules, flagship-venue set |
| `ios/ChqCalendarShared/Domain/IntentTimeframe.swift` (new) | Timeframe vocabulary + `DateInterval` resolution + `SeasonStatus` |
| `ios/ChqCalendarShared/Domain/DaypartSlot.swift` (new) | "evening show" / "morning lecture" slot matching |
| `ios/ChqCalendarShared/Domain/ThemeWeek.swift` (new) | Theme-week vocabulary → week number resolution |
| `ios/ChqCalendarShared/Domain/IntentDialogText.swift` (new) | Every spoken dialog string, as pure functions |
| `ios/ChqCalendarShared/Data/SharedSnapshotLoader.swift` (modify) | + `loadThemes(year:cache:)` |
| `ios/ChqCalendar/Data/IntentDataSource.swift` (modify) | + `defaultYear()`, `selectMatching`, `featured`, `selectSchedule` |
| `ios/ChqCalendar/Intents/IntentEnums.swift` (new) | `AppEnum` conformances (literal display representations) |
| `ios/ChqCalendar/Intents/VenueEntity.swift` (new) | Venue `AppEntity` + query + spoken synonyms |
| `ios/ChqCalendar/Intents/EventIntents.swift` (modify) | `NextEventsIntent` gains kind/timeframe/venue params |
| `ios/ChqCalendar/Intents/WeekThemeIntent.swift` (new) | Theme query intent |
| `ios/ChqCalendar/Intents/MyScheduleIntent.swift` (new) | Starred-events query intent |
| `ios/ChqCalendar/Intents/FlagshipIntents.swift` (new) | `WhoIsSpeakingIntent` + `ShowTimeIntent` |
| `ios/ChqCalendar/Intents/ChqShortcuts.swift` (modify) | Phrase registration (7 shortcuts) |
| `ios/ChqCalendar/Info.plist` (modify) | `INAlternativeAppNames` |
| `ios/ChqCalendar/App/WidgetReloading.swift` (modify) | `updateAppShortcutParameters()` alongside widget reload |
| `ios/ChqCalendar/Features/About/AboutInfo.swift` + `AboutView.swift` (modify) | "Ask Siri" section |
| `ios/ChqCalendar/Features/MyDay/MyDayView.swift` (modify) | One-time `SiriTipView` |
| Tests | `EventKindTests.swift`, `IntentTimeframeTests.swift`, `IntentDialogTextTests.swift`, `SharedSnapshotLoaderTests.swift`, `IntentMatchingTests.swift`, `DaypartSlotTests.swift`, `ThemeWeekTests.swift`, `IntentEnumsTests.swift`, additions to `AboutInfoTests.swift` (all new files in `ios/ChqCalendarTests/`) |

The project uses filesystem-synchronized groups (`objectVersion = 70`): new files dropped into these folders are picked up automatically — no pbxproj editing.

---

### Task 1: `EventKind` vocabulary (shared)

**Files:**
- Create: `ios/ChqCalendarShared/Domain/EventKind.swift`
- Test: `ios/ChqCalendarTests/EventKindTests.swift`

**Interfaces:**
- Consumes: `Event` (`filterTokens: Set<String>`, `displayLocation: String?`) from `ChqCalendarShared/Models/Event.swift`.
- Produces: `EventKind: String, CaseIterable, Sendable` with `var displayTitle: String`, `var spokenSynonyms: [String]`, `func matches(_ event: Event) -> Bool`, `static func isFlagshipVenue(_ name: String?) -> Bool`. Later tasks (5, 6, 7, 10) rely on these exact names.

- [ ] **Step 1: Write the failing test**

```swift
// ios/ChqCalendarTests/EventKindTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins the #193 Siri vocabulary's kind → feed-token mapping. Tag values
/// are the slug-form tags observed in the live 2026 feed (see the design
/// spec's vocabulary table); `Event.filterTokens` contains them lowercased.
struct EventKindTests {
    private func event(tags: [String] = [], location: String? = nil) -> Event {
        makeEvent(id: "e", start: ChqTime.parse("2026-07-15 10:00:00")!, location: location, tags: tags)
    }

    @Test func lecturesMatchChautauquaLectureSeries() {
        #expect(EventKind.lectures.matches(event(tags: ["chautauqua-lecture-series"])))
    }

    @Test func lecturesMatchInterfaithAndCLSCAndMasterClass() {
        #expect(EventKind.lectures.matches(event(tags: ["interfaith-lecture"])))
        #expect(EventKind.lectures.matches(event(tags: ["chautauqua-literary-and-scientific-circle-clsc"])))
        #expect(EventKind.lectures.matches(event(tags: ["master-class"])))
        #expect(EventKind.lectures.matches(event(tags: ["special-lectures"])))
    }

    @Test func lecturesDoNotMatchAMovie() {
        #expect(!EventKind.lectures.matches(event(tags: ["movies"])))
    }

    @Test func symphonyMatchesCSOAndChamberMusic() {
        #expect(EventKind.symphonyConcerts.matches(event(tags: ["chautauqua-symphony-orchestra-classical-concerts"])))
        #expect(EventKind.symphonyConcerts.matches(event(tags: ["chautauqua-chamber-music"])))
    }

    @Test func concertsIncludePopularEntertainmentAndSymphonyAndSchoolOfMusic() {
        #expect(EventKind.concerts.matches(event(tags: ["popular-entertainment-concerts"])))
        #expect(EventKind.concerts.matches(event(tags: ["chautauqua-symphony-orchestra-classical-concerts"])))
        #expect(EventKind.concerts.matches(event(tags: ["school-of-music"])))
    }

    @Test func moviesMatchByTagOrCinemaVenue() {
        #expect(EventKind.movies.matches(event(tags: ["movies"])))
        #expect(EventKind.movies.matches(event(location: "Chautauqua Cinema")))
        #expect(!EventKind.movies.matches(event(tags: ["opera"])))
    }

    @Test func worshipMatchesFaithProgrammingAndServices() {
        #expect(EventKind.worshipServices.matches(event(tags: ["faith-and-spiritual-programming"])))
        #expect(EventKind.worshipServices.matches(event(tags: ["service"])))
        #expect(EventKind.worshipServices.matches(event(tags: ["weekly-chaplains"])))
    }

    @Test func remainingKindsMatchTheirTags() {
        #expect(EventKind.operas.matches(event(tags: ["opera"])))
        #expect(EventKind.plays.matches(event(tags: ["theater"])))
        #expect(EventKind.dance.matches(event(tags: ["dance"])))
        #expect(EventKind.recreation.matches(event(tags: ["recreation"])))
        #expect(EventKind.familyActivities.matches(event(tags: ["youth-programs-and-activities"])))
    }

    @Test func displayTitlesArePluralAndSynonymsNonEmpty() {
        for kind in EventKind.allCases {
            #expect(!kind.displayTitle.isEmpty)
            #expect(!kind.spokenSynonyms.isEmpty)
        }
        // Titles are baked verbatim into Siri utterances — plural forms only.
        #expect(EventKind.movies.displayTitle == "movies")
        #expect(EventKind.lectures.displayTitle == "lectures")
    }

    @Test func flagshipVenueDetectionIsCaseInsensitiveAndNilSafe() {
        #expect(EventKind.isFlagshipVenue("Amphitheater"))
        #expect(EventKind.isFlagshipVenue("hall of philosophy"))
        #expect(EventKind.isFlagshipVenue("Bratton Theater"))
        #expect(!EventKind.isFlagshipVenue("Smith Wilkes Hall"))
        #expect(!EventKind.isFlagshipVenue(nil))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run the Global Constraints test command with `-only-testing:ChqCalendarTests/EventKindTests` appended.
Expected: build FAILURE — `cannot find 'EventKind' in scope`.

- [ ] **Step 3: Write the implementation**

```swift
// ios/ChqCalendarShared/Domain/EventKind.swift
import Foundation

/// The controlled "kind of event" vocabulary behind the Siri surface
/// (#193): each case carries the natural plural spoken title (Siri bakes
/// display titles verbatim into generated utterances), the synonyms a
/// user might say instead, and a matching rule over the feed's slug-form
/// tags (`Event.filterTokens`) plus, for movies, the venue itself.
///
/// Slug tags (e.g. `chautauqua-lecture-series`) are used rather than the
/// human-readable category names because slugs are stable ASCII — names
/// carry HTML entities and punctuation that vary (`popular entertainment
/// & concerts`).
///
/// `nonisolated`, like every type in this layer — see
/// `IntentDataSource.swift`'s doc comment.
nonisolated enum EventKind: String, CaseIterable, Sendable {
    case lectures
    case symphonyConcerts
    case concerts
    case movies
    case operas
    case plays
    case dance
    case worshipServices
    case recreation
    case familyActivities

    /// Natural plural spoken form — becomes the AppEnum case display title.
    var displayTitle: String {
        switch self {
        case .lectures: return "lectures"
        case .symphonyConcerts: return "symphony concerts"
        case .concerts: return "concerts"
        case .movies: return "movies"
        case .operas: return "operas"
        case .plays: return "plays"
        case .dance: return "dance performances"
        case .worshipServices: return "worship services"
        case .recreation: return "recreation activities"
        case .familyActivities: return "family activities"
        }
    }

    /// What a user might say instead of `displayTitle` — becomes the
    /// AppEnum case synonyms.
    var spokenSynonyms: [String] {
        switch self {
        case .lectures: return ["lecture", "talks", "talk", "speakers"]
        case .symphonyConcerts: return ["symphony", "the symphony", "CSO", "classical concerts", "orchestra concerts"]
        case .concerts: return ["concert", "shows", "performances", "music", "entertainment"]
        case .movies: return ["movie", "films", "film", "cinema"]
        case .operas: return ["opera"]
        case .plays: return ["play", "theater", "theatre", "drama"]
        case .dance: return ["dance", "ballet"]
        case .worshipServices: return ["services", "church services", "religious services", "sacred song services"]
        case .recreation: return ["recreation", "sports", "fitness", "activities"]
        case .familyActivities: return ["kids activities", "kids events", "youth programs", "children's activities"]
        }
    }

    /// Slug-form feed tags that identify this kind (matched against
    /// `Event.filterTokens`, which is already lowercased).
    private var slugTags: Set<String> {
        switch self {
        case .lectures:
            return ["chautauqua-lecture-series", "interfaith-lecture", "special-lectures",
                    "chautauqua-literary-and-scientific-circle-clsc", "master-class"]
        case .symphonyConcerts:
            return ["chautauqua-symphony-orchestra-classical-concerts", "chautauqua-chamber-music"]
        case .concerts:
            return ["popular-entertainment-concerts", "chautauqua-symphony-orchestra-classical-concerts",
                    "chautauqua-chamber-music", "school-of-music"]
        case .movies: return ["movies"]
        case .operas: return ["opera"]
        case .plays: return ["theater"]
        case .dance: return ["dance"]
        case .worshipServices: return ["faith-and-spiritual-programming", "service", "weekly-chaplains"]
        case .recreation: return ["recreation"]
        case .familyActivities: return ["youth-programs-and-activities"]
        }
    }

    /// Whether `event` is this kind. Movies additionally match by venue:
    /// everything at Chautauqua Cinema is a movie whether or not tagged.
    func matches(_ event: Event) -> Bool {
        if self == .movies, event.displayLocation?.lowercased() == "chautauqua cinema" {
            return true
        }
        return !slugTags.isDisjoint(with: event.filterTokens)
    }

    /// The venues whose events lead a spoken answer when several match —
    /// "what's the next lecture" should answer the 10:45 Amp lecture, not
    /// a porch chat (lowercased for comparison).
    static let flagshipVenues: Set<String> = [
        "amphitheater", "hall of philosophy", "norton hall", "bratton theater", "lenna hall"
    ]

    static func isFlagshipVenue(_ name: String?) -> Bool {
        guard let name else { return false }
        return flagshipVenues.contains(name.lowercased())
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: all `EventKindTests` PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/EventKind.swift ios/ChqCalendarTests/EventKindTests.swift
git commit -m "feat(ios): EventKind vocabulary for Siri queries (#193)"
```

---

### Task 2: `IntentTimeframe` + `SeasonStatus` (shared)

**Files:**
- Create: `ios/ChqCalendarShared/Domain/IntentTimeframe.swift`
- Test: `ios/ChqCalendarTests/IntentTimeframeTests.swift`

**Interfaces:**
- Consumes: `SeasonCalendar.weeks(forYear:) -> [SeasonWeek]` (`.number/.start/.end`, noon-to-noon), `SeasonCalendar.currentWeekNumber(at:year:) -> Int?`, `ChqTime.calendar`, `ChqTime.endOfDay(_:)`.
- Produces: `IntentTimeframe: String, CaseIterable, Sendable` with `var spokenLabel: String`, `func interval(now: Date, year: Int) -> DateInterval`; `SeasonStatus` enum with `case preSeason(start: Date)`, `case inSeason`, `case postSeason` and `static func make(now: Date, year: Int) -> SeasonStatus`. Tasks 5, 7–10 rely on these exact names.

- [ ] **Step 1: Read `ChqTime.endOfDay` (`ios/ChqCalendarShared/Support/ChqTime.swift:102`)** to confirm its semantics (end-of-NY-day for the given date) before writing interval math.

- [ ] **Step 2: Write the failing test**

```swift
// ios/ChqCalendarTests/IntentTimeframeTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins #193's timeframe vocabulary → NY-time interval resolution.
/// 2026 season: week 1 starts Sat 2026-06-27 12:00 NY; week 9 ends
/// Sat 2026-08-29 12:00 NY (per SeasonCalendarTests).
struct IntentTimeframeTests {
    private let year = 2026

    @Test func todayRunsFromNowToEndOfDay() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.today.interval(now: now, year: year)
        #expect(interval.start == now)
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-15 23:00:00"))))
        #expect(!interval.contains(try #require(ChqTime.parse("2026-07-16 08:00:00"))))
    }

    @Test func tonightStartsAtFivePM() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.tonight.interval(now: now, year: year)
        #expect(interval.start == ChqTime.parse("2026-07-15 17:00:00"))
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-15 20:15:00"))))
        #expect(!interval.contains(try #require(ChqTime.parse("2026-07-15 14:00:00"))))
    }

    @Test func tonightAfterFivePMStartsNow() throws {
        let now = try #require(ChqTime.parse("2026-07-15 19:00:00"))
        let interval = IntentTimeframe.tonight.interval(now: now, year: year)
        #expect(interval.start == now)
    }

    @Test func tomorrowCoversTheFullNextNYDay() throws {
        let now = try #require(ChqTime.parse("2026-07-15 22:00:00"))
        let interval = IntentTimeframe.tomorrow.interval(now: now, year: year)
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-16 00:30:00"))))
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-16 23:00:00"))))
        #expect(!interval.contains(now))
    }

    @Test func thisWeekEndsAtTheSeasonWeekBoundary() throws {
        // 2026-07-15 is inside week 3 (Jul 11 noon – Jul 18 noon).
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.thisWeek.interval(now: now, year: year)
        #expect(interval.start == now)
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-17 20:00:00"))))
        #expect(!interval.contains(try #require(ChqTime.parse("2026-07-19 10:00:00"))))
    }

    @Test func nextWeekIsTheFollowingSeasonWeek() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.nextWeek.interval(now: now, year: year)
        // Week 4: Jul 18 noon – Jul 25 noon.
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-20 10:00:00"))))
        #expect(!interval.contains(now))
    }

    @Test func explicitWeekResolvesItsSeasonWeek() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.week7.interval(now: now, year: year)
        // Week 7: Aug 8 noon – Aug 15 noon.
        #expect(interval.contains(try #require(ChqTime.parse("2026-08-10 10:00:00"))))
        #expect(!interval.contains(now))
    }

    @Test func thisWeekOffSeasonFallsBackToSevenDays() throws {
        let now = try #require(ChqTime.parse("2026-10-01 10:00:00"))
        let interval = IntentTimeframe.thisWeek.interval(now: now, year: year)
        #expect(interval.start == now)
        #expect(interval.contains(try #require(ChqTime.parse("2026-10-05 10:00:00"))))
    }

    @Test func spokenLabelsReadNaturally() {
        #expect(IntentTimeframe.today.spokenLabel == "today")
        #expect(IntentTimeframe.thisWeek.spokenLabel == "this week")
        #expect(IntentTimeframe.week7.spokenLabel == "week 7")
    }

    @Test func seasonStatusDetectsPreInAndPost() throws {
        let before = try #require(ChqTime.parse("2026-05-01 10:00:00"))
        let during = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let after = try #require(ChqTime.parse("2026-09-15 10:00:00"))
        if case .preSeason(let start) = SeasonStatus.make(now: before, year: year) {
            #expect(start == SeasonCalendar.seasonStart(year: year))
        } else { Issue.record("expected preSeason") }
        #expect(SeasonStatus.make(now: during, year: year) == .inSeason)
        #expect(SeasonStatus.make(now: after, year: year) == .postSeason)
    }
}
```

- [ ] **Step 3: Run tests to verify they fail** (same command shape, `-only-testing:ChqCalendarTests/IntentTimeframeTests`). Expected: `cannot find 'IntentTimeframe' in scope`.

- [ ] **Step 4: Write the implementation**

```swift
// ios/ChqCalendarShared/Domain/IntentTimeframe.swift
import Foundation

/// The timeframe vocabulary behind the Siri surface (#193), resolved to
/// concrete NY-time `DateInterval`s against the season calendar.
/// `nonisolated` — see `IntentDataSource.swift`'s doc comment.
nonisolated enum IntentTimeframe: String, CaseIterable, Sendable {
    case today, tonight, tomorrow, thisWeek, nextWeek
    case week1, week2, week3, week4, week5, week6, week7, week8, week9

    /// The explicit season week number, or `nil` for the relative cases.
    var explicitWeek: Int? {
        switch self {
        case .week1: return 1
        case .week2: return 2
        case .week3: return 3
        case .week4: return 4
        case .week5: return 5
        case .week6: return 6
        case .week7: return 7
        case .week8: return 8
        case .week9: return 9
        default: return nil
        }
    }

    /// How the timeframe is spoken back in a dialog ("No movies *tonight*.").
    var spokenLabel: String {
        switch self {
        case .today: return "today"
        case .tonight: return "tonight"
        case .tomorrow: return "tomorrow"
        case .thisWeek: return "this week"
        case .nextWeek: return "next week"
        default: return "week \(explicitWeek!)"
        }
    }

    /// The NY-time window this timeframe means at `now`. Relative week
    /// cases use the season's Saturday-noon week boundaries when `now` is
    /// in season, and a plain 7-day window otherwise (so off-season
    /// queries still resolve and the empty result produces an off-season
    /// dialog rather than a crash).
    func interval(now: Date, year: Int) -> DateInterval {
        let cal = ChqTime.calendar
        switch self {
        case .today:
            return DateInterval(start: now, end: max(now, ChqTime.endOfDay(now)))
        case .tonight:
            var c = cal.dateComponents([.year, .month, .day], from: now)
            c.hour = 17
            let five = cal.date(from: c) ?? now
            let start = max(now, five)
            return DateInterval(start: start, end: max(start, ChqTime.endOfDay(now)))
        case .tomorrow:
            let t = cal.date(byAdding: .day, value: 1, to: now) ?? now
            return DateInterval(start: cal.startOfDay(for: t), end: ChqTime.endOfDay(t))
        case .thisWeek:
            if let n = SeasonCalendar.currentWeekNumber(at: now, year: year) {
                return DateInterval(start: now, end: max(now, SeasonCalendar.weeks(forYear: year)[n - 1].end))
            }
            return DateInterval(start: now, end: cal.date(byAdding: .day, value: 7, to: now) ?? now)
        case .nextWeek:
            let weeks = SeasonCalendar.weeks(forYear: year)
            if let n = SeasonCalendar.currentWeekNumber(at: now, year: year) {
                if n < 9 {
                    let w = weeks[n] // weeks[n] is week n+1 (0-indexed array)
                    return DateInterval(start: w.start, end: w.end)
                }
                // Week 9: "next week" is past the season — zero-length
                // window yields no matches and an off-season dialog.
                return DateInterval(start: weeks[8].end, end: weeks[8].end)
            }
            let start = cal.date(byAdding: .day, value: 7, to: now) ?? now
            return DateInterval(start: start, end: cal.date(byAdding: .day, value: 14, to: now) ?? start)
        default:
            let w = SeasonCalendar.weeks(forYear: year)[explicitWeek! - 1]
            return DateInterval(start: w.start, end: w.end)
        }
    }
}

/// Where `now` falls relative to `year`'s season — drives the off-season
/// dialog shapes ("The 2026 season has ended…").
nonisolated enum SeasonStatus: Equatable, Sendable {
    case preSeason(start: Date)
    case inSeason
    case postSeason

    static func make(now: Date, year: Int) -> SeasonStatus {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let first = weeks.first, let last = weeks.last else { return .inSeason }
        if now < first.start { return .preSeason(start: first.start) }
        if now >= last.end { return .postSeason }
        return .inSeason
    }
}
```

- [ ] **Step 5: Run tests to verify they pass.** If `thisWeekEndsAtTheSeasonWeekBoundary` fails on the exact week-3 boundary dates, re-check against `SeasonCalendarTests`' pinned 2026 dates and fix the TEST dates (the season math is already pinned by that suite — do not change `SeasonCalendar`).

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendarShared/Domain/IntentTimeframe.swift ios/ChqCalendarTests/IntentTimeframeTests.swift
git commit -m "feat(ios): IntentTimeframe + SeasonStatus for Siri queries (#193)"
```

---

### Task 3: Dialog text builders (shared)

**Files:**
- Create: `ios/ChqCalendarShared/Domain/IntentDialogText.swift`
- Test: `ios/ChqCalendarTests/IntentDialogTextTests.swift`

**Interfaces:**
- Consumes: `Event`, `ChqTime.dayTitle/timeString/compactDayLabel`, `WeekThemeSummary` (`weekNumber: Int`, `title: String`, `dateRange: String`), `SeasonStatus`.
- Produces (all `static func` on `nonisolated enum IntentDialogText`, all return `String`):
  - `nextUp(kindTitle: String?, event: Event) -> String`
  - `listSummary(count: Int, kindTitle: String?, timeframeLabel: String?, first: Event) -> String`
  - `noMatch(kindTitle: String?, timeframeLabel: String?, next: Event?) -> String`
  - `whoIsSpeaking(event: Event) -> String`
  - `showTime(slotLabel: String, event: Event) -> String`
  - `mySchedule(timeframeLabel: String, events: [Event]) -> String`
  - `theme(summary: WeekThemeSummary) -> String`
  - `noTheme() -> String`
  - `offSeason(_ status: SeasonStatus, year: Int) -> String?` (nil when `.inSeason`)
  - `coldCache() -> String`

- [ ] **Step 1: Write the failing test**

```swift
// ios/ChqCalendarTests/IntentDialogTextTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins every spoken dialog shape for the #193 Siri surface. These are the
/// strings Siri reads aloud — changes here are user-facing copy changes.
struct IntentDialogTextTests {
    private var amp: Event {
        makeEvent(id: "a", start: ChqTime.parse("2026-07-14 20:15:00")!,
                  title: "An Evening with Yo-Yo Ma", location: "Amphitheater")
    }

    @Test func nextUpWithKind() {
        let s = IntentDialogText.nextUp(kindTitle: "symphony concerts", event: amp)
        #expect(s == "Next for symphony concerts: An Evening with Yo-Yo Ma — Tuesday, July 14 at 8:15 PM, Amphitheater.")
    }

    @Test func nextUpWithoutKindOrVenue() {
        let e = makeEvent(id: "b", start: ChqTime.parse("2026-07-14 20:15:00")!, title: "Mystery Event")
        #expect(IntentDialogText.nextUp(kindTitle: nil, event: e)
            == "Next up: Mystery Event — Tuesday, July 14 at 8:15 PM.")
    }

    @Test func listSummaryCountsAndNamesTheFirst() {
        let s = IntentDialogText.listSummary(count: 4, kindTitle: "movies", timeframeLabel: "this week", first: amp)
        #expect(s == "4 movies this week — first: An Evening with Yo-Yo Ma, Tuesday, July 14 at 8:15 PM.")
    }

    @Test func listSummaryWithoutKindSaysEvents() {
        let s = IntentDialogText.listSummary(count: 12, kindTitle: nil, timeframeLabel: "tomorrow", first: amp)
        #expect(s.hasPrefix("12 events tomorrow — first: "))
    }

    @Test func noMatchWithNextSuggestsIt() {
        let s = IntentDialogText.noMatch(kindTitle: "movies", timeframeLabel: "tonight", next: amp)
        #expect(s == "No movies tonight. Next one: Tuesday, July 14 at 8:15 PM.")
    }

    @Test func noMatchWithoutNextOrTimeframe() {
        #expect(IntentDialogText.noMatch(kindTitle: nil, timeframeLabel: nil, next: nil)
            == "No events coming up.")
    }

    @Test func whoIsSpeakingLeadsWithPresenter() {
        let e = makeEvent(id: "c", start: ChqTime.parse("2026-07-15 10:45:00")!,
                          title: "The Future of Democracy", location: "Amphitheater", presenter: "Jane Goodall")
        #expect(IntentDialogText.whoIsSpeaking(event: e)
            == "Jane Goodall speaks Wednesday, July 15 at 10:45 AM in the Amphitheater: The Future of Democracy.")
    }

    @Test func whoIsSpeakingWithoutPresenterFallsBackToNextUp() {
        let e = makeEvent(id: "d", start: ChqTime.parse("2026-07-15 10:45:00")!,
                          title: "Morning Lecture", location: "Amphitheater")
        #expect(IntentDialogText.whoIsSpeaking(event: e)
            == IntentDialogText.nextUp(kindTitle: "lectures", event: e))
    }

    @Test func showTime() {
        #expect(IntentDialogText.showTime(slotLabel: "evening show", event: amp)
            == "The evening show Tuesday, July 14 is An Evening with Yo-Yo Ma at 8:15 PM.")
    }

    @Test func myScheduleListsUpToThreeTitles() {
        let e1 = makeEvent(id: "1", start: ChqTime.parse("2026-07-15 09:00:00")!, title: "A")
        let e2 = makeEvent(id: "2", start: ChqTime.parse("2026-07-15 10:00:00")!, title: "B")
        #expect(IntentDialogText.mySchedule(timeframeLabel: "tomorrow", events: [e1, e2])
            == "You have 2 starred events tomorrow: A, B.")
        #expect(IntentDialogText.mySchedule(timeframeLabel: "today", events: [e1])
            == "You have 1 starred event today: A.")
        #expect(IntentDialogText.mySchedule(timeframeLabel: "today", events: [])
            == "Nothing starred for today yet.")
    }

    @Test func themeAndNoTheme() {
        let summary = WeekThemeSummary(weekNumber: 7, title: "The Human Brain", dateRange: "August 8–15")
        #expect(IntentDialogText.theme(summary: summary) == "Week 7 (August 8–15): The Human Brain.")
        #expect(IntentDialogText.noTheme() == "No theme is listed for that week.")
    }

    @Test func offSeasonMessages() throws {
        let start = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        #expect(IntentDialogText.offSeason(.preSeason(start: start), year: 2026)
            == "The 2026 season starts \(ChqTime.compactDayLabel(for: start)).")
        #expect(IntentDialogText.offSeason(.postSeason, year: 2026)
            == "The 2026 season has ended. Check back when next season is announced.")
        #expect(IntentDialogText.offSeason(.inSeason, year: 2026) == nil)
    }

    @Test func coldCache() {
        #expect(IntentDialogText.coldCache()
            == "Open CHQ Calendar once to load the season schedule, then ask again.")
    }
}
```

Note: `WeekThemeSummary`'s memberwise init — check `ios/ChqCalendarShared/Domain/WeekThemeSummary.swift` for the exact property order/labels and adjust the test's constructor call if it differs.

- [ ] **Step 2: Run tests to verify they fail** (`cannot find 'IntentDialogText'`).

- [ ] **Step 3: Write the implementation**

```swift
// ios/ChqCalendarShared/Domain/IntentDialogText.swift
import Foundation

/// Every spoken dialog string for the #193 Siri surface, as pure
/// functions returning `String` — the intents wrap these in
/// `IntentDialog` at the call site, so the exact copy Siri speaks is
/// unit-testable without the AppIntents runtime.
nonisolated enum IntentDialogText {
    private static func when(_ event: Event) -> String {
        "\(ChqTime.dayTitle(for: event.start)) at \(ChqTime.timeString(for: event.start))"
    }

    static func nextUp(kindTitle: String?, event: Event) -> String {
        let lead = kindTitle.map { "Next for \($0)" } ?? "Next up"
        let venue = event.displayLocation.map { ", \($0)" } ?? ""
        return "\(lead): \(event.title) — \(when(event))\(venue)."
    }

    static func listSummary(count: Int, kindTitle: String?, timeframeLabel: String?, first: Event) -> String {
        let what = kindTitle ?? "events"
        let scope = timeframeLabel.map { " \($0)" } ?? " coming up"
        return "\(count) \(what)\(scope) — first: \(first.title), \(when(first))."
    }

    static func noMatch(kindTitle: String?, timeframeLabel: String?, next: Event?) -> String {
        let what = kindTitle ?? "events"
        let scope = timeframeLabel ?? "coming up"
        let base = "No \(what) \(scope)."
        guard let next else { return base }
        return "\(base) Next one: \(when(next))."
    }

    static func whoIsSpeaking(event: Event) -> String {
        guard let presenter = event.presenter, !presenter.isEmpty else {
            return nextUp(kindTitle: "lectures", event: event)
        }
        let venue = event.displayLocation.map { " in the \($0)" } ?? ""
        return "\(presenter) speaks \(when(event))\(venue): \(event.title)."
    }

    static func showTime(slotLabel: String, event: Event) -> String {
        "The \(slotLabel) \(ChqTime.dayTitle(for: event.start)) is \(event.title) at \(ChqTime.timeString(for: event.start))."
    }

    static func mySchedule(timeframeLabel: String, events: [Event]) -> String {
        guard !events.isEmpty else { return "Nothing starred for \(timeframeLabel) yet." }
        let noun = events.count == 1 ? "starred event" : "starred events"
        let titles = events.prefix(3).map(\.title).joined(separator: ", ")
        return "You have \(events.count) \(noun) \(timeframeLabel): \(titles)."
    }

    static func theme(summary: WeekThemeSummary) -> String {
        "Week \(summary.weekNumber) (\(summary.dateRange)): \(summary.title)."
    }

    static func noTheme() -> String { "No theme is listed for that week." }

    static func offSeason(_ status: SeasonStatus, year: Int) -> String? {
        switch status {
        case .inSeason: return nil
        case .preSeason(let start):
            return "The \(year) season starts \(ChqTime.compactDayLabel(for: start))."
        case .postSeason:
            return "The \(year) season has ended. Check back when next season is announced."
        }
    }

    static func coldCache() -> String {
        "Open CHQ Calendar once to load the season schedule, then ask again."
    }
}
```

- [ ] **Step 4: Run tests to verify they pass.** If `dayTitle`/`timeString` formats differ from the test's expected literals (e.g. "Tuesday, July 14" vs another form), fix the TEST literals to the real formatter output — the formatters are pre-existing behavior.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/IntentDialogText.swift ios/ChqCalendarTests/IntentDialogTextTests.swift
git commit -m "feat(ios): spoken dialog builders for Siri intents (#193)"
```

---

### Task 4: `SharedSnapshotLoader.loadThemes` (shared)

**Files:**
- Modify: `ios/ChqCalendarShared/Data/SharedSnapshotLoader.swift`
- Test: `ios/ChqCalendarTests/SharedSnapshotLoaderTests.swift` (new)

**Interfaces:**
- Consumes: `DataCaching` (`cache.read(_ key: String)`), `WeeklyThemesFile` (`let weeks: [WeeklyTheme]`; `WeeklyTheme` has `number/title/startDate/endDate`) from `Models/Sidecars.swift`. Cache key literal is `"themes-\(year)"` — mirrors `RemoteResource.weeklyThemes(year:).cacheKey` (`ios/ChqCalendar/Data/CalendarAPI.swift:44`) and `EventRepository.cachedThemes` (`ios/ChqCalendar/Data/EventRepository.swift:221-229`); `RemoteResource` itself is app-target-only, hence the literal, same as `loadEvents`' `"events-\(year)"`.
- Produces: `static func loadThemes(year: Int, cache: DataCaching) -> [WeeklyTheme]` — Task 8 relies on this.

- [ ] **Step 1: Look at an existing `DiskCacheTests`/`FixtureLoading` test** to see how tests construct a `DiskCache`/`DataCaching` with seeded content, and reuse that pattern (likely a temp-directory `DiskCache` plus `cache.write`). Match it exactly.

- [ ] **Step 2: Write the failing test**

```swift
// ios/ChqCalendarTests/SharedSnapshotLoaderTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins `SharedSnapshotLoader.loadThemes` (#193): themes decode from the
/// same `themes-<year>` cache entry `EventRepository` writes, and any
/// missing/corrupt entry degrades to `[]`.
struct SharedSnapshotLoaderTests {
    // Use the project's existing temp-DiskCache test pattern here (see
    // DiskCacheTests). The JSON matches the weekly-themes sidecar wire
    // format (`WeeklyThemesFile`).
    private let themesJSON = """
    {"weeks":[{"number":7,"title":"The Human Brain","startDate":"2026-08-08","endDate":"2026-08-15"}]}
    """

    @Test func loadThemesDecodesCachedSidecar() throws {
        let cache = makeTempDiskCache() // per DiskCacheTests' pattern
        cache.write("themes-2026", data: Data(themesJSON.utf8))
        let themes = SharedSnapshotLoader.loadThemes(year: 2026, cache: cache)
        #expect(themes.map(\.number) == [7])
        #expect(themes.first?.title == "The Human Brain")
    }

    @Test func loadThemesToleratesMissingEntry() {
        let cache = makeTempDiskCache()
        #expect(SharedSnapshotLoader.loadThemes(year: 2026, cache: cache).isEmpty)
    }

    @Test func loadThemesToleratesCorruptEntry() {
        let cache = makeTempDiskCache()
        cache.write("themes-2026", data: Data("not json".utf8))
        #expect(SharedSnapshotLoader.loadThemes(year: 2026, cache: cache).isEmpty)
    }
}
```

Adjust `makeTempDiskCache()`/`cache.write` calls to the actual helper/API surface found in Step 1 (`DiskCache` may take `(directory:)` and `write` may take a `CacheEntry`). Also verify `WeeklyTheme`'s decode keys against `Sidecars.swift:32-41` and fix the fixture JSON if the field names differ.

- [ ] **Step 3: Run tests to verify they fail** (`loadThemes` not found).

- [ ] **Step 4: Implement** — add to `SharedSnapshotLoader`, matching its existing doc-comment style:

```swift
    /// Decodes the weekly-themes sidecar cached under `"themes-<year>"`
    /// (the same entry `EventRepository.cachedThemes` reads), or `[]` on
    /// any failure — same missing-data-degrades-to-nothing convention as
    /// every other loader here.
    static func loadThemes(year: Int, cache: DataCaching) -> [WeeklyTheme] {
        guard let entry = cache.read("themes-\(year)"),
              let file = try? JSONDecoder().decode(WeeklyThemesFile.self, from: entry.data)
        else {
            return []
        }
        return file.weeks
    }
```

- [ ] **Step 5: Run tests to verify they pass.**

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendarShared/Data/SharedSnapshotLoader.swift ios/ChqCalendarTests/SharedSnapshotLoaderTests.swift
git commit -m "feat(ios): SharedSnapshotLoader.loadThemes for the theme intent (#193)"
```

---

### Task 5: Selection engine — `IntentDataSource` extensions

**Files:**
- Modify: `ios/ChqCalendar/Data/IntentDataSource.swift`
- Test: `ios/ChqCalendarTests/IntentMatchingTests.swift` (new)

**Interfaces:**
- Consumes: `EventKind` (Task 1), `IntentTimeframe` (Task 2), existing `IntentDataSource.events(now:)` / `fallbackYear` / `DiskCache` / `SharedSnapshotLoader.loadYears`.
- Produces (all on `IntentDataSource`):
  - `static func defaultYear() async -> Int` — cached years manifest's `defaultYear` or `fallbackYear`.
  - `static func selectMatching(events: [Event], kind: EventKind?, timeframe: IntentTimeframe?, venue: String?, now: Date, year: Int) -> [Event]` — pure; no result cap (callers cap the *entities* they return; the dialog needs the true count).
  - `static func featured(in results: [Event]) -> Event?` — the event a single-answer dialog leads with.
  - `static func selectSchedule(events: [Event], favoriteIDs: Set<String>, timeframe: IntentTimeframe, now: Date, year: Int) -> [Event]`
  Tasks 7–10 rely on these exact signatures.

- [ ] **Step 1: Write the failing test**

```swift
// ios/ChqCalendarTests/IntentMatchingTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins the #193 composed selection engine: kind × timeframe × venue
/// filtering, flagship-venue featuring, and starred-schedule selection.
struct IntentMatchingTests {
    private let year = 2026
    private var now: Date { ChqTime.parse("2026-07-15 09:00:00")! }

    private var fixtures: [Event] {
        [
            makeEvent(id: "porch", start: ChqTime.parse("2026-07-15 10:00:00")!,
                      title: "Porch Chat", location: "Smith Wilkes Hall",
                      tags: ["chautauqua-lecture-series"]),
            makeEvent(id: "amp-lecture", start: ChqTime.parse("2026-07-15 10:45:00")!,
                      title: "Morning Lecture", location: "Amphitheater",
                      tags: ["chautauqua-lecture-series"], presenter: "Jane Goodall"),
            makeEvent(id: "movie", start: ChqTime.parse("2026-07-15 18:00:00")!,
                      title: "A Film", location: "Chautauqua Cinema"),
            makeEvent(id: "cso", start: ChqTime.parse("2026-07-16 20:15:00")!,
                      title: "CSO Concert", location: "Amphitheater",
                      tags: ["chautauqua-symphony-orchestra-classical-concerts"]),
            makeEvent(id: "cancelled", start: ChqTime.parse("2026-07-15 11:00:00")!,
                      tags: ["chautauqua-lecture-series"], status: .cancelled),
            makeEvent(id: "past", start: ChqTime.parse("2026-07-14 10:00:00")!,
                      tags: ["chautauqua-lecture-series"]),
        ]
    }

    @Test func kindFilterSelectsOnlyThatKindUpcoming() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: .lectures, timeframe: nil,
                                                venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["porch", "amp-lecture"])
    }

    @Test func timeframeFilterScopesToWindow() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: nil, timeframe: .today,
                                                venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["porch", "amp-lecture", "movie"])
    }

    @Test func tonightExcludesTheAfternoon() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: nil, timeframe: .tonight,
                                                venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["movie"])
    }

    @Test func venueFilterIsCaseInsensitive() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: nil, timeframe: nil,
                                                venue: "amphitheater", now: now, year: year)
        #expect(r.map(\.id) == ["amp-lecture", "cso"])
    }

    @Test func kindAndTimeframeCompose() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: .symphonyConcerts,
                                                timeframe: .tomorrow, venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["cso"])
    }

    @Test func cancelledAndPastAreAlwaysExcluded() {
        let ids = IntentDataSource.selectMatching(events: fixtures, kind: .lectures, timeframe: nil,
                                                  venue: nil, now: now, year: year).map(\.id)
        #expect(!ids.contains("cancelled"))
        #expect(!ids.contains("past"))
    }

    @Test func featuredPrefersFlagshipVenueOnTheSameDay() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: .lectures, timeframe: nil,
                                                venue: nil, now: now, year: year)
        // "porch" starts first, but the Amp lecture the same NY day leads.
        #expect(IntentDataSource.featured(in: r)?.id == "amp-lecture")
    }

    @Test func featuredFallsBackToFirstWhenNoFlagshipThatDay() {
        let r = [fixtures[0]] // porch only
        #expect(IntentDataSource.featured(in: r)?.id == "porch")
        #expect(IntentDataSource.featured(in: []) == nil)
    }

    @Test func scheduleSelectsOnlyStarredInWindow() {
        let r = IntentDataSource.selectSchedule(events: fixtures, favoriteIDs: ["porch", "cso"],
                                                timeframe: .today, now: now, year: year)
        #expect(r.map(\.id) == ["porch"])
    }
}
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement** — append to `IntentDataSource` (keep the existing members untouched; `selectUpcoming`/`selectToday` remain for the existing intents/queries):

```swift
    /// The cached years manifest's default year, or `fallbackYear` when
    /// nothing is cached yet — the year every #193 intent resolves
    /// timeframes against.
    static func defaultYear() async -> Int {
        let cache = DiskCache(directory: AppGroup.cacheDirectory())
        return SharedSnapshotLoader.loadYears(cache: cache)?.defaultYear ?? fallbackYear
    }

    /// The #193 composed selection: non-cancelled events, scoped to
    /// `timeframe`'s window (or strictly-after-`now` when `nil`),
    /// narrowed by `kind` and/or exact case-insensitive `venue`, soonest
    /// first. Uncapped — dialogs need the true match count; callers cap
    /// what they *return* separately.
    static func selectMatching(events: [Event], kind: EventKind?, timeframe: IntentTimeframe?,
                               venue: String?, now: Date, year: Int) -> [Event] {
        let venueKey = venue?.lowercased()
        let window = timeframe?.interval(now: now, year: year)
        return events
            .filter { $0.status != .cancelled }
            .filter { event in
                if let window { return window.contains(event.start) }
                return event.start > now
            }
            .filter { event in kind?.matches(event) ?? true }
            .filter { event in
                guard let venueKey else { return true }
                return event.displayLocation?.lowercased() == venueKey
            }
            .sorted { $0.start < $1.start }
    }

    /// The event a single-answer dialog should lead with: the first
    /// flagship-venue event on the same NY day as the soonest match, or
    /// the soonest match itself — "what's the next lecture" answers the
    /// 10:45 Amp lecture, not a porch chat.
    static func featured(in results: [Event]) -> Event? {
        guard let first = results.first else { return nil }
        let day = ChqTime.dayKey(for: first.start)
        return results.first {
            ChqTime.dayKey(for: $0.start) == day && EventKind.isFlagshipVenue($0.displayLocation)
        } ?? first
    }

    /// The user's starred events inside `timeframe`'s window, soonest
    /// first — the My Schedule intent's selection.
    static func selectSchedule(events: [Event], favoriteIDs: Set<String>, timeframe: IntentTimeframe,
                               now: Date, year: Int) -> [Event] {
        let window = timeframe.interval(now: now, year: year)
        return events
            .filter { $0.status != .cancelled }
            .filter { favoriteIDs.contains($0.id) }
            .filter { window.contains($0.start) }
            .sorted { $0.start < $1.start }
    }
```

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Data/IntentDataSource.swift ios/ChqCalendarTests/IntentMatchingTests.swift
git commit -m "feat(ios): composed kind/timeframe/venue selection engine (#193)"
```

---

### Task 6: AppEnum conformances + `VenueEntity`

**Files:**
- Create: `ios/ChqCalendar/Intents/IntentEnums.swift`
- Create: `ios/ChqCalendar/Intents/VenueEntity.swift`
- Test: `ios/ChqCalendarTests/IntentEnumsTests.swift` (new)

**Interfaces:**
- Consumes: `EventKind`, `IntentTimeframe` (Tasks 1–2), `WidgetConfigOptions.venueOptions(events:limit:) -> [String]`, `IntentDataSource.events(now:)`.
- Produces: `EventKind: AppEnum`, `IntentTimeframe: AppEnum`, `VenueEntity: AppEntity` (`let name: String`, `var id: String`), `VenueEntityQuery`. Task 7's `@Parameter`s rely on these.

- [ ] **Step 1: Write the failing cross-check test** (guards the literal-dictionary requirement against drift from the shared enum):

```swift
// ios/ChqCalendarTests/IntentEnumsTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// The AppEnum display representations must be LITERAL dictionaries (the
/// App Intents metadata processor const-extracts them at build time — a
/// computed dictionary can silently export nothing). These tests pin the
/// literals to the shared vocabulary so the two can never drift.
struct IntentEnumsTests {
    @Test func eventKindRepresentationsCoverAllCasesWithMatchingTitlesAndSynonyms() {
        for kind in EventKind.allCases {
            let rep = EventKind.caseDisplayRepresentations[kind]
            #expect(rep != nil, "missing display representation for \(kind)")
            #expect(String(localized: rep!.title) == kind.displayTitle)
            #expect(rep!.synonyms.map { String(localized: $0) } == kind.spokenSynonyms)
        }
    }

    @Test func timeframeRepresentationsCoverAllCasesWithMatchingTitles() {
        for tf in IntentTimeframe.allCases {
            let rep = IntentTimeframe.caseDisplayRepresentations[tf]
            #expect(rep != nil, "missing display representation for \(tf)")
            #expect(String(localized: rep!.title) == tf.spokenLabel)
        }
    }

    @Test func venueEntityUsesItsNameAsIdentity() {
        let venue = VenueEntity(name: "Amphitheater")
        #expect(venue.id == "Amphitheater")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement the conformances.** Write literal dictionaries whose values are copied from `EventKind.displayTitle`/`spokenSynonyms` and `IntentTimeframe.spokenLabel` — the Step 1 test enforces the copy stays exact.

```swift
// ios/ChqCalendar/Intents/IntentEnums.swift
import AppIntents
import Foundation

/// AppEnum conformances for the shared #193 vocabulary types. Kept in the
/// app target (not `ChqCalendarShared`) so the shared layer never depends
/// on AppIntents — same split as `EventEntity` vs `Event`.
///
/// The dictionaries below are deliberately LITERAL, duplicating
/// `displayTitle`/`spokenSynonyms`/`spokenLabel`: the App Intents
/// metadata processor const-extracts these at build time, and a computed
/// dictionary can silently export no synonyms. `IntentEnumsTests` pins
/// every literal to the shared source of truth, so drift fails CI.
///
/// `nonisolated`: AppEnum's static requirements are read off the main
/// actor by the Shortcuts/Siri runtime — see `EventEntity.swift`.
nonisolated extension EventKind: AppEnum {
    static let typeDisplayRepresentation =
        TypeDisplayRepresentation(name: "Kind of Event", synonyms: ["Type of Event"])

    static let caseDisplayRepresentations: [EventKind: DisplayRepresentation] = [
        .lectures: DisplayRepresentation(title: "lectures",
            synonyms: ["lecture", "talks", "talk", "speakers"]),
        .symphonyConcerts: DisplayRepresentation(title: "symphony concerts",
            synonyms: ["symphony", "the symphony", "CSO", "classical concerts", "orchestra concerts"]),
        .concerts: DisplayRepresentation(title: "concerts",
            synonyms: ["concert", "shows", "performances", "music", "entertainment"]),
        .movies: DisplayRepresentation(title: "movies",
            synonyms: ["movie", "films", "film", "cinema"]),
        .operas: DisplayRepresentation(title: "operas", synonyms: ["opera"]),
        .plays: DisplayRepresentation(title: "plays",
            synonyms: ["play", "theater", "theatre", "drama"]),
        .dance: DisplayRepresentation(title: "dance performances",
            synonyms: ["dance", "ballet"]),
        .worshipServices: DisplayRepresentation(title: "worship services",
            synonyms: ["services", "church services", "religious services", "sacred song services"]),
        .recreation: DisplayRepresentation(title: "recreation activities",
            synonyms: ["recreation", "sports", "fitness", "activities"]),
        .familyActivities: DisplayRepresentation(title: "family activities",
            synonyms: ["kids activities", "kids events", "youth programs", "children's activities"]),
    ]
}

nonisolated extension IntentTimeframe: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "When")

    static let caseDisplayRepresentations: [IntentTimeframe: DisplayRepresentation] = [
        .today: DisplayRepresentation(title: "today"),
        .tonight: DisplayRepresentation(title: "tonight"),
        .tomorrow: DisplayRepresentation(title: "tomorrow"),
        .thisWeek: DisplayRepresentation(title: "this week"),
        .nextWeek: DisplayRepresentation(title: "next week"),
        .week1: DisplayRepresentation(title: "week 1"),
        .week2: DisplayRepresentation(title: "week 2"),
        .week3: DisplayRepresentation(title: "week 3"),
        .week4: DisplayRepresentation(title: "week 4"),
        .week5: DisplayRepresentation(title: "week 5"),
        .week6: DisplayRepresentation(title: "week 6"),
        .week7: DisplayRepresentation(title: "week 7"),
        .week8: DisplayRepresentation(title: "week 8"),
        .week9: DisplayRepresentation(title: "week 9"),
    ]
}
```

```swift
// ios/ChqCalendar/Intents/VenueEntity.swift
import AppIntents
import Foundation

/// The venue slot for #193's parameterized phrases. An `AppEntity`
/// rather than the previous plain-`String` parameter because only enums
/// and entities may appear in an App Shortcut phrase — and entity values
/// reach Siri via `ChqShortcuts.updateAppShortcutParameters()`, called
/// whenever cached event data changes (see `WidgetReloading`).
///
/// `nonisolated` — same reasoning as `EventEntity`.
nonisolated struct VenueEntity: AppEntity {
    let name: String
    var id: String { name }

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Venue"
    static let defaultQuery = VenueEntityQuery()

    /// Spoken alternatives for the venues people abbreviate, keyed by
    /// lowercased feed name.
    private static let spokenSynonyms: [String: [String]] = [
        "amphitheater": ["the Amp", "the Amphitheater", "the amphitheatre"],
        "hall of philosophy": ["the Hall of Philosophy"],
        "chautauqua cinema": ["the cinema", "the movie theater"],
    ]

    var displayRepresentation: DisplayRepresentation {
        let synonyms = Self.spokenSynonyms[name.lowercased()] ?? []
        return DisplayRepresentation(
            title: "\(name)",
            subtitle: nil, image: nil,
            synonyms: synonyms.map { "\($0)" }
        )
    }
}

/// Venue values come from the same most-frequent-first ranking the
/// widget's venue picker uses, over the cached snapshot.
nonisolated struct VenueEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async -> [VenueEntity] {
        identifiers.map(VenueEntity.init(name:))
    }

    func suggestedEntities() async -> [VenueEntity] {
        WidgetConfigOptions.venueOptions(events: await IntentDataSource.events(now: Date()))
            .map(VenueEntity.init(name:))
    }
}
```

- [ ] **Step 4: Run the tests AND a full app build** (Global Constraints command with plain `build` instead of `test`, then the test command). The build gate matters here: the metadata processor must accept the conformances. Expected: tests pass, build succeeds with an `ExtractAppIntentsMetadata` step and no `appintentsmetadataprocessor` errors.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Intents/IntentEnums.swift ios/ChqCalendar/Intents/VenueEntity.swift ios/ChqCalendarTests/IntentEnumsTests.swift
git commit -m "feat(ios): AppEnum conformances + VenueEntity for Siri slots (#193)"
```

---

### Task 7: Extend `NextEventsIntent` + register its phrases

**Files:**
- Modify: `ios/ChqCalendar/Intents/EventIntents.swift` (the `NextEventsIntent` struct and the now-obsolete `NextEventsVenueOptionsProvider`)
- Modify: `ios/ChqCalendar/Intents/ChqShortcuts.swift`

**Interfaces:**
- Consumes: everything from Tasks 1–6 (`EventKind`, `IntentTimeframe`, `VenueEntity`, `IntentDataSource.selectMatching/featured/defaultYear`, `IntentDialogText.*`).
- Produces: `NextEventsIntent` with `@Parameter var kind: EventKind?`, `@Parameter var timeframe: IntentTimeframe?`, `@Parameter var venue: VenueEntity?`. Behavior change note: the venue parameter's type changes from `String?` to `VenueEntity?` — a user's saved Shortcut using the old venue will re-prompt once; acceptable pre-1.2.

- [ ] **Step 1: Replace `NextEventsIntent` and delete `NextEventsVenueOptionsProvider`** (its picker role is superseded by `VenueEntityQuery.suggestedEntities`):

```swift
/// "What's Next" — the #193 workhorse: upcoming events optionally
/// narrowed by kind of event, timeframe, or venue (each narrowable by
/// voice through its own phrase family — one parameter per phrase is a
/// platform rule), spoken back as a one-line dialog plus the full list
/// as a returned value. Selection and dialog copy live in
/// `IntentDataSource`/`IntentDialogText`, both unit-tested.
struct NextEventsIntent: AppIntent {
    static let title: LocalizedStringResource = "What's Next"

    @Parameter(title: "Kind of Event")
    var kind: EventKind?

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    @Parameter(title: "Venue")
    var venue: VenueEntity?

    /// How many events the returned value is capped at (the dialog's
    /// count is NOT capped — it reports the true match count).
    private static let entityLimit = 5

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let results = IntentDataSource.selectMatching(
            events: events, kind: kind, timeframe: timeframe, venue: venue?.name, now: now, year: year)
        let entities = results.prefix(Self.entityLimit).map(EventEntity.init(event:))

        guard let firstMatch = IntentDataSource.featured(in: results) else {
            if let offSeason = IntentDialogText.offSeason(SeasonStatus.make(now: now, year: year), year: year) {
                return .result(value: [], dialog: "\(offSeason)")
            }
            let next = IntentDataSource.selectMatching(
                events: events, kind: kind, timeframe: nil, venue: venue?.name, now: now, year: year).first
            let text = IntentDialogText.noMatch(
                kindTitle: kind?.displayTitle, timeframeLabel: timeframe?.spokenLabel, next: next)
            return .result(value: [], dialog: "\(text)")
        }

        let text: String
        if results.count == 1 {
            text = IntentDialogText.nextUp(kindTitle: kind?.displayTitle, event: firstMatch)
        } else if timeframe != nil {
            text = IntentDialogText.listSummary(
                count: results.count, kindTitle: kind?.displayTitle,
                timeframeLabel: timeframe?.spokenLabel, first: firstMatch)
        } else {
            text = IntentDialogText.nextUp(kindTitle: kind?.displayTitle, event: firstMatch)
        }
        return .result(value: entities, dialog: "\(text)")
    }
}
```

- [ ] **Step 2: Replace the "What's Next" `AppShortcut` in `ChqShortcuts.appShortcuts`** (keep the Today and Open Event shortcuts untouched). Every phrase has at most ONE `\(\.$…)` slot; a shortcut may mix phrases that parameterize different slots (spike-verified):

```swift
        AppShortcut(
            intent: NextEventsIntent(),
            phrases: [
                "What's next in \(.applicationName)",
                "What's coming up in \(.applicationName)",
                "What \(\.$kind) are playing in \(.applicationName)",
                "What \(\.$kind) are on in \(.applicationName)",
                "What \(\.$kind) are coming up in \(.applicationName)",
                "What's the next \(\.$kind) in \(.applicationName)",
                "When is the next \(\.$kind) in \(.applicationName)",
                "What \(\.$kind) are playing tonight in \(.applicationName)",
                "What \(\.$kind) are playing this week in \(.applicationName)",
                "What's happening \(\.$timeframe) in \(.applicationName)",
                "What's going on \(\.$timeframe) in \(.applicationName)",
                "What's coming up \(\.$timeframe) in \(.applicationName)",
                "What's happening at \(\.$venue) in \(.applicationName)",
                "What's playing at \(\.$venue) in \(.applicationName)",
                "What's next at \(\.$venue) in \(.applicationName)",
            ],
            shortTitle: "What's Next",
            systemImageName: "clock"
        )
```

Note the two literal-time kind phrases ("…playing tonight/this week"): the intent receives only `kind`, so the answer scopes to upcoming — the dialog says the scope it used, which the spec accepts ("Deliberately few of these…"). Also update `ChqShortcuts`'s doc comment: it still says "three Siri/Shortcuts phrases"; rewrite to describe the 7-shortcut #193 surface, keeping the "marketing copy must quote phrases, not titles" warning.

- [ ] **Step 3: Full build + full test suite** (both Global Constraints commands). Expected: metadata processor accepts all phrases (no "Multiple parameters" error); all existing tests still pass (`IntentSelectionTests` covers `selectUpcoming`, which is untouched).

- [ ] **Step 4: Inspect the exported phrases** (sanity check that the enum titles read grammatically):

```bash
cd ios && xcodebuild -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/chq-193-dd build > /dev/null 2>&1
/usr/bin/compression_tool -decode \
  -i /tmp/chq-193-dd/Build/Products/Debug-iphonesimulator/ChqCalendar.app/Metadata.appintents/nlu/nlu.lzfse \
  -o /tmp/chq-193-nlu.bin -a lzfse
strings /tmp/chq-193-nlu.bin | grep -i "playing in CHQ" | head
```

Expected: utterances like "What movies are playing in CHQ Calendar" (plural, grammatical). If a title reads badly in situ, fix the title in BOTH `EventKind.displayTitle` and the Task 6 literal (the cross-check test keeps them honest).

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Intents/EventIntents.swift ios/ChqCalendar/Intents/ChqShortcuts.swift
git commit -m "feat(ios): kind/timeframe/venue parameters + phrases for What's Next (#193)"
```

---

### Task 8: `WeekThemeIntent`

**Files:**
- Create: `ios/ChqCalendarShared/Domain/ThemeWeek.swift`
- Create: `ios/ChqCalendar/Intents/WeekThemeIntent.swift`
- Modify: `ios/ChqCalendar/Intents/IntentEnums.swift` (add `ThemeWeek: AppEnum`)
- Modify: `ios/ChqCalendar/Intents/ChqShortcuts.swift` (add shortcut)
- Test: `ios/ChqCalendarTests/ThemeWeekTests.swift` (new); extend `IntentEnumsTests.swift`

**Interfaces:**
- Consumes: `SeasonCalendar.currentWeekNumber(at:year:)`, `SharedSnapshotLoader.loadThemes(year:cache:)` (Task 4), `WeekThemeSummary.make(forWeek:in:)`, `IntentDialogText.theme/noTheme/offSeason/coldCache`.
- Produces: `ThemeWeek: String, CaseIterable, Sendable` with `var spokenLabel: String`, `func weekNumber(now: Date, year: Int) -> Int?`; `WeekThemeIntent`.

- [ ] **Step 1: Write the failing test**

```swift
// ios/ChqCalendarTests/ThemeWeekTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins #193's theme-week vocabulary → season week number resolution.
struct ThemeWeekTests {
    private let year = 2026

    @Test func thisWeekResolvesTheCurrentSeasonWeek() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00")) // week 3
        #expect(ThemeWeek.thisWeek.weekNumber(now: now, year: year) == 3)
    }

    @Test func nextWeekResolvesTheFollowingWeekAndCapsAtNine() throws {
        let midSeason = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        #expect(ThemeWeek.nextWeek.weekNumber(now: midSeason, year: year) == 4)
        let weekNine = try #require(ChqTime.parse("2026-08-26 10:00:00"))
        #expect(ThemeWeek.nextWeek.weekNumber(now: weekNine, year: year) == nil)
    }

    @Test func relativeWeeksAreNilOffSeason() throws {
        let october = try #require(ChqTime.parse("2026-10-01 10:00:00"))
        #expect(ThemeWeek.thisWeek.weekNumber(now: october, year: year) == nil)
        #expect(ThemeWeek.nextWeek.weekNumber(now: october, year: year) == nil)
    }

    @Test func explicitWeeksAlwaysResolve() throws {
        let october = try #require(ChqTime.parse("2026-10-01 10:00:00"))
        #expect(ThemeWeek.week7.weekNumber(now: october, year: year) == 7)
    }
}
```

Also add to `IntentEnumsTests`:

```swift
    @Test func themeWeekRepresentationsCoverAllCases() {
        for w in ThemeWeek.allCases {
            let rep = ThemeWeek.caseDisplayRepresentations[w]
            #expect(rep != nil, "missing display representation for \(w)")
            #expect(String(localized: rep!.title) == w.spokenLabel)
        }
    }
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement.**

```swift
// ios/ChqCalendarShared/Domain/ThemeWeek.swift
import Foundation

/// The week slot for #193's theme queries ("what's the theme week 7") —
/// separate from `IntentTimeframe` because only weeks make sense here
/// ("what's the theme tonight" is not a question).
nonisolated enum ThemeWeek: String, CaseIterable, Sendable {
    case thisWeek, nextWeek
    case week1, week2, week3, week4, week5, week6, week7, week8, week9

    var spokenLabel: String {
        switch self {
        case .thisWeek: return "this week"
        case .nextWeek: return "next week"
        case .week1: return "week 1"
        case .week2: return "week 2"
        case .week3: return "week 3"
        case .week4: return "week 4"
        case .week5: return "week 5"
        case .week6: return "week 6"
        case .week7: return "week 7"
        case .week8: return "week 8"
        case .week9: return "week 9"
        }
    }

    /// The season week this resolves to at `now`, or `nil` when there
    /// isn't one (relative cases out of season; "next week" during week 9).
    func weekNumber(now: Date, year: Int) -> Int? {
        switch self {
        case .thisWeek:
            return SeasonCalendar.currentWeekNumber(at: now, year: year)
        case .nextWeek:
            guard let n = SeasonCalendar.currentWeekNumber(at: now, year: year), n < 9 else { return nil }
            return n + 1
        case .week1: return 1
        case .week2: return 2
        case .week3: return 3
        case .week4: return 4
        case .week5: return 5
        case .week6: return 6
        case .week7: return 7
        case .week8: return 8
        case .week9: return 9
        }
    }
}
```

```swift
// ios/ChqCalendar/Intents/WeekThemeIntent.swift
import AppIntents
import Foundation

/// "Weekly Theme" (#193) — answers "what's the theme this week / week 7"
/// from the already-cached weekly-themes sidecar. Dialog-only (no
/// returned value: a theme isn't an entity anything else consumes).
struct WeekThemeIntent: AppIntent {
    static let title: LocalizedStringResource = "Weekly Theme"

    @Parameter(title: "Week")
    var week: ThemeWeek?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let now = Date()
        let year = await IntentDataSource.defaultYear()
        let themes = SharedSnapshotLoader.loadThemes(
            year: year, cache: DiskCache(directory: AppGroup.cacheDirectory()))
        guard !themes.isEmpty else {
            return .result(dialog: "\(IntentDialogText.coldCache())")
        }
        guard let number = (week ?? .thisWeek).weekNumber(now: now, year: year) else {
            let status = SeasonStatus.make(now: now, year: year)
            let text = IntentDialogText.offSeason(status, year: year) ?? IntentDialogText.noTheme()
            return .result(dialog: "\(text)")
        }
        guard let summary = WeekThemeSummary.make(forWeek: number, in: themes) else {
            return .result(dialog: "\(IntentDialogText.noTheme())")
        }
        return .result(dialog: "\(IntentDialogText.theme(summary: summary))")
    }
}
```

Add to `IntentEnums.swift` (literal, like the others):

```swift
nonisolated extension ThemeWeek: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Week")

    static let caseDisplayRepresentations: [ThemeWeek: DisplayRepresentation] = [
        .thisWeek: DisplayRepresentation(title: "this week"),
        .nextWeek: DisplayRepresentation(title: "next week"),
        .week1: DisplayRepresentation(title: "week 1"),
        .week2: DisplayRepresentation(title: "week 2"),
        .week3: DisplayRepresentation(title: "week 3"),
        .week4: DisplayRepresentation(title: "week 4"),
        .week5: DisplayRepresentation(title: "week 5"),
        .week6: DisplayRepresentation(title: "week 6"),
        .week7: DisplayRepresentation(title: "week 7"),
        .week8: DisplayRepresentation(title: "week 8"),
        .week9: DisplayRepresentation(title: "week 9"),
    ]
}
```

Add to `ChqShortcuts.appShortcuts`:

```swift
        AppShortcut(
            intent: WeekThemeIntent(),
            phrases: [
                "What's the theme \(\.$week) in \(.applicationName)",
                "What is the theme \(\.$week) in \(.applicationName)",
                "What's the weekly theme in \(.applicationName)",
            ],
            shortTitle: "Weekly Theme",
            systemImageName: "lightbulb"
        )
```

- [ ] **Step 4: Run tests + full build** (metadata gate). Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/ThemeWeek.swift ios/ChqCalendar/Intents/WeekThemeIntent.swift ios/ChqCalendar/Intents/IntentEnums.swift ios/ChqCalendar/Intents/ChqShortcuts.swift ios/ChqCalendarTests/ThemeWeekTests.swift ios/ChqCalendarTests/IntentEnumsTests.swift
git commit -m "feat(ios): WeekThemeIntent — 'what's the theme this week' (#193)"
```

---

### Task 9: `MyScheduleIntent`

**Files:**
- Create: `ios/ChqCalendar/Intents/MyScheduleIntent.swift`
- Modify: `ios/ChqCalendar/Intents/ChqShortcuts.swift` (add shortcut)

**Interfaces:**
- Consumes: `SharedSnapshotLoader.loadFavorites(defaults:now:)`, `AppGroup.userDefaults()`, `IntentDataSource.selectSchedule` (Task 5), `IntentDialogText.mySchedule/coldCache`. Selection and dialog are already fully covered by `IntentMatchingTests.scheduleSelectsOnlyStarredInWindow` and `IntentDialogTextTests.myScheduleListsUpToThreeTitles`, so this task is wiring only — the build is the gate.

- [ ] **Step 1: Implement.**

```swift
// ios/ChqCalendar/Intents/MyScheduleIntent.swift
import AppIntents
import Foundation

/// "My Schedule" (#193) — "what am I doing tomorrow": the user's starred
/// events (same favorites store the StarredWidget reads) inside the
/// spoken timeframe, defaulting to today.
struct MyScheduleIntent: AppIntent {
    static let title: LocalizedStringResource = "My Schedule"

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let favorites = SharedSnapshotLoader.loadFavorites(defaults: AppGroup.userDefaults(), now: now)
        let scope = timeframe ?? .today
        let results = IntentDataSource.selectSchedule(
            events: events, favoriteIDs: favorites, timeframe: scope, now: now, year: year)
        let text = IntentDialogText.mySchedule(timeframeLabel: scope.spokenLabel, events: results)
        return .result(value: results.map(EventEntity.init(event:)), dialog: "\(text)")
    }
}
```

Add to `ChqShortcuts.appShortcuts`:

```swift
        AppShortcut(
            intent: MyScheduleIntent(),
            phrases: [
                "What am I doing \(\.$timeframe) in \(.applicationName)",
                "What am I doing in \(.applicationName)",
                "What's on my schedule \(\.$timeframe) in \(.applicationName)",
                "What's my plan \(\.$timeframe) in \(.applicationName)",
            ],
            shortTitle: "My Schedule",
            systemImageName: "star"
        )
```

- [ ] **Step 2: Full build + full test suite.** Expected: green.

- [ ] **Step 3: Commit**

```bash
git add ios/ChqCalendar/Intents/MyScheduleIntent.swift ios/ChqCalendar/Intents/ChqShortcuts.swift
git commit -m "feat(ios): MyScheduleIntent — 'what am I doing tomorrow' (#193)"
```

---

### Task 10: `WhoIsSpeakingIntent` + `ShowTimeIntent`

**Files:**
- Create: `ios/ChqCalendarShared/Domain/DaypartSlot.swift`
- Create: `ios/ChqCalendar/Intents/FlagshipIntents.swift`
- Modify: `ios/ChqCalendar/Intents/IntentEnums.swift` (add `DaypartSlot: AppEnum`)
- Modify: `ios/ChqCalendar/Intents/ChqShortcuts.swift` (add 2 shortcuts)
- Test: `ios/ChqCalendarTests/DaypartSlotTests.swift` (new); extend `IntentEnumsTests.swift`

**Interfaces:**
- Consumes: `EventKind.lectures.matches`, `ChqTime.calendar`, `IntentDataSource.selectMatching/featured`, `IntentDialogText.whoIsSpeaking/showTime/noMatch/coldCache`.
- Produces: `DaypartSlot: String, CaseIterable, Sendable` with `var spokenLabel: String`, `func matches(_ event: Event) -> Bool`; `WhoIsSpeakingIntent` (param `timeframe: IntentTimeframe?`); `ShowTimeIntent` (param `slot: DaypartSlot`, non-optional).

- [ ] **Step 1: Write the failing test**

```swift
// ios/ChqCalendarTests/DaypartSlotTests.swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins #193's "evening show" / "morning lecture" slot rules: flagship
/// Amphitheater events, split by NY-time start hour.
struct DaypartSlotTests {
    @Test func eveningShowIsAnAmpEventAtOrAfterSixPM() {
        let show = makeEvent(id: "a", start: ChqTime.parse("2026-07-15 20:15:00")!, location: "Amphitheater")
        let morning = makeEvent(id: "b", start: ChqTime.parse("2026-07-15 10:45:00")!, location: "Amphitheater")
        let elsewhere = makeEvent(id: "c", start: ChqTime.parse("2026-07-15 20:15:00")!, location: "Bratton Theater")
        #expect(DaypartSlot.eveningShow.matches(show))
        #expect(!DaypartSlot.eveningShow.matches(morning))
        #expect(!DaypartSlot.eveningShow.matches(elsewhere))
    }

    @Test func morningLectureIsAMorningAmpLecture() {
        let lecture = makeEvent(id: "a", start: ChqTime.parse("2026-07-15 10:45:00")!,
                                location: "Amphitheater", tags: ["chautauqua-lecture-series"])
        let worship = makeEvent(id: "b", start: ChqTime.parse("2026-07-15 09:15:00")!,
                                location: "Amphitheater", tags: ["service"])
        let evening = makeEvent(id: "c", start: ChqTime.parse("2026-07-15 20:15:00")!,
                                location: "Amphitheater", tags: ["chautauqua-lecture-series"])
        #expect(DaypartSlot.morningLecture.matches(lecture))
        #expect(!DaypartSlot.morningLecture.matches(worship))
        #expect(!DaypartSlot.morningLecture.matches(evening))
    }
}
```

Also add to `IntentEnumsTests`:

```swift
    @Test func daypartSlotRepresentationsCoverAllCases() {
        for s in DaypartSlot.allCases {
            let rep = DaypartSlot.caseDisplayRepresentations[s]
            #expect(rep != nil, "missing display representation for \(s)")
            #expect(String(localized: rep!.title) == s.spokenLabel)
        }
    }
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement.**

```swift
// ios/ChqCalendarShared/Domain/DaypartSlot.swift
import Foundation

/// The "what time is the evening show / morning lecture" slot (#193):
/// the two flagship daily Amphitheater programs, identified by venue +
/// NY-time start hour (the feed has no "flagship" flag).
nonisolated enum DaypartSlot: String, CaseIterable, Sendable {
    case eveningShow
    case morningLecture

    var spokenLabel: String {
        switch self {
        case .eveningShow: return "evening show"
        case .morningLecture: return "morning lecture"
        }
    }

    func matches(_ event: Event) -> Bool {
        guard event.displayLocation?.lowercased() == "amphitheater" else { return false }
        let hour = ChqTime.calendar.component(.hour, from: event.start)
        switch self {
        case .eveningShow: return hour >= 18
        case .morningLecture: return EventKind.lectures.matches(event) && (9...12).contains(hour)
        }
    }
}
```

```swift
// ios/ChqCalendar/Intents/FlagshipIntents.swift
import AppIntents
import Foundation

/// "Who's Speaking" (#193) — "who is speaking tomorrow": the flagship
/// lecture answer, leading with the presenter's name. A dedicated intent
/// because a phrase cannot preset another intent's parameters — this IS
/// `NextEventsIntent(kind: .lectures)` with a presenter-first dialog.
struct WhoIsSpeakingIntent: AppIntent {
    static let title: LocalizedStringResource = "Who's Speaking"

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let scope = timeframe ?? .today
        let results = IntentDataSource.selectMatching(
            events: events, kind: .lectures, timeframe: scope, venue: nil, now: now, year: year)
        guard let featured = IntentDataSource.featured(in: results) else {
            let next = IntentDataSource.selectMatching(
                events: events, kind: .lectures, timeframe: nil, venue: nil, now: now, year: year).first
            let text = IntentDialogText.noMatch(
                kindTitle: "lectures", timeframeLabel: scope.spokenLabel, next: next)
            return .result(value: [], dialog: "\(text)")
        }
        let entities = results.prefix(5).map(EventEntity.init(event:))
        return .result(value: entities, dialog: "\(IntentDialogText.whoIsSpeaking(event: featured))")
    }
}

/// "Show Time" (#193) — "what time is the evening show": the next
/// flagship Amphitheater program of the requested daypart.
struct ShowTimeIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Time"

    @Parameter(title: "Show")
    var slot: DaypartSlot

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let upcoming = IntentDataSource.selectMatching(
            events: events, kind: nil, timeframe: nil, venue: nil, now: now, year: year)
        guard let match = upcoming.first(where: { slot.matches($0) }) else {
            let text = IntentDialogText.noMatch(kindTitle: nil, timeframeLabel: nil, next: nil)
            return .result(value: [], dialog: "\(text)")
        }
        return .result(value: [EventEntity(event: match)],
                       dialog: "\(IntentDialogText.showTime(slotLabel: slot.spokenLabel, event: match))")
    }
}
```

Add to `IntentEnums.swift`:

```swift
nonisolated extension DaypartSlot: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Show")

    static let caseDisplayRepresentations: [DaypartSlot: DisplayRepresentation] = [
        .eveningShow: DisplayRepresentation(title: "evening show",
            synonyms: ["tonight's show", "evening performance", "show tonight"]),
        .morningLecture: DisplayRepresentation(title: "morning lecture",
            synonyms: ["10:45 lecture", "morning talk"]),
    ]
}
```

Add to `ChqShortcuts.appShortcuts` (final count: 7 shortcuts):

```swift
        AppShortcut(
            intent: WhoIsSpeakingIntent(),
            phrases: [
                "Who is speaking \(\.$timeframe) in \(.applicationName)",
                "Who's speaking \(\.$timeframe) in \(.applicationName)",
                "Who is speaking in \(.applicationName)",
            ],
            shortTitle: "Who's Speaking",
            systemImageName: "person.wave.2"
        )
        AppShortcut(
            intent: ShowTimeIntent(),
            phrases: [
                "What time is the \(\.$slot) in \(.applicationName)",
                "When is the \(\.$slot) in \(.applicationName)",
            ],
            shortTitle: "Show Time",
            systemImageName: "clock.badge.questionmark"
        )
```

- [ ] **Step 4: Run tests + full build** (metadata gate). Expected: green.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DaypartSlot.swift ios/ChqCalendar/Intents/FlagshipIntents.swift ios/ChqCalendar/Intents/IntentEnums.swift ios/ChqCalendar/Intents/ChqShortcuts.swift ios/ChqCalendarTests/DaypartSlotTests.swift ios/ChqCalendarTests/IntentEnumsTests.swift
git commit -m "feat(ios): WhoIsSpeaking + ShowTime intents (#193)"
```

---

### Task 11: Alternative app names + shortcut-parameter refresh

**Files:**
- Modify: `ios/ChqCalendar/Info.plist`
- Modify: `ios/ChqCalendar/App/WidgetReloading.swift`

**Interfaces:**
- Consumes: `ChqShortcuts` (any `AppShortcutsProvider` exposes the static `updateAppShortcutParameters()`).
- Produces: nothing new for later tasks. No unit test — both changes are runtime/system-facing (this is the on-device checklist's territory); the build is the gate.

- [ ] **Step 1: Read `ios/ChqCalendar/Info.plist`** to see its current structure, then add inside the top-level `<dict>`:

```xml
	<key>INAlternativeAppNames</key>
	<array>
		<dict>
			<key>INAlternativeAppName</key>
			<string>Chautauqua</string>
			<key>INAlternativeAppNamePronunciationHint</key>
			<string>shuh-TAW-kwuh</string>
		</dict>
		<dict>
			<key>INAlternativeAppName</key>
			<string>Chautauqua Calendar</string>
		</dict>
		<dict>
			<key>INAlternativeAppName</key>
			<string>CHQ</string>
		</dict>
	</array>
```

(Hard limit is 3 entries; these are the spec's three names.)

- [ ] **Step 2: Add the parameter refresh to `LiveWidgetReloading.reloadAll()`** in `WidgetReloading.swift`:

```swift
struct LiveWidgetReloading: WidgetReloading {
    func reloadAll() {
        WidgetCenter.shared.reloadAllTimelines()
        // Same trigger, same reason: cached data a system surface renders
        // from has changed. Republishing the App Shortcut parameter values
        // keeps Siri's venue vocabulary (`VenueEntity`) in step with the
        // feed — without this, venue-slot phrases resolve against stale or
        // empty values until the next app install.
        ChqShortcuts.updateAppShortcutParameters()
    }
}
```

Extend the type's existing doc comment ("Asks WidgetKit to reload…") to mention the shortcut-parameter refresh responsibility.

- [ ] **Step 3: Full build + full test suite.** Expected: green (existing `WidgetReloadingTests` exercise the protocol seam, not the live conformance, so nothing breaks).

- [ ] **Step 4: Commit**

```bash
git add ios/ChqCalendar/Info.plist ios/ChqCalendar/App/WidgetReloading.swift
git commit -m "feat(ios): 'Chautauqua'/'CHQ' alternative app names + Siri venue refresh (#193)"
```

---

### Task 12: "Ask Siri" section on the About sheet

**Files:**
- Modify: `ios/ChqCalendar/Features/About/AboutInfo.swift`
- Modify: `ios/ChqCalendar/Features/About/AboutView.swift`
- Test: extend `ios/ChqCalendarTests/AboutInfoTests.swift`

**Interfaces:**
- Consumes: `NextEventsIntent` (for `SiriTipView`), SwiftUI + AppIntents (`SiriTipView`, `ShortcutsLink`).
- Produces: `AboutInfo.SiriPhrase` (`id`, `phrase`) and `AboutInfo.siriPhrases: [SiriPhrase]`.

- [ ] **Step 1: Write the failing test** (add to `AboutInfoTests.swift`, matching its existing style):

```swift
    @Test func siriPhrasesQuoteSpokenFormsWithAnAppName() {
        #expect(!AboutInfo.siriPhrases.isEmpty)
        for p in AboutInfo.siriPhrases {
            // Every listed phrase must contain a form Siri actually routes
            // on — the app name or an INAlternativeAppNames entry.
            #expect(p.phrase.contains("Chautauqua") || p.phrase.contains("CHQ"),
                    "phrase lacks an app name: \(p.phrase)")
        }
        #expect(Set(AboutInfo.siriPhrases.map(\.id)).count == AboutInfo.siriPhrases.count)
    }
```

- [ ] **Step 2: Run to verify it fails** (`siriPhrases` not found).

- [ ] **Step 3: Implement.** In `AboutInfo.swift`, after `quickLinks`:

```swift
    /// Example Siri phrases surfaced on the About sheet (#193). These
    /// quote the *spoken* forms — including the "Chautauqua" alternative
    /// app name — matching the registered `ChqShortcuts` phrase templates
    /// (quote phrases, not intent titles; see ChqShortcuts.swift).
    struct SiriPhrase: Identifiable, Equatable {
        let id: String
        let phrase: String
    }

    static let siriPhrases: [SiriPhrase] = [
        SiriPhrase(id: "next", phrase: "What's coming up in Chautauqua?"),
        SiriPhrase(id: "movies", phrase: "What movies are playing in Chautauqua?"),
        SiriPhrase(id: "symphony", phrase: "What's the next symphony in Chautauqua?"),
        SiriPhrase(id: "tonight", phrase: "What's happening tonight in Chautauqua?"),
        SiriPhrase(id: "speaking", phrase: "Who is speaking tomorrow in Chautauqua?"),
        SiriPhrase(id: "theme", phrase: "What's the theme this week in Chautauqua?"),
        SiriPhrase(id: "myday", phrase: "What am I doing tomorrow in Chautauqua?"),
    ]
```

In `AboutView.swift`, add `import AppIntents` at the top, then a new `Section` after the disclaimer section:

```swift
                Section {
                    SiriTipView(intent: NextEventsIntent())
                    ForEach(AboutInfo.siriPhrases) { item in
                        Text("“\(item.phrase)”")
                            .font(.callout)
                    }
                    ShortcutsLink()
                } header: {
                    Text("Ask Siri")
                } footer: {
                    Text("Siri also understands “CHQ” and “CHQ Calendar” as the app's name.")
                }
```

- [ ] **Step 4: Run tests + full build.** Expected: green.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Features/About/AboutInfo.swift ios/ChqCalendar/Features/About/AboutView.swift ios/ChqCalendarTests/AboutInfoTests.swift
git commit -m "feat(ios): Ask Siri discovery section on the About sheet (#193)"
```

---

### Task 13: One-time Siri tip on My Day

**Files:**
- Modify: `ios/ChqCalendar/Features/MyDay/MyDayView.swift`

**Interfaces:**
- Consumes: `MyScheduleIntent` (Task 9), `SiriTipView(intent:isVisible:)`. No unit test — pure SwiftUI presentation with a system-managed dismiss; the build is the gate (matching the project's "test logic, not SwiftUI bodies" convention).

- [ ] **Step 1: Implement.** In `MyDayView.swift`: add `import AppIntents`; add a persisted visibility flag alongside the existing `@State`:

```swift
    /// One-time discovery tip for the My Schedule Siri phrase (#193) —
    /// shown only where it's personally relevant (the user has starred
    /// days), dismissed forever via the tip's own close button.
    @AppStorage("chq-myday-siri-tip-visible") private var siriTipVisible = true
```

In `planContent(for:availableDays:)` (the non-empty branch of `content`), insert the tip above the plan list (exact insertion point: the top of that view builder's vertical structure — read the method and place it as the first element):

```swift
            if siriTipVisible {
                SiriTipView(intent: MyScheduleIntent(), isVisible: $siriTipVisible)
                    .padding(.horizontal)
            }
```

Note: `@AppStorage` requires the property owner be a SwiftUI view (it is) — do NOT add it to `AppModel`.

- [ ] **Step 2: Full build + full test suite.** Expected: green.

- [ ] **Step 3: Commit**

```bash
git add ios/ChqCalendar/Features/MyDay/MyDayView.swift
git commit -m "feat(ios): one-time My Schedule Siri tip on My Day (#193)"
```

---

### Task 14: Final verification, screenshots, listing copy, PR

**Files:**
- Possibly regenerate: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/`
- Re-read: `docs/app-store/listing-copy.md`, `docs/app-store/listing-fields.json`

- [ ] **Step 1: Full test suite + full build** (both Global Constraints commands). Everything green; fix anything red before proceeding.

- [ ] **Step 2: Phrase-export sanity sweep** (repeat Task 7 Step 4's `nlu.lzfse` inspection): every registered phrase family appears; spot-check "What movies are playing in CHQ Calendar", "What's the theme this week in CHQ Calendar", "What am I doing today in CHQ Calendar".

- [ ] **Step 3: App Store assets rule** (CLAUDE.md): this PR changes user-visible screens (About sheet, My Day tip). Run:

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

The shot list (`ios/Scripts/screenshot-plan.json`) covers `07-my-day` — the Siri tip may appear there. Commit any manifest/review-copy changes. If the manifest is unchanged (tip not visible in the shot's fixture state and About isn't a covered shot), put `[skip-screenshots: regenerated, no covered shot changed]` in the PR description.

- [ ] **Step 4: Listing copy re-read.** Check `docs/app-store/listing-copy.md` + `listing-fields.json` for claims the change invalidates (there should be none — this adds capability). Add Siri examples to the 1.2 `whatsNew` draft if one exists; do not invent new listing claims beyond what shipped.

- [ ] **Step 5: Push and open the PR** against `main`, base branch `siri-vocabulary-193`, titled `feat(ios): Siri interaction vocabulary (#193)`. PR body must include: summary, link to spec + this plan, the `[skip-screenshots: …]` line if applicable, and this **on-device checklist** (copy verbatim — none of it is CI-verifiable):

```markdown
## On-device Siri checklist (before 1.2 submission)
- [ ] "Hey Siri, what movies are playing in Chautauqua" → movie answer (alternative app name works)
- [ ] "Hey Siri, what's the next symphony in CHQ Calendar" → CSO answer (synonym "symphony" → symphony concerts)
- [ ] "Hey Siri, what's happening this week in CHQ" → list answer ("CHQ" alternative name)
- [ ] "Hey Siri, what's the theme this week in Chautauqua" → theme answer
- [ ] "Hey Siri, what am I doing tomorrow in Chautauqua" (with starred events) → schedule answer
- [ ] "Hey Siri, who is speaking tomorrow in Chautauqua" → presenter-led answer
- [ ] "Hey Siri, what time is the evening show in Chautauqua" → time answer
- [ ] Venue phrase after fresh install + one app launch: "what's happening at the Amp in Chautauqua"
- [ ] Shortcuts app lists 7 CHQ Calendar shortcuts with sensible parameter pickers
- [ ] About sheet: Ask Siri section renders; SiriTipView adds the shortcut; ShortcutsLink opens Shortcuts
- [ ] My Day: Siri tip appears once, dismiss sticks across relaunch
```

- [ ] **Step 6: Update the GitHub issue.** Comment on #193 with the PR link and a one-paragraph summary of the phrase surface.

---

## Spec deviations (deliberate, from the SDK spike)

1. **"Fixed phrases" became two tiny intents** (`WhoIsSpeakingIntent`, `ShowTimeIntent`) — a phrase cannot preset another intent's parameter values.
2. **"Week out of range" dialog dropped** — the week slot is an enum of weeks 1–9, so an out-of-range week is unrepresentable.
3. **7 App Shortcuts, not 5** — consequence of deviation 1. Still under the 10 cap.
