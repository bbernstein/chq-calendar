import AppIntents

/// Registers the app's #193 Siri/Shortcuts surface — this is what makes
/// the eight shortcuts (listed in the Shortcuts app gallery under CHQ
/// Calendar by their `AppIntent.title`: "What's Next", "Today at
/// Chautauqua", "Open Event", "Weekly Theme", "My Schedule", "Who's
/// Speaking", "Show Time", "Show a Day") show up without the user configuring anything,
/// and lets Siri run them by voice. "What's Next" alone carries 27
/// phrases across four families — plain, kind-parameterized,
/// timeframe-parameterized, and venue-parameterized — so a user can ask
/// "what's next", "what movies are playing", "what's happening tonight",
/// or "what's playing at the Amp" and land on the same intent with a
/// different slot filled in.
///
/// The `phrases` below are what a user actually *says* — they are not the
/// titles or the `shortTitle`s, and `\(.applicationName)` resolves to the
/// app name (or an `INAlternativeAppNames` entry: "Chautauqua",
/// "Chautauqua Calendar", "CHQ"), so spoken forms include "What's next in
/// CHQ Calendar" and "What movies are playing at Chautauqua". Marketing
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
                "What's next at \(.applicationName)",
                "What's coming up in \(.applicationName)",
                "What's coming up at \(.applicationName)",
                "What \(\.$kind) are playing in \(.applicationName)",
                "What \(\.$kind) are playing at \(.applicationName)",
                "What \(\.$kind) are on in \(.applicationName)",
                "What \(\.$kind) are on at \(.applicationName)",
                "What \(\.$kind) are coming up in \(.applicationName)",
                "What \(\.$kind) are coming up at \(.applicationName)",
                "What's the next \(\.$kind) in \(.applicationName)",
                "What's the next \(\.$kind) at \(.applicationName)",
                "When is the next \(\.$kind) in \(.applicationName)",
                "When is the next \(\.$kind) at \(.applicationName)",
                "What \(\.$kind) are playing tonight in \(.applicationName)",
                "What \(\.$kind) are playing tonight at \(.applicationName)",
                "What \(\.$kind) are playing this week in \(.applicationName)",
                "What \(\.$kind) are playing this week at \(.applicationName)",
                "What's happening \(\.$timeframe) in \(.applicationName)",
                "What's happening \(\.$timeframe) at \(.applicationName)",
                "What's going on \(\.$timeframe) in \(.applicationName)",
                "What's going on \(\.$timeframe) at \(.applicationName)",
                "What's coming up \(\.$timeframe) in \(.applicationName)",
                "What's coming up \(\.$timeframe) at \(.applicationName)",
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
        // The first phrase in each array below is the one SiriTipView and
        // the Shortcuts gallery display verbatim (phraseTemplates[0]) —
        // `\(.applicationName)` resolves there, but a parameter slot like
        // `\(\.$week)` does not, so it must lead with a plain phrase. The
        // parameterized variants stay in the list (just not first) because
        // they're what makes the slots fillable by voice.
        AppShortcut(
            intent: OpenDayIntent(),
            phrases: [
                "Show me a day in \(.applicationName)",
                "Show me a day at \(.applicationName)",
                "Show me \(\.$timeframe) in \(.applicationName)",
                "Show me \(\.$timeframe) at \(.applicationName)",
                "Open \(\.$timeframe) in \(.applicationName)",
                "Open \(\.$timeframe) at \(.applicationName)",
                "Take me to \(\.$timeframe) in \(.applicationName)",
                "Take me to \(\.$timeframe) at \(.applicationName)"
            ],
            shortTitle: "Show a Day",
            systemImageName: "calendar.day.timeline.left"
        )
        AppShortcut(
            intent: WeekThemeIntent(),
            phrases: [
                "What's the weekly theme in \(.applicationName)",
                "What's the weekly theme at \(.applicationName)",
                "What's the theme \(\.$week) in \(.applicationName)",
                "What's the theme \(\.$week) at \(.applicationName)",
                "What is the theme \(\.$week) in \(.applicationName)",
                "What is the theme \(\.$week) at \(.applicationName)",
            ],
            shortTitle: "Weekly Theme",
            systemImageName: "lightbulb"
        )
        AppShortcut(
            intent: MyScheduleIntent(),
            phrases: [
                "What am I doing in \(.applicationName)",
                "What am I doing at \(.applicationName)",
                "What am I doing \(\.$timeframe) in \(.applicationName)",
                "What am I doing \(\.$timeframe) at \(.applicationName)",
                "What's on my schedule \(\.$timeframe) in \(.applicationName)",
                "What's on my schedule \(\.$timeframe) at \(.applicationName)",
                "What's my plan \(\.$timeframe) in \(.applicationName)",
                "What's my plan \(\.$timeframe) at \(.applicationName)",
            ],
            shortTitle: "My Schedule",
            systemImageName: "star"
        )
        AppShortcut(
            intent: WhoIsSpeakingIntent(),
            phrases: [
                "Who is speaking in \(.applicationName)",
                "Who is speaking at \(.applicationName)",
                "Who is speaking \(\.$timeframe) in \(.applicationName)",
                "Who is speaking \(\.$timeframe) at \(.applicationName)",
                "Who's speaking \(\.$timeframe) in \(.applicationName)",
                "Who's speaking \(\.$timeframe) at \(.applicationName)",
            ],
            shortTitle: "Who's Speaking",
            systemImageName: "person.wave.2"
        )
        AppShortcut(
            intent: ShowTimeIntent(),
            phrases: [
                "What time is the \(\.$slot) in \(.applicationName)",
                "What time is the \(\.$slot) at \(.applicationName)",
                "When is the \(\.$slot) in \(.applicationName)",
                "When is the \(\.$slot) at \(.applicationName)",
            ],
            shortTitle: "Show Time",
            systemImageName: "clock.badge.questionmark"
        )
    }
}
