import Testing
@testable import ChqCalendar

struct WeekThemeSummaryTests {
    private func theme(
        _ number: Int,
        _ title: String,
        _ start: String,
        _ end: String,
        description: String = ""
    ) -> WeeklyTheme {
        WeeklyTheme(
            number: number, title: title, description: description,
            startDate: start, endDate: end)
    }

    private var sample: [WeeklyTheme] {
        [
            theme(1, "Icons and Instigators", "2026-06-27", "2026-07-04"),
            theme(6, "The Human Voice", "2026-08-01", "2026-08-08"),
            theme(9, "The Importance of Gathering", "2026-08-22", "2026-08-30"),
        ]
    }

    @Test func summarisesAWeekThatHasATheme() {
        let summary = WeekThemeSummary.make(forWeek: 6, in: sample)
        #expect(summary?.weekNumber == 6)
        #expect(summary?.weekLabel == "Week 6")
        #expect(summary?.title == "The Human Voice")
        #expect(summary?.dateRange == "Aug 1\u{2013}8")
    }

    @Test func returnsNilForAWeekWithNoTheme() {
        // The season has 9 weeks but this fixture only carries 3, so weeks
        // 2-5, 7 and 8 have nothing. This is the case that decides whether
        // a badge is tappable at all.
        #expect(WeekThemeSummary.make(forWeek: 5, in: sample) == nil)
    }

    @Test func returnsNilWhenThereAreNoThemesAtAll() {
        // The 2025 path: the sidecar 404s, so `themes` is empty.
        #expect(WeekThemeSummary.make(forWeek: 6, in: []) == nil)
    }

    @Test func looksUpByWeekNumberNotArrayPosition() {
        // Week 6 is at index 1 here; an implementation indexing by position
        // would return the wrong theme or crash.
        #expect(WeekThemeSummary.make(forWeek: 6, in: sample)?.title == "The Human Voice")
        #expect(WeekThemeSummary.make(forWeek: 1, in: sample)?.title == "Icons and Instigators")
        #expect(WeekThemeSummary.make(forWeek: 9, in: sample)?.title == "The Importance of Gathering")
    }

    @Test func looksUpCorrectlyWhenThemesAreOutOfOrder() {
        let shuffled = [sample[2], sample[0], sample[1]]
        #expect(WeekThemeSummary.make(forWeek: 6, in: shuffled)?.title == "The Human Voice")
    }

    @Test func collapsesARangeInsideOneMonth() {
        #expect(WeekThemeSummary.make(forWeek: 6, in: sample)?.dateRange == "Aug 1\u{2013}8")
    }

    @Test func keepsBothMonthsWhenTheRangeCrossesOne() {
        let crossing = [theme(1, "Icons", "2026-06-27", "2026-07-04")]
        #expect(WeekThemeSummary.make(forWeek: 1, in: crossing)?.dateRange == "Jun 27\u{2013}Jul 4")
    }

    @Test func malformedDatesDegradeToNoRangeRatherThanCrashing() {
        let broken = [theme(3, "Election", "not-a-date", "2026-07-18")]
        let summary = WeekThemeSummary.make(forWeek: 3, in: broken)
        // The summary still exists — the title is the point — but the
        // header line simply has no range to show.
        #expect(summary != nil)
        #expect(summary?.title == "Election")
        #expect(summary?.dateRange == nil)
    }

    @Test func outOfRangeMonthIsTreatedAsMalformed() {
        let broken = [theme(3, "Election", "2026-13-01", "2026-13-08")]
        #expect(WeekThemeSummary.make(forWeek: 3, in: broken)?.dateRange == nil)
    }

    @Test func impossibleDayInAMonthDegradesToNoRange() {
        // February never has a 31st, in any year. Structurally
        // well-shaped, calendrically impossible.
        let broken = [theme(3, "Election", "2026-02-31", "2026-07-18")]
        let summary = WeekThemeSummary.make(forWeek: 3, in: broken)
        // Same contract as any other malformed date: the summary and its
        // title survive, only the range is lost.
        #expect(summary != nil)
        #expect(summary?.title == "Election")
        #expect(summary?.dateRange == nil)
    }

    @Test func april31DegradesToNoRange() {
        // April has 30 days, so the 31st is impossible too — this isn't a
        // February-only rule.
        let broken = [theme(3, "Election", "2026-04-31", "2026-07-18")]
        #expect(WeekThemeSummary.make(forWeek: 3, in: broken)?.dateRange == nil)
    }

    @Test func february29InANonLeapYearDegradesToNoRange() {
        // 2026 is not a leap year.
        let broken = [theme(3, "Election", "2026-02-29", "2026-07-18")]
        #expect(WeekThemeSummary.make(forWeek: 3, in: broken)?.dateRange == nil)
    }

    @Test func february29InALeapYearIsValid() {
        // 2028 is a leap year — pinned so a fix doesn't overcorrect into
        // rejecting every February 29th regardless of year.
        let leap = [theme(3, "Election", "2028-02-29", "2028-07-18")]
        #expect(WeekThemeSummary.make(forWeek: 3, in: leap)?.dateRange == "Feb 29\u{2013}Jul 18")
    }

    @Test func leadingHyphenDegradesToNoRange() {
        // `split(separator:)` omits empty subsequences, so without an
        // explicit shape check this would parse as year "2026", month
        // "08", day "01" and silently succeed.
        let broken = [theme(3, "Election", "-2026-08-01", "2026-07-18")]
        #expect(WeekThemeSummary.make(forWeek: 3, in: broken)?.dateRange == nil)
    }

    @Test func anEmptyDescriptionIsIgnored() {
        // Every real 2026 description is empty and none is ever rendered.
        // This pins that the summary does not start depending on it.
        let withDescription = [theme(6, "The Human Voice", "2026-08-01", "2026-08-08",
                                     description: "Some prose")]
        #expect(WeekThemeSummary.make(forWeek: 6, in: sample)
                == WeekThemeSummary.make(forWeek: 6, in: withDescription))
    }
}
