import Foundation
import Testing
@testable import ChqCalendar

/// Pins the #193 Siri vocabulary's kind → feed-token mapping. Tag values
/// are the slug-form tags observed in the live 2026 feed (see the design
/// spec's vocabulary table); `Event.filterTokens` contains them lowercased.
struct EventKindTests {
    private func event(tags: [String] = [], location: String? = nil) -> Event {
        makeEvent(id: "e", start: ChqTime.parse("2026-07-15 10:00:00")!, location: location, tags: tags)
    }

    @Test func lecturesMatchChautauquaLectureSeries() {
        #expect(EventKind.lectures.matches(event(tags: ["chautauqua-lecture-series"])))
    }

    @Test func lecturesMatchInterfaithAndCLSCAndMasterClass() {
        #expect(EventKind.lectures.matches(event(tags: ["interfaith-lecture"])))
        #expect(EventKind.lectures.matches(event(tags: ["chautauqua-literary-and-scientific-circle-clsc"])))
        #expect(EventKind.lectures.matches(event(tags: ["master-class"])))
        #expect(EventKind.lectures.matches(event(tags: ["special-lectures"])))
    }

    @Test func lecturesDoNotMatchAMovie() {
        #expect(!EventKind.lectures.matches(event(tags: ["movies"])))
    }

    @Test func symphonyMatchesCSOAndChamberMusic() {
        #expect(EventKind.symphonyConcerts.matches(event(tags: ["chautauqua-symphony-orchestra-classical-concerts"])))
        #expect(EventKind.symphonyConcerts.matches(event(tags: ["chautauqua-chamber-music"])))
    }

    @Test func concertsIncludePopularEntertainmentAndSymphonyAndSchoolOfMusic() {
        #expect(EventKind.concerts.matches(event(tags: ["popular-entertainment-concerts"])))
        #expect(EventKind.concerts.matches(event(tags: ["chautauqua-symphony-orchestra-classical-concerts"])))
        #expect(EventKind.concerts.matches(event(tags: ["school-of-music"])))
    }

    @Test func moviesMatchByTagOrCinemaVenue() {
        #expect(EventKind.movies.matches(event(tags: ["movies"])))
        #expect(EventKind.movies.matches(event(location: "Chautauqua Cinema")))
        #expect(!EventKind.movies.matches(event(tags: ["opera"])))
    }

    @Test func worshipMatchesFaithProgrammingAndServices() {
        #expect(EventKind.worshipServices.matches(event(tags: ["faith-and-spiritual-programming"])))
        #expect(EventKind.worshipServices.matches(event(tags: ["service"])))
        #expect(EventKind.worshipServices.matches(event(tags: ["weekly-chaplains"])))
    }

    @Test func remainingKindsMatchTheirTags() {
        #expect(EventKind.operas.matches(event(tags: ["opera"])))
        #expect(EventKind.plays.matches(event(tags: ["theater"])))
        #expect(EventKind.dance.matches(event(tags: ["dance"])))
        #expect(EventKind.recreation.matches(event(tags: ["recreation"])))
        #expect(EventKind.familyActivities.matches(event(tags: ["youth-programs-and-activities"])))
    }

    @Test func displayTitlesArePluralAndSynonymsNonEmpty() {
        for kind in EventKind.allCases {
            #expect(!kind.displayTitle.isEmpty)
            #expect(!kind.spokenSynonyms.isEmpty)
        }
        // Titles are baked verbatim into Siri utterances — plural forms only.
        #expect(EventKind.movies.displayTitle == "movies")
        #expect(EventKind.lectures.displayTitle == "lectures")
    }

    @Test func flagshipVenueDetectionIsCaseInsensitiveAndNilSafe() {
        #expect(EventKind.isFlagshipVenue("Amphitheater"))
        #expect(EventKind.isFlagshipVenue("hall of philosophy"))
        #expect(EventKind.isFlagshipVenue("Bratton Theater"))
        #expect(!EventKind.isFlagshipVenue("Smith Wilkes Hall"))
        #expect(!EventKind.isFlagshipVenue(nil))
    }
}
