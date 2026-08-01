import SwiftUI

/// One row in the calendar list: time, title/location/status, and a
/// favorite toggle. `model` is read directly (not `@Bindable`) — this view
/// only calls `toggleFavorite`, it never needs a `Binding` into `AppModel`.
struct EventRow: View {
    let model: AppModel
    let event: Event

    private var isFavorite: Bool { model.favorites.contains(event.id) }
    private var hasArticleLinks: Bool { !model.articleLinks(for: event.id).isEmpty }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(ChqTime.timeString(for: event.start))
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 60, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                Text(event.title)
                    .font(.body)
                    .strikethrough(event.status == .cancelled)
                    .foregroundStyle(event.status == .cancelled ? .secondary : .primary)

                HStack(spacing: 6) {
                    if let location = event.displayLocation {
                        Text(DisplayNames.location(location))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if hasArticleLinks {
                        Image(systemName: "newspaper")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                statusBadge
            }

            Spacer(minLength: 0)

            Button {
                model.toggleFavorite(event.id)
            } label: {
                Image(systemName: isFavorite ? "star.fill" : "star")
                    .foregroundStyle(isFavorite ? .yellow : .secondary)
            }
            .buttonStyle(.borderless)
        }
        .swipeActions(edge: .leading) {
            Button {
                model.toggleFavorite(event.id)
            } label: {
                Label(isFavorite ? "Unfavorite" : "Favorite", systemImage: isFavorite ? "star.slash" : "star")
            }
            .tint(.yellow)
        }
        .contextMenu {
            contextMenuContent
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch event.status {
        case .cancelled:
            badge("Cancelled", color: .red)
        case .rescheduled:
            badge("Rescheduled", color: .orange)
        case .scheduled:
            EmptyView()
        }
    }

    private func badge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color, in: Capsule())
    }

    @ViewBuilder
    private var contextMenuContent: some View {
        Button {
            model.toggleFavorite(event.id)
        } label: {
            Label(isFavorite ? "Unfavorite" : "Favorite", systemImage: isFavorite ? "star.slash" : "star")
        }

        if let pageURL = event.pageURL {
            Link(destination: pageURL) {
                Label("Open on chq.org", systemImage: "safari")
            }
            ShareLink(item: pageURL) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
        }
    }
}
