import SwiftUI

/// Shown as the first row of the calendar list while the current year's
/// season hasn't started yet.
struct CountdownBanner: View {
    let days: Int

    private var message: String {
        days == 1 ? "1 day until the season begins" : "\(days) days until the season begins"
    }

    var body: some View {
        Label(message, systemImage: "calendar.badge.clock")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.tint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowBackground(Color.accentColor.opacity(0.12))
    }
}

/// Shown when the most recent background refresh failed but we're still
/// displaying previously-cached data.
struct OfflineBanner: View {
    var body: some View {
        Label("Showing saved events — couldn't refresh from the network.", systemImage: "wifi.slash")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowBackground(Color.secondary.opacity(0.08))
    }
}
