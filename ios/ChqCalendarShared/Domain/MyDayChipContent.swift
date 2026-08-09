import Foundation

/// The text and state one My Day day-chip renders (#192).
///
/// Split out of the SwiftUI view so the labelling rules — which are what the
/// issue was actually about — are unit-testable without a view host.
///
/// **The state encoding.** A day can be empty *and* today *and* selected at
/// once, so the four signals must not compete for the same channel:
///
/// - **Fill** means *selected*, and means nothing else. It is owned by the
///   view, not by this type.
/// - **Today** is carried by the word `"Today"` in `topLine`. Because it
///   lives in the text, it survives being selected, being empty, or both. A
///   ring or accent border would be swallowed by the selected fill in
///   exactly the case where it matters most.
/// - **Empty** is `isEmpty`, which the view renders as a dashed stroke plus
///   secondary content.
/// - **Count** is `starCount`, on its own line.
nonisolated struct MyDayChipContent: Equatable, Sendable {
    /// `"Today"` for today's chip, otherwise the weekday (`"Sun"`).
    let topLine: String
    /// `"MMM d"` — e.g. `"Aug 9"`. The month is on *every* chip so a chip is
    /// unambiguous wherever the strip happens to be scrolled. The old chip
    /// was `"EEE d"` ("Sun 9"), which cannot distinguish June from August
    /// without counting.
    let dateLine: String
    let starCount: Int
    let isToday: Bool
    /// Spoken as one phrase, e.g. `"Sunday, August 9, today, 3 starred events"`.
    let accessibilityLabel: String

    var isEmpty: Bool { starCount == 0 }

    /// `nil` when `dayKey` isn't a parseable `"yyyy-MM-dd"` day key.
    ///
    /// `includingYear` affects only `accessibilityLabel`: the visible lines
    /// stay compact because a year does not fit on a chip, but a screen
    /// reader announcing an archived season's day should say which year.
    static func make(
        dayKey: String,
        todayKey: String,
        starCount: Int,
        includingYear: Bool
    ) -> MyDayChipContent? {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return nil }

        let isToday = dayKey == todayKey
        let countPhrase = starCount == 0
            ? "no starred events"
            : "\(starCount) starred event\(starCount == 1 ? "" : "s")"
        let spokenParts = [
            ChqTime.dayTitle(for: date, includingYear: includingYear),
            isToday ? "today" : nil,
            countPhrase,
        ].compactMap { $0 }

        return MyDayChipContent(
            topLine: isToday ? "Today" : ChqTime.weekdayLabel(for: date),
            dateLine: ChqTime.monthDayLabel(for: date),
            starCount: starCount,
            isToday: isToday,
            accessibilityLabel: spokenParts.joined(separator: ", "))
    }
}
