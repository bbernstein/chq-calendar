import Foundation

/// One day's slice of the week band above the day rail (#256).
///
/// One segment per day chip, so the band aligns with the chips **by
/// construction** rather than by two layouts happening to agree — the same
/// argument the web rail's shared chip-box class rests on. A single pixel
/// of drift shows up as a seam through a week boundary.
nonisolated struct WeekBandSegment: Equatable, Sendable, Identifiable {
    /// The day this segment sits above.
    let dayKey: String

    /// The season week(s) this day belongs to, ascending. Two entries means
    /// a boundary Saturday, which belongs to both the week it closes and
    /// the week it opens. Empty for a day outside the season.
    ///
    /// Day-granular deliberately: a Chautauqua week turns over at Saturday
    /// *noon*, but splitting a 44pt chip at its centre is a distinction no
    /// reader can use at swipe speed. This is the same model
    /// `SeasonCalendar.weekNumbers(spanningDayOf:)` gives the `Wk 5/6`
    /// day-header badge.
    let weekNumbers: [Int]

    /// Position in the season for each entry of `weekNumbers`, same order:
    /// 0 for week 1, 1 for the last week. Drives the colour ramp, which
    /// varies in lightness rather than hue so it survives colour-vision
    /// deficiency and so adjacent weeks always differ.
    let rampSteps: [Double]

    /// The week a tap here navigates to, or `nil` when a tap would be
    /// ambiguous or meaningless.
    ///
    /// `nil` for a *shared* Saturday: it opens one week and closes another,
    /// so a tap on it cannot mean one week. Each week's six non-shared days
    /// (Sunday through Friday) carry its navigation instead — plus week 1's
    /// opening Saturday and the final week's closing Saturday, which have
    /// no neighbour to share with. Also `nil` outside the season.
    let navigationTarget: Int?

    /// The week whose `WEEK n` label this segment draws, if any. At most
    /// one segment per week carries it.
    let labelledWeek: Int?

    var id: String { dayKey }
}

/// Builds the week band's per-day segments.
///
/// Pure and fully unit-testable: *which* spans a band covers is decided
/// here; where they land in pixels is the view's problem. That split is
/// deliberate — the pixel half is the part only a device can check.
nonisolated enum WeekBands {
    /// Segments for `dayKeys`, in the order given.
    ///
    /// `dayKeys` is the rail's own span (`navigableBounds`), which is a
    /// superset of the season and can start or end mid-week. Label
    /// placement therefore follows the *visible* run of each week rather
    /// than a fixed offset from a week start that may be off screen.
    static func segments(dayKeys: [String], year: Int) -> [WeekBandSegment] {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard !weeks.isEmpty else {
            return dayKeys.map {
                WeekBandSegment(dayKey: $0, weekNumbers: [], rampSteps: [],
                                navigationTarget: nil, labelledWeek: nil)
            }
        }

        let denominator = Double(max(weeks.count - 1, 1))
        let membership = dayKeys.map { key -> [Int] in
            // `key` is a bare "yyyy-MM-dd" day key, not the space- or
            // T-separated timestamp `ChqTime.parse` expects, so it is
            // anchored to local midnight first — the same
            // `parse("\(key) 00:00:00")` pattern `ChqTime.day(_:offsetBy:)`
            // and `isCanonicalDayKey` already use. The exact wall-clock
            // time within the day doesn't matter here:
            // `weekNumbers(spanningDayOf:)` normalises to `startOfDay`
            // before comparing against week boundaries.
            guard let date = ChqTime.parse("\(key) 00:00:00") else { return [] }
            return SeasonCalendar.weekNumbers(spanningDayOf: date, year: year)
        }

        // A week's label goes on the middle of its visible *non-shared*
        // days, so it never lands on a boundary Saturday (where it would
        // have to pick one of two weeks and would sit on the split fill).
        var labelIndexByWeek: [Int: Int] = [:]
        var soloIndicesByWeek: [Int: [Int]] = [:]
        for (index, numbers) in membership.enumerated() where numbers.count == 1 {
            soloIndicesByWeek[numbers[0], default: []].append(index)
        }
        for (week, indices) in soloIndicesByWeek {
            labelIndexByWeek[week] = indices[indices.count / 2]
        }

        return dayKeys.enumerated().map { index, key in
            let numbers = membership[index]
            let steps = numbers.map { Double($0 - 1) / denominator }
            // Unambiguous only when this day belongs to exactly one week.
            let target = numbers.count == 1 ? numbers[0] : nil
            let labelled = numbers.count == 1 && labelIndexByWeek[numbers[0]] == index
                ? numbers[0] : nil
            return WeekBandSegment(
                dayKey: key, weekNumbers: numbers, rampSteps: steps,
                navigationTarget: target, labelledWeek: labelled)
        }
    }

    /// The day key of the full Saturday that opens `number`.
    ///
    /// The navigation target for a band tap: a reader asking for week 6 is
    /// asking to be put at the top of week 6, and week 6 opens on that
    /// Saturday — even though its morning belongs to week 5, which the day
    /// header's `Wk 5/6` and the band's split fill both already say.
    ///
    /// Reachability is the caller's business: this names the day, and
    /// `EventListView.selectDay` decides whether it can be reached.
    static func openingDayKey(ofWeek number: Int, year: Int) -> String? {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let week = weeks.first(where: { $0.number == number }) else { return nil }
        return ChqTime.dayKey(for: week.start)
    }
}
