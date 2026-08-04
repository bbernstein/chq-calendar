import SwiftUI

/// The contents of the popover a themed day-header week badge presents.
///
/// Deliberately just a caption line, the theme title, and a link out. Theme
/// descriptions are empty throughout the 2026 feed and are never rendered
/// (see `WeekThemeSummary`), so the link is the only route to any detail the
/// app cannot show — which is exactly why it is here.
struct WeekThemePopover: View {
    let summary: WeekThemeSummary

    /// The same destination the web app's popover links to.
    private static let themesURL = URL(
        string: "https://www.chq.org/things-to-do/events/weekly-themes/")!

    private var headerLine: String {
        guard let range = summary.dateRange else { return summary.weekLabel }
        return "\(summary.weekLabel) \u{00B7} \(range)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(headerLine)
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            Text(summary.title)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            Link(destination: Self.themesURL) {
                HStack(spacing: 3) {
                    Text("View on chq.org")
                    Image(systemName: "arrow.up.right")
                        .font(.caption2)
                }
                .font(.caption)
            }
        }
        .padding(16)
        .frame(maxWidth: 280, alignment: .leading)
        .presentationCompactAdaptation(.popover)
    }
}

#Preview("Same-month range") {
    WeekThemePopover(summary: WeekThemeSummary(
        weekNumber: 6,
        title: "The Human Voice: Song, Speech, and Story",
        dateRange: "Aug 1\u{2013}8"))
}

#Preview("No range (malformed dates)") {
    WeekThemePopover(summary: WeekThemeSummary(
        weekNumber: 3,
        title: "The 2026 Election: What\u{2019}s at Stake?",
        dateRange: nil))
}

#Preview("Longest real title") {
    // The real feed's longest title, 83 characters — the case that decides
    // whether the popover's width and wrapping hold up.
    WeekThemePopover(summary: WeekThemeSummary(
        weekNumber: 9,
        title: "The Importance of Gathering: A Collaboration with the Smithsonian Folklife Festival",
        dateRange: "Aug 22\u{2013}30"))
}
