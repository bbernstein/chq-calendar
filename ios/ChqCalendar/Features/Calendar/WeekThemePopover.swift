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
        // `UIPopoverPresentationController` derives its content size by
        // asking this hierarchy for its *ideal* size before it ever gets
        // presented — a separate, earlier layout pass than the one that
        // renders it on screen. A `maxWidth` alone leaves that ideal-size
        // pass free to measure `Text` at its unconstrained (single-line)
        // width, so it reports a short ideal height back; the render pass
        // then clamps to 280pt and wraps to three lines, which no longer fit
        // the frame the popover already committed to. A definite `width`
        // makes both passes measure at the same 280pt, so the wrap the
        // render pass produces is the wrap the size query already accounted
        // for. `fixedSize` on the outer stack (not just the title `Text`)
        // makes sure that full wrapped height — header line, however many
        // lines the title takes, and the link — is what gets reported,
        // rather than a height the presentation later proposes and this
        // view silently accepts.
        VStack(alignment: .leading, spacing: 8) {
            Text(headerLine)
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            Text(summary.title)
                .font(.subheadline.weight(.semibold))

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
        .frame(width: 280, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
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
