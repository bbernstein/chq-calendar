import Foundation
import Testing
@testable import ChqCalendar

/// Pins `LandingState.determine`'s boundary cases against the exact dates
/// from issue #177: the `.next` scope's 90-day adaptive-window cap
/// (`EventFilter.adaptiveEndDate`) means the 2026 season (last event
/// 2026-09-10) goes empty in the default filter starting 2026-09-11, and the
/// app must describe that as `.postSeason` rather than showing nothing.
struct LandingStateTests {
    private let manifestYears = [2025, 2026, 2027]

    /// Pins the value used to build every `opening`/`daysUntil` expectation
    /// below, the same way `SeasonCalendarTests` pins `seasonStart(year:)`
    /// directly against a parsed date.
    @Test func seasonStart2027LandsSaturdayNoonNY() throws {
        let expected = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        #expect(SeasonCalendar.seasonStart(year: 2027) == expected)
    }

    /// Rule 1 outranks the calendar at both ends of the season's tail: deep
    /// in it, and on a day past the nine-week window `SeasonCalendar` allots
    /// (the 2026 feed's real Sep 1-10 shoulder). One event still ahead is
    /// all it takes — the input is a predicate, not a count, since #288; how
    /// MANY there are was never a rule here.
    @Test(arguments: ["2026-08-30 12:00:00", "2026-09-05 00:00:00"])
    func inSeasonWheneverTheYearStillHasSomethingAhead(_ nowString: String) throws {
        let now = try #require(ChqTime.parse(nowString))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears,
            yearHasUpcomingEvents: true, yearHasEvents: true)
        #expect(state == .inSeason)
    }

    /// The exact day the 2026 feed runs out: its last event is 2026-09-10,
    /// so `yearHasUpcomingEvents` is false from 2026-09-11 on — which is
    /// also, separately, the day the `.next` scope's 90-day adaptive window
    /// has nothing left to show (`EventFilter.adaptiveEndDate`). The two
    /// coincide here; #288 is about the dates where they do not.
    @Test func postSeasonTheDayAfterTheSeasonsLastEvent() throws {
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(state == .postSeason(endedSeasonYear: 2026, nextSeasonYear: 2027, opening: opening, daysUntil: 288))
    }

    /// `.postSeason` must keep holding months later, not flip to some other
    /// state just because a new calendar year has begun.
    @Test func postSeasonStillHoldsMonthsAfterTheSeasonEnded() throws {
        let now = try #require(ChqTime.parse("2027-01-15 00:00:00"))
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(state == .postSeason(endedSeasonYear: 2026, nextSeasonYear: 2027, opening: opening, daysUntil: 162))
    }

    /// Once the user (or `previewNextSeason()`) has moved `selectedYear`
    /// forward to the announced next season, and it's still before that
    /// season's own start, the state is `.preSeason` for *that* year — not
    /// `.postSeason` for the year that just ended.
    @Test func preSeasonWhenSelectedYearHasAdvancedToTheAnnouncedNextSeason() throws {
        let now = try #require(ChqTime.parse("2027-06-20 00:00:00"))
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2027, availableYears: manifestYears, yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(state == .preSeason(opening: opening, daysUntil: 6))
    }

    /// No later year in the manifest yet: `nextSeasonYear`/`opening`/
    /// `daysUntil` are all `nil` rather than guessing or crashing.
    @Test func postSeasonWithNoNextYearAnnouncedInManifest() throws {
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: [2025, 2026], yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(state == .postSeason(endedSeasonYear: 2026, nextSeasonYear: nil, opening: nil, daysUntil: nil))
    }

    /// `now` exactly at the season's start instant is in-season territory,
    /// not pre-season — `determine` only returns `.preSeason` for `now`
    /// strictly before `start`.
    @Test func exactlyAtSeasonStartIsNotPreSeason() throws {
        let start = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        let state = LandingState.determine(
            now: start, selectedYear: 2026, availableYears: manifestYears, yearHasUpcomingEvents: false, yearHasEvents: true)
        if case .preSeason = state {
            Issue.record("expected not-preSeason at the exact season start instant, got \(state)")
        }
    }

    // MARK: - Rule 3: no events at all is not "the season is over" (#288)

    /// A feed that came back empty (or decoded to nothing) mid-season must
    /// not be reported as `.postSeason`. "We have no data" and "we have the
    /// data and it says nothing is left" are different claims, and only the
    /// second one earns "See you next season". Ports rule 3 of
    /// `landingState.ts`'s `determineLandingState`, which the web added for
    /// exactly this reason.
    @Test func inSeasonMidSeasonWhenTheYearHasNoEventsAtAll() throws {
        let now = try #require(ChqTime.parse("2026-07-15 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears,
            yearHasUpcomingEvents: false, yearHasEvents: false)
        #expect(state == .inSeason)
    }

    /// Rule 2 still outranks rule 3: before the season starts, an empty year
    /// is the announced-but-unpublished case, and the countdown is the right
    /// screen for it.
    @Test func preSeasonStillWinsOverAnEmptyYearBeforeTheSeasonStarts() throws {
        let now = try #require(ChqTime.parse("2026-05-01 00:00:00"))
        let opening = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears,
            yearHasUpcomingEvents: false, yearHasEvents: false)
        #expect(state == .preSeason(opening: opening, daysUntil: 57))
    }

    // MARK: - Rule 4: no countdown to a season that has already opened (#288)

    /// A reader on an archived year part-way through the season that
    /// followed it. `nextSeasonYear` still names 2027 — there is somewhere
    /// to send them — but `opening`/`daysUntil` are `nil`, because 2027 has
    /// already opened and a countdown to it would render negative.
    ///
    /// This state was unreachable before #288: a non-current year degrades
    /// `.next` to `.all` (`EffectiveScope.resolve`), so the old count-based
    /// probe never read 0 for an archived year and `determine` never got
    /// here. Unbinding the probe from `.next` makes it reachable, which is
    /// why the clamp is part of the same change.
    @Test func postSeasonOffersNoCountdownOnceTheNextSeasonHasAlreadyOpened() throws {
        let now = try #require(ChqTime.parse("2027-07-15 00:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears,
            yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(state == .postSeason(
            endedSeasonYear: 2026, nextSeasonYear: 2027, opening: nil, daysUntil: nil))
    }

    /// The clamp's own boundary: `now` exactly at the next season's start
    /// instant is already "opened", not "one moment away".
    @Test func postSeasonDropsTheCountdownExactlyAtTheNextSeasonsStart() throws {
        let start = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let state = LandingState.determine(
            now: start, selectedYear: 2026, availableYears: manifestYears,
            yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(state == .postSeason(
            endedSeasonYear: 2026, nextSeasonYear: 2027, opening: nil, daysUntil: nil))
    }

    /// One second earlier it is still a countdown — pinning that the clamp
    /// is `now < opening` and not something coarser like a day comparison.
    @Test func postSeasonKeepsTheCountdownOneSecondBeforeTheNextSeasonsStart() throws {
        let start = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let now = start.addingTimeInterval(-1)
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears,
            yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(state == .postSeason(
            endedSeasonYear: 2026, nextSeasonYear: 2027, opening: start, daysUntil: 0))
    }

    // MARK: - isPostSeason

    @Test func isPostSeasonIsTrueOnlyForPostSeason() throws {
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let postSeason = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(postSeason.isPostSeason)

        #expect(!LandingState.inSeason.isPostSeason)

        let preSeasonNow = try #require(ChqTime.parse("2026-05-01 00:00:00"))
        let preSeason = LandingState.determine(
            now: preSeasonNow, selectedYear: 2026, availableYears: manifestYears, yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(!preSeason.isPostSeason)
    }

    // MARK: - archiveYear

    /// Reviewer-confirmed defect: `.preSeason`'s "Browse the _ season"
    /// button used to label itself `selectedYear - 1` while the underlying
    /// `AppModel.browseArchiveSeason()` applied `.season` scope to
    /// `selectedYear` (the *upcoming* year) instead — a label/outcome
    /// mismatch, reachable even when `selectedYear - 1` was in
    /// `model.years`. The fix is `archiveYear` returning `nil`
    /// unconditionally for `.preSeason`, which hides the button rather than
    /// showing one whose action can't honor its own label.
    @Test func archiveYearIsNilForPreSeasonEvenWhenAnEarlierYearExists() throws {
        let opening = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        let preSeason = LandingState.preSeason(opening: opening, daysUntil: 5)
        #expect(preSeason.archiveYear == nil)
    }

    @Test func archiveYearIsTheEndedSeasonYearForPostSeason() throws {
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let postSeason = LandingState.postSeason(
            endedSeasonYear: 2026, nextSeasonYear: 2027, opening: opening, daysUntil: 288)
        #expect(postSeason.archiveYear == 2026)
    }
}
