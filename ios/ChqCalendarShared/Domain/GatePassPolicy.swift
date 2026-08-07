import Foundation

/// Whether Gate Pass holders get general admission to an event.
///
/// This is a **heuristic**, not data: chq.org stores per-event access as
/// protected WordPress post meta that no API exposes. The full investigation
/// record is `docs/superpowers/specs/2026-08-04-ios-gate-pass-weeks-links-design.md`,
/// added in PR #167. The approved rule: Amphitheater events during the season
/// admit Gate Pass holders. Fail-safe by omission — an event this heuristic
/// misses gets no note; it never fabricates one for an event it can't confirm.
nonisolated enum GatePassPolicy {
    static func includesGeneralAdmission(_ event: Event) -> Bool {
        guard let location = event.displayLocation,
              location.caseInsensitiveCompare("Amphitheater") == .orderedSame
        else { return false }

        // The event's own year, in NY time — season weeks are computed per
        // year, so a 2025 event is judged against the 2025 season.
        let year = ChqTime.calendar.component(.year, from: event.start)
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let first = weeks.first, let last = weeks.last else { return false }
        return first.start <= event.start && event.start < last.end
    }
}
