import Foundation

/// What the root list view should show for "now", derived purely from the
/// clock, the season calendar, and how many events the default filter would
/// currently surface. Exists because `EventFilter`'s `.next` scope caps its
/// adaptive window at 90 days (see `EventFilter.adaptiveEndDate`) — once the
/// season has been over for more than 90 days, the default filter's window
/// still advances with "now" but there is nothing left in it, so the app
/// would otherwise land on a silently empty screen (#177) rather than
/// telling the user the season is over and when the next one starts.
///
/// `determine` is a pure function of its arguments — no `Date()`, no clock
/// reads — so it is trivially testable and callers (`AppModel.landingState`)
/// own supplying "now" and the upcoming-event count consistently with
/// whatever else they derive from the same instant.
nonisolated enum LandingState: Equatable, Sendable {
    /// The default filter already has at least one upcoming event to show.
    case inSeason

    /// `selectedYear`'s season has not started yet. `opening` is that
    /// season's start instant; `daysUntil` is the whole-day NY-calendar
    /// difference between "now" and `opening`.
    case preSeason(opening: Date, daysUntil: Int)

    /// `selectedYear`'s season has already ended (or, equivalently, the
    /// default filter's adaptive window has run past its 90-day cap with
    /// nothing left in it) and it isn't yet time to call that a `preSeason`
    /// for a later year. `nextSeasonYear`/`opening`/`daysUntil` describe the
    /// next season announced in the years manifest, or are all `nil` when no
    /// later year is available yet.
    case postSeason(endedSeasonYear: Int, nextSeasonYear: Int?, opening: Date?, daysUntil: Int?)

    /// `true` only for `.postSeason`, regardless of its associated values —
    /// the discriminator `EventListView`/`AppModelTests` need without
    /// pattern-matching out four values they don't care about.
    var isPostSeason: Bool {
        if case .postSeason = self { return true }
        return false
    }

    /// Rules, in priority order:
    /// 1. `upcomingDefaultCount > 0` → `.inSeason` — the default filter has
    ///    something to show, regardless of the calendar.
    /// 2. Else, if `now` is before `selectedYear`'s season start → `.preSeason`.
    /// 3. Else → `.postSeason`, describing whatever later year (if any) is
    ///    in `availableYears`.
    static func determine(
        now: Date,
        selectedYear: Int,
        availableYears: [Int],
        upcomingDefaultCount: Int
    ) -> LandingState {
        guard upcomingDefaultCount <= 0 else {
            return .inSeason
        }

        let start = SeasonCalendar.seasonStart(year: selectedYear)
        if now < start {
            return .preSeason(opening: start, daysUntil: daysBetween(now, start))
        }

        let nextSeasonYear = availableYears.filter { $0 > selectedYear }.min()
        let opening = nextSeasonYear.map(SeasonCalendar.seasonStart)
        let daysUntil = opening.map { daysBetween(now, $0) }
        return .postSeason(
            endedSeasonYear: selectedYear,
            nextSeasonYear: nextSeasonYear,
            opening: opening,
            daysUntil: daysUntil
        )
    }

    /// Whole NY-calendar days between the day containing `from` and the day
    /// containing `to` — not a raw 24-hour-bucket division, so a `from`/`to`
    /// pair that straddles a DST transition still counts calendar dates, not
    /// partial days.
    private static func daysBetween(_ from: Date, _ to: Date) -> Int {
        let calendar = ChqTime.calendar
        let fromDay = calendar.startOfDay(for: from)
        let toDay = calendar.startOfDay(for: to)
        return calendar.dateComponents([.day], from: fromDay, to: toDay).day ?? 0
    }
}
