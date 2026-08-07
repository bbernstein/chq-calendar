import SwiftUI

@main
struct ChqCalendarApp: App {
    // `now:` defaults to `AppModel.launchNow()` rather than the type's own
    // `{ Date() }` default so a DEBUG build can honor `-uitest-freeze-now`
    // (off-season landing screenshots, #177) — see that function's doc
    // comment for why the seam has to be here, at construction, rather than
    // a later mutation.
    @State private var model = AppModel(
        repository: EventRepository(api: LiveCalendarAPI(), cache: DiskCache.standard()),
        store: UserStateStore(),
        now: AppModel.launchNow()
    )

    var body: some Scene {
        WindowGroup {
            CalendarView(model: model)
        }
    }
}
