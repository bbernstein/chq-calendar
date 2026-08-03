import SwiftUI

/// The app's entire standing chrome: two pills in a capsule floating over
/// the event list.
///
/// Takes plain values rather than `AppModel` so it previews without a model
/// and so its two states can be eyeballed side by side.
///
/// The two states differ in **label text and width only — never in height**.
/// That is not cosmetic: `EventListView` reserves a constant bottom content
/// margin for this bar, and a height change here would move the list under
/// the user mid-scroll, which is exactly the failure mode the previous
/// `safeAreaInset` bar had. The invariant has to hold at every Dynamic Type
/// size, not just the default one — see `BarPill.pillHeight` for how.
struct FloatingFilterBar: View {
    let dateLabel: String
    let filterCount: Int
    let state: BarState
    let onDate: () -> Void
    let onFilters: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            // The date label never abbreviates, in either state: it is
            // precisely the thing a scrolling user wants to keep reading.
            // Only the filter pill gives up its word.
            BarPill(
                systemImage: "calendar",
                label: dateLabel,
                badge: nil,
                isProminent: true,
                action: onDate)
                .accessibilityLabel("Date range: \(dateLabel). Double tap to change.")

            BarPill(
                systemImage: "line.3.horizontal.decrease",
                label: state == .expanded ? "Filters" : nil,
                badge: filterCount > 0 ? filterCount : nil,
                isProminent: false,
                action: onFilters)
                .accessibilityLabel(filtersAccessibilityLabel)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .chromeSurface()
        .padding(.bottom, 10)
    }

    private var filtersAccessibilityLabel: String {
        filterCount == 0
            ? "Filters, none active. Double tap to change."
            : "Filters, \(filterCount) active. Double tap to change."
    }
}

/// One pill in the bar. `label` is optional so the compact state can drop
/// the word without changing the pill's height.
private struct BarPill: View {
    let systemImage: String
    let label: String?
    let badge: Int?
    let isProminent: Bool
    let action: () -> Void

    /// A fixed, Dynamic-Type-scaled pill height, applied identically
    /// whether or not `label` is present.
    ///
    /// `.frame(minHeight: 44)` is only a floor: at accessibility text
    /// sizes the `.subheadline` label (rendered only when `label != nil`)
    /// has a line height that exceeds 44pt on its own, so the expanded
    /// pill would grow past the floor while the compact pill — whose
    /// tallest content is the smaller `.footnote` icon — would not, and
    /// the two states would end up different heights. `@ScaledMetric`
    /// relative to `.subheadline` scales this value in lockstep with that
    /// same text style's Dynamic Type curve, so the 44pt base (chosen to
    /// clear the accessibility minimum touch target at the default size)
    /// stays proportionally ahead of the label's line height at every
    /// size, not just the default one. Applying it as an exact
    /// `.frame(height:)` — not another `minHeight` — makes both branches
    /// resolve to the identical value regardless of which optional
    /// content they render.
    @ScaledMetric(relativeTo: .subheadline) private var pillHeight: CGFloat = 44

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(.footnote.weight(.semibold))
                if let label {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                }
                if let badge {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold))
                        .monospacedDigit()
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(badgeBackground, in: Capsule())
                        .foregroundStyle(badgeForeground)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: pillHeight)
            .foregroundStyle(isProminent ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isProminent
                    ? AnyShapeStyle(Color.accentColor)
                    : AnyShapeStyle(.quaternary),
                in: Capsule())
        }
        .buttonStyle(.plain)
        .contentTransition(.identity)
    }

    private var badgeBackground: AnyShapeStyle {
        isProminent ? AnyShapeStyle(.white.opacity(0.3)) : AnyShapeStyle(Color.accentColor)
    }

    private var badgeForeground: AnyShapeStyle {
        isProminent ? AnyShapeStyle(.white) : AnyShapeStyle(.white)
    }
}

#Preview("Expanded") {
    ZStack {
        Color.gray.opacity(0.3)
        VStack {
            Spacer()
            FloatingFilterBar(
                dateLabel: "Weeks 4\u{2013}6", filterCount: 3, state: .expanded,
                onDate: {}, onFilters: {})
        }
    }
}

#Preview("Compact") {
    ZStack {
        Color.gray.opacity(0.3)
        VStack {
            Spacer()
            FloatingFilterBar(
                dateLabel: "Now", filterCount: 0, state: .compact,
                onDate: {}, onFilters: {})
        }
    }
}

/// Both states stacked together at an accessibility Dynamic Type size, so
/// the equal-height invariant is inspectable by a human, not just asserted
/// in a doc comment. Expanded and compact should render at the identical
/// pill height here, exactly as they do at the default size above — only
/// the width of the filter pill (and the wrapping of its longer label)
/// should differ.
#Preview("Accessibility Dynamic Type") {
    ZStack {
        Color.gray.opacity(0.3)
        VStack(spacing: 16) {
            Spacer()
            FloatingFilterBar(
                dateLabel: "Weeks 4\u{2013}6", filterCount: 3, state: .expanded,
                onDate: {}, onFilters: {})
            FloatingFilterBar(
                dateLabel: "Now", filterCount: 0, state: .compact,
                onDate: {}, onFilters: {})
        }
    }
    .environment(\.dynamicTypeSize, .accessibility3)
}
