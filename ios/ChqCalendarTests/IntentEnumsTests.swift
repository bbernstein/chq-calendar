import Foundation
import Testing
@testable import ChqCalendar

/// The AppEnum display representations must be LITERAL dictionaries (the
/// App Intents metadata processor const-extracts them at build time — a
/// computed dictionary can silently export nothing). These tests pin the
/// literals to the shared vocabulary so the two can never drift.
struct IntentEnumsTests {
    @Test func eventKindRepresentationsCoverAllCasesWithMatchingTitlesAndSynonyms() {
        for kind in EventKind.allCases {
            let rep = EventKind.caseDisplayRepresentations[kind]
            #expect(rep != nil, "missing display representation for \(kind)")
            #expect(String(localized: rep!.title) == kind.displayTitle)
            #expect(rep!.synonyms.map { String(localized: $0) } == kind.spokenSynonyms)
        }
    }

    @Test func timeframeRepresentationsCoverAllCasesWithMatchingTitles() {
        for tf in IntentTimeframe.allCases {
            let rep = IntentTimeframe.caseDisplayRepresentations[tf]
            #expect(rep != nil, "missing display representation for \(tf)")
            #expect(String(localized: rep!.title) == tf.spokenLabel)
        }
    }

    @Test func themeWeekRepresentationsCoverAllCases() {
        for w in ThemeWeek.allCases {
            let rep = ThemeWeek.caseDisplayRepresentations[w]
            #expect(rep != nil, "missing display representation for \(w)")
            #expect(String(localized: rep!.title) == w.spokenLabel)
        }
    }

    @Test func venueEntityUsesItsNameAsIdentity() {
        let venue = VenueEntity(name: "Amphitheater")
        #expect(venue.id == "Amphitheater")
    }
}
