import Foundation

/// Which `DateScope` the pipeline **actually applies**, as opposed to the one
/// stored in `FilterSelection`.
///
/// Two rules make those differ, and before this type existed both were
/// duplicated across `EventFilter.apply`, `DateFilterLabel.text`, and
/// `FilterChipState.isScopeSelected` — three sites that had to agree, with
/// no compiler help if they drifted. `FilterChipState` is the one where
/// drift is a *silent* wrong answer: a chip renders selected or unselected
/// against a filter that is doing something else entirely (#192, #197).
///
/// 1. **A past or future season has no "now"**, so every scope relative to
///    it degrades to `.all`.
/// 2. **`.day` is exempt from that**, because it names an absolute calendar
///    day — just as meaningful in an archived season as in the live one —
///    but only while it actually carries a key. A `.day` with no key names
///    no date and filters nothing, which is precisely what `.all` means.
nonisolated enum EffectiveScope {
    /// - Parameter isCurrentYear: must be the same value the caller passes to
    ///   `EventFilter.apply`. Deliberately not defaulted: a default is what
    ///   lets a future call site forget it and silently reintroduce the bug
    ///   where a pill read "Now" over a list that was not date-filtered.
    ///
    /// Idempotent — resolving an already-resolved scope returns it unchanged
    /// — so a consumer that resolves twice cannot disagree with one that
    /// resolves once.
    static func resolve(
        scope: DateScope,
        selectedDayKey: String?,
        isCurrentYear: Bool
    ) -> DateScope {
        if scope == .day {
            return selectedDayKey == nil ? .all : .day
        }
        return isCurrentYear ? scope : .all
    }

    /// Convenience over a whole selection.
    static func resolve(_ selection: FilterSelection, isCurrentYear: Bool) -> DateScope {
        resolve(
            scope: selection.dateScope,
            selectedDayKey: selection.selectedDayKey,
            isCurrentYear: isCurrentYear)
    }
}
