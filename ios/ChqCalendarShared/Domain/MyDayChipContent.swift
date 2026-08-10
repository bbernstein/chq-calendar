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

    /// One chip, paired with the day key it was built from — the key doubles
    /// as the `ForEach`/`scrollTo` identity in `MyDayView`.
    nonisolated struct Entry: Equatable, Identifiable, Sendable {
        let day: String
        let content: MyDayChipContent
        var id: String { day }
    }

    /// Chip contents for a whole strip, in the order given.
    ///
    /// **Why this exists rather than calling `make` inside the `ForEach`.**
    /// `make` returns `nil` for a key it cannot read, and an `if let` in a
    /// `ForEach` body drops that chip — *and its `.id`* — leaving nothing on
    /// screen but a gap. A missing `.id` is precisely the orphaned-selection
    /// failure `DayWindow.make`'s `selectedDay` widening exists to prevent,
    /// so a regression in day-key generation would resurface as a strip that
    /// silently will not scroll to the selection, with no other symptom
    /// (#197 item 6).
    ///
    /// Callers build `days` from `ChqTime.dayKeys` / `ChqTime.day`, which
    /// only ever emit canonical keys, so a non-canonical one here is a bug
    /// upstream. DEBUG builds trap on it; release builds skip the chip as
    /// before, because a strip missing one day is better than a crash in the
    /// user's hand.
    static func makeAll(
        days: [String],
        todayKey: String,
        starredCounts: [String: Int],
        includingYear: Bool
    ) -> [Entry] {
        days.compactMap { day in
            assert(
                ChqTime.isCanonicalDayKey(day),
                "non-canonical day key \"\(day)\" reached the My Day strip — check day-key generation")
            guard let content = make(
                dayKey: day,
                todayKey: todayKey,
                starCount: starredCounts[day] ?? 0,
                includingYear: includingYear
            ) else { return nil }
            return Entry(day: day, content: content)
        }
    }
}
