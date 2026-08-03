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
/// `safeAreaInset` bar had. A 44pt minimum is also the accessibility floor
/// for a touch target, so the constraint costs nothing.
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
            .frame(minHeight: 44)
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
