import Foundation

/// Every spoken dialog string for the #193 Siri surface, as pure
/// functions returning `String` — the intents wrap these in
/// `IntentDialog` at the call site, so the exact copy Siri speaks is
/// unit-testable without the AppIntents runtime.
nonisolated enum IntentDialogText {
    private static func when(_ event: Event) -> String {
        "\(ChqTime.dayTitle(for: event.start)) at \(ChqTime.timeString(for: event.start))"
    }

    static func nextUp(kindTitle: String?, event: Event) -> String {
        let lead = kindTitle.map { "Next for \($0)" } ?? "Next up"
        let venue = event.displayLocation.map { ", \($0)" } ?? ""
        return "\(lead): \(event.title) — \(when(event))\(venue)."
    }

    static func listSummary(count: Int, kindTitle: String?, timeframeLabel: String?, first: Event) -> String {
        let what = kindTitle ?? "events"
        let scope = timeframeLabel.map { " \($0)" } ?? " coming up"
        return "\(count) \(what)\(scope) — first: \(first.title), \(when(first))."
    }

    static func noMatch(kindTitle: String?, timeframeLabel: String?, next: Event?) -> String {
        let what = kindTitle ?? "events"
        let scope = timeframeLabel ?? "coming up"
        let base = "No \(what) \(scope)."
        guard let next else { return base }
        return "\(base) Next one: \(when(next))."
    }

    static func whoIsSpeaking(event: Event) -> String {
        guard let presenter = event.presenter, !presenter.isEmpty else {
            return nextUp(kindTitle: "lectures", event: event)
        }
        let venue = event.displayLocation.map { " in the \($0)" } ?? ""
        return "\(presenter) speaks \(when(event))\(venue): \(event.title)."
    }

    static func showTime(slotLabel: String, event: Event) -> String {
        "The \(slotLabel) \(ChqTime.dayTitle(for: event.start)) is \(event.title) at \(ChqTime.timeString(for: event.start))."
    }

    static func mySchedule(timeframeLabel: String, events: [Event]) -> String {
        guard !events.isEmpty else { return "Nothing starred for \(timeframeLabel) yet." }
        let noun = events.count == 1 ? "starred event" : "starred events"
        let titles = events.prefix(3).map(\.title).joined(separator: ", ")
        return "You have \(events.count) \(noun) \(timeframeLabel): \(titles)."
    }

    static func theme(summary: WeekThemeSummary) -> String {
        guard let dateRange = summary.dateRange, !dateRange.isEmpty else {
            return "Week \(summary.weekNumber): \(summary.title)."
        }
        return "Week \(summary.weekNumber) (\(dateRange)): \(summary.title)."
    }

    static func noTheme() -> String { "No theme is listed for that week." }

    static func offSeason(_ status: SeasonStatus, year: Int) -> String? {
        switch status {
        case .inSeason: return nil
        case .preSeason(let start):
            return "The \(year) season starts \(ChqTime.dayTitle(for: start))."
        case .postSeason:
            return "The \(year) season has ended. Check back when next season is announced."
        }
    }

    static func coldCache() -> String {
        "Open CHQ Calendar once to load the season schedule, then ask again."
    }
}
