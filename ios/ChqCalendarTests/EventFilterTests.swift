import Foundation
import Testing
@testable import ChqCalendar

struct EventFilterTests {
    // MARK: - searchScore

    @Test func kayakTermMatchesKayakFixtureEvent() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let kayak = try #require(envelope.data.first { $0.id == "101037" })
        #expect(EventFilter.searchScore(event: kayak, term: "kayak") > 0)
    }

    @Test func kayakFixtureScoresTitleAndDetailsBothTiersForSingleWord() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let kayak = try #require(envelope.data.first { $0.id == "101037" })
        // There is no whole-phrase stage — "kayak" is scored as a single
        // word against both tiers: base (title +100, details +50 = 150)
        // and, since it's longer than 2 chars, the bonus tier (title +10,
        // details +5 = 15). No location/token/presenter hits for this word.
        #expect(EventFilter.searchScore(event: kayak, term: "kayak") == 165)
    }

    @Test func titleMatchOutscoresDetailsOnlyMatch() {
        let titleMatch = makeEvent(id: "title", start: Date(), title: "Sunrise Yoga")
        let detailsMatch = makeEvent(id: "details", start: Date(), title: "Morning Class", details: "A relaxing yoga session")

        let titleScore = EventFilter.searchScore(event: titleMatch, term: "yoga")
        let detailsScore = EventFilter.searchScore(event: detailsMatch, term: "yoga")

        #expect(titleScore > detailsScore)
    }

    @Test func multiWordQueryScoresOnlyTheMatchingWordKayakOrientation() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let kayak = try #require(envelope.data.first { $0.id == "101037" })
        // Every word is scored independently and summed — there's no
        // whole-phrase requirement. "kayak" matches title+details on both
        // tiers (100+50+10+5 = 165); "orientation" matches nothing
        // anywhere, contributing 0. Total is exactly the single matching
        // word's score.
        #expect(EventFilter.searchScore(event: kayak, term: "kayak orientation") == 165)
    }

    @Test func shortWordsBelowThreeCharsSkipTheBonusTier() {
        let event = makeEvent(id: "e1", start: Date(), title: "An Event About Us")
        // "us" is 2 chars, at-or-below the >2 threshold, so only the base
        // tier applies: title contains "us" -> +100. The bonus tier is
        // skipped entirely for this word.
        let score = EventFilter.searchScore(event: event, term: "us")
        #expect(score == 100)
    }

    @Test func filterTokenMatchesAreSummedPerTokenInBaseTierOnly() {
        let event = makeEvent(id: "e1", start: Date(), title: "Gathering", categories: ["Recreation"], tags: ["recreational sport"])
        // filterTokens = {"recreation", "recreational sport"} — both contain
        // "recreat", so both +85 hits stack in the base tier (170).
        // "recreat" is also >2 chars, so the bonus tier's flat any-token +7
        // applies once on top (177) — it does not stack per token the way
        // the base tier does.
        let score = EventFilter.searchScore(event: event, term: "recreat")
        #expect(score == 85 + 85 + 7)
    }

    // MARK: - apply: search stage

    @Test func applyFiltersToOnlyMatchingEventsBySearchText() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let sel = FilterSelection(searchText: "kayak", dateScope: .all)
        let result = EventFilter.apply(sel, to: envelope.data, favorites: [], now: Date(), year: 2026, isCurrentYear: true)
        #expect(result.map(\.id) == ["101037"])
    }

    // MARK: - apply: .today boundary

    @Test func todayScopeUsesNYCalendarDayBoundaryRegardlessOfProcessZone() throws {
        // ChqTime is NY-pinned internally, so this holds even though the
        // test process's local time zone is whatever the CI/dev machine is
        // running (not necessarily America/New_York).
        let now = try #require(ChqTime.parse("2026-07-27 12:00:00"))
        let lateSameDay = makeEvent(id: "late", start: try #require(ChqTime.parse("2026-07-27 23:59:00")))
        let earlyNextDay = makeEvent(id: "next", start: try #require(ChqTime.parse("2026-07-28 00:01:00")))

        let sel = FilterSelection(dateScope: .today)
        let result = EventFilter.apply(sel, to: [lateSameDay, earlyNextDay], favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["late"])
    }

    // MARK: - apply: .next adaptive window + grace + extraDays

    @Test func adaptiveEndDateStopsAtFirstDayReachingMinCount() throws {
        let from = try #require(ChqTime.parse("2026-07-10 08:00:00"))
        var events: [Event] = []
        for day in 0..<3 {
            let dayDate = try #require(ChqTime.calendar.date(byAdding: .day, value: day, to: from))
            for minute in 0..<20 {
                let start = try #require(ChqTime.calendar.date(byAdding: .minute, value: minute, to: dayDate))
                events.append(makeEvent(id: "day\(day)-\(minute)", start: start))
            }
        }
        // 20 events after day 0, 40 after day 1 (still < 50), 60 after day 2
        // (>= 50) — so the adaptive window should stop at day 2's end.
        let result = EventFilter.adaptiveEndDate(events: events, from: from, minCount: 50)
        let expected = ChqTime.endOfDay(try #require(ChqTime.calendar.date(byAdding: .day, value: 2, to: from)))
        #expect(result == expected)
    }

    @Test func nextScopeIncludesEventWithinOneHourGraceWindow() throws {
        let now = try #require(ChqTime.parse("2026-07-10 09:00:00"))
        let withinGrace = makeEvent(id: "grace", start: now.addingTimeInterval(-1800)) // 30 min ago
        let outsideGrace = makeEvent(id: "past", start: now.addingTimeInterval(-7200)) // 2h ago

        let sel = FilterSelection(dateScope: .next)
        let result = EventFilter.apply(sel, to: [withinGrace, outsideGrace], favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["grace"])
    }

    @Test func nextScopeGraceBoundaryIsInclusiveAtExactlyOneHourAgo() throws {
        let now = try #require(ChqTime.parse("2026-07-10 09:00:00"))
        let exactlyOneHourAgo = makeEvent(id: "boundary", start: now.addingTimeInterval(-3600))

        let sel = FilterSelection(dateScope: .next)
        let result = EventFilter.apply(sel, to: [exactlyOneHourAgo], favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["boundary"])
    }

    @Test func nextScopeAdaptiveWindowIsComputedFromFullSetNotSearchFilteredSet() throws {
        let now = try #require(ChqTime.parse("2026-07-10 09:00:00"))
        let from = now.addingTimeInterval(-3600)

        // 50 "Gathering" events spread across day 0 satisfy minCount
        // immediately, fixing the adaptive window at day 0's end — but only
        // one of them ("Kayak Tour") would survive a "kayak" search filter.
        var events: [Event] = try (0..<50).map { i in
            makeEvent(
                id: "base\(i)",
                start: try #require(ChqTime.calendar.date(byAdding: .minute, value: i, to: from)),
                title: "Gathering \(i)"
            )
        }
        let kayakEvent = makeEvent(id: "kayak", start: from.addingTimeInterval(60), title: "Kayak Tour")
        events.append(kayakEvent)
        // An event just past day 0 that a full-set adaptive window would
        // exclude — if the window were instead computed from the
        // search-narrowed set (only 1 "kayak" match, far below minCount, so
        // the window would grow to reach the 90-day cap and wrongly
        // include this), this event would incorrectly appear too.
        let laterKayakEvent = makeEvent(id: "later-kayak", start: try #require(ChqTime.parse("2026-07-11 10:00:00")), title: "Kayak Trip")
        events.append(laterKayakEvent)

        let sel = FilterSelection(searchText: "kayak", dateScope: .next)
        let result = EventFilter.apply(sel, to: events, favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["kayak"])
    }

    @Test func extraDaysWidensNextWindowByWholeDays() throws {
        let now = try #require(ChqTime.parse("2026-07-10 09:00:00"))
        let from = now.addingTimeInterval(-3600) // 08:00

        // 50 baseline events all within day 0, so the adaptive window
        // reaches minCount immediately and settles at day 0's end-of-day.
        var events: [Event] = try (0..<50).map { i in
            makeEvent(id: "base\(i)", start: try #require(ChqTime.calendar.date(byAdding: .minute, value: i, to: from)))
        }
        let later = makeEvent(id: "later", start: try #require(ChqTime.parse("2026-07-11 10:00:00")))
        events.append(later)

        let noExtra = FilterSelection(dateScope: .next, extraDays: 0)
        let resultNoExtra = EventFilter.apply(noExtra, to: events, favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(!resultNoExtra.contains { $0.id == "later" })

        let withExtra = FilterSelection(dateScope: .next, extraDays: 1)
        let resultWithExtra = EventFilter.apply(withExtra, to: events, favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(resultWithExtra.contains { $0.id == "later" })
    }

    // MARK: - apply: weeks filter

    @Test func weeksFilterMatchesEventBySeasonWeekContainingStart() throws {
        let event = makeEvent(id: "e1", start: try #require(ChqTime.parse("2026-07-08 12:00:00"))) // week 2

        let selMatching = FilterSelection(dateScope: .all, selectedWeeks: [2])
        let selNonMatching = FilterSelection(dateScope: .all, selectedWeeks: [3])

        #expect(EventFilter.apply(selMatching, to: [event], favorites: [], now: Date(), year: 2026, isCurrentYear: true).count == 1)
        #expect(EventFilter.apply(selNonMatching, to: [event], favorites: [], now: Date(), year: 2026, isCurrentYear: true).isEmpty)
    }

    @Test func noonBoundaryEventBelongsToIncomingWeekNotOutgoingWeek() throws {
        let event = makeEvent(id: "boundary", start: try #require(ChqTime.parse("2026-07-04 12:00:00")))

        let selWeek1 = FilterSelection(dateScope: .all, selectedWeeks: [1])
        let selWeek2 = FilterSelection(dateScope: .all, selectedWeeks: [2])

        #expect(EventFilter.apply(selWeek1, to: [event], favorites: [], now: Date(), year: 2026, isCurrentYear: true).isEmpty)
        #expect(EventFilter.apply(selWeek2, to: [event], favorites: [], now: Date(), year: 2026, isCurrentYear: true).count == 1)
    }

    // MARK: - season scope

    @Test func seasonScopeKeepsOnlyInSeasonEvents() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let preSeason = makeEvent(id: "pre", start: weeks.first!.start.addingTimeInterval(-86400))
        let opening = makeEvent(id: "opening", start: weeks.first!.start)
        let midSeason = makeEvent(id: "mid", start: weeks[4].start.addingTimeInterval(3600))
        let lastMoment = makeEvent(id: "last", start: weeks.last!.end.addingTimeInterval(-1))
        let postSeason = makeEvent(id: "post", start: weeks.last!.end)

        let result = EventFilter.apply(
            FilterSelection(dateScope: .season),
            to: [preSeason, opening, midSeason, lastMoment, postSeason],
            favorites: [],
            now: weeks.first!.start,
            year: 2026,
            isCurrentYear: true)

        #expect(result.map(\.id) == ["opening", "mid", "last"])
    }

    @Test func seasonScopeIsIgnoredOffTheCurrentYear() {
        // Same collapse as every other scope: a non-current year has no
        // meaningful "season" *selection* — the pipeline forces .all.
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let postSeason = makeEvent(id: "post", start: weeks.last!.end)

        let result = EventFilter.apply(
            FilterSelection(dateScope: .season),
            to: [postSeason],
            favorites: [],
            now: weeks.first!.start,
            year: 2026,
            isCurrentYear: false)

        #expect(result.map(\.id) == ["post"])
    }

    // MARK: - apply: categories / locations / favorites

    @Test func categoriesFilterIntersectsFilterTokens() {
        let event = makeEvent(id: "e1", start: Date(), categories: ["Recreation"], tags: ["kayak"])

        let selMatch = FilterSelection(dateScope: .all, selectedCategories: ["recreation"])
        let selNoMatch = FilterSelection(dateScope: .all, selectedCategories: ["lecture"])

        #expect(EventFilter.apply(selMatch, to: [event], favorites: [], now: Date(), year: 2026, isCurrentYear: true).count == 1)
        #expect(EventFilter.apply(selNoMatch, to: [event], favorites: [], now: Date(), year: 2026, isCurrentYear: true).isEmpty)
    }

    @Test func locationsFilterMatchesLowercasedDisplayLocation() {
        let event = makeEvent(id: "e1", start: Date(), location: "Smith Wilkes Hall")
        let sel = FilterSelection(dateScope: .all, selectedLocations: ["smith wilkes hall"])

        #expect(EventFilter.apply(sel, to: [event], favorites: [], now: Date(), year: 2026, isCurrentYear: true).count == 1)
    }

    @Test func favoritesOnlyKeepsOnlyFavoritedIds() {
        let favorite = makeEvent(id: "fav1", start: Date())
        let other = makeEvent(id: "other", start: Date())
        let sel = FilterSelection(dateScope: .all, showFavoritesOnly: true)

        let result = EventFilter.apply(sel, to: [favorite, other], favorites: ["fav1"], now: Date(), year: 2026, isCurrentYear: true)
        #expect(result.map(\.id) == ["fav1"])
    }

    // MARK: - apply: non-current year forces .all

    @Test func nonCurrentYearForcesAllRegardlessOfDateScope() throws {
        let now = try #require(ChqTime.parse("2026-07-10 09:00:00"))
        let farEvent = makeEvent(id: "far", start: try #require(ChqTime.parse("2026-08-20 09:00:00")))

        let sel = FilterSelection(dateScope: .today)
        let result = EventFilter.apply(sel, to: [farEvent], favorites: [], now: now, year: 2026, isCurrentYear: false)

        #expect(result.map(\.id) == ["far"])
    }

    // MARK: - Case-insensitive venue/category matching

    @Test func originalCasedSelectionMatchesLowercasedEventFields() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, location: "Amphitheater", categories: ["CSO"]),
            makeEvent(id: "b", start: start, location: "Norton Hall", categories: ["CLSC"]),
        ]
        var filter = FilterSelection(dateScope: .all)
        filter.selectedLocations = ["Amphitheater"]

        let result = EventFilter.apply(
            filter, to: events, favorites: [], now: start, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func differentlyCasedDuplicateDoesNotNarrowFurther() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, location: "Amphitheater"),
            makeEvent(id: "b", start: start, location: "Norton Hall"),
        ]
        var filter = FilterSelection(dateScope: .all)
        filter.selectedLocations = ["Amphitheater", "AMPHITHEATER"]

        let result = EventFilter.apply(
            filter, to: events, favorites: [], now: start, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func categorySelectionMatchesFilterTokensCaseInsensitively() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, categories: ["CSO"]),
            makeEvent(id: "b", start: start, categories: ["CLSC"]),
        ]
        var filter = FilterSelection(dateScope: .all)
        filter.selectedCategories = ["CSO"]

        let result = EventFilter.apply(
            filter, to: events, favorites: [], now: start, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a"])
    }

    // MARK: - .day scope

    @Test func dayScopeMatchesOnlyThatNYCalendarDay() throws {
        let onDay = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        let lateOnDay = try #require(ChqTime.parse("2026-08-09 23:30:00"))
        let nextDay = try #require(ChqTime.parse("2026-08-10 00:30:00"))
        let events = [
            makeEvent(id: "a", start: onDay),
            makeEvent(id: "b", start: lateOnDay),
            makeEvent(id: "c", start: nextDay),
        ]
        let now = try #require(ChqTime.parse("2026-08-01 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09"),
            to: events, favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a", "b"])
    }

    @Test func dayScopeSurvivesANonCurrentYear() throws {
        // The exemption that matters. Every *time-relative* scope is
        // downgraded to .all for a past season because it has no "now" —
        // but .day names an absolute date and is meaningful in any season.
        // Downgrading it would silently un-filter the list in exactly the
        // case the browse-this-day button is most useful for.
        let onDay = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        let otherDay = try #require(ChqTime.parse("2025-08-24 10:00:00"))
        let now = try #require(ChqTime.parse("2026-08-09 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .day, selectedDayKey: "2025-08-23"),
            to: [makeEvent(id: "a", start: onDay), makeEvent(id: "b", start: otherDay)],
            favorites: [], now: now, year: 2025, isCurrentYear: false)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func timeRelativeScopesAreStillDowngradedForANonCurrentYear() throws {
        // Guards the exemption against over-reach: only .day is exempt.
        let old = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        let now = try #require(ChqTime.parse("2026-08-09 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .today),
            to: [makeEvent(id: "a", start: old)],
            favorites: [], now: now, year: 2025, isCurrentYear: false)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func dayScopeWithNoDayKeyFiltersNothing() throws {
        let first = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        let second = try #require(ChqTime.parse("2026-08-10 10:00:00"))
        let now = try #require(ChqTime.parse("2026-08-01 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .day, selectedDayKey: nil),
            to: [makeEvent(id: "a", start: first), makeEvent(id: "b", start: second)],
            favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a", "b"])
    }
}
