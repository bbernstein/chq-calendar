import AppIntents

/// Registers the app's growing #193 Siri/Shortcuts surface — this is what
/// makes the three intents (listed in the Shortcuts app gallery under CHQ
/// Calendar by their `AppIntent.title`: "What's Next", "Today at
/// Chautauqua", "Open Event") show up without the user configuring
/// anything, and lets Siri run them by voice. "What's Next" alone now
/// carries 15 phrases across four families — plain, kind-parameterized,
/// timeframe-parameterized, and venue-parameterized — so a user can ask
/// "what's next", "what movies are playing", "what's happening tonight",
/// or "what's playing at the Amp" and land on the same intent with a
/// different slot filled in.
///
/// The `phrases` below are what a user actually *says* — they are not the
/// titles or the `shortTitle`s, and `\(.applicationName)` resolves to the
/// app name, so the spoken forms are "What's next in CHQ Calendar",
/// "Today in CHQ Calendar", and "Open an event in CHQ Calendar". Marketing
/// copy quoting a Siri phrase must quote these, not a title.
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
                "What's coming up in \(.applicationName)",
                "What \(\.$kind) are playing in \(.applicationName)",
                "What \(\.$kind) are on in \(.applicationName)",
                "What \(\.$kind) are coming up in \(.applicationName)",
                "What's the next \(\.$kind) in \(.applicationName)",
                "When is the next \(\.$kind) in \(.applicationName)",
                "What \(\.$kind) are playing tonight in \(.applicationName)",
                "What \(\.$kind) are playing this week in \(.applicationName)",
                "What's happening \(\.$timeframe) in \(.applicationName)",
                "What's going on \(\.$timeframe) in \(.applicationName)",
                "What's coming up \(\.$timeframe) in \(.applicationName)",
                "What's happening at \(\.$venue) in \(.applicationName)",
                "What's playing at \(\.$venue) in \(.applicationName)",
                "What's next at \(\.$venue) in \(.applicationName)"
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
        AppShortcut(
            intent: WeekThemeIntent(),
            phrases: [
                "What's the theme \(\.$week) in \(.applicationName)",
                "What is the theme \(\.$week) in \(.applicationName)",
                "What's the weekly theme in \(.applicationName)",
            ],
            shortTitle: "Weekly Theme",
            systemImageName: "lightbulb"
        )
    }
}
