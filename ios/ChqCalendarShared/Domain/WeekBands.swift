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

/// Where a tap on one week's band lands, and what VoiceOver reads for it.
///
/// A week with no `WeekBandDestination` is one the band cannot reach — its
/// fill is dimmed and its tap does nothing, mirroring the empty chips
/// directly beneath it (`disablesEmptyDays: true`), rather than looking
/// ordinary and silently refusing.
nonisolated struct WeekBandDestination: Equatable, Sendable {
    /// The day a tap navigates to.
    let dayKey: String

    /// The phrase VoiceOver reads for the band, e.g. "Go to Week 6, opens
    /// Saturday, June 27, 84 events".
    let accessibilityLabel: String
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
        // Built **once** and threaded into every membership lookup below
        // (#256 review fix). `SeasonCalendar.weekNumbers(spanningDayOf:
        // year:)` rebuilds the whole season on every call, and this runs
        // once per day key inside `EventListView.body`'s
        // `.safeAreaInset(edge: .top)` — which re-evaluates every time
        // `visibleDays` changes, i.e. at every day-section boundary crossed
        // while scrolling. That made a ~70-chip rail cost ~70 season
        // rebuilds (a `seasonStart` plus nine `date(byAdding:)` each) per
        // scroll tick on the main thread. One rebuild, seventy lookups.
        let weeks = SeasonCalendar.weeks(forYear: year)

        // `SeasonCalendar.weeks` always returns nine, so an empty season is
        // unreachable — but the ramp divides by this, and a one-week season
        // would divide by zero rather than merely look wrong. The guard that
        // used to sit above this line said the same thing a second way and
        // was deleted; this one stays because it is the one that prevents a
        // crash rather than a redundant early return.
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
            return SeasonCalendar.weekNumbers(spanningDayOf: date, in: weeks)
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
    /// `WeekBands.navigationTarget(week:year:eventDays:bounds:)` decides
    /// whether it can be reached.
    static func openingDayKey(ofWeek number: Int, year: Int) -> String? {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let week = weeks.first(where: { $0.number == number }) else { return nil }
        return ChqTime.dayKey(for: week.start)
    }

    /// The day a tap on week `number`'s band should land on, or `nil` when
    /// no day of that week can be reached at all.
    ///
    /// The design's three branches, in order, live here rather than in
    /// `EventListView` so both fallbacks are testable without a view host:
    ///
    /// 1. the full Saturday that opens the week, when it holds events under
    ///    the current non-date filters — a reader asking for week 6 is
    ///    asking to be put at the top of week 6;
    /// 2. otherwise the week's first day that does, because the rail never
    ///    announces a destination it cannot reach;
    /// 3. otherwise `nil`, which is the signal the band is **disabled** —
    ///    matching `disablesEmptyDays: true` on the chips beneath it. A
    ///    normal-looking band next to visibly empty chips that does nothing
    ///    when tapped is worse than one that says it cannot go there.
    ///
    /// `bounds` is the rail's own navigable span. A day outside it is not a
    /// legal target (`AppModel.goToDay` refuses it), so a week whose days
    /// all lie outside is unreachable even if events exist there.
    ///
    /// `eventDays` is `NavMatching.eventDays`, already sorted ascending, so
    /// `first(where:)` over it in its existing order finds the week's
    /// earliest reachable day without re-sorting work `AppModel` has done.
    static func navigationTarget(
        week number: Int,
        year: Int,
        eventDays: [String],
        bounds: ClosedRange<String>
    ) -> String? {
        destination(
            ofWeek: number, in: SeasonCalendar.weeks(forYear: year),
            eventDays: eventDays, bounds: bounds
        )?.dayKey
    }

    /// Every week the band can navigate to, keyed by week number, with the
    /// phrase VoiceOver reads for it. A week **absent** from the map is
    /// unreachable: its band renders dimmed and does not fire.
    ///
    /// The batch form exists because the rail needs all nine answers on
    /// every render and the single-week form rebuilds the season each call —
    /// the same cost `segments` was fixed for. One season build here.
    static func destinations(
        year: Int,
        eventDays: [String],
        bounds: ClosedRange<String>,
        countsByDay: [String: Int],
        includingYear: Bool
    ) -> [Int: WeekBandDestination] {
        let weeks = SeasonCalendar.weeks(forYear: year)
        var result: [Int: WeekBandDestination] = [:]
        for week in weeks {
            guard let found = destination(
                ofWeek: week.number, in: weeks, eventDays: eventDays, bounds: bounds)
            else { continue }
            result[week.number] = WeekBandDestination(
                dayKey: found.dayKey,
                accessibilityLabel: label(
                    week: week.number, dayKey: found.dayKey,
                    opensTheWeek: found.opensTheWeek,
                    eventCount: countsByDay[found.dayKey] ?? 0,
                    includingYear: includingYear))
        }
        return result
    }

    /// What VoiceOver reads for a week the band cannot reach — a statement
    /// of fact, not an offer, exactly as `MyDayChipContent` labels an empty
    /// chip ("Sunday, August 16, no events") rather than offering to go
    /// there.
    static func unreachableLabel(week number: Int) -> String {
        "Week \(number), no events"
    }

    private static func destination(
        ofWeek number: Int,
        in weeks: [SeasonWeek],
        eventDays: [String],
        bounds: ClosedRange<String>
    ) -> (dayKey: String, opensTheWeek: Bool)? {
        guard let week = weeks.first(where: { $0.number == number }) else { return nil }

        // A week's days run from the key of the Saturday it opens on
        // through the key of the Saturday it closes on, both inclusive —
        // the day-granular span `SeasonCalendar.weekNumbers(spanningDayOf:)`
        // gives the band, in which a boundary Saturday belongs to both of
        // its weeks. Day keys are `"yyyy-MM-dd"`, so string ordering is
        // chronological ordering and the clamp against `bounds` is a plain
        // comparison.
        let opening = ChqTime.dayKey(for: week.start)
        let closing = ChqTime.dayKey(for: week.end)
        let first = max(opening, bounds.lowerBound)
        let last = min(closing, bounds.upperBound)
        guard first <= last else { return nil }

        if opening >= first, opening <= last, eventDays.contains(opening) {
            return (opening, true)
        }
        guard let fallback = eventDays.first(where: { $0 >= first && $0 <= last })
        else { return nil }
        return (fallback, false)
    }

    private static func label(
        week number: Int, dayKey: String, opensTheWeek: Bool,
        eventCount: Int, includingYear: Bool
    ) -> String {
        // Named by destination, never by direction — the rail's established
        // convention (`DayRailNavigation.stepLabel`'s own rule, and why
        // `⟳ Now` reads "Go to Wednesday, July 1, today, 3 events" rather
        // than "go forward"). "Opens" is only said when the target really is
        // the week's opening Saturday; when the reader is being sent to a
        // later day because that Saturday is empty, saying "opens" would be
        // a small lie about where they are landing.
        let title = ChqTime.parse("\(dayKey) 00:00:00")
            .map { ChqTime.dayTitle(for: $0, includingYear: includingYear) } ?? dayKey
        let where_ = opensTheWeek ? "opens \(title)" : "first events \(title)"
        return "Go to Week \(number), \(where_), "
            + "\(eventCount) event\(eventCount == 1 ? "" : "s")"
    }
}
