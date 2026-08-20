import Foundation
import Testing
@testable import ChqCalendar

/// `OpenDayIntent`'s whole decision, minus the AppIntents runtime.
struct OpenDayTargetTests {
    @Test func aDayInsideTheSeasonIsNavigatedTo() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))
        let events = [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-28 10:00:00")))]

        let target = OpenDayTarget.resolve(
            timeframe: .tomorrow, now: now, year: 2026, events: events)

        #expect(target == .navigate(dayKey: "2026-07-28"))
    }

    /// No timeframe spoken ("show me a day") means today — the same default
    /// every other timeframe-carrying intent uses.
    @Test func noTimeframeMeansToday() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))
        let events = [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-27 10:00:00")))]

        let target = OpenDayTarget.resolve(
            timeframe: nil, now: now, year: 2026, events: events)

        #expect(target == .navigate(dayKey: "2026-07-27"))
    }

    /// The case the refusal exists for: asked on the season's last day,
    /// "tomorrow" names a real calendar day that navigation cannot reach.
    /// Opening the app and silently doing nothing is the behaviour this
    /// prevents.
    @Test func theDayAfterTheSeasonEndsIsRefusedWithADialog() throws {
        let bounds = ViewWindow.navigableBounds(year: 2026, events: [], starredDays: [])
        let lastDay = try #require(ChqTime.parse("\(bounds.upperBound) 09:00:00"))
        let events = [makeEvent(id: "a", start: lastDay)]

        let target = OpenDayTarget.resolve(
            timeframe: .tomorrow, now: lastDay, year: 2026, events: events)

        guard case .refuse(let dialog) = target else {
            Issue.record("expected a refusal, got \(target)")
            return
        }
        #expect(!dialog.isEmpty)
    }

    /// Out of season entirely, the refusal should explain *that* rather than
    /// talk about a day — `IntentDialogText.offSeason` is the established
    /// vocabulary and must win over the generic line. A fixture event inside
    /// the season keeps the event list non-empty so resolution reaches the
    /// bounds check instead of short-circuiting on the cold-cache branch —
    /// with `events: []` this hits `IntentDialogText.coldCache()` first.
    @Test func offSeasonRefusalUsesTheOffSeasonDialog() throws {
        let now = try #require(ChqTime.parse("2026-02-01 09:00:00"))
        let events = [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-27 10:00:00")))]

        let target = OpenDayTarget.resolve(
            timeframe: .today, now: now, year: 2026, events: events)

        let expected = try #require(
            IntentDialogText.offSeason(SeasonStatus.make(now: now, year: 2026), year: 2026))
        #expect(target == .refuse(dialog: expected))
    }

    /// A day the reader starred outside the season widens
    /// `navigableBounds` — so reachability is a question about *this* user's
    /// data, not about the calendar. Pinned because a "clamp to the season"
    /// rewrite would pass every other test here.
    @Test func aDayReachableOnlyBecauseAnEventLivesThereIsAccepted() throws {
        let bounds = ViewWindow.navigableBounds(year: 2026, events: [], starredDays: [])
        let dayAfter = try #require(
            ChqTime.day(bounds.upperBound, offsetBy: 1))
        let asked = try #require(ChqTime.parse("\(bounds.upperBound) 09:00:00"))
        let events = [makeEvent(id: "a", start: try #require(ChqTime.parse("\(dayAfter) 10:00:00")))]

        let target = OpenDayTarget.resolve(
            timeframe: .tomorrow, now: asked, year: 2026, events: events)

        #expect(target == .navigate(dayKey: dayAfter))
    }

    /// An empty event list is a cold cache, full stop — it wins over the
    /// bounds question even when `now` is in season, because there is
    /// nothing to check bounds against. Tightened from an earlier `||`
    /// between the cold-cache and off-season dialogs: with the real
    /// implementation the empty-events guard runs first, so exactly one of
    /// those two outcomes is possible here, not "one of two things."
    @Test func aColdCacheIsRefusedWithTheColdCacheDialog() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))

        let target = OpenDayTarget.resolve(
            timeframe: .today, now: now, year: 2026, events: [])

        #expect(target == .refuse(dialog: IntentDialogText.coldCache()))
    }
}
