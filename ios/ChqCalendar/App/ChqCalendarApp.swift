import SwiftUI

@main
struct ChqCalendarApp: App {
    @State private var model = AppModel(
        repository: EventRepository(api: LiveCalendarAPI(), cache: DiskCache.standard()),
        store: UserStateStore()
    )

    var body: some Scene {
        WindowGroup {
            CalendarView(model: model)
        }
    }
}
