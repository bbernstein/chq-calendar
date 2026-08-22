import SwiftUI

// Shared furniture for the filter sheets. Extracted from
// `DateFilterSheet.swift` when that view was deleted (#256): both types
// were always shared — `SheetChip` by `FilterSheet` and `FacetChipCloud`,
// `SheetDismissButton` by `FilterSheet` — and only lived there because
// that is where the first one was written.
//
// Nothing about either type changed in the move. If you are reading this
// because a chip renders differently, the cause is elsewhere.

/// A selectable pill inside a sheet. Distinct from the bottom-bar buttons
/// in `EventListView`, which are controls that open something rather than
/// values that toggle.
struct SheetChip: View {
    let label: String
    var count: Int?
    /// Marks a value the user picked recently. Renders a leading dot, and
    /// is announced by VoiceOver — without that the distinction would be
    /// purely visual. Only ever true for *unselected* chips: a selected
    /// chip is already accent-filled with a checkmark and has moved to the
    /// front group, so a dot inside it would be noise.
    var isRecent: Bool = false
    let isSelected: Bool
    let action: () -> Void

    /// Scales with Dynamic Type so the dot stays visible as the visible
    /// label grows — otherwise it's the only *visual* recency cue and a
    /// fixed 5pt effectively vanishes at accessibility text sizes.
    /// VoiceOver users get the same information from `voiceOverLabel`
    /// regardless; this covers low-vision users who aren't using it.
    @ScaledMetric private var dotSize: CGFloat = 5

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                } else if isRecent {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: dotSize, height: dotSize)
                }
                labelText
                if let count {
                    Text("\(count)")
                        .monospacedDigit()
                        .foregroundStyle(isSelected ? .white.opacity(0.7) : .secondary)
                }
            }
            // Metrics are deliberately below the 44pt HIG floor, which
            // governs isolated controls rather than dense grids of
            // same-kind, adjacent, non-destructive targets. 36pt makes rows
            // roughly 20% shorter, which buys headroom rather than a
            // guarantee: 44pt already cleared the fold on the venue names
            // present when this shipped, and the extra room is what absorbs
            // longer-than-average naming before Categories drops off.
            // `minHeight` is a floor, and the vertical padding is what
            // keeps the text breathing at large Dynamic Type sizes, where
            // the floor stops binding.
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(minHeight: 36)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isSelected
                    ? AnyShapeStyle(Color.accentColor)
                    : AnyShapeStyle(.quaternary),
                in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voiceOverLabel)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    /// Set explicitly rather than inferred, because the recency dot is a
    /// bare `Circle` with no implicit VoiceOver label. Keeps the count in
    /// the announcement, which the inferred label included.
    ///
    /// Named `voiceOverLabel`, not `accessibilityLabel`, so it cannot be
    /// confused with the SwiftUI modifier of that name one line above.
    private var voiceOverLabel: String {
        var parts = [label]
        if isRecent && !isSelected { parts.append("recently used") }
        if let count { parts.append("\(count) event\(count == 1 ? "" : "s")") }
        return parts.joined(separator: ", ")
    }

    private var labelText: some View {
        Text(label)
            .lineLimit(1)
    }
}

/// The footer both sheets share. It **dismisses** — filters have already
/// applied live behind the sheet. There is no staged selection to commit,
/// so there is nothing to cancel either.
struct SheetDismissButton: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Show \(count.formatted()) event\(count == 1 ? "" : "s")")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .background(.bar)
    }
}
