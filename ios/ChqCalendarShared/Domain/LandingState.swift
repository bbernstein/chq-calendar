import Foundation

/// What the root list view should show for "now", derived purely from the
/// clock, the season calendar, and whether the selected year's own events
/// have anything left ahead. Exists because `EventFilter`'s `.next` scope
/// caps its adaptive window at 90 days (see `EventFilter.adaptiveEndDate`) —
/// once the season has been over for more than 90 days, the default filter's
/// window still advances with "now" but there is nothing left in it, so the
/// app would otherwise land on a silently empty screen (#177) rather than
/// telling the user the season is over and when the next one starts.
///
/// **The inputs are the year's whole event set, never `.next`'s window
/// (#288).** That distinction is the entire bug this signature now prevents:
/// asking "does `.next` have something" folds the 90-day cap — a *scope*
/// decision — into "is the season over", and on 2026-10-01, when the server
/// flips `defaultYear` to a 2027 whose published events were ~265 days out,
/// the two answers came apart. iOS said `.preSeason` (a countdown with no
/// buttons, for six months) while the web, asking its year's whole event
/// set, said `in-season` for the identical manifest, feed and clock.
/// `frontend/src/lib/utils/landingState.ts`'s module header promises the two
/// apps do not hold different opinions about whether the season is over;
/// this is the half of that promise iOS owns.
///
/// `determine` is a pure function of its arguments — no `Date()`, no clock
/// reads — so it is trivially testable and callers (`AppModel.landingState`)
/// own supplying "now" and the event predicates consistently with whatever
/// else they derive from the same instant.
nonisolated enum LandingState: Equatable, Sendable {
    /// There is nothing off-season to say: either `selectedYear` still has
    /// an event ahead of "now", or we have no event data for it at all (rule
    /// 3). The list — or, with no data, the generic empty state — is what
    /// the reader should see.
    case inSeason

    /// `selectedYear`'s season has not started yet. `opening` is that
    /// season's start instant; `daysUntil` is the whole-day NY-calendar
    /// difference between "now" and `opening`.
    case preSeason(opening: Date, daysUntil: Int)

    /// `selectedYear` has events, its season start is past, and none of
    /// those events is still ahead — the season ran and is over — and it
    /// isn't yet time to call that a `preSeason` for a later year.
    /// `nextSeasonYear` names the next season announced in the years
    /// manifest, or is `nil` when no later year is available yet.
    /// `opening`/`daysUntil` describe that season only while it is still
    /// ahead of "now"; both go `nil` once it has started, so an archived
    /// year never renders a countdown that has already run negative.
    case postSeason(endedSeasonYear: Int, nextSeasonYear: Int?, opening: Date?, daysUntil: Int?)

    /// `true` only for `.postSeason`, regardless of its associated values —
    /// the discriminator `EventListView`/`AppModelTests` need without
    /// pattern-matching out four values they don't care about.
    var isPostSeason: Bool {
        if case .postSeason = self { return true }
        return false
    }

    /// The year `OffSeasonLandingView`'s "Browse the _ season" button
    /// offers, or `nil` to hide the button entirely.
    ///
    /// `.postSeason` always has one — `endedSeasonYear`, the very year
    /// `AppModel.selectedYear` is already on, which is exactly what
    /// `AppModel.browseArchiveSeason()` (deliberately not touching
    /// `selectedYear`) shows.
    ///
    /// `.preSeason` is unconditionally `nil`, even when `selectedYear - 1`
    /// exists in the years manifest: `browseArchiveSeason()` has no
    /// year-aware variant, so a `.preSeason` button labeled `selectedYear -
    /// 1` would apply `.season` scope to `selectedYear` (the *upcoming*
    /// year) instead of the labeled past year — a label/outcome mismatch a
    /// reviewer confirmed as an Important defect. Hiding the button is the
    /// mitigation until a year-aware `browsePastSeason(year:)` exists.
    var archiveYear: Int? {
        if case .postSeason(let endedSeasonYear, _, _, _) = self {
            return endedSeasonYear
        }
        return nil
    }

    /// Rules, in priority order — matching `landingState.ts`'s
    /// `determineLandingState` exactly, rule for rule:
    /// 1. `yearHasUpcomingEvents` → `.inSeason` — the year still has
    ///    something ahead, regardless of the calendar.
    /// 2. Else, if `now` is before `selectedYear`'s season start → `.preSeason`.
    /// 3. Else, if the year has no events at all → `.inSeason`. "We have no
    ///    data" is not "the season is over": a feed that failed to decode or
    ///    came back empty mid-July must reach the generic empty state, not
    ///    "See you next season". `AppModel.landingState`'s `guard snapshot
    ///    != nil` covers the no-snapshot case; this covers a snapshot that
    ///    decoded to nothing.
    /// 4. Else → `.postSeason`, describing whatever later year (if any) is
    ///    in `availableYears`.
    ///
    /// - Parameter yearHasUpcomingEvents: does ANY event in `selectedYear`'s
    ///   full, UNFILTERED set start at or after a graced `now`? **Not** "does
    ///   the default filter have something to show" — see the type's header
    ///   for why that distinction is load-bearing (#288). The grace is the
    ///   caller's: `AppModel` applies the same one hour `.next` itself opens
    ///   with (`ViewWindow.swift`'s `now.addingTimeInterval(-3600)`), so the
    ///   hour after the season's last event begins is not reported as the
    ///   season being over while that event is still running.
    /// - Parameter yearHasEvents: does `selectedYear`'s full, UNFILTERED set
    ///   hold any event at all? See rule 3.
    static func determine(
        now: Date,
        selectedYear: Int,
        availableYears: [Int],
        yearHasUpcomingEvents: Bool,
        yearHasEvents: Bool
    ) -> LandingState {
        guard !yearHasUpcomingEvents else {
            return .inSeason
        }

        let start = SeasonCalendar.seasonStart(year: selectedYear)
        if now < start {
            return .preSeason(opening: start, daysUntil: daysBetween(now, start))
        }

        guard yearHasEvents else {
            return .inSeason
        }

        let nextSeasonYear = availableYears.filter { $0 > selectedYear }.min()
        let nextOpening = nextSeasonYear.map(SeasonCalendar.seasonStart)
        // Only a countdown target while it is still ahead of `now`. A reader
        // on an archived year part-way through the season that followed it
        // would otherwise get a countdown stuck at a negative day count —
        // a state that was unreachable while the probe was `.next`-bound
        // (a non-current year degrades `.next` to `.all`, so the count was
        // never 0) and becomes reachable the moment it is not.
        //
        // `WidgetTimelineBuilder.seasonState` has always filtered its own
        // openings to `$0 > now`, so this is the app catching up to what the
        // widget already did — which is what `daysBetween`'s doc comment
        // there means by "the widget's countdown and the app's never
        // disagree".
        let opening = nextOpening.flatMap { now < $0 ? $0 : nil }
        return .postSeason(
            endedSeasonYear: selectedYear,
            nextSeasonYear: nextSeasonYear,
            opening: opening,
            daysUntil: opening.map { daysBetween(now, $0) }
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
