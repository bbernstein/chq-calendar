import Foundation

/// A single week of the Chautauqua Institution's summer season.
///
/// `start`/`end` are noon-to-noon boundaries in `ChqTime` (America/New_York):
/// a week runs from Saturday at 12:00 noon through the following Saturday at
/// 12:00 noon (exclusive), so `end` of week *n* equals `start` of week
/// *n + 1*.
nonisolated struct SeasonWeek: Hashable, Sendable {
    let number: Int
    let start: Date
    let end: Date

    /// `start <= date < end`.
    func contains(_ date: Date) -> Bool {
        start <= date && date < end
    }
}

/// Computes the Chautauqua season's 9-week structure for a given year.
///
/// The season always begins the Saturday before the 4th Sunday of June, at
/// 12:00 noon Eastern time — this is when the Saturday-to-Saturday weekly
/// gate program turns over. All math is performed with `ChqTime.calendar`
/// (Gregorian, pinned to America/New_York) so the noon boundary lands
/// correctly across DST transitions.
nonisolated enum SeasonCalendar {
    /// The start of Week 1 for `year`: the Saturday before the 4th Sunday of
    /// June, at 12:00 noon NY.
    static func seasonStart(year: Int) -> Date {
        let cal = ChqTime.calendar

        var juneFirstComponents = DateComponents()
        juneFirstComponents.year = year
        juneFirstComponents.month = 6
        juneFirstComponents.day = 1
        guard let juneFirst = cal.date(from: juneFirstComponents) else {
            fatalError("SeasonCalendar: could not construct June 1, \(year)")
        }

        // Calendar.weekday: Sunday == 1 ... Saturday == 7.
        let weekday = cal.component(.weekday, from: juneFirst)
        let daysToFirstSunday = (1 - weekday + 7) % 7
        guard let firstSunday = cal.date(byAdding: .day, value: daysToFirstSunday, to: juneFirst),
              let fourthSunday = cal.date(byAdding: .day, value: 21, to: firstSunday),
              let saturdayBeforeFourthSunday = cal.date(byAdding: .day, value: -1, to: fourthSunday)
        else {
            fatalError("SeasonCalendar: could not compute 4th Sunday of June, \(year)")
        }

        // Set the noon boundary via calendar components (not by adding fixed
        // seconds), so DST transitions never shift the wall-clock time.
        var noonComponents = cal.dateComponents([.year, .month, .day], from: saturdayBeforeFourthSunday)
        noonComponents.hour = 12
        noonComponents.minute = 0
        noonComponents.second = 0
        guard let start = cal.date(from: noonComponents) else {
            fatalError("SeasonCalendar: could not set noon boundary for \(year) season start")
        }
        return start
    }

    /// The season's 9 weeks, each exactly 7 days, noon Saturday to noon
    /// Saturday.
    static func weeks(forYear year: Int) -> [SeasonWeek] {
        let cal = ChqTime.calendar
        var result: [SeasonWeek] = []
        var weekStart = seasonStart(year: year)
        for number in 1...9 {
            guard let weekEnd = cal.date(byAdding: .day, value: 7, to: weekStart) else {
                fatalError("SeasonCalendar: could not compute end of week \(number), \(year)")
            }
            result.append(SeasonWeek(number: number, start: weekStart, end: weekEnd))
            weekStart = weekEnd
        }
        return result
    }

    /// The week number containing `at`, or `nil` if `at` falls outside the
    /// season entirely.
    static func currentWeekNumber(at date: Date, year: Int) -> Int? {
        weeks(forYear: year).first { $0.contains(date) }?.number
    }

    /// The week number(s) whose `[start, end)` range intersects the NY
    /// calendar day containing `date`. A Saturday that falls on an
    /// in-season week boundary intersects both the outgoing and incoming
    /// week, so it returns two numbers (e.g. `[1, 2]`).
    static func weekNumbers(spanningDayOf date: Date, year: Int) -> [Int] {
        let cal = ChqTime.calendar
        let dayStart = cal.startOfDay(for: date)
        guard let dayEnd = cal.date(byAdding: .day, value: 1, to: dayStart) else {
            return []
        }
        return weeks(forYear: year)
            .filter { $0.start < dayEnd && $0.end > dayStart }
            .map { $0.number }
    }
}
