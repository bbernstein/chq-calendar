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
    /// prevents. `now` (9am Saturday) is still before the season's actual
    /// end instant (noon Saturday), so `SeasonStatus.make` reports
    /// `.inSeason` and `IntentDialogText.offSeason` returns `nil` — that's
    /// what makes this the one path in the whole suite that reaches
    /// `IntentDialogText.unreachableDay`, so the exact string is asserted
    /// rather than just non-emptiness: a `??` fallback to any other
    /// non-empty string would otherwise go unnoticed.
    @Test func theDayAfterTheSeasonEndsIsRefusedWithADialog() throws {
        let bounds = ViewWindow.navigableBounds(year: 2026, events: [], starredDays: [])
        let lastDay = try #require(ChqTime.parse("\(bounds.upperBound) 09:00:00"))
        let events = [makeEvent(id: "a", start: lastDay)]

        let target = OpenDayTarget.resolve(
            timeframe: .tomorrow, now: lastDay, year: 2026, events: events)

        #expect(target == .refuse(dialog: IntentDialogText.unreachableDay(year: 2026)))
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

    /// A day carrying an event outside the season widens `navigableBounds`
    /// — so reachability is a question about *this* user's data (an event
    /// landing there; `starredDays` is passed empty), not about the
    /// calendar. Pinned because a "clamp to the season" rewrite would pass
    /// every other test here.
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

    /// `IntentDataSource.events(now:)` returns the whole unfiltered year
    /// snapshot, so an empty list means "no snapshot has loaded yet," not
    /// "no events today" — that's true regardless of what `now` is. Pins
    /// cold-cache as winning over the season question even when `now` is
    /// itself off-season: a rewrite to "empty && in-season -> coldCache,
    /// else offSeason" would pass every other test in this file but fail
    /// this one, since it would report the off-season dialog here instead.
    @Test func offSeasonWithEmptyEventsIsStillAColdCacheRefusal() throws {
        let now = try #require(ChqTime.parse("2026-02-01 09:00:00"))

        let target = OpenDayTarget.resolve(
            timeframe: .today, now: now, year: 2026, events: [])

        #expect(target == .refuse(dialog: IntentDialogText.coldCache()))
    }

    /// Week 9's "next week" resolves to a day key equal to the season's
    /// last day (`IntentTimeframeTests
    /// .targetDayKeyForNextWeekInWeekNineStillProducesAKey` pins the key
    /// itself) — and that day is inside `navigableBounds`, so `OpenDayTarget`
    /// navigates there rather than refusing. Landing on the last day is more
    /// useful than a refusal for a day that genuinely is reachable; this
    /// pins the half of that picture `OpenDayTarget` owns; `IntentTimeframe`
    /// only produces the key.
    @Test func weekNineNextWeekNavigatesToTheSeasonsLastDay() throws {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let inWeekNine = weeks[8].start.addingTimeInterval(3600)
        let events = [makeEvent(id: "a", start: weeks[8].start)]

        let target = OpenDayTarget.resolve(
            timeframe: .nextWeek, now: inWeekNine, year: 2026, events: events)

        #expect(target == .navigate(dayKey: ChqTime.dayKey(for: weeks[8].end)))
    }
}
