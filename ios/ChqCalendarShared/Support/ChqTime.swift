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

    /// The last moment (23:59:59) of the NY calendar day containing `date`.
    static func endOfDay(_ date: Date) -> Date {
        let cal = calendar
        let startOfDay = cal.startOfDay(for: date)
        return cal.date(byAdding: DateComponents(day: 1, second: -1), to: startOfDay) ?? date
    }
}
