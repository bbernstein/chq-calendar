import AppIntents

/// Registers the app's three Siri/Shortcuts phrases (#180) — this is what
/// makes "What's Next"/"Today at Chautauqua"/"Open Event" show up in the
/// Shortcuts app gallery under CHQ Calendar without the user configuring
/// anything, and lets Siri run them by voice.
///
/// `nonisolated`, matching `EventEntity`/`EventEntityQuery`: `appShortcuts`
/// is a synchronous, non-async static requirement, and the project's
/// `SWIFT_DEFAULT_ACTOR_ISOLATION` is `MainActor` — the Shortcuts/Siri
/// runtime queries this metadata off the main actor, so the type is marked
/// `nonisolated` rather than relying on it happening to be MainActor at
/// query time.
nonisolated struct ChqShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: NextEventsIntent(),
            phrases: [
                "What's next in \(.applicationName)",
                "What's coming up in \(.applicationName)"
            ],
            shortTitle: "What's Next",
            systemImageName: "clock"
        )
        AppShortcut(
            intent: TodayEventsIntent(),
            phrases: [
                "Today in \(.applicationName)",
                "What's happening today in \(.applicationName)"
            ],
            shortTitle: "Today",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: OpenEventIntent(),
            phrases: [
                "Open an event in \(.applicationName)",
                "Open \(\.$event) in \(.applicationName)"
            ],
            shortTitle: "Open Event",
            systemImageName: "arrow.up.right.circle"
        )
    }
}
