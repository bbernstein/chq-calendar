import SwiftUI
import WidgetKit

/// Home Screen + Lock Screen widget showing the user's starred events —
/// `NextUpWidget` with `favoritesOnly` permanently forced on and no user
/// configuration at all (#179). `StaticConfiguration`, not
/// `AppIntentConfiguration`: there is nothing to configure.
struct StarredWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StarredWidget", provider: StarredProvider()) { entry in
            StarredWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Starred")
        .description("Your starred Chautauqua events.")
        .supportedFamilies([.systemSmall, .accessoryRectangular])
    }
}

/// `nonisolated` for the same reason as `NextUpProvider` — see that type's
/// doc comment.
nonisolated struct StarredProvider: TimelineProvider {
    typealias Entry = WidgetEntry

    private static let config = WidgetTimelineBuilder.Config(favoritesOnly: true)

    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: Date(), state: .events(WidgetDataSource.sampleEvents))
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        let now = Date()
        if context.isPreview {
            completion(WidgetEntry(date: now, state: .events(WidgetDataSource.sampleEvents)))
            return
        }
        completion(WidgetEntry(date: now, state: WidgetDataSource.firstSlice(config: Self.config, now: now).state))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        let now = Date()
        let slices = WidgetDataSource.slices(config: Self.config, now: now)
        let entries = slices.map { WidgetEntry(date: $0.date, state: $0.state) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}
