import SwiftUI

/// Shown in place of the day-grouped list when the default filter would come
/// up empty because the season itself is over or hasn't started yet, rather
/// than the generic "No matching events" screen — `EventListView.content`
/// renders this only when `model.filter.isDefault && model.landingState !=
/// .inSeason` (#177: an App Store reviewer's very first look at the app,
/// after the last event's 90-day adaptive window expires, must never be an
/// empty list). A non-default filter that happens to be empty during the
/// same calendar window falls through to `EventListView.noMatchesView`
/// instead, whose "Clear Filters"/"Show All Events" pair is about the user's
/// own selection, not the calendar.
///
/// `ScrollView`-based rather than `List`-based: this is a handful of static
/// blocks, not rows, and a `ScrollView` only engages when Dynamic Type or a
/// small device actually needs it to — no separator lines, no swipe actions
/// to accidentally suggest.
struct OffSeasonLandingView: View {
    @Bindable var model: AppModel

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                header
                if let countdown {
                    countdownCard(countdown)
                }
                actions
                footnote
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 12) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text(title)
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
        }
    }

    /// `.postSeason` gets the "see you next time" framing; every other
    /// off-season case reaching this view is `.preSeason` (`.inSeason` never
    /// renders this view at all — see `EventListView.content`).
    private var title: String {
        model.landingState.isPostSeason ? "See you next season" : "Almost showtime"
    }

    // MARK: - Countdown

    private struct Countdown {
        let openingLine: String
        let daysLine: String
    }

    /// `opening`/`daysUntil` for whichever off-season case this is, or `nil`
    /// when `landingState` hasn't got them (`.postSeason` with no
    /// next-season year announced yet) — the card is simply omitted then,
    /// same as the primary button below.
    private var countdown: Countdown? {
        let opening: Date?
        let daysUntil: Int?
        switch model.landingState {
        case .inSeason:
            return nil
        case .preSeason(let seasonOpening, let seasonDaysUntil):
            opening = seasonOpening
            daysUntil = seasonDaysUntil
        case .postSeason(_, _, let seasonOpening, let seasonDaysUntil):
            opening = seasonOpening
            daysUntil = seasonDaysUntil
        }
        guard let opening, let daysUntil else { return nil }

        let year = ChqTime.calendar.component(.year, from: opening)
        let openingLine = "The \(year) season begins \(Self.monthDayFormatter.string(from: opening))"
        let daysLine = daysUntil == 1 ? "1 day away" : "\(daysUntil) days away"
        return Countdown(openingLine: openingLine, daysLine: daysLine)
    }

    /// `"MMMM d"`, e.g. `"June 26"` — deliberately not `ChqTime.dayTitle`,
    /// which also names the weekday ("Saturday, June 26"); the countdown
    /// card already states the day count separately, so a weekday would be
    /// redundant here.
    private static let monthDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = ChqTime.zone
        formatter.dateFormat = "MMMM d"
        return formatter
    }()

    private func countdownCard(_ countdown: Countdown) -> some View {
        VStack(spacing: 4) {
            Text(countdown.openingLine)
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(countdown.daysLine)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: - Actions

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: 12) {
            if case .postSeason(_, let nextSeasonYear?, _, _) = model.landingState {
                Button("Preview the \(String(nextSeasonYear)) season") {
                    Task { await model.previewNextSeason() }
                }
                .buttonStyle(.borderedProminent)
            }
            if let archiveYear {
                Button("Browse the \(String(archiveYear)) season") {
                    model.browseArchiveSeason()
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The year named by the "Browse the _ season" button:
    /// - `.postSeason` always has one — `endedSeasonYear`, the very year
    ///   `model.selectedYear` is already on, which is exactly what
    ///   `model.browseArchiveSeason()` (deliberately not touching
    ///   `selectedYear`; see its doc comment) shows.
    /// - `.preSeason` has no ended year of its own to offer — this is
    ///   ordinarily the *upcoming* season not having started yet, so the
    ///   only past season to browse is `selectedYear - 1`, and only when the
    ///   years manifest actually has it (a first-ever season has nothing
    ///   before it). `nil` hides the button entirely rather than showing one
    ///   that would try to browse a year nobody has data for.
    private var archiveYear: Int? {
        switch model.landingState {
        case .inSeason:
            return nil
        case .postSeason(let endedSeasonYear, _, _, _):
            return endedSeasonYear
        case .preSeason:
            let candidate = model.selectedYear - 1
            return model.years.contains(candidate) ? candidate : nil
        }
    }

    // MARK: - Footnote

    private var footnote: some View {
        Text("Starred events and filters still work in past seasons.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
    }
}
