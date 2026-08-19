import SwiftUI

/// One end-cap on the day rail: a symbol, an action, and a label naming
/// **where it goes**.
///
/// Never "next day"/"previous day". A control named for its direction tells a
/// screen-reader user nothing about whether pressing it is worth doing, and
/// on this rail a step can be several calendar days — the nearest day that
/// actually has events — so the direction is not even the whole truth.
///
/// `nil` label means there is nowhere to go, and the control is disabled
/// rather than hidden: a control that appears and disappears as the window
/// grows is harder to aim at than one that greys out.
struct DayStepControl: View {
    let symbol: String
    let identifier: String
    /// The full spoken name of the destination, or `nil` when there is none.
    let destinationLabel: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                // 44pt to meet the HIG minimum tap target; height matches
                // `DayChip`, same as `MyDayExpandControl` does on My Day.
                .frame(width: 44, height: 62)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(destinationLabel == nil)
        .accessibilityLabel(destinationLabel ?? "No further days in this direction")
        .accessibilityIdentifier(identifier)
    }
}
