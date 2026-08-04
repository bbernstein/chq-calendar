import SwiftUI

/// A `Wk 6` capsule in a day header, which reveals that week's theme when
/// one exists.
///
/// Owns its own presentation state so that a day spanning a week boundary —
/// which renders two of these side by side — needs no coordination from the
/// list, and so `EventListView` holds no popover state at all.
///
/// When the week has no theme this renders exactly what shipped before this
/// view existed: plain text in a capsule, no button, no accent, no
/// accessibility action. That is deliberate. The 2025 season has no themes
/// at all, and a badge that looks tappable but does nothing is worse than one
/// that never invited the tap.
struct WeekThemeBadge: View {
    let weekNumber: Int
    let themes: [WeeklyTheme]

    @State private var isShowingTheme = false

    private var summary: WeekThemeSummary? {
        WeekThemeSummary.make(forWeek: weekNumber, in: themes)
    }

    var body: some View {
        if let summary {
            Button {
                isShowingTheme = true
            } label: {
                // Tints the capsule's background, not just its text: `.secondary`
                // in `capsule` below is a hierarchical style, so it resolves
                // against whatever foreground style is ambient here rather than
                // the system grey. That whole-capsule tint is the affordance — it
                // is what separates a tappable badge from an inert one, including
                // on a boundary day where one of two adjacent badges is themed
                // and the other is not.
                capsule.foregroundStyle(Color.accentColor)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(summary.weekLabel) theme: \(summary.title)")
            .accessibilityHint("Shows this week's theme")
            .popover(isPresented: $isShowingTheme) {
                WeekThemePopover(summary: summary)
            }
        } else {
            capsule
        }
    }

    /// The badge itself, identical in both states apart from its colour, so
    /// a themed and an unthemed badge never differ in size or position.
    private var capsule: some View {
        Text("Wk \(weekNumber)")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.secondary.opacity(0.15), in: Capsule())
    }
}
