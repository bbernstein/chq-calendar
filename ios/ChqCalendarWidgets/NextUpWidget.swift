import AppIntents
import SwiftUI
import WidgetKit

/// Home Screen + Lock Screen widget showing the next few upcoming
/// Chautauqua events, user-narrowable to a venue, category, or starred-only
/// via `WidgetConfigIntent` (#179).
struct NextUpWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "NextUpWidget", intent: WidgetConfigIntent.self, provider: NextUpProvider()) { entry in
            NextUpWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next Up")
        .description("Your next Chautauqua events, optionally narrowed to a venue, category, or your starred events.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

/// `nonisolated` — like Task 9's placeholder `NextUpProvider` this replaces
/// — because `placeholder(in:)` is a synchronous protocol requirement, and
/// the widget target's `SWIFT_DEFAULT_ACTOR_ISOLATION` is `MainActor`: a
/// conforming type left at its default isolation would need every method,
/// including that synchronous one, to hop to the main actor, which a sync
/// non-`@MainActor` caller (WidgetKit itself, on its own extension process
/// thread) cannot do. Marking the whole type `nonisolated` sidesteps that
/// entirely, matching every other type in `ChqCalendarShared` this reads
/// through (`WidgetTimelineBuilder`, `SharedSnapshotLoader`, `DiskCache`,
/// `AppGroup`, `Event`, `ChqTime`).
nonisolated struct NextUpProvider: AppIntentTimelineProvider {
    typealias Entry = WidgetEntry
    typealias Intent = WidgetConfigIntent

    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: Date(), state: .events(WidgetDataSource.sampleEvents))
    }

    func snapshot(for configuration: WidgetConfigIntent, in context: Context) async -> WidgetEntry {
        let now = Date()
        if context.isPreview {
            return WidgetEntry(date: now, state: .events(WidgetDataSource.sampleEvents))
        }
        let config = await configuration.timelineConfig
        return WidgetEntry(date: now, state: WidgetDataSource.firstSlice(config: config, now: now).state)
    }

    func timeline(for configuration: WidgetConfigIntent, in context: Context) async -> Timeline<WidgetEntry> {
        let now = Date()
        let config = await configuration.timelineConfig
        let slices = WidgetDataSource.slices(config: config, now: now)
        let entries = slices.map { WidgetEntry(date: $0.date, state: $0.state) }
        return Timeline(entries: entries, policy: .atEnd)
    }
}
