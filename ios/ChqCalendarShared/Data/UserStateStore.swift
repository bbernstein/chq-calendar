import Foundation

/// Which date window a `FilterSelection` restricts events to. Raw values
/// match the web app's query-string vocabulary (`this-week` uses a hyphen).
nonisolated enum DateScope: String, Codable, CaseIterable, Sendable {
    case next
    case today
    case thisWeek = "this-week"
    case season
    case all
    /// A single named calendar day, held in `FilterSelection.selectedDayKey`.
    ///
    /// **Derived, not pickable.** It is never offered in
    /// `DateFilterSheet.visibleScopes` — an arbitrary date cannot be chosen
    /// from a fixed row of presets — and arrives only from My Day's
    /// empty-day "Browse …" action (#192).
    ///
    /// Unlike every other case here it names an **absolute** date, not a
    /// window relative to "now". That is why both `EventFilter.apply` and
    /// `DateFilterLabel.text` exempt it from their non-current-year
    /// downgrade to `.all`: a named day is just as meaningful in an archived
    /// season as in the live one.
    case day

    var label: String {
        switch self {
        case .next: return "Now"
        case .today: return "Today"
        case .thisWeek: return "This Week"
        case .season: return "All Season"
        case .all: return "All Year"
        // Never user-facing: `DateFilterLabel` renders the date itself.
        case .day: return "Day"
        }
    }
}

/// The user's current filter/search state for the event list.
///
/// `searchText`, `extraDays`, and `selectedDayKey` are session-only: they
/// affect what's shown right now but are deliberately excluded from
/// `isDefault` and are never persisted by `UserStateStore` — which also
/// persists a live `.day` scope as `.next`, since without its day key it
/// would mean nothing on the way back in (matches web intent — a fresh app
/// launch always starts with an empty search box) (#192).
nonisolated struct FilterSelection: Codable, Equatable, Sendable {
    var searchText: String = ""
    var dateScope: DateScope = .next
    var selectedWeeks: Set<Int> = []
    /// The single day a `.day` scope names, as a `ChqTime.dayKey`
    /// (`"yyyy-MM-dd"`). Meaningful only while `dateScope == .day`.
    ///
    /// **Session-only**, like `searchText` and `extraDays`: never persisted
    /// by `UserStateStore`. Restoring a date pinned days ago would be worse
    /// than not restoring at all (#192).
    var selectedDayKey: String?
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
        selectedDayKey: String? = nil,
        selectedLocations: [String] = [],
        selectedCategories: [String] = [],
        showFavoritesOnly: Bool = false,
        extraDays: Int = 0
    ) {
        self.searchText = searchText
        self.dateScope = dateScope
        self.selectedWeeks = selectedWeeks
        self.selectedDayKey = selectedDayKey
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

    /// Whether a `.day` scope is actually narrowing anything. `.day` without a
    /// `selectedDayKey` names no date, so `EventFilter` filters nothing — and
    /// every consumer that describes the active date filter has to agree with
    /// that rather than trusting the scope alone (#192).
    var isDayFilterActive: Bool { dateScope == .day && selectedDayKey != nil }

    /// Whether a date range is narrowing the results. Mirrors the web's
    /// `hasDateFilters`. A `.day` scope only counts while `isDayFilterActive`
    /// — a keyless `.day` filters nothing, so it must not be reported as a
    /// date filter either (#192).
    var hasDateFilters: Bool {
        if dateScope == .day { return isDayFilterActive || !selectedWeeks.isEmpty }
        return dateScope != .all || !selectedWeeks.isEmpty
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
/// `searchText`/`extraDays`/`selectedDayKey` are session-only and are never
/// written to disk: `saveFilters` persists a payload with those fields
/// reset to their defaults, so `loadFilters` always returns an empty
/// search, zero extra days, and no day key even immediately after a round
/// trip. A live `.day` scope is likewise persisted as `.next`, since
/// without its day key it would mean nothing on the way back in (#192).
nonisolated struct UserStateStore {
    private static let filtersKey = "chq-filters"
    private static let favoritesKey = "chq-favorites"
    private static let recentsKey = "chq-recents"
    private static let remindersKey = "chq-reminders"
    private static let expiry: TimeInterval = 30 * 24 * 3600

    /// The subset of `FilterSelection` that's actually persisted —
    /// `searchText`/`extraDays`/`selectedDayKey` are intentionally omitted,
    /// and a `.day` scope is stored as `.next` (#192).
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
    /// Delegates the actual isAppProcess/entitlement gating to
    /// `triggerMigrationIfNeeded(isAppProcess:)` below — kept as a separate
    /// function (rather than inlined in this closure) purely so that
    /// function's `isAppProcess` gate is independently testable, since a
    /// `static let` only ever evaluates once per process and could not
    /// otherwise be exercised under both branches in one test run.
    private static let didMigrateDefaults: Bool = triggerMigrationIfNeeded()

    /// The one-time defaults-migration trigger `didMigrateDefaults` runs
    /// exactly once per process. Broken out with an `isAppProcess`
    /// parameter (defaulting to the live `AppGroup.isAppProcess` check) so
    /// both branches are testable directly, independent of the
    /// once-per-process `static let` above.
    ///
    /// Gated on `AppGroup.shouldRunAppOnlyMigration` (task: iOS 4.2
    /// resubmission review, F1): the widget extension builds its own
    /// `UserStateStore` on every timeline refresh, and without this gate
    /// its empty `.standard` could migrate first — copying nothing but
    /// still marking the shared App Group suite as "migrated" — and
    /// permanently skip the app's real migration once it finally launches.
    /// Always returns `true` (never re-runs the check) whether or not the
    /// migration actually happened, mirroring the no-op-forever contract
    /// `AppGroup.migrateDefaultsIfNeeded` itself already has once its own
    /// flag is set.
    @discardableResult
    static func triggerMigrationIfNeeded(isAppProcess: Bool = AppGroup.isAppProcess) -> Bool {
        guard AppGroup.shouldRunAppOnlyMigration(
            isAppProcess: isAppProcess,
            hasGroupContainer: AppGroup.containerURL() != nil
        ) else { return true }
        AppGroup.migrateDefaultsIfNeeded(
            from: .standard,
            to: AppGroup.userDefaults(),
            keys: [filtersKey, favoritesKey, recentsKey]
        )
        return true
    }

    /// Loads the persisted filter facets, or `nil` if nothing was saved or
    /// the saved state is 30+ days old. `searchText`, `extraDays`, and
    /// `selectedDayKey` are always returned at their defaults (empty/0/nil)
    /// since they aren't persisted.
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

    /// Persists `f`'s facets, stamped with the current time. `searchText`,
    /// `extraDays`, and `selectedDayKey` are deliberately dropped — they're
    /// session-only — and a live `.day` scope is persisted as `.next`, since
    /// without its day key it would mean nothing on the way back in.
    func saveFilters(_ f: FilterSelection) {
        let persisted = PersistedFilters(
            dateScope: f.dateScope == .day ? .next : f.dateScope,
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

    /// Loads the persisted reminder settings, or `ReminderSettings()`
    /// (30-minutes-before default, no overrides) if nothing was saved.
    ///
    /// Unlike `loadFilters`/`loadFavorites`/`loadRecents`, this has **no
    /// expiry**: a reminder a user configured must not silently vanish just
    /// because they haven't opened the app in a while — that would defeat
    /// the point of reminding them. `ReminderSettings` is encoded directly
    /// (no `lastSaved`-carrying wrapper struct): it already has an
    /// extensible shape (an enum with a raw-value `Codable` and a
    /// `[String: ReminderPreset]` dictionary), so no wrapper is needed to
    /// keep it forward-compatible.
    func loadReminderSettings() -> ReminderSettings {
        guard
            let data = defaults.data(forKey: Self.remindersKey),
            let settings = try? Self.decoder.decode(ReminderSettings.self, from: data)
        else {
            return ReminderSettings()
        }
        return settings
    }

    /// Persists `settings` verbatim, with no expiry stamp.
    func saveReminderSettings(_ settings: ReminderSettings) {
        guard let data = try? Self.encoder.encode(settings) else { return }
        defaults.set(data, forKey: Self.remindersKey)
    }
}
