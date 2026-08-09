import Foundation
import Testing
@testable import ChqCalendar

/// Pins the My Day chip's labelling rules (#192), which are what the issue
/// was actually about — the old chip read "Sun 9" with no month, and nothing
/// on screen said which day was selected.
///
/// Split out of the SwiftUI view precisely so these rules are testable
/// without a view host.
struct MyDayChipContentTests {
    @Test func ordinaryChipShowsWeekdayAndMonthDay() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-10", todayKey: "2026-08-09", starCount: 2, includingYear: false))

        #expect(content.topLine == "Mon")
        #expect(content.dateLine == "Aug 10")
        #expect(!content.isToday)
        #expect(!content.isEmpty)
    }

    @Test func todaysChipReplacesTheWeekdayWithTheWordToday() {
        // Today is carried in the *text* rather than a ring or a fill,
        // because a day can be today, empty, and selected at once. Fill
        // means selected and nothing else.
        let content = MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-08-09", starCount: 3, includingYear: false)

        #expect(content?.topLine == "Today")
        #expect(content?.isToday == true)
    }

    @Test func todaysChipCanAlsoBeEmptyBecauseTodayAndEmptyAreIndependentSignals() throws {
        // Pins the exact composition `MyDayChipContent`'s doc comment cites as
        // the reason the type encodes today/empty/selected as independent
        // signals rather than a single "state": today with nothing starred.
        // `todaysChipReplacesTheWeekdayWithTheWordToday` only covers today
        // with events (`starCount: 3`), and `zeroStarCountReadsAsEmpty` only
        // covers empty on a non-today key, so neither exercises this pair.
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-08-09", starCount: 0, includingYear: false))

        #expect(content.topLine == "Today")
        #expect(content.isEmpty)
        #expect(content.isToday)
        #expect(content.accessibilityLabel == "Sunday, August 9, today, no starred events")
    }

    @Test func everyChipCarriesItsMonthSoItIsUnambiguousInIsolation() throws {
        let june = try #require(MyDayChipContent.make(
            dayKey: "2026-06-28", todayKey: "2026-08-09", starCount: 1, includingYear: false))
        let august = try #require(MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-07-01", starCount: 1, includingYear: false))

        #expect(june.dateLine == "Jun 28")
        #expect(august.dateLine == "Aug 9")
    }

    @Test func zeroStarCountReadsAsEmpty() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-11", todayKey: "2026-08-09", starCount: 0, includingYear: false))

        #expect(content.isEmpty)
        #expect(content.starCount == 0)
    }

    @Test func accessibilityLabelNamesTheDayTheCountAndTodayness() throws {
        let today = try #require(MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-08-09", starCount: 3, includingYear: false))
        #expect(today.accessibilityLabel == "Sunday, August 9, today, 3 starred events")

        let other = try #require(MyDayChipContent.make(
            dayKey: "2026-08-10", todayKey: "2026-08-09", starCount: 1, includingYear: false))
        #expect(other.accessibilityLabel == "Monday, August 10, 1 starred event")

        let empty = try #require(MyDayChipContent.make(
            dayKey: "2026-08-11", todayKey: "2026-08-09", starCount: 0, includingYear: false))
        #expect(empty.accessibilityLabel == "Tuesday, August 11, no starred events")
    }

    @Test func accessibilityLabelCarriesTheYearForAnArchivedSeason() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2025-08-23", todayKey: "2026-08-09", starCount: 2, includingYear: true))

        #expect(content.accessibilityLabel == "Saturday, August 23, 2025, 2 starred events")
        // The visible lines stay compact regardless — the year would not fit.
        #expect(content.topLine == "Sat")
        #expect(content.dateLine == "Aug 23")
    }

    @Test func makeIsNilForAnUnparseableDayKey() {
        #expect(MyDayChipContent.make(
            dayKey: "not-a-day", todayKey: "2026-08-09", starCount: 0, includingYear: false) == nil)
    }
}
