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
                // `.primary`, not the button's default accent tint
                // (accessibility follow-up to #245): the accent colour
                // (`#5B7F95`) against the now-opaque
                // `dayRailControlBackground` measures under 4.5:1, which an
                // on-device audit caught once the background stopped being
                // a translucent material.
                .foregroundStyle(.primary)
                // 44x62 is a MINIMUM, not a fixed size (accessibility
                // follow-up to #245): a fixed frame clipped the symbol at
                // large Dynamic Type sizes, which an on-device audit
                // caught. 44pt still meets the HIG tap-target minimum, and
                // at the default text size the icon is far smaller than
                // either minimum, so the control still renders at exactly
                // 44x62 there — unchanged from before, and still matching
                // `DayChip`'s height, same as `MyDayExpandControl` does on
                // My Day.
                .frame(minWidth: 44, minHeight: 62)
                .background(Color.dayRailControlBackground, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(destinationLabel == nil)
        .accessibilityLabel(destinationLabel ?? "No further days in this direction")
        .accessibilityIdentifier(identifier)
    }
}
