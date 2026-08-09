import Foundation

/// NY-pinned time helpers. All parsing/formatting is anchored to
/// America/New_York regardless of the device's local time zone, since the
/// Chautauqua Institution's season always runs on Eastern time and the feed
/// dates carry no UTC offset of their own.
nonisolated enum ChqTime {
    static let zone = TimeZone(identifier: "America/New_York")!

    static var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        return cal
    }

    /// `"yyyy-MM-dd HH:mm:ss"` — the space-separated form used by the
    /// events feed.
    private static let spaceSeparatedFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    /// `"yyyy-MM-dd'T'HH:mm:ss"` — the ISO-ish `T`-separated form some
    /// events (and publisher feeds) use instead.
    private static let tSeparatedFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return formatter
    }()

    private static let dayKeyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let dayTitleFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter
    }()

    private static let timeStringFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    /// `"EEE d"`, e.g. `"Fri 14"` — shared by `MyDayView`'s day chips and
    /// `GroundsMapView`'s upcoming-events rows (task 18, fix round 1 fold-in;
    /// previously two identical private formatters).
    private static let compactDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEE d"
        return formatter
    }()

    /// `"EEE"`, e.g. `"Sun"` — the top line of a My Day chip (#192).
    /// Deliberately separate from `compactDayFormatter` (`"EEE d"`), which
    /// `GroundsMapView` also uses and which must not change.
    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEE"
        return formatter
    }()

    /// `"MMM d"`, e.g. `"Aug 9"` — the date line of a My Day chip. The
    /// month is on *every* chip so a chip is unambiguous wherever the strip
    /// happens to be scrolled (#192).
    private static let monthDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "MMM d"
        return formatter
    }()

    /// `"EEEE, MMMM d, yyyy"` — `dayTitle` for a season that isn't the
    /// current one, where the year is load-bearing.
    private static let dayTitleWithYearFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEEE, MMMM d, yyyy"
        return formatter
    }()

    /// `"EEE, MMM d"`, e.g. `"Sun, Aug 9"` — the Events-tab date pill for a
    /// `.day` scope.
    private static let pillDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEE, MMM d"
        return formatter
    }()

    /// `"EEE, MMM d, yyyy"`, e.g. `"Sat, Aug 23, 2025"`.
    private static let pillDayWithYearFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEE, MMM d, yyyy"
        return formatter
    }()

    /// Parses `"yyyy-MM-dd HH:mm:ss"` or `"yyyy-MM-dd'T'HH:mm:ss"`, both
    /// interpreted as America/New_York wall-clock time.
    static func parse(_ s: String) -> Date? {
        if let date = spaceSeparatedFormatter.date(from: s) {
            return date
        }
        return tSeparatedFormatter.date(from: s)
    }

    /// A stable `"yyyy-MM-dd"` key for grouping events by NY calendar day,
    /// independent of the process's local time zone.
    static func dayKey(for date: Date) -> String {
        dayKeyFormatter.string(from: date)
    }

    /// `"EEEE, MMMM d"`, e.g. `"Monday, July 27"`.
    static func dayTitle(for date: Date) -> String {
        dayTitleFormatter.string(from: date)
    }

    /// `"h:mm a"`, e.g. `"12:45 PM"`.
    static func timeString(for date: Date) -> String {
        timeStringFormatter.string(from: date)
    }

    /// `"EEE d"`, e.g. `"Fri 14"`.
    static func compactDayLabel(for date: Date) -> String {
        compactDayFormatter.string(from: date)
    }

    /// `"EEE"`, e.g. `"Sun"`.
    static func weekdayLabel(for date: Date) -> String {
        weekdayFormatter.string(from: date)
    }

    /// `"MMM d"`, e.g. `"Aug 9"`.
    static func monthDayLabel(for date: Date) -> String {
        monthDayFormatter.string(from: date)
    }

    /// `dayTitle`, optionally carrying the year. Callers pass
    /// `includingYear: !isCurrentYear` — the same signal the rest of the app
    /// already threads through to distinguish the live season from an
    /// archived one.
    static func dayTitle(for date: Date, includingYear: Bool) -> String {
        includingYear ? dayTitleWithYearFormatter.string(from: date) : dayTitle(for: date)
    }

    /// `"EEE, MMM d"` (optionally `", yyyy"`), e.g. `"Sun, Aug 9"` — the
    /// Events-tab date pill for a `.day` scope.
    static func pillDayLabel(for date: Date, includingYear: Bool) -> String {
        includingYear
            ? pillDayWithYearFormatter.string(from: date)
            : pillDayFormatter.string(from: date)
    }

    /// The last moment (23:59:59) of the NY calendar day containing `date`.
    static func endOfDay(_ date: Date) -> Date {
        let cal = calendar
        let startOfDay = cal.startOfDay(for: date)
        return cal.date(byAdding: DateComponents(day: 1, second: -1), to: startOfDay) ?? date
    }

    /// `key` shifted by `days` NY calendar days, or `nil` when `key` isn't a
    /// parseable `"yyyy-MM-dd"` day key.
    ///
    /// Goes through `calendar.date(byAdding: .day:)` rather than adding
    /// 86_400 seconds, so a day that is 23 or 25 hours long across a DST
    /// transition still counts as one day.
    static func day(_ key: String, offsetBy days: Int) -> String? {
        guard
            let date = parse("\(key) 00:00:00"),
            let shifted = calendar.date(byAdding: .day, value: days, to: date)
        else { return nil }
        return dayKey(for: shifted)
    }

    /// Every day key from `from` through `through`, inclusive and ascending.
    /// Empty when either key is unparseable or `through` precedes `from`.
    static func dayKeys(from: String, through: String) -> [String] {
        guard
            from <= through,
            let startDate = parse("\(from) 00:00:00"),
            parse("\(through) 00:00:00") != nil
        else { return [] }

        var result: [String] = []
        var cursor = startDate
        var key = dayKey(for: cursor)
        while key <= through {
            result.append(key)
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
            key = dayKey(for: cursor)
        }
        return result
    }
}
