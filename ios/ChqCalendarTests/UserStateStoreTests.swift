import Foundation
import Testing
@testable import ChqCalendar

struct UserStateStoreTests {
    /// A fresh, isolated `UserDefaults` suite per test so runs never collide.
    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    // MARK: - DateScope

    @Test func dateScopeRawValuesMatchWebParity() {
        #expect(DateScope.next.rawValue == "next")
        #expect(DateScope.today.rawValue == "today")
        #expect(DateScope.thisWeek.rawValue == "this-week")
        #expect(DateScope.season.rawValue == "season")
        #expect(DateScope.all.rawValue == "all")
    }

    @Test func dateScopeLabels() {
        #expect(DateScope.next.label == "Now")
        #expect(DateScope.today.label == "Today")
        #expect(DateScope.thisWeek.label == "This Week")
        #expect(DateScope.season.label == "All Season")
        #expect(DateScope.all.label == "All Year")
    }

    // MARK: - FilterSelection.isDefault

    @Test func defaultFilterSelectionIsDefault() {
        #expect(FilterSelection().isDefault)
    }

    @Test func filterSelectionWithSearchTextOnlyIsStillDefault() {
        var filter = FilterSelection()
        filter.searchText = "opera"
        #expect(filter.isDefault)
    }

    @Test func filterSelectionWithWindowExpansionOnlyIsStillDefault() {
        var filter = FilterSelection()
        filter.windowEndDayKey = "2026-07-13"
        #expect(filter.isDefault)
    }

    @Test func filterSelectionWithWeeksIsNotDefault() {
        var filter = FilterSelection()
        filter.selectedWeeks = [3]
        #expect(!filter.isDefault)
    }

    @Test func filterSelectionWithNonNextScopeIsNotDefault() {
        var filter = FilterSelection()
        filter.dateScope = .today
        #expect(!filter.isDefault)
    }

    // MARK: - UserStateStore: filters round-trip

    @Test func filtersRoundTripPreservesPersistedFacets() throws {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        var filter = FilterSelection()
        filter.selectedWeeks = [1, 4, 7]
        filter.selectedLocations = ["Amp", "Hall of Philosophy"]
        filter.selectedCategories = ["Music"]
        filter.showFavoritesOnly = true
        filter.dateScope = .thisWeek

        store.saveFilters(filter)
        let loaded = try #require(store.loadFilters())

        #expect(loaded.selectedWeeks == [1, 4, 7])
        #expect(loaded.selectedLocations == ["Amp", "Hall of Philosophy"])
        #expect(loaded.selectedCategories == ["Music"])
        #expect(loaded.showFavoritesOnly == true)
        #expect(loaded.dateScope == .thisWeek)
    }

    @Test func filtersRoundTripDoesNotPersistSearchTextOrWindowExpansion() throws {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        var filter = FilterSelection()
        filter.searchText = "opera"
        filter.windowStartDayKey = "2026-07-08"
        filter.windowEndDayKey = "2026-07-15"
        filter.selectedWeeks = [2]

        store.saveFilters(filter)
        let loaded = try #require(store.loadFilters())

        #expect(loaded.searchText == "")
        #expect(loaded.windowStartDayKey == nil)
        #expect(loaded.windowEndDayKey == nil)
        #expect(loaded.selectedWeeks == [2])
    }

    @Test func loadFiltersReturnsNilWhenNoneSaved() {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        #expect(store.loadFilters() == nil)
    }

    @Test func filtersLoadAt29DaysStillReturnsValue() throws {
        let defaults = makeDefaults()
        let saveTime = Date(timeIntervalSince1970: 1_700_000_000)
        let store = UserStateStore(defaults: defaults, now: { saveTime })
        var filter = FilterSelection()
        filter.selectedWeeks = [5]
        store.saveFilters(filter)

        let laterStore = UserStateStore(
            defaults: defaults,
            now: { saveTime.addingTimeInterval(29 * 24 * 3600) }
        )
        let loaded = try #require(laterStore.loadFilters())
        #expect(loaded.selectedWeeks == [5])
    }

    @Test func filtersLoadAt31DaysReturnsNil() {
        let defaults = makeDefaults()
        let saveTime = Date(timeIntervalSince1970: 1_700_000_000)
        let store = UserStateStore(defaults: defaults, now: { saveTime })
        var filter = FilterSelection()
        filter.selectedWeeks = [5]
        store.saveFilters(filter)

        let laterStore = UserStateStore(
            defaults: defaults,
            now: { saveTime.addingTimeInterval(31 * 24 * 3600) }
        )
        #expect(laterStore.loadFilters() == nil)
    }

    @Test func filtersLoadAtExactly30DaysReturnsNil() {
        // Pins the boundary direction: spec is ">= 30 days expires", so the
        // comparison inside loadFilters must be a strict `<` against the
        // expiry window (not `<=`) — exactly 30*24*3600 seconds after save
        // must already be treated as expired.
        let defaults = makeDefaults()
        let saveTime = Date(timeIntervalSince1970: 1_700_000_000)
        let store = UserStateStore(defaults: defaults, now: { saveTime })
        var filter = FilterSelection()
        filter.selectedWeeks = [5]
        store.saveFilters(filter)

        let laterStore = UserStateStore(
            defaults: defaults,
            now: { saveTime.addingTimeInterval(30 * 24 * 3600) }
        )
        #expect(laterStore.loadFilters() == nil)
    }

    // MARK: - UserStateStore: favorites round-trip

    @Test func favoritesRoundTrip() {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        store.saveFavorites(["evt-1", "evt-2"])
        #expect(store.loadFavorites() == ["evt-1", "evt-2"])
    }

    @Test func loadFavoritesReturnsEmptyWhenNoneSaved() {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        #expect(store.loadFavorites() == [])
    }

    @Test func favoritesLoadAt29DaysStillReturnsValue() {
        let defaults = makeDefaults()
        let saveTime = Date(timeIntervalSince1970: 1_700_000_000)
        let store = UserStateStore(defaults: defaults, now: { saveTime })
        store.saveFavorites(["evt-9"])

        let laterStore = UserStateStore(
            defaults: defaults,
            now: { saveTime.addingTimeInterval(29 * 24 * 3600) }
        )
        #expect(laterStore.loadFavorites() == ["evt-9"])
    }

    @Test func favoritesLoadAt31DaysReturnsEmpty() {
        let defaults = makeDefaults()
        let saveTime = Date(timeIntervalSince1970: 1_700_000_000)
        let store = UserStateStore(defaults: defaults, now: { saveTime })
        store.saveFavorites(["evt-9"])

        let laterStore = UserStateStore(
            defaults: defaults,
            now: { saveTime.addingTimeInterval(31 * 24 * 3600) }
        )
        #expect(laterStore.loadFavorites() == [])
    }

    @Test func favoritesLoadAtExactly30DaysReturnsEmpty() {
        // Same boundary-direction pin as filtersLoadAtExactly30DaysReturnsNil,
        // for the favorites store.
        let defaults = makeDefaults()
        let saveTime = Date(timeIntervalSince1970: 1_700_000_000)
        let store = UserStateStore(defaults: defaults, now: { saveTime })
        store.saveFavorites(["evt-9"])

        let laterStore = UserStateStore(
            defaults: defaults,
            now: { saveTime.addingTimeInterval(30 * 24 * 3600) }
        )
        #expect(laterStore.loadFavorites() == [])
    }

    // MARK: - Selection storage (original casing, ordered)

    @Test func selectionsRoundTripPreservingCasingAndOrder() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        var filter = FilterSelection()
        filter.selectedLocations = ["Amphitheater", "Elizabeth S. Lenna Hall"]
        filter.selectedCategories = ["CSO", "CHQ Assembly"]

        store.saveFilters(filter)
        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()

        #expect(reloaded?.selectedLocations == ["Amphitheater", "Elizabeth S. Lenna Hall"])
        #expect(reloaded?.selectedCategories == ["CSO", "CHQ Assembly"])
    }

    /// Payloads written by the shipped build stored these as JSON arrays of
    /// lowercased strings (they were `Set<String>`). Decoding must still
    /// yield the selections rather than throwing and silently wiping them.
    @Test func legacyLowercasedPayloadStillDecodes() throws {
        let defaults = makeDefaults()
        let legacy = """
        {"dateScope":"next","selectedWeeks":[3],\
        "selectedLocations":["amphitheater"],"selectedCategories":["cso"],\
        "showFavoritesOnly":false,"lastSaved":"2026-08-01T12:00:00Z"}
        """
        defaults.set(Data(legacy.utf8), forKey: "chq-filters")

        let now = try #require(ChqTime.parse("2026-08-02 12:00:00"))
        let loaded = UserStateStore(defaults: defaults, now: { now }).loadFilters()

        #expect(loaded?.selectedLocations == ["amphitheater"])
        #expect(loaded?.selectedCategories == ["cso"])
        #expect(loaded?.selectedWeeks == [3])
    }

    // MARK: - RecentFilters

    @Test func addingPutsNewestFirst() {
        var list: [String] = []
        list = RecentFilters.adding("Amphitheater", to: list)
        list = RecentFilters.adding("Norton Hall", to: list)
        #expect(list == ["Norton Hall", "Amphitheater"])
    }

    @Test func addingMovesAnExistingEntryToTheFrontWithoutDuplicating() {
        let list = RecentFilters.adding(
            "amphitheater", to: ["Norton Hall", "Amphitheater", "Lenna Hall"])
        #expect(list == ["amphitheater", "Norton Hall", "Lenna Hall"])
    }

    @Test func addingCapsAtTen() {
        var list = (1...10).map { "Venue \($0)" }
        list = RecentFilters.adding("Venue 11", to: list)
        #expect(list.count == 10)
        #expect(list.first == "Venue 11")
        #expect(!list.contains("Venue 10"))
    }

    @Test func recentsRoundTrip() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        store.saveRecents(RecentFilters(locations: ["Amphitheater"], categories: ["CSO"]))

        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadRecents()
        #expect(reloaded.locations == ["Amphitheater"])
        #expect(reloaded.categories == ["CSO"])
    }

    @Test func missingRecentsKeyYieldsEmptyAndLeavesFiltersAlone() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        var filter = FilterSelection()
        filter.selectedWeeks = [2]
        store.saveFilters(filter)

        let reloaded = UserStateStore(defaults: defaults, now: { Date() })
        #expect(reloaded.loadRecents() == RecentFilters())
        #expect(reloaded.loadFilters()?.selectedWeeks == [2])
    }

    @Test func recentsExpireAfterThirtyDays() throws {
        let defaults = makeDefaults()
        let saved = try #require(ChqTime.parse("2026-06-01 12:00:00"))
        UserStateStore(defaults: defaults, now: { saved })
            .saveRecents(RecentFilters(locations: ["Amphitheater"], categories: []))

        let muchLater = saved.addingTimeInterval(31 * 24 * 3600)
        #expect(UserStateStore(defaults: defaults, now: { muchLater }).loadRecents()
            == RecentFilters())
    }

    // MARK: - UserStateStore: reminder settings round-trip (no expiry)

    @Test func reminderSettingsDefaultWhenNoneSaved() {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        let loaded = store.loadReminderSettings()
        #expect(loaded == ReminderSettings())
        #expect(loaded.defaultPreset == .thirtyMinutesBefore)
        #expect(loaded.overrides.isEmpty)
    }

    @Test func reminderSettingsRoundTrip() {
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        var settings = ReminderSettings()
        settings.defaultPreset = .nightBefore
        settings.setOverride(.oneHourBefore, for: "evt-1")
        settings.setOverride(ReminderPreset.none, for: "evt-2")

        store.saveReminderSettings(settings)
        let loaded = store.loadReminderSettings()

        #expect(loaded == settings)
        #expect(loaded.preset(for: "evt-1") == .oneHourBefore)
        #expect(loaded.preset(for: "evt-2") == .none)
        #expect(loaded.preset(for: "evt-3") == .nightBefore)
    }

    /// Reminder settings must have **no** expiry: unlike filters/favorites/
    /// recents, a save made 40 days ago (well past the 30-day expiry those
    /// other keys use) must still load, so a configured reminder never
    /// silently vanishes.
    @Test func reminderSettingsAt40DaysStillLoad() throws {
        let defaults = makeDefaults()
        let saveTime = try #require(ChqTime.parse("2026-06-01 12:00:00"))
        let store = UserStateStore(defaults: defaults, now: { saveTime })
        var settings = ReminderSettings()
        settings.defaultPreset = .oneHourBefore
        settings.setOverride(.nightBefore, for: "evt-9")
        store.saveReminderSettings(settings)

        let muchLater = saveTime.addingTimeInterval(40 * 24 * 3600)
        let laterStore = UserStateStore(defaults: defaults, now: { muchLater })
        #expect(laterStore.loadReminderSettings() == settings)
    }

    // MARK: - triggerMigrationIfNeeded isAppProcess gate (F1)

    /// Neither branch touches the real `UserDefaults.standard` in the unit
    /// test host, since `AppGroup.containerURL()` is `nil` there regardless
    /// of `isAppProcess` — but both must be callable (independent of the
    /// once-per-process `didMigrateDefaults` static let, which this
    /// parameterized function exists separately from) and return `true`
    /// without crashing. `AppGroup.shouldRunAppOnlyMigrationTests` pins the
    /// actual `isAppProcess`-vs-`hasGroupContainer` decision matrix; this
    /// just confirms the trigger wires that decision through correctly for
    /// both values it's given.
    @Test func triggerMigrationIfNeededReturnsTrueWhenIsAppProcessIsTrue() {
        #expect(UserStateStore.triggerMigrationIfNeeded(isAppProcess: true))
    }

    @Test func triggerMigrationIfNeededReturnsTrueWhenIsAppProcessIsFalse() {
        #expect(UserStateStore.triggerMigrationIfNeeded(isAppProcess: false))
    }

    @Test func reminderSettingsSaveDoesNotAffectOtherKeys() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        store.saveFavorites(["evt-1"])

        var settings = ReminderSettings()
        settings.defaultPreset = .none
        store.saveReminderSettings(settings)

        #expect(store.loadFavorites() == ["evt-1"])
        #expect(store.loadReminderSettings().defaultPreset == .none)
    }

    // MARK: - .day scope is session-only

    @Test func dayScopeIsPersistedAsNextAndTheDayKeyIsNeverWritten() {
        // A date pinned three days ago and silently restored on launch would
        // be worse than not restoring at all — same reasoning as
        // searchText/windowStartDayKey/windowEndDayKey. `.day` names an
        // absolute date, so it cannot survive a relaunch the way a relative
        // scope can.
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = UserStateStore(defaults: defaults, now: { Date() })

        store.saveFilters(FilterSelection(
            dateScope: .day,
            selectedDayKey: "2026-08-09",
            selectedLocations: ["Amphitheater"]))
        let loaded = store.loadFilters()

        #expect(loaded?.dateScope == .next)
        #expect(loaded?.selectedDayKey == nil)
        // The rest of the selection still round-trips normally.
        #expect(loaded?.selectedLocations == ["Amphitheater"])
    }

    /// Every scope but `.day` — the name was plural while the body pinned
    /// only `.season`, so the "only `.day` is rewritten" half of the
    /// contract above was largely unguarded (#197 item 4). Driven off
    /// `DateScope.allCases` so a scope added later is covered by default
    /// rather than by someone remembering to extend a literal list.
    @Test func nonDayScopesStillRoundTripUnchanged() {
        for scope in DateScope.allCases where scope != .day {
            let defaults = UserDefaults(suiteName: UUID().uuidString)!
            let store = UserStateStore(defaults: defaults, now: { Date() })

            store.saveFilters(FilterSelection(dateScope: scope))

            #expect(
                store.loadFilters()?.dateScope == scope,
                "\(scope) must survive a round trip unchanged")
        }
    }

    @Test func dayScopeIsNotDefaultAndCountsAsADateFilter() {
        let selection = FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09")

        #expect(!selection.isDefault)
        #expect(selection.hasDateFilters)
        #expect(!selection.hasNonDateFilters)
    }
}
