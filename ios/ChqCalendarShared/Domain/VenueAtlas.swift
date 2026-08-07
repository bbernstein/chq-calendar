import Foundation

/// A single building/place on the Chautauqua grounds, with a coordinate good
/// enough for walking-time estimates (not turn-by-turn navigation).
nonisolated struct VenueLocation: Equatable, Sendable, Identifiable {
    /// Canonical slug, e.g. "amphitheater". Stable — used as a map/list key.
    let id: String
    /// Display name, e.g. "Amphitheater".
    let name: String
    let latitude: Double
    let longitude: Double
}

/// Static table of Chautauqua Institution venues (coordinates + walking-time
/// math) backing the My Day planner (#181) and grounds map (#182).
///
/// Data source: OpenStreetMap (Overpass) + Nominatim, researched 2026-08-07
/// and recorded in
/// `.superpowers/sdd/2026-08-07-app-store-4.2-implementation-plan/venue-coordinates.json`.
/// 54 buildings cover all feed-name strings the live event data uses that
/// have a physical location; see `unmappable` in that file for the handful
/// that don't (TBD, Zoom, Washington DC, "Chautauqua Institution", and the
/// grouped "Denominational Houses (Selected)" listing) — those correctly
/// resolve to `nil` here.
///
/// Each entry's trailing comment carries its OSM/Nominatim source id and
/// confidence rating from that research file (`high` / `medium` / `low`);
/// `// estimated` marks the two `low`-confidence entries that have no direct
/// OSM feature and were approximated from a written description instead.
nonisolated enum VenueAtlas {
    /// One entry per building, sorted by display name.
    static let all: [VenueLocation] = venues.map(\.location).sorted { $0.name < $1.name }

    /// Grounds centroid — the map view's default camera target.
    static let groundsCenter: (latitude: Double, longitude: Double) = (42.2097, -79.4665)

    /// Resolves a raw feed location string (as it appears on `Event`) to its
    /// building. Normalizes (lowercase, curly `’` → straight `'`, trim) and
    /// looks up an exact match in the alias table built from known feed
    /// names — deliberately no fuzzy/prefix matching, so an unknown string
    /// always returns `nil` rather than guessing.
    static func location(for feedName: String) -> VenueLocation? {
        aliasIndex[normalize(feedName)]
    }

    /// The raw feed-name strings (as they appear on `Event.displayLocation`)
    /// that resolve to `venueID` — the inverse of `location(for:)`. A
    /// building that aggregates several room-level feed names (e.g.
    /// "Hultquist 101" and "Hultquist Porch" both under `hultquist-center`)
    /// returns all of them, which is what an exact-match location filter
    /// (`FilterSelection.selectedLocations`, compared case-insensitively in
    /// `EventFilter.apply`) needs to select every event at the building
    /// rather than just events tagged with its canonical display name.
    /// Empty for an unknown `venueID`.
    static func feedNames(forVenueID venueID: String) -> [String] {
        venues.first { $0.id == venueID }?.feedNames ?? []
    }

    /// Walking time between two venues: haversine great-circle distance,
    /// inflated by a 1.3x route factor (grid streets, building setbacks,
    /// walking around rather than through gardens), at a brisk 80 m/min
    /// pace, rounded up to the next whole minute. Zero for the same venue.
    static func walkingMinutes(from: VenueLocation, to: VenueLocation) -> Int {
        if from.id == to.id { return 0 }
        let meters = haversineMeters(
            lat1: from.latitude, lon1: from.longitude,
            lat2: to.latitude, lon2: to.longitude)
        let routeMeters = meters * 1.3
        let minutes = routeMeters / 80.0
        return Int(minutes.rounded(.up))
    }

    // MARK: - Normalization

    private static func normalize(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "\u{2019}", with: "'") // ’ -> '
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    // MARK: - Haversine

    private static func haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let earthRadiusMeters = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let rLat1 = lat1 * .pi / 180
        let rLat2 = lat2 * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(rLat1) * cos(rLat2) * sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return earthRadiusMeters * c
    }

    // MARK: - Table

    /// One row per building. `feedNames` are the exact strings the event
    /// feed uses (verbatim, including room-level names that resolve up to
    /// the building); the first is used as the display name's source data
    /// only insofar as `canonicalName` (below) already reflects it.
    private struct VenueRow {
        let id: String
        let canonicalName: String
        let latitude: Double
        let longitude: Double
        let feedNames: [String]

        var location: VenueLocation {
            VenueLocation(id: id, name: canonicalName, latitude: latitude, longitude: longitude)
        }
    }

    private static let venues: [VenueRow] = [
        VenueRow( // osm-way-619932539, confidence: high
            id: "amphitheater", canonicalName: "Amphitheater",
            latitude: 42.2083145, longitude: -79.4645537,
            feedNames: ["Amphitheater"]),
        VenueRow( // osm-node-6299443781, confidence: high
            id: "chautauqua-cinema", canonicalName: "Chautauqua Cinema",
            latitude: 42.2111068, longitude: -79.4697279,
            feedNames: ["Chautauqua Cinema"]),
        VenueRow( // osm-way-820060447, confidence: high
            id: "hall-of-philosophy", canonicalName: "Hall of Philosophy",
            latitude: 42.206508, longitude: -79.4632455,
            feedNames: ["Hall of Philosophy", "Hall of Philosophy Grove"]),
        VenueRow( // osm-node-13014159335;nominatim-55-clark-ave, confidence: high
            id: "chapel-of-the-good-shepherd", canonicalName: "Chapel of the Good Shepherd",
            latitude: 42.2071054, longitude: -79.4637511,
            feedNames: ["Chapel of the Good Shepherd", "Episcopal Chapel"]),
        VenueRow( // osm-way-820058876, confidence: high
            id: "hall-of-missions", canonicalName: "Hall of Missions",
            latitude: 42.2065441, longitude: -79.4639193,
            feedNames: ["Hall of Missions"]),
        VenueRow( // osm-way-1416154857, confidence: high
            id: "ucc-headquarters-randell-chapel", canonicalName: "UCC Headquarters (Randell Chapel)",
            latitude: 42.2086421, longitude: -79.4649046,
            feedNames: ["Randell Chapel, UCC Headquarters"]),
        VenueRow( // osm-way-820059527, confidence: high
            id: "hurlbut-church", canonicalName: "Hurlbut Church",
            latitude: 42.210163, longitude: -79.4678665,
            feedNames: ["Hurlbut Church sanctuary", "Hurlbut Marion Lawrance", "Hurlbut Truesdale"]),
        VenueRow( // osm-way-820057908, confidence: high
            id: "smith-wilkes-hall", canonicalName: "Smith Wilkes Hall",
            latitude: 42.2076256, longitude: -79.463602,
            feedNames: ["Smith Wilkes Hall"]),
        VenueRow( // osm-way-820059535, confidence: high
            id: "bratton-theater", canonicalName: "Bratton Theater",
            latitude: 42.2104205, longitude: -79.4682085,
            feedNames: ["Bratton Theater"]),
        VenueRow( // osm-way-680211973, confidence: high
            id: "hall-of-christ", canonicalName: "Hall of Christ",
            latitude: 42.2056406, longitude: -79.4638618,
            feedNames: ["Hall of Christ: Sanctuary"]),
        VenueRow( // osm-way-619932532, confidence: high
            id: "bestor-plaza", canonicalName: "Bestor Plaza",
            latitude: 42.2093747, longitude: -79.4661389,
            feedNames: ["Bestor Plaza"]),
        VenueRow( // osm-way-1198655730, confidence: high
            id: "miller-park", canonicalName: "Miller Park",
            latitude: 42.2105717, longitude: -79.4640839,
            feedNames: ["Miller Park"]),
        VenueRow( // osm-way-1416151230;nominatim-9-palestine-ave, confidence: high
            id: "presbyterian-house", canonicalName: "Presbyterian House",
            latitude: 42.2079588, longitude: -79.4640065,
            feedNames: ["Presbyterian House"]),
        VenueRow( // osm-way-1416151230 (same building as Presbyterian House, room-level), confidence: medium
            id: "presbyterian-chapel", canonicalName: "Presbyterian Chapel (in Presbyterian House)",
            latitude: 42.2079588, longitude: -79.4640065,
            feedNames: ["Presbyterian Chapel"]),
        VenueRow( // osm-way-820059627, confidence: high
            id: "elizabeth-s-lenna-hall", canonicalName: "Elizabeth S. Lenna Hall",
            latitude: 42.2099177, longitude: -79.4713114,
            feedNames: ["Elizabeth S. Lenna Hall"]),
        VenueRow( // osm-way-820060271, confidence: high
            id: "fletcher-music-hall", canonicalName: "Fletcher Music Hall",
            latitude: 42.2104315, longitude: -79.4716105,
            feedNames: ["Fletcher Music Hall"]),
        VenueRow( // osm-way-820058819, confidence: medium
            id: "sports-club", canonicalName: "Sports Club",
            latitude: 42.2091795, longitude: -79.462496,
            feedNames: ["Sports Club, Lawn Bowling Green", "Sports Club, Waterfront", "Sports Club"]),
        VenueRow( // osm-way-1416154858, confidence: high
            id: "hultquist-center", canonicalName: "Hultquist Center",
            latitude: 42.2088111, longitude: -79.4651387,
            feedNames: ["Hultquist 101", "Hultquist Porch"]),
        VenueRow( // osm-way-820059268, confidence: high
            id: "everett-jewish-life-center", canonicalName: "Everett Jewish Life Center",
            latitude: 42.2057865, longitude: -79.4661005,
            feedNames: ["Everett Jewish Life Center"]),
        VenueRow( // osm-way-820058858, confidence: high
            id: "lutheran-house", canonicalName: "Lutheran House",
            latitude: 42.206848, longitude: -79.463562,
            feedNames: ["Lutheran House"]),
        VenueRow( // osm-node-6040036973, confidence: high
            id: "sharpe-field", canonicalName: "Sharpe Field",
            latitude: 42.2043045, longitude: -79.4614781,
            feedNames: ["Sharpe Field"]),
        VenueRow( // osm-way-820059354, confidence: high
            id: "catholic-house", canonicalName: "Catholic House",
            latitude: 42.2078923, longitude: -79.465159,
            feedNames: ["Catholic House"]),
        VenueRow( // osm-way-1424773553, confidence: high
            id: "roe-green-theater-center", canonicalName: "Roe Green Theater Center",
            latitude: 42.2102364, longitude: -79.4728537,
            feedNames: ["Roe Green Theater Center"]),
        VenueRow( // osm-way-680211974, confidence: high
            id: "alumni-hall", canonicalName: "Alumni Hall",
            latitude: 42.2060468, longitude: -79.4644397,
            feedNames: ["Alumni Hall Porch", "Alumni Hall Ballroom"]),
        VenueRow( // osm-way-820056242, confidence: high
            id: "sherwood-marsh-studios", canonicalName: "Sherwood-Marsh Studios",
            latitude: 42.2109635, longitude: -79.471276,
            feedNames: ["Sherwood-Marsh 101"]),
        VenueRow( // osm-node-6299449220, confidence: high
            id: "norton-hall", canonicalName: "Norton Hall",
            latitude: 42.2105868, longitude: -79.4686765,
            feedNames: ["Norton Hall"]),
        VenueRow( // estimated (BTG's South End Ravine outdoor classrooms; approximated to The Ravine park feature), confidence: low
            id: "outdoor-classroom", canonicalName: "Outdoor Classroom (South End Ravine, near Bird Tree & Garden Club)",
            latitude: 42.2048631, longitude: -79.4632866,
            feedNames: ["Outdoor Classroom"]),
        VenueRow( // osm-way-820060204, confidence: high
            id: "mcknight-hall", canonicalName: "McKnight Hall",
            latitude: 42.209463, longitude: -79.4706547,
            feedNames: ["McKnight Hall"]),
        VenueRow( // osm-way-969673687, confidence: high
            id: "palestine-park", canonicalName: "Palestine Park",
            latitude: 42.2103188, longitude: -79.4629817,
            feedNames: ["Palestine Park"]),
        VenueRow( // osm-way-820059343, confidence: high
            id: "united-methodist-house", canonicalName: "United Methodist House",
            latitude: 42.2081655, longitude: -79.465701,
            feedNames: ["United Methodist House"]),
        VenueRow( // osm-way-820058851, confidence: high
            id: "episcopal-cottage", canonicalName: "Episcopal Cottage",
            latitude: 42.2070435, longitude: -79.4636935,
            feedNames: ["Episcopal Cottage"]),
        VenueRow( // osm-way-820058836, confidence: high
            id: "disciples-of-christ-house", canonicalName: "Disciples of Christ House",
            latitude: 42.2076239, longitude: -79.4645004,
            feedNames: ["Disciples of Christ House"]),
        VenueRow( // osm-way-1408189199, confidence: high
            id: "unitarian-universalist-fellowship", canonicalName: "Unitarian Universalist Fellowship",
            latitude: 42.2104275, longitude: -79.4664021,
            feedNames: ["Unitarian Universalist Fellowship"]),
        VenueRow( // osm-way-820059566, confidence: high
            id: "quaker-house", canonicalName: "Quaker House (Religious Society of Friends)",
            latitude: 42.208777, longitude: -79.4687645,
            feedNames: ["Quaker House"]),
        VenueRow( // osm-way-820059461, confidence: high
            id: "zigdon-chabad-jewish-house", canonicalName: "Zigdon Chabad Jewish House",
            latitude: 42.2089545, longitude: -79.4670935,
            feedNames: ["Chabad Jewish House"]),
        VenueRow( // estimated (described as on South Lake Drive in front of Heinz Fitness Center / Youth Activities Center, near Seaver Gym), confidence: low
            id: "heinz-beach", canonicalName: "Heinz Beach (waterfront in front of Heinz Fitness Center)",
            latitude: 42.2053, longitude: -79.46,
            feedNames: ["Heinz Beach"]),
        VenueRow( // osm-way-820058828, confidence: high
            id: "baptist-house", canonicalName: "Baptist House",
            latitude: 42.2075114, longitude: -79.4639448,
            feedNames: ["Baptist House"]),
        VenueRow( // osm-way-820058810, confidence: high
            id: "athenaeum-hotel", canonicalName: "Athenaeum Hotel",
            latitude: 42.2082364, longitude: -79.4633392,
            feedNames: ["Athenaeum Parlor", "Athenaeum Porch", "Heirloom (at Athenaeum)", "Athenaeum Hotel"]),
        VenueRow( // osm-node-7967774018, confidence: high
            id: "turner-community-center", canonicalName: "Turner Community Center (outside main gate, Route 394)",
            latitude: 42.2107149, longitude: -79.4744905,
            feedNames: ["Turner (Outside of Building)", "Turner Lobby", "Turner Conference Room"]),
        VenueRow( // nominatim-19-prospect-ave (Joan R Lincoln Ceramics Center), confidence: medium
            id: "cva-arts-quad", canonicalName: "CVA Arts Quad (Chautauqua Institution School of Art / Ceramics Center area)",
            latitude: 42.2119627, longitude: -79.4706542,
            feedNames: ["CVA: Arts Quad"]),
        VenueRow( // osm-way-820056246, confidence: high
            id: "strohl-art-center", canonicalName: "Strohl Art Center",
            latitude: 42.2098155, longitude: -79.4682289,
            feedNames: ["Strohl Art Center 2nd Floor", "Strohl Art Center: Main Galleries"]),
        VenueRow( // osm-way-701378760, confidence: high
            id: "3-taps", canonicalName: "3 Taps",
            latitude: 42.211135, longitude: -79.4621342,
            feedNames: ["3 Taps"]),
        VenueRow( // osm-way-820059455, confidence: high
            id: "christian-science-house", canonicalName: "Christian Science House",
            latitude: 42.2091751, longitude: -79.4664086,
            feedNames: ["Christian Science House"]),
        VenueRow( // nominatim-40-scott-ave, confidence: high
            id: "african-american-heritage-house", canonicalName: "African American Heritage House",
            latitude: 42.2098907, longitude: -79.4693207,
            feedNames: ["AAHH African American Heritage House"]),
        VenueRow( // osm-way-820059526, confidence: high
            id: "fowler-kellogg-art-center", canonicalName: "Fowler-Kellogg Art Center",
            latitude: 42.2099915, longitude: -79.4676735,
            feedNames: ["Fowler-Kellogg Art Center: 1st Floor", "Fowler-Kellogg Art Center 2nd floor"]),
        VenueRow( // osm-way-680211976, confidence: high
            id: "childrens-school", canonicalName: "Children's School",
            latitude: 42.211887, longitude: -79.4701233,
            feedNames: ["Children's School"]),
        VenueRow( // nominatim-52-south-ave, confidence: high
            id: "oliver-archives-center", canonicalName: "Oliver Archives Center",
            latitude: 42.2054035, longitude: -79.4657281,
            feedNames: ["Oliver Archives Center"]),
        VenueRow( // estimated (adjacent to/outside Strohl Art Center), confidence: medium
            id: "melvin-johnson-sculpture-garden", canonicalName: "Melvin Johnson Sculpture Garden",
            latitude: 42.20975, longitude: -79.46805,
            feedNames: ["Melvin Johnson Sculpture Garden"]),
        VenueRow( // osm-way-820058528, confidence: high
            id: "carnahan-jackson-dance-studios", canonicalName: "Carnahan-Jackson Dance Studios",
            latitude: 42.211688, longitude: -79.4721325,
            feedNames: ["Carnahan-Jackson: McBride/Verdy", "Carnahan-Jackson: Verdy"]),
        VenueRow( // nominatim-30-south-lake-drive, confidence: medium
            id: "chautauqua-womens-club", canonicalName: "Chautauqua Women's Club",
            latitude: 42.2080115, longitude: -79.4626304,
            feedNames: ["Women's Club"]),
        VenueRow( // osm-way-678505375, confidence: high
            id: "john-r-turney-sailing-center", canonicalName: "John R. Turney Sailing Center",
            latitude: 42.2030486, longitude: -79.4593378,
            feedNames: ["John R. Turney Sailing Center"]),
        VenueRow( // osm-way-134799985, confidence: high
            id: "chautauqua-golf-club", canonicalName: "Chautauqua Golf Club",
            latitude: 42.1992403, longitude: -79.4687759,
            feedNames: ["Chautauqua Golf Club"]),
        VenueRow( // estimated (Literary Arts Center at Alumni Hall, south end of grounds on Wythe Ave, across from Hall of Philosophy), confidence: medium
            id: "literary-arts-grove", canonicalName: "Literary Arts Grove (near Alumni Hall, Wythe Ave)",
            latitude: 42.2060468, longitude: -79.4644397,
            feedNames: ["Literary Arts Grove"]),
        VenueRow( // osm-way-641329576, confidence: high
            id: "colonnade-steps", canonicalName: "Colonnade Steps (The Colonnade)",
            latitude: 42.210083, longitude: -79.4666449,
            feedNames: ["Colonnade Steps"]),
    ]

    /// Normalized feed name -> venue, flattened from `venues[].feedNames`.
    private static let aliasIndex: [String: VenueLocation] = {
        var index: [String: VenueLocation] = [:]
        for row in venues {
            let location = row.location
            for feedName in row.feedNames {
                index[normalize(feedName)] = location
            }
        }
        return index
    }()
}
