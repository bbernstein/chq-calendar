import SwiftUI

/// The last row of the filter bar, shown only while something is narrowing
/// the results: a reset, an optional "keep dates" reset, and every active
/// filter as a one-tap removable chip.
///
/// Mirrors the web's `ActiveFilters`. Venues and categories appear here as
/// well as in their own rows; that redundancy is deliberate, so there is
/// one predictable place listing everything — and it is the only place the
/// search term is visible at all once the system search field collapses.
struct ResetFilterRow: View {
    let model: AppModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                resetChip(
                    label: "Clear all",
                    systemImage: "xmark.circle.fill",
                    accessibility: "Clear all filters and show all events"
                ) {
                    model.clearAll()
                }

                if model.filter.hasDateFilters && model.filter.hasNonDateFilters {
                    resetChip(
                        label: "Keep dates",
                        systemImage: "calendar.badge.checkmark",
                        accessibility: "Keep date and week filters but clear all others"
                    ) {
                        model.clearNonDateFilters()
                    }
                }

                ForEach(ActiveFilterChips.build(selection: model.filter)) { chip in
                    Button {
                        KeyboardDismisser.dismiss()
                        model.remove(chip)
                    } label: {
                        HStack(spacing: 4) {
                            Text(chip.label)
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .opacity(0.7)
                        }
                        .font(.subheadline)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .foregroundStyle(.white)
                        .background(Color.accentColor, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(chip.accessibilityLabel)
                }
            }
            .padding(.horizontal)
        }
    }

    private func resetChip(
        label: String, systemImage: String, accessibility: String, action: @escaping () -> Void
    ) -> some View {
        Button {
            KeyboardDismisser.dismiss()
            action()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                Text(label)
            }
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(.thinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
    }
}
