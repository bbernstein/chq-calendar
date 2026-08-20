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
/// - **Empty** is `isEmpty`, which the view renders as a dashed stroke.
///   Rendered at ordinary (not dimmed) text weight — a translucent chip
///   background compounded with dimmed text into an on-device contrast
///   audit failure, so the stroke alone now carries the signal.
/// - **Count** is `count`, on its own line.
nonisolated struct MyDayChipContent: Equatable, Sendable {
    /// `"Today"` for today's chip, otherwise the weekday (`"Sun"`).
    let topLine: String
    /// `"MMM d"` — e.g. `"Aug 9"`. The month is on *every* chip so a chip is
    /// unambiguous wherever the strip happens to be scrolled. The old chip
    /// was `"EEE d"` ("Sun 9"), which cannot distinguish June from August
    /// without counting.
    let dateLine: String
    let count: Int
    /// SF Symbol beside the count, from the style. `nil` renders a bare
    /// number, which is what the Events rail wants: an events count needs no
    /// icon to say what it counts, and a symbol on 58 chips is visual noise.
    let symbol: String?
    let isToday: Bool
    /// Spoken as one phrase, e.g. `"Sunday, August 9, today, 3 starred events"`.
    let accessibilityLabel: String

    var isEmpty: Bool { count == 0 }

    /// `nil` when `dayKey` isn't a parseable `"yyyy-MM-dd"` day key.
    ///
    /// `includingYear` affects only `accessibilityLabel`: the visible lines
    /// stay compact because a year does not fit on a chip, but a screen
    /// reader announcing an archived season's day should say which year.
    static func make(
        dayKey: String,
        todayKey: String,
        count: Int,
        style: DayChipCountStyle,
        includingYear: Bool
    ) -> MyDayChipContent? {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return nil }

        let isToday = dayKey == todayKey
        let title = ChqTime.dayTitle(for: date, includingYear: includingYear)
        // The prefix rides the title rather than the whole phrase so it reads
        // as "Go to Sunday, August 16, 4 events" and not "Go to Sunday,
        // August 16, today, 4 events" losing its verb somewhere in the
        // middle. Empty days never take it — see `actionPrefix`.
        let head = (count > 0 ? style.actionPrefix : nil).map { "\($0) \(title)" } ?? title
        let spokenParts = [head, isToday ? "today" : nil, style.phrase(for: count)]
            .compactMap { $0 }

        return MyDayChipContent(
            topLine: isToday ? "Today" : ChqTime.weekdayLabel(for: date),
            dateLine: ChqTime.monthDayLabel(for: date),
            count: count,
            symbol: style.symbol,
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
    /// upstream. DEBUG builds trap on it. Release builds render it anyway
    /// whenever `make` can read it — `assert` compiles out, and a key like
    /// `"2026-8-9"` parses (see `ChqTime.isCanonicalDayKey` for why
    /// "parses" and "is canonical" differ), so it yields a chip carrying
    /// that non-canonical string as its `.id`.
    ///
    /// That is deliberate, not an oversight. Skipping it would reopen the
    /// gap-in-the-strip failure this helper exists to close, and the `.id`
    /// stays usable because `selectedDay` and `days` both come from the
    /// same `DayWindow` — they are wrong together or right together, so
    /// `scrollTo` still finds its target. Only a key `make` cannot parse at
    /// all is dropped, which is the pre-existing behavior.
    ///
    /// The non-canonical path is therefore unreachable from the test suite,
    /// which runs DEBUG and would trap: the assertion is the contract, and
    /// `ChqTimeTests.everyGeneratedDayKeyIsCanonical` is what keeps it from
    /// firing on legitimate data.
    static func makeAll(
        days: [String],
        todayKey: String,
        counts: [String: Int],
        style: DayChipCountStyle,
        includingYear: Bool
    ) -> [Entry] {
        days.compactMap { day in
            assert(
                ChqTime.isCanonicalDayKey(day),
                "non-canonical day key \"\(day)\" reached the My Day strip — check day-key generation")
            guard let content = make(
                dayKey: day,
                todayKey: todayKey,
                count: counts[day] ?? 0,
                style: style,
                includingYear: includingYear
            ) else { return nil }
            return Entry(day: day, content: content)
        }
    }
}
