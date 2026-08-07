import SwiftUI
import WidgetKit

@main
struct ChqCalendarWidgetBundle: WidgetBundle {
    var body: some Widget {
        NextUpWidget()
    }
}

/// Placeholder widget scaffold. Task 11 replaces this with the real
/// next-up event timeline backed by the shared app-group cache.
struct NextUpWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextUpWidget", provider: NextUpProvider()) { entry in
            NextUpWidgetView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Next Up")
        .description("The next Chautauqua event.")
    }
}

nonisolated struct NextUpEntry: TimelineEntry {
    let date: Date
}

nonisolated struct NextUpProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextUpEntry {
        NextUpEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (NextUpEntry) -> Void) {
        completion(NextUpEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextUpEntry>) -> Void) {
        completion(Timeline(entries: [NextUpEntry(date: Date())], policy: .never))
    }
}

struct NextUpWidgetView: View {
    let entry: NextUpEntry

    var body: some View {
        Text("CHQ Calendar")
    }
}
