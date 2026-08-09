import Foundation
import Testing

/// `ChqShortcuts.appShortcuts` declares, for each `AppShortcut`, a
/// `phrases` array. `AppShortcut`/`AppIntent` machinery has no
/// runtime-introspectable way to read that array back out in test code —
/// it is consumed by the App Shortcuts extension at build time — and the
/// property this test cares about (which phrase comes *first*) is a
/// source-ordering convention, not something observable through the
/// compiled framework. So this test reads `ChqShortcuts.swift` as plain
/// text instead of exercising the type.
///
/// Why the first phrase matters: `SiriTipView(intent:)` displays
/// `phraseTemplates[0]` for the given intent. At display time
/// `\(.applicationName)` resolves to the app's name, but a parameter slot
/// like `\(\.$timeframe)` does not — it renders literally, e.g.
/// `Say "What am I doing ${timeframe} in CHQ Calendar"`. That is exactly
/// what shipped on the My Day screen. This test protects against a future
/// shortcut being added (or reordered) with a parameterized phrase first,
/// which would silently leak a raw slot name into the Siri tip UI again.
struct ChqShortcutsTests {
    /// `ShowTimeIntent` is a deliberate, documented exception. All four of
    /// its phrases are parameterized on `\(\.$slot)` — there is no plain
    /// variant to promote, because its slot vocabulary is only two fixed
    /// values ("evening show", "morning lecture") and inventing a plain
    /// phrase would add an utterance nobody actually says. It is also not
    /// bound to any `SiriTipView` — its only surface is the Shortcuts
    /// gallery, where Apple may render parameter slots as tappable tokens
    /// rather than literal text. That has not been verified on a device,
    /// so this exclusion should be revisited after a device check.
    private static let exemptIntents: Set<String> = ["ShowTimeIntent"]

    @Test func firstPhraseOfEveryAppShortcutHasNoParameterSlot() throws {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // ChqShortcutsTests.swift
            .deletingLastPathComponent() // ChqCalendarTests
            .deletingLastPathComponent() // ios
        let sourceURL = repoRoot
            .appendingPathComponent("ios/ChqCalendar/Intents/ChqShortcuts.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)

        // Each `AppShortcut(` marks the start of one shortcut's block.
        // Splitting on the literal text is the whole "read as source" the
        // doc comment above describes.
        let blocks = source.components(separatedBy: "AppShortcut(").dropFirst()

        var checkedIntents: [String] = []

        for block in blocks {
            guard let intentRange = block.range(
                of: #"intent:\s*(\w+)\("#,
                options: .regularExpression
            ) else {
                Issue.record("Could not find `intent:` declaration in an AppShortcut block")
                continue
            }
            let intentName = String(block[intentRange])
                .replacingOccurrences(of: "intent:", with: "")
                .replacingOccurrences(of: "(", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            checkedIntents.append(intentName)

            guard !Self.exemptIntents.contains(intentName) else { continue }

            guard let phrasesStart = block.range(of: "phrases: ["),
                  let arrayEnd = block.range(
                      of: "]",
                      range: phrasesStart.upperBound..<block.endIndex
                  ) else {
                Issue.record("Could not find `phrases: [...]` array for \(intentName)")
                continue
            }
            let phrasesBody = block[phrasesStart.upperBound..<arrayEnd.lowerBound]

            guard let firstQuoteStart = phrasesBody.firstIndex(of: "\"") else {
                Issue.record("\(intentName) has no phrases")
                continue
            }
            let afterOpenQuote = phrasesBody.index(after: firstQuoteStart)
            guard let firstQuoteEnd = phrasesBody[afterOpenQuote...].firstIndex(of: "\"") else {
                Issue.record("Malformed first phrase string literal for \(intentName)")
                continue
            }
            let firstPhrase = String(phrasesBody[afterOpenQuote..<firstQuoteEnd])

            // Parameter interpolations are the only place `$` appears in
            // these phrases (`\(\.$paramName)`); `\(.applicationName)`
            // has no `$`. A `$` in the first phrase means it will render
            // as a literal, unresolved slot name in SiriTipView.
            #expect(
                !firstPhrase.contains("$"),
                """
                First phrase for \(intentName) contains a parameter slot and will render \
                literally (e.g. "${slotName}") in SiriTipView instead of a complete \
                sentence: "\(firstPhrase)". Move a plain phrase to the front of its \
                `phrases` array.
                """
            )
        }

        #expect(
            Set(checkedIntents) == [
                "NextEventsIntent", "TodayEventsIntent", "OpenEventIntent",
                "WeekThemeIntent", "MyScheduleIntent", "WhoIsSpeakingIntent",
                "ShowTimeIntent",
            ],
            "Unexpected set of intents found in ChqShortcuts.swift: \(checkedIntents)"
        )
    }
}
