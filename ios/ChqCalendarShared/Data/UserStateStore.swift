import Foundation

/// Which date window a `FilterSelection` restricts events to. Raw values
/// match the web app's query-string vocabulary (`this-week` uses a hyphen).
nonisolated enum DateScope: String, Codable, CaseIterable, Sendable {
    case next
    case today
    case thisWeek = "this-week"
    case season
    case all

    var label: String {
        switch self {
        case .next: return "Now"
        case .today: return "Today"
        case .thisWeek: return "This Week"
        case .season: return "All Season"
        case .all: return "All Year"
        }
    }
}

/// The user's current filter/search state for the event list.
///
/// `searchText` and `extraDays` are session-only: they affect what's shown
/// right now but are deliberately excluded from `isDefault`
/// and are never persisted by `UserStateStore` (matches web intent — a
/// fresh app launch always starts with an empty search box).
nonisolated struct FilterSelection: Codable, Equatable, Sendable {
    var searchText: String = ""
    var dateScope: DateScope = .next
    var selectedWeeks: Set<Int> = []
    /// Venue and category selections hold the feed's **original casing** in
    /// selection order, matching the web's `selectedLocations` /
    /// `selectedTags`. Comparison is lowercased at the point of use
    /// (`EventFilter.apply`), not at the point of storage: the stored value
    /// is what gets rendered as a chip label, and `DisplayNames` is an
    /// exact-match dictionary keyed on the original casing.
    var selectedLocations: [String] = []
    var selectedCategories: [String] = []
    var showFavoritesOnly: Bool = false
    var extraDays: Int = 0

    init(
        searchText: String = "",
        dateScope: DateScope = .next,
        selectedWeeks: Set<Int> = [],
        selectedLocations: [String] = [],
        selectedCategories: [String] = [],
        showFavoritesOnly: Bool = false,
        extraDays: Int = 0
    ) {
        self.searchText = searchText
        self.dateScope = dateScope
        self.selectedWeeks = selectedWeeks
        self.selectedLocations = selectedLocations
        self.selectedCategories = selectedCategories
        self.showFavoritesOnly = showFavoritesOnly
        self.extraDays = extraDays
    }

    /// Whether the *persisted* facets (weeks/locations/categories/
    /// favorites-only/scope) match a brand-new `FilterSelection()`.
    /// `searchText`/`extraDays` are session-only and excluded.
    var isDefault: Bool {
        selectedWeeks.isEmpty
            && selectedLocations.isEmpty
            && selectedCategories.isEmpty
            && !showFavoritesOnly
            && dateScope == .next
    }

    /// Whether a date range is narrowing the results. Mirrors the web's
    /// `hasDateFilters`.
    var hasDateFilters: Bool {
        dateScope != .all || !selectedWeeks.isEmpty
    }

    /// Whether anything *other* than a date range is narrowing the results.
    /// `searchText` is trimmed so a whitespace-only term — which matches
    /// everything and produces no chip — doesn't count. Mirrors the web's
    /// `hasNonDateFilters`.
    var hasNonDateFilters: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !selectedLocations.isEmpty
            || !selectedCategories.isEmpty
            || showFavoritesOnly
    }

    var hasFilters: Bool { hasDateFilters || hasNonDateFilters }
}

/// The user's most-recently-used venue and category filters, so repeating a
/// filter is one tap instead of a trip through a picker.
///
/// Persisted state but *not* filter input: `EventFilter` never sees this.
/// Names carry the feed's original casing, matching `FilterSelection`.
nonisolated struct RecentFilters: Codable, Equatable, Sendable {
    var locations: [String] = []
    var categories: [String] = []

    /// `item` moved to the front, any case-insensitive duplicate removed,
    /// truncated to `max`. The web's `addToRecent`, plus case-insensitive
    /// matching so "CSO" and "cso" can't both occupy a slot.
    static func adding(_ item: String, to list: [String], max: Int = 10) -> [String] {
        let key = item.lowercased()
        return ([item] + list.filter { $0.lowercased() != key }).prefix(max).map { $0 }
    }
}

/// Persists `FilterSelection` and favorite event IDs to `UserDefaults`,
/// each with a 30-day expiry so a user who hasn't opened the app in a
/// month starts fresh rather than seeing stale/confusing filters.
///
/// `searchText`/`extraDays` are session-only and are never written to
/// disk: `saveFilters` persists a payload with those fields reset to
/// their defaults, so `loadFilters` always returns an empty search and
/// zero extra days even immediately after a round trip.
nonisolated struct UserStateStore {
    private static let filtersKey = "chq-filters"
    private static let favoritesKey = "chq-favorites"
    private static let recentsKey = "chq-recents"
    private static let expiry: TimeInterval = 30 * 24 * 3600

    /// The subset of `FilterSelection` that's actually persisted —
    /// `searchText`/`extraDays` are intentionally omitted.
    private struct PersistedFilters: Codable {
        var dateScope: DateScope
        var selectedWeeks: Set<Int>
        var selectedLocations: [String]
        var selectedCategories: [String]
        var showFavoritesOnly: Bool
        var lastSaved: Date
    }

    private struct PersistedFavorites: Codable {
        var ids: Set<String>
        var lastSaved: Date
    }

    private struct PersistedRecents: Codable {
        var recents: RecentFilters
        var lastSaved: Date
    }

    private let defaults: UserDefaults
    private let now: @Sendable () -> Date

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    init(defaults: UserDefaults = AppGroup.userDefaults(), now: @escaping @Sendable () -> Date = { Date() }) {
        _ = Self.didMigrateDefaults
        self.defaults = defaults
        self.now = now
    }

    /// Lazily migrates the three persisted keys from `.standard` into the
    /// App Group suite the first time any `UserStateStore` is created in
    /// this process (regardless of the `defaults:` argument it was given —
    /// the migration always runs against `.standard` and the App Group
    /// suite, not against whatever `defaults` this particular instance
    /// uses). A `static let` is used rather than a mutable flag for the
    /// same reason as
    /// `DiskCache.didMigrate`: Swift initializes it exactly once,
    /// thread-safely, with no actor isolation or lock required.
    ///
    /// When the App Group entitlement is absent (unit-test hosts,
    /// un-entitled builds), `AppGroup.containerURL()` is `nil` and this is
    /// a no-op — it never touches the real `UserDefaults.standard` in that
    /// case, so tests that pass their own isolated `defaults:` suite are
    /// unaffected.
    private static let didMigrateDefaults: Bool = {
        guard AppGroup.containerURL() != nil else { return true }
        AppGroup.migrateDefaultsIfNeeded(
            from: .standard,
            to: AppGroup.userDefaults(),
            keys: [filtersKey, favoritesKey, recentsKey]
        )
        return true
    }()

    /// Loads the persisted filter facets, or `nil` if nothing was saved or
    /// the saved state is 30+ days old. `searchText` and `extraDays` are
    /// always returned at their defaults (empty/0) since they aren't
    /// persisted.
    func loadFilters() -> FilterSelection? {
        guard
            let data = defaults.data(forKey: Self.filtersKey),
            let persisted = try? Self.decoder.decode(PersistedFilters.self, from: data),
            now().timeIntervalSince(persisted.lastSaved) < Self.expiry
        else {
            return nil
        }
        return FilterSelection(
            dateScope: persisted.dateScope,
            selectedWeeks: persisted.selectedWeeks,
            selectedLocations: persisted.selectedLocations,
            selectedCategories: persisted.selectedCategories,
            showFavoritesOnly: persisted.showFavoritesOnly
        )
    }

    /// Persists `f`'s facets, stamped with the current time. `searchText`
    /// and `extraDays` are deliberately dropped — they're session-only.
    func saveFilters(_ f: FilterSelection) {
        let persisted = PersistedFilters(
            dateScope: f.dateScope,
            selectedWeeks: f.selectedWeeks,
            selectedLocations: f.selectedLocations,
            selectedCategories: f.selectedCategories,
            showFavoritesOnly: f.showFavoritesOnly,
            lastSaved: now()
        )
        guard let data = try? Self.encoder.encode(persisted) else { return }
        defaults.set(data, forKey: Self.filtersKey)
    }

    /// Loads the persisted favorite event IDs, or an empty set if nothing
    /// was saved or the saved state is 30+ days old.
    func loadFavorites() -> Set<String> {
        guard
            let data = defaults.data(forKey: Self.favoritesKey),
            let persisted = try? Self.decoder.decode(PersistedFavorites.self, from: data),
            now().timeIntervalSince(persisted.lastSaved) < Self.expiry
        else {
            return []
        }
        return persisted.ids
    }

    /// Persists `ids`, stamped with the current time.
    func saveFavorites(_ ids: Set<String>) {
        let persisted = PersistedFavorites(ids: ids, lastSaved: now())
        guard let data = try? Self.encoder.encode(persisted) else { return }
        defaults.set(data, forKey: Self.favoritesKey)
    }

    /// Loads the persisted recents, or empty ones if nothing was saved or
    /// the saved state is 30+ days old. Stored under its own key rather
    /// than inside `PersistedFilters` so adding it can't affect decoding of
    /// an existing filters payload.
    func loadRecents() -> RecentFilters {
        guard
            let data = defaults.data(forKey: Self.recentsKey),
            let persisted = try? Self.decoder.decode(PersistedRecents.self, from: data),
            now().timeIntervalSince(persisted.lastSaved) < Self.expiry
        else {
            return RecentFilters()
        }
        return persisted.recents
    }

    func saveRecents(_ recents: RecentFilters) {
        let persisted = PersistedRecents(recents: recents, lastSaved: now())
        guard let data = try? Self.encoder.encode(persisted) else { return }
        defaults.set(data, forKey: Self.recentsKey)
    }
}
