import Foundation
import Testing
@testable import ChqCalendar

/// Pins the pure selection/ranking logic behind the App Intents / Siri
/// Shortcuts surface (#180) — `IntentDataSource.selectToday`/`selectUpcoming`,
/// `EventEntityQuery.rank`, and the `PendingIntentLink` handoff — all
/// exercisable without the AppIntents runtime. All dates are constructed via
/// `ChqTime.parse` (no `Date()` in the logic under test), matching the rest
/// of the domain layer's testing style.
struct IntentSelectionTests {
    // MARK: - IntentDataSource.selectToday

    @Test func selectTodayIncludesAnEventLateTonightNewYorkTime() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let lateTonight = try #require(ChqTime.parse("2026-07-15 23:30:00"))
        let events = [makeEvent(id: "a", start: lateTonight)]

        let result = IntentDataSource.selectToday(events: events, now: now)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func selectTodayExcludesAnEventAfterMidnightNewYorkTime() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let afterMidnight = try #require(ChqTime.parse("2026-07-16 00:15:00"))
        let events = [makeEvent(id: "a", start: afterMidnight)]

        let result = IntentDataSource.selectToday(events: events, now: now)

        #expect(result.isEmpty)
    }

    @Test func selectTodayExcludesCancelledEvents() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let sameDay = try #require(ChqTime.parse("2026-07-15 14:00:00"))
        let events = [makeEvent(id: "a", start: sameDay, status: .cancelled)]

        let result = IntentDataSource.selectToday(events: events, now: now)

        #expect(result.isEmpty)
    }

    @Test func selectTodaySortsSoonestFirst() throws {
        let now = try #require(ChqTime.parse("2026-07-15 08:00:00"))
        let later = try #require(ChqTime.parse("2026-07-15 18:00:00"))
        let earlier = try #require(ChqTime.parse("2026-07-15 09:00:00"))
        let events = [makeEvent(id: "later", start: later), makeEvent(id: "earlier", start: earlier)]

        let result = IntentDataSource.selectToday(events: events, now: now)

        #expect(result.map(\.id) == ["earlier", "later"])
    }

    // MARK: - IntentDataSource.selectUpcoming

    @Test func selectUpcomingOrdersByStartAndCapsAtLimit() throws {
        let now = try #require(ChqTime.parse("2026-07-15 08:00:00"))
        let events = [
            makeEvent(id: "d", start: try #require(ChqTime.parse("2026-07-15 13:00:00"))),
            makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-15 11:00:00"))),
            makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 10:00:00"))),
            makeEvent(id: "c", start: try #require(ChqTime.parse("2026-07-15 12:00:00")))
        ]

        let result = IntentDataSource.selectUpcoming(events: events, venue: nil, now: now, limit: 2)

        #expect(result.map(\.id) == ["a", "b"])
    }

    @Test func selectUpcomingExcludesEventsNotStrictlyAfterNow() throws {
        let now = try #require(ChqTime.parse("2026-07-15 12:00:00"))
        let events = [
            makeEvent(id: "past", start: try #require(ChqTime.parse("2026-07-15 11:00:00"))),
            makeEvent(id: "now", start: now),
            makeEvent(id: "future", start: try #require(ChqTime.parse("2026-07-15 13:00:00")))
        ]

        let result = IntentDataSource.selectUpcoming(events: events, venue: nil, now: now, limit: 10)

        #expect(result.map(\.id) == ["future"])
    }

    @Test func selectUpcomingExcludesCancelledEvents() throws {
        let now = try #require(ChqTime.parse("2026-07-15 08:00:00"))
        let future = try #require(ChqTime.parse("2026-07-15 09:00:00"))
        let events = [makeEvent(id: "a", start: future, status: .cancelled)]

        let result = IntentDataSource.selectUpcoming(events: events, venue: nil, now: now, limit: 10)

        #expect(result.isEmpty)
    }

    @Test func selectUpcomingFiltersToAnExactVenueCaseInsensitively() throws {
        let now = try #require(ChqTime.parse("2026-07-15 08:00:00"))
        let start = try #require(ChqTime.parse("2026-07-15 09:00:00"))
        let events = [
            makeEvent(id: "amp", start: start, location: "Amphitheater"),
            makeEvent(id: "hall", start: start, location: "Hall of Philosophy"),
            makeEvent(id: "none", start: start, location: nil)
        ]

        let result = IntentDataSource.selectUpcoming(events: events, venue: "amphitheater", now: now, limit: 10)

        #expect(result.map(\.id) == ["amp"])
    }

    // MARK: - EventEntityQuery.rank (search matching, via EventFilter.searchScore)

    @Test func rankFindsEventsByTitle() {
        let events = [
            makeEvent(id: "a", start: .distantFuture, title: "Chautauqua Symphony Orchestra"),
            makeEvent(id: "b", start: .distantFuture, title: "Morning Lecture")
        ]

        let result = EventEntityQuery.rank(events: events, matching: "symphony", limit: 10)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func rankFindsEventsByPresenter() {
        let events = [
            makeEvent(id: "a", start: .distantFuture, title: "Morning Lecture", presenter: "Jane Doe"),
            makeEvent(id: "b", start: .distantFuture, title: "Evening Concert", presenter: "John Smith")
        ]

        let result = EventEntityQuery.rank(events: events, matching: "Doe", limit: 10)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func rankFindsEventsByVenueToken() {
        let events = [
            makeEvent(id: "a", start: .distantFuture, title: "Morning Lecture", location: "Hall of Philosophy"),
            makeEvent(id: "b", start: .distantFuture, title: "Evening Concert", location: "Amphitheater")
        ]

        let result = EventEntityQuery.rank(events: events, matching: "Philosophy", limit: 10)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func rankOrdersHigherScoreFirst() {
        let events = [
            // "opera" appears only in `details` (+50/+5 per EventFilter.searchScore).
            makeEvent(id: "weak", start: .distantFuture, title: "Evening Event", details: "An opera-adjacent evening."),
            // "opera" appears in the title (+100/+10) — scores strictly higher.
            makeEvent(id: "strong", start: .distantFuture, title: "Opera Night")
        ]

        let result = EventEntityQuery.rank(events: events, matching: "opera", limit: 10)

        #expect(result.map(\.id) == ["strong", "weak"])
    }

    @Test func rankExcludesNonMatchingEvents() {
        let events = [makeEvent(id: "a", start: .distantFuture, title: "Morning Lecture")]

        let result = EventEntityQuery.rank(events: events, matching: "nonexistentterm", limit: 10)

        #expect(result.isEmpty)
    }

    @Test func rankCapsAtLimit() {
        let events = (0..<5).map { makeEvent(id: "e\($0)", start: .distantFuture, title: "Lecture \($0)") }

        let result = EventEntityQuery.rank(events: events, matching: "lecture", limit: 3)

        #expect(result.count == 3)
    }

    // MARK: - PendingIntentLink handoff

    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    @Test func consumeReturnsNilWhenNothingIsPending() {
        let defaults = makeDefaults()
        #expect(PendingIntentLink.consume(from: defaults) == nil)
    }

    @Test func writeThenConsumeRoundTripsTheLink() {
        let defaults = makeDefaults()
        PendingIntentLink.write(.event(id: "101037"), to: defaults)

        #expect(PendingIntentLink.consume(from: defaults) == .event(id: "101037"))
    }

    @Test func consumeRemovesTheKeySoASecondCallReturnsNil() {
        let defaults = makeDefaults()
        PendingIntentLink.write(.event(id: "101037"), to: defaults)

        _ = PendingIntentLink.consume(from: defaults)

        #expect(PendingIntentLink.consume(from: defaults) == nil)
    }

    @Test func consumeIgnoresAStoredURLWithAnUnrecognizedScheme() {
        let defaults = makeDefaults()
        defaults.set("https://example.com/event/1", forKey: PendingIntentLink.defaultsKey)

        #expect(PendingIntentLink.consume(from: defaults) == nil)
        // Still removed — an unrecognized value is consumed (not retried
        // forever), matching `DeepLink.parse`'s "ignore it" convention.
        #expect(defaults.string(forKey: PendingIntentLink.defaultsKey) == nil)
    }

    // MARK: - OpenDayIntent handoff

    /// The step the whole "show me a day" feature hangs on: a navigable
    /// target writes the `.day` link the next launch consumes, and the dialog
    /// names the timeframe the user actually spoke. `OpenDayTargetTests`
    /// covers the decision; nothing covered the effect, which is what
    /// `OpenDayIntent.deliver` exists to make reachable without the
    /// AppIntents runtime.
    @Test func deliveringANavigableDayWritesTheDayLink() {
        let defaults = makeDefaults()

        let dialog = OpenDayIntent.deliver(
            .navigate(dayKey: "2026-07-28"), timeframe: .tomorrow, to: defaults)

        #expect(PendingIntentLink.consume(from: defaults) == .day(key: "2026-07-28"))
        #expect(dialog == "Opening tomorrow.")
    }

    /// A refusal must leave *nothing* pending. `openAppWhenRun` brings the
    /// app forward either way, so a link written on a refused run would
    /// navigate on a launch whose own dialog just said it could not — the
    /// silent teleport the refusal exists to prevent.
    @Test func deliveringARefusalWritesNothingAndSpeaksItsDialog() {
        let defaults = makeDefaults()

        let dialog = OpenDayIntent.deliver(
            .refuse(dialog: IntentDialogText.coldCache()), timeframe: .today, to: defaults)

        #expect(PendingIntentLink.consume(from: defaults) == nil)
        #expect(dialog == IntentDialogText.coldCache())
    }

    /// "Show me a day" with no timeframe spoken is legal, and means today.
    /// Asserted on the intent because that is the *only* place the default
    /// lives: `OpenDayTarget.resolve` takes a non-optional timeframe
    /// precisely so a second, drifting copy of it cannot exist.
    @Test func anUnspokenTimeframeMeansToday() {
        var intent = OpenDayIntent()
        #expect(intent.resolvedTimeframe == .today)

        intent.timeframe = .nextWeek
        #expect(intent.resolvedTimeframe == .nextWeek)
    }
}
