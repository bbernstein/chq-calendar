import Foundation
import Testing
@testable import ChqCalendar

struct VenueAtlasTests {
    // MARK: - Coverage

    /// Every feed location string with >= 14 events in the live audit
    /// (from `docs/superpowers/.../task-14-brief.md`'s feed-name audit).
    /// Three of these are single venue names that happen to contain a
    /// comma ("Randell Chapel, UCC Headquarters", "Sports Club, Lawn
    /// Bowling Green", "Sports Club, Waterfront") — do not split them.
    private static let liveVenueNames: [String] = [
        "Amphitheater",
        "Chautauqua Cinema",
        "Hall of Philosophy",
        "Chapel of the Good Shepherd",
        "Hall of Missions",
        "Hall of Philosophy Grove",
        "Randell Chapel, UCC Headquarters",
        "Hurlbut Church sanctuary",
        "Smith Wilkes Hall",
        "Bratton Theater",
        "Hall of Christ: Sanctuary",
        "Bestor Plaza",
        "Miller Park",
        "Presbyterian House",
        "Presbyterian Chapel",
        "Hurlbut Marion Lawrance",
        "Elizabeth S. Lenna Hall",
        "Fletcher Music Hall",
        "Sports Club, Lawn Bowling Green",
        "Hultquist 101",
        "Everett Jewish Life Center",
        "Lutheran House",
        "Sports Club, Waterfront",
        "Sharpe Field",
        "Catholic House",
        "Roe Green Theater Center",
        "Sports Club",
        "Alumni Hall Porch",
        "Sherwood-Marsh 101",
        "Norton Hall",
        "Outdoor Classroom",
        "McKnight Hall",
        "Palestine Park",
        "United Methodist House",
        "Episcopal Cottage",
        "Disciples of Christ House",
        "Unitarian Universalist Fellowship",
        "Quaker House",
        "Chabad Jewish House",
        "Heinz Beach",
        "Baptist House",
        "Athenaeum Parlor",
        "Alumni Hall Ballroom",
        "Turner (Outside of Building)",
    ]

    @Test func allLiveVenueNamesResolve() {
        for name in Self.liveVenueNames {
            #expect(VenueAtlas.location(for: name) != nil, "expected a location for '\(name)'")
        }
    }

    // MARK: - Coordinate sanity

    /// Grounds bounding box. Checked against every entry in
    /// venue-coordinates.json: the only venue actually outside it is
    /// Chautauqua Golf Club (lat 42.1992403, south of the 42.20 floor).
    /// Turner Community Center sits near the box's west edge
    /// (lon -79.4744905) but is still inside -79.48...-79.45.
    private static let boundsExceptions: Set<String> = ["chautauqua-golf-club"]

    @Test func allCoordinatesAreWithinGroundsBoundingBoxExceptKnownOutliers() {
        for venue in VenueAtlas.all where !Self.boundsExceptions.contains(venue.id) {
            #expect((42.20...42.22).contains(venue.latitude), "\(venue.name) latitude out of range")
            #expect((-79.48...(-79.45)).contains(venue.longitude), "\(venue.name) longitude out of range")
        }
    }

    @Test func knownOutliersAreActuallyOutsideTheBox() throws {
        let golfClub = try #require(VenueAtlas.location(for: "Chautauqua Golf Club"))
        #expect(!(42.20...42.22).contains(golfClub.latitude))
    }

    // MARK: - Walking time

    @Test func amphitheaterToHallOfPhilosophyIsAShortWalk() throws {
        // The task-14 brief guessed 8-15 min ("~700 m across the grounds"),
        // written before the OSM coordinates below were pinned down. The
        // researched, high-confidence centroids
        // (osm-way-619932539 / osm-way-820060447) are only ~228 m apart
        // straight-line -> ~296 m routed -> ~3.7 min, ceil 4. Trusting the
        // transcribed coordinates + the spec'd formula over the brief's
        // pre-research guess; flagged in the task-14 report for the plan
        // owner to confirm against the real path.
        let amphitheater = try #require(VenueAtlas.location(for: "Amphitheater"))
        let hallOfPhilosophy = try #require(VenueAtlas.location(for: "Hall of Philosophy"))
        let minutes = VenueAtlas.walkingMinutes(from: amphitheater, to: hallOfPhilosophy)
        #expect((3...6).contains(minutes))
    }

    @Test func sameVenueIsZeroMinutes() throws {
        let amphitheater = try #require(VenueAtlas.location(for: "Amphitheater"))
        #expect(VenueAtlas.walkingMinutes(from: amphitheater, to: amphitheater) == 0)
    }

    @Test func walkingTimeIsSymmetric() throws {
        let amphitheater = try #require(VenueAtlas.location(for: "Amphitheater"))
        let hallOfPhilosophy = try #require(VenueAtlas.location(for: "Hall of Philosophy"))
        let there = VenueAtlas.walkingMinutes(from: amphitheater, to: hallOfPhilosophy)
        let back = VenueAtlas.walkingMinutes(from: hallOfPhilosophy, to: amphitheater)
        #expect(there == back)
    }

    // MARK: - Normalization

    @Test func curlyApostropheNormalizes() {
        // The feed emits a curly apostrophe here; the table is keyed with a
        // straight one, so normalization must bridge the two.
        #expect(VenueAtlas.location(for: "Children\u{2019}s School") != nil)
    }

    @Test func caseAndWhitespaceAreNormalized() {
        #expect(VenueAtlas.location(for: "  amphitheater  ") != nil)
        #expect(VenueAtlas.location(for: "AMPHITHEATER") != nil)
    }

    // MARK: - Unknown / unmappable

    @Test func unknownVenueIsNil() {
        #expect(VenueAtlas.location(for: "Some Made Up Place") == nil)
    }

    @Test func unmappableFeedNamesAreNil() {
        for name in ["TBD", "Zoom", "Washington, DC", "Chautauqua Institution", "Denominational Houses (Selected)"] {
            #expect(VenueAtlas.location(for: name) == nil, "'\(name)' should not resolve")
        }
    }

    // MARK: - Table integrity

    @Test func allEntryCountMatchesResearch() {
        // 54 buildings: 46 high confidence, 6 medium, 2 low (see
        // venue-coordinates.json). This pins the transcription didn't drop
        // or duplicate an entry.
        #expect(VenueAtlas.all.count == 54)
    }

    @Test func allIdsAreUnique() {
        let ids = VenueAtlas.all.map(\.id)
        #expect(Set(ids).count == ids.count)
    }

    // MARK: - feedNames (inverse lookup, #182)

    @Test func feedNamesReturnsAllRoomLevelNamesForABuilding() throws {
        let hultquist = try #require(VenueAtlas.location(for: "Hultquist 101"))
        let feedNames = VenueAtlas.feedNames(forVenueID: hultquist.id)
        #expect(Set(feedNames) == ["Hultquist 101", "Hultquist Porch"])
    }

    @Test func feedNamesRoundTripsThroughLocationFor() {
        // Every feed name a venue reports must itself resolve back to that
        // same venue - the whole point of the table being an alias index.
        for venue in VenueAtlas.all {
            for feedName in VenueAtlas.feedNames(forVenueID: venue.id) {
                #expect(VenueAtlas.location(for: feedName)?.id == venue.id)
            }
        }
    }

    @Test func feedNamesIsEmptyForAnUnknownVenueID() {
        #expect(VenueAtlas.feedNames(forVenueID: "not-a-real-venue").isEmpty)
    }

    @Test func groundsCenterMatchesResearch() {
        #expect(abs(VenueAtlas.groundsCenter.latitude - 42.2097) < 0.0001)
        #expect(abs(VenueAtlas.groundsCenter.longitude - (-79.4665)) < 0.0001)
    }
}
