import SwiftUI

/// Issue #162's week selector: one joined bar of nine segments where the
/// selected run reads as a single continuous range, not nine buttons.
///
/// Interaction is one `DragGesture(minimumDistance: 0)`: touch-down anchors,
/// the finger's segment is the live endpoint, touch-up commits through
/// `WeekStripDrag.commit`. The model is updated once per gesture — the
/// provisional range during the drag is view-local state.
///
/// Trade-off, accepted in the design doc: the strip claims touches that
/// start on it, so the sheet can't be drag-dismissed from the strip itself.
struct WeekRangeStrip: View {
    let weekNumbers: [Int]
    /// The committed selection, as the chips see it (includes the
    /// `.thisWeek` ⇄ current-week equivalence via `FilterChipState`).
    let isSelected: (Int) -> Bool
    /// The selection `WeekStripDrag.commit` should treat as existing —
    /// `[currentWeek]` when a persisted `.thisWeek` scope is highlighting
    /// the current week, else the stored weeks. Keeping this a value (not
    /// re-derived here) leaves `FilterChipState` the single source of truth.
    let effectiveSelection: Set<Int>
    /// Season-relative state per week — drives the current-week marker and
    /// the dimmed rendering of weeks gone by. Callers pass `.upcoming` for
    /// every week when there is no "now" to be relative to (non-current
    /// years), which renders the strip neutrally with no marker.
    let timeState: (Int) -> WeekTimeState
    let commit: (Set<Int>) -> Void

    @State private var anchor: Int?
    @State private var provisional: ClosedRange<Int>?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            bar
            currentWeekMarker
        }
    }

    private var bar: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                ForEach(weekNumbers, id: \.self) { number in
                    segment(number)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let current = WeekStripDrag.segment(
                            atX: value.location.x, width: geo.size.width,
                            count: weekNumbers.count)
                        if anchor == nil { anchor = current }
                        provisional = WeekStripDrag.range(anchor: anchor ?? current, current: current)
                    }
                    .onEnded { value in
                        let current = WeekStripDrag.segment(
                            atX: value.location.x, width: geo.size.width,
                            count: weekNumbers.count)
                        commit(WeekStripDrag.commit(
                            anchor: anchor ?? current, current: current,
                            existing: effectiveSelection))
                        anchor = nil
                        provisional = nil
                    })
        }
        .frame(minHeight: 44)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    /// The "Current Week" callout under the bar. Rendered only when some
    /// week is `.current`; decorative for VoiceOver (the segment's own
    /// accessibility label already says "current week").
    @ViewBuilder
    private var currentWeekMarker: some View {
        if weekNumbers.contains(where: { timeState($0) == .current }) {
            HStack(spacing: 0) {
                ForEach(weekNumbers, id: \.self) { number in
                    if timeState(number) == .current {
                        VStack(spacing: 1) {
                            Image(systemName: "arrowtriangle.up.fill")
                                .font(.system(size: 8))
                            Text("Current Week")
                                .font(.caption2.weight(.medium))
                                .fixedSize()
                        }
                        .foregroundStyle(Color.accentColor)
                        .frame(maxWidth: .infinity)
                    } else {
                        Color.clear
                            .frame(maxWidth: .infinity, maxHeight: 0)
                    }
                }
            }
            .accessibilityHidden(true)
        }
    }

    private func highlighted(_ number: Int) -> Bool {
        if let provisional { return provisional.contains(number) }
        return isSelected(number)
    }

    @ViewBuilder
    private func segment(_ number: Int) -> some View {
        let on = highlighted(number)
        let state = timeState(number)
        // Round only the run's outer corners so a contiguous selection
        // renders as one capsule, not per-segment pills.
        let leadingEdge = on && !highlighted(number - 1)
        let trailingEdge = on && !highlighted(number + 1)

        Text("\(number)")
            .font(.subheadline.weight(state == .current && !on ? .semibold : .medium))
            .monospacedDigit()
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(
                on ? AnyShapeStyle(.white)
                : state == .current ? AnyShapeStyle(Color.accentColor)
                : state == .past ? AnyShapeStyle(.tertiary)
                : AnyShapeStyle(.primary))
            .background(
                on ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.clear),
                in: UnevenRoundedRectangle(
                    topLeadingRadius: leadingEdge ? 12 : 0,
                    bottomLeadingRadius: leadingEdge ? 12 : 0,
                    bottomTrailingRadius: trailingEdge ? 12 : 0,
                    topTrailingRadius: trailingEdge ? 12 : 0))
            .accessibilityElement()
            .accessibilityLabel(state == .current ? "Week \(number), current week" : "Week \(number)")
            .accessibilityAddTraits(on ? [.isButton, .isSelected] : [.isButton])
            .accessibilityAction {
                commit(WeekStripDrag.commit(
                    anchor: number, current: number, existing: effectiveSelection))
            }
            .accessibilityAction(named: "Extend selection to week \(number)") {
                commit(WeekStripDrag.extended(from: effectiveSelection, to: number))
            }
    }
}
