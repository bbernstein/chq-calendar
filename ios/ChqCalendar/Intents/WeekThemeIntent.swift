import AppIntents
import Foundation

/// "Weekly Theme" (#193) — answers "what's the theme this week / week 7"
/// from the already-cached weekly-themes sidecar. Dialog-only (no
/// returned value: a theme isn't an entity anything else consumes).
struct WeekThemeIntent: AppIntent {
    static let title: LocalizedStringResource = "Weekly Theme"

    @Parameter(title: "Week")
    var week: ThemeWeek?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let now = Date()
        let year = await IntentDataSource.defaultYear()
        let themes = SharedSnapshotLoader.loadThemes(
            year: year, cache: DiskCache(directory: AppGroup.cacheDirectory()))
        guard !themes.isEmpty else {
            return .result(dialog: "\(IntentDialogText.coldCache())")
        }
        guard let number = (week ?? .thisWeek).weekNumber(now: now, year: year) else {
            let status = SeasonStatus.make(now: now, year: year)
            let text = IntentDialogText.offSeason(status, year: year) ?? IntentDialogText.noTheme()
            return .result(dialog: "\(text)")
        }
        guard let summary = WeekThemeSummary.make(forWeek: number, in: themes) else {
            return .result(dialog: "\(IntentDialogText.noTheme())")
        }
        return .result(dialog: "\(IntentDialogText.theme(summary: summary))")
    }
}
