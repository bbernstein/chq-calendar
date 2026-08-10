import Foundation
import Testing
@testable import ChqCalendar

/// Pins `AppModel`'s two widget-reload triggers (#179): a successful
/// `refresh(force:)` and `toggleFavorite`. Mirrors `MockScheduler`'s role
/// for `ReminderCenterTests`/`AppModelTests` — a mock conformance recording
/// calls, so this never needs the real `WidgetCenter` (which requires a
/// live app process with a widget extension installed and isn't available
/// in a unit-test host).
@MainActor
struct WidgetReloadingTests {
    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    final class MockWidgetReloader: WidgetReloading {
        private(set) var reloadCount = 0

        func reloadAll() {
            reloadCount += 1
        }
    }

    @Test func toggleFavoriteReloadsWidgets() {
        let reloader = MockWidgetReloader()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            widgetReloader: reloader
        )

        model.toggleFavorite("evt-1")
        #expect(reloader.reloadCount == 1)

        model.toggleFavorite("evt-1")
        #expect(reloader.reloadCount == 2)
    }

    @Test func successfulRefreshReloadsWidgets() async {
        let cache = MockCache()
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1", for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)
        let reloader = MockWidgetReloader()
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            widgetReloader: reloader
        )

        await model.refresh(force: true)

        #expect(model.phase == .ready)
        #expect(reloader.reloadCount == 1)
    }

    /// A failed refresh must not reload widgets — there's nothing new for
    /// them to show, and reloading anyway would just churn WidgetKit's
    /// (rate-limited) budget for no benefit.
    @Test func failedRefreshDoesNotReloadWidgets() async {
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("events-down"), for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: MockCache())
        let reloader = MockWidgetReloader()
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            widgetReloader: reloader
        )

        await model.refresh(force: true)

        #expect(model.phase == .offline)
        #expect(reloader.reloadCount == 0)
    }

    /// The default `widgetReloader: nil` (every other `AppModel` test in the
    /// suite) must never crash `toggleFavorite`/`refresh` — this is the
    /// same no-op-by-default contract `reminderCenter` already has.
    @Test func noReloaderIsANoOp() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        model.toggleFavorite("evt-1")
        await model.refresh(force: true)

        #expect(model.favorites.contains("evt-1"))
    }
}
