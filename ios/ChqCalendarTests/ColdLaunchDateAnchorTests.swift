import Foundation
import Testing
@testable import ChqCalendar

/// Where a cold launch lands when nothing is persisted (#278).
///
/// #278 reported that a launch with no saved date opens on the **start of
/// the dataset** rather than on today. It did not reproduce, and these
/// tests pin why — the report's two plausible paths are both closed, and
/// closed for reasons that a future change could reopen without any other
/// test noticing:
///
/// 1. `.day` is the one scope with no "now" of its own, and
///    `EffectiveScope.resolve` degrades a keyless `.day` to `.all` — whose
///    window is the whole dataset. A cold launch never has one:
///    `UserStateStore` persists a live `.day` as `.next` and drops
///    `selectedDayKey` entirely (#192), so `loadFilters()` cannot return a
///    `.day`, and `AppModel` falls back to `FilterSelection()`, which is
///    `.next`. Persisting `selectedDayKey` "so the day survives a relaunch"
///    is the change that would reopen this.
/// 2. `EventListView`'s anchor chain (`pendingScroll?.day ??
///    pinnedSelectionDay ?? scrollAnchor ?? anchorDay`) really does fall
///    through to the first rendered day at launch, as the report says. That
///    is only correct while the first rendered day *is* today, which holds
///    because `.next`'s window starts at `now - 1h`. A default scope that
///    is not `now`-relative would reopen this too.
///
/// The two acceptance criteria that a naive "fix" for #278 would most
/// easily break — a saved scope still winning, and an archived year still
/// opening at the season start — are pinned here alongside, so the guard
/// cannot be satisfied by simply forcing today everywhere.
@MainActor
struct ColdLaunchDateAnchorTests {
    /// A fresh, isolated `UserDefaults` suite per test so runs never collide.
    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    private static func at(_ s: String) throws -> Date {
        try #require(ChqTime.parse(s))
    }

    private func seasonBounds() -> ClosedRange<String> {
        DayWindow.bounds(year: 2026, starredDays: [])
    }

    // MARK: - what a cold launch actually starts from

    @Test func aFreshInstallHasNoPersistedFilters() {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        #expect(store.loadFilters() == nil)
    }

    /// The fallback `AppModel` uses when `loadFilters()` is `nil`. `.next`
    /// rather than `.day` is what makes path 1 above unreachable.
    @Test func theColdLaunchFallbackIsNextWithNoDayKey() {
        let selection = FilterSelection()
        #expect(selection.dateScope == .next)
        #expect(selection.selectedDayKey == nil)
        #expect(EffectiveScope.resolve(selection, isCurrentYear: true) == .next)
    }

    // MARK: - the reported symptom

    /// `.next` is `now`-relative, so its window opens on today — not on
    /// `bounds.lowerBound`, which is what `.all` would have given.
    @Test func theColdLaunchWindowStartsOnTodayNotTheDatasetStart() throws {
        let now = try Self.at("2026-07-15 09:00:00")
        let events = [
            makeEvent(id: "before", start: try Self.at("2026-06-28 10:00:00")),
            makeEvent(id: "today", start: try Self.at("2026-07-15 19:00:00")),
            makeEvent(id: "after", start: try Self.at("2026-07-20 19:00:00")),
        ]
        let bounds = seasonBounds()
        let window = try #require(ViewWindow.make(
            selection: FilterSelection(), events: events, now: now,
            year: 2026, isCurrentYear: true, bounds: bounds))

        #expect(window.startDay == "2026-07-15")
        // Stated separately from the equality above so a failure says which
        // of the two things went wrong: the window is on today, AND it is
        // not the whole-dataset window `.all` would produce.
        #expect(window.startDay != bounds.lowerBound)
    }

    /// End to end, through the real `AppModel`: the first day the list
    /// renders on a cold launch. `events-sample`'s earliest event is
    /// 2026-07-01 and `now` is pinned two days later, so "opened on today"
    /// and "opened at the start of the dataset" are distinguishable — which
    /// is the whole point of the fixture choice.
    @Test func theColdLaunchListOpensOnToday() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let api = MockAPI()
        // The years manifest is not cached; hanging that call proves the
        // list is correct before any network work finishes, matching
        // `AppModelTests.startWithWarmCacheIsReadyBeforeAnyNetworkCompletes`.
        await api.setNeverResolves(for: .years)
        let repo = EventRepository(api: api, cache: cache)
        let fixedNow = try Self.at("2026-07-03 09:00:00")
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { fixedNow })

        Task { await model.start() }
        await waitUntil("model reaches .ready phase") { model.phase == .ready }

        #expect(model.dayGroups.first?.id == "2026-07-03")
        // The dataset's own first day must be filtered out, not merely
        // scrolled past: asserting only `first` would still pass if the
        // list opened on today while `.all` quietly widened what's below.
        #expect(!model.dayGroups.contains { $0.id < "2026-07-03" })
    }

    // MARK: - what a fix for #278 must not break

    /// #278's third acceptance criterion. A saved scope is a preference,
    /// and outranks the today default.
    @Test func aSavedScopeStillWinsOverTheTodayDefault() {
        let defaults = makeDefaults()
        UserStateStore(defaults: defaults, now: { Date() })
            .saveFilters(FilterSelection(dateScope: .season))

        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() }))

        #expect(model.filter.dateScope == .season)
    }

    /// #278's second acceptance criterion. An archived season has no "now"
    /// to anchor on, so every `now`-relative scope degrades to `.all` and
    /// the window is the season — which is the *correct* answer there, and
    /// the one a "always start on today" change would break.
    @Test func anArchivedYearStillOpensAtTheSeasonStart() throws {
        let now = try Self.at("2026-07-15 09:00:00")
        let bounds = seasonBounds()
        let window = try #require(ViewWindow.make(
            selection: FilterSelection(), events: [], now: now,
            year: 2026, isCurrentYear: false, bounds: bounds))

        #expect(window.startDay == bounds.lowerBound)
        #expect(window.endDay == bounds.upperBound)
    }
}
