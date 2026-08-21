import Foundation
import Testing
@testable import ChqCalendar

struct DeepLinkTests {
    // MARK: - Round trip

    @Test func eventRoundTrips() {
        let link = DeepLink.event(id: "101037")
        #expect(DeepLink.parse(link.url) == link)
    }

    @Test func myDayRoundTrips() {
        let link = DeepLink.myDay
        #expect(DeepLink.parse(link.url) == link)
    }

    @Test func mapWithNoVenueRoundTrips() {
        let link = DeepLink.map(venue: nil)
        #expect(DeepLink.parse(link.url) == link)
    }

    @Test func mapWithVenueRoundTrips() {
        let link = DeepLink.map(venue: "Amphitheater")
        #expect(DeepLink.parse(link.url) == link)
    }

    @Test func mapWithVenueContainingSpacesAndCommasRoundTrips() {
        let link = DeepLink.map(venue: "Sports Club, Waterfront")
        #expect(DeepLink.parse(link.url) == link)
    }

    @Test func dayRoundTrips() {
        let link = DeepLink.day(key: "2026-07-29")
        #expect(DeepLink.parse(link.url) == link)
    }

    @Test func dayURLHasExpectedShape() {
        #expect(DeepLink.day(key: "2026-07-29").url.absoluteString == "chqcal://day/2026-07-29")
    }

    /// `ChqTime.parse` is more permissive than its format string suggests —
    /// `"2026-7-9"` reads as July 9th and `"26-07-09"` reads as year 26 — and
    /// neither is a key `EventFilter`'s raw string comparisons will ever
    /// match. A link carrying one must be rejected at the door rather than
    /// silently resolving to a day the list cannot show.
    @Test func dayWithANonCanonicalKeyIsRejected() {
        #expect(DeepLink.parse(URL(string: "chqcal://day/2026-7-9")!) == nil)
        #expect(DeepLink.parse(URL(string: "chqcal://day/26-07-09")!) == nil)
        #expect(DeepLink.parse(URL(string: "chqcal://day/tomorrow")!) == nil)
    }

    @Test func dayWithNoKeyIsRejected() {
        #expect(DeepLink.parse(URL(string: "chqcal://day")!) == nil)
        #expect(DeepLink.parse(URL(string: "chqcal://day/")!) == nil)
    }

    // MARK: - URL shape

    @Test func eventURLHasExpectedShape() {
        let link = DeepLink.event(id: "101037")
        #expect(link.url.absoluteString == "chqcal://event/101037")
    }

    @Test func myDayURLHasExpectedShape() {
        #expect(DeepLink.myDay.url.absoluteString == "chqcal://my-day")
    }

    @Test func mapURLWithNoVenueHasExpectedShape() {
        #expect(DeepLink.map(venue: nil).url.absoluteString == "chqcal://map")
    }

    @Test func mapURLWithVenueIsPercentEncoded() {
        let link = DeepLink.map(venue: "Sports Club, Waterfront")
        let url = link.url
        #expect(url.absoluteString == "chqcal://map/Sports%20Club,%20Waterfront"
            || url.absoluteString.hasPrefix("chqcal://map/Sports%20Club%2C%20Waterfront"))
    }

    // MARK: - Rejections

    @Test func parseRejectsHTTPSScheme() {
        let url = URL(string: "https://event/101037")!
        #expect(DeepLink.parse(url) == nil)
    }

    @Test func parseRejectsUnknownHost() {
        let url = URL(string: "chqcal://unknown")!
        #expect(DeepLink.parse(url) == nil)
    }

    @Test func parseRejectsEmptyEventID() {
        let url = URL(string: "chqcal://event/")!
        #expect(DeepLink.parse(url) == nil)
    }

    @Test func parseRejectsMissingEventID() {
        let url = URL(string: "chqcal://event")!
        #expect(DeepLink.parse(url) == nil)
    }

    // MARK: - Parsing specifics

    @Test func parseDecodesPercentEncodedVenue() {
        let url = URL(string: "chqcal://map/Sports%20Club%2C%20Waterfront")!
        #expect(DeepLink.parse(url) == .map(venue: "Sports Club, Waterfront"))
    }

    @Test func parseEventReadsIDFromPath() {
        let url = URL(string: "chqcal://event/abc-123")!
        #expect(DeepLink.parse(url) == .event(id: "abc-123"))
    }
}
