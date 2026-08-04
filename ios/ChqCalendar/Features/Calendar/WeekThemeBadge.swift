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

    #if DEBUG
    /// Set by `EventListView` to a binding onto `AppModel.uiTestShowWeekTheme`
    /// for the single badge `-uitest-show-week-theme` targets
    /// (`AppModel.uiTestFirstThemedWeek`); `nil` for every other badge, and
    /// unavailable as a parameter at all in Release builds. Reading `true`
    /// presents the popover immediately, since `xcrun simctl` can't
    /// synthesize the tap; writing `false` back consumes the flag so a
    /// header that scrolls off and back on doesn't reopen it.
    var uiTestAutoShow: Binding<Bool>?
    #endif

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
            #if DEBUG
            // MARK: UI-test hook (DEBUG only)
            //
            // Both `onAppear` (the flag is already true when this badge
            // mounts, e.g. a warm cache where `AppModel.start()` — and thus
            // `CalendarView.applyUITestHooks`, which sets the flag — finished
            // before this row appeared) and `onChange` (this row mounted from
            // a cached snapshot before `start()` flipped the flag, e.g. a
            // cold launch that starts blank) are needed to catch either
            // ordering. Mirrors `EventListView.presentFilterSheetIfNeeded`.
            .onAppear(perform: presentIfUITestAutoShowRequested)
            .onChange(of: uiTestAutoShow?.wrappedValue) { _, _ in presentIfUITestAutoShowRequested() }
            #endif
        } else {
            capsule
        }
    }

    #if DEBUG
    private func presentIfUITestAutoShowRequested() {
        guard uiTestAutoShow?.wrappedValue == true else { return }
        uiTestAutoShow?.wrappedValue = false
        isShowingTheme = true
    }
    #endif

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
