import Foundation
import Testing
@testable import ChqCalendar

/// Pins `DeepLinkTabRoute.resolve` — the tab shell's pure "which tab, is
/// the link consumed by the switch, and what venue survives" decision
/// (task 16). The two-phase consumption contract these tests pin:
/// `.event` must NOT be consumed by the tab switch (CalendarView resolves
/// it against a snapshot that may not have loaded yet); `.myDay`/`.map`
/// must be consumed by it (the tab selection is the whole navigation).
struct DeepLinkTabRouteTests {
    @Test func eventRoutesToEventsTabWithoutConsumingTheLink() {
        let route = DeepLinkTabRoute.resolve(.event(id: "101037"))
        #expect(route.tab == .events)
        #expect(route.consumesLink == false)
        #expect(route.mapFocusVenue == nil)
    }

    @Test func myDayRoutesToMyDayTabAndConsumesTheLink() {
        let route = DeepLinkTabRoute.resolve(.myDay)
        #expect(route.tab == .myDay)
        #expect(route.consumesLink == true)
        #expect(route.mapFocusVenue == nil)
    }

    @Test func mapWithoutVenueRoutesToMapTabConsumedWithNilFocus() {
        let route = DeepLinkTabRoute.resolve(.map(venue: nil))
        #expect(route.tab == .map)
        #expect(route.consumesLink == true)
        #expect(route.mapFocusVenue == nil)
    }

    @Test func mapWithVenueRoutesToMapTabConsumedCarryingTheVenue() {
        let route = DeepLinkTabRoute.resolve(.map(venue: "Amphitheater"))
        #expect(route.tab == .map)
        #expect(route.consumesLink == true)
        #expect(route.mapFocusVenue == "Amphitheater")
    }

    /// A venue that came in percent-encoded is already decoded by
    /// `DeepLink.parse` — the route must pass it through verbatim, not
    /// re-encode or trim it.
    @Test func mapVenueWithSpacesAndCommasPassesThroughVerbatim() {
        guard let url = URL(string: "chqcal://map/Sports%20Club%2C%20Waterfront"),
              let link = DeepLink.parse(url)
        else {
            Issue.record("failed to build/parse the map deep link")
            return
        }
        let route = DeepLinkTabRoute.resolve(link)
        #expect(route.tab == .map)
        #expect(route.mapFocusVenue == "Sports Club, Waterfront")
    }

    /// `.day` behaves like `.event`, not like `.myDay`: selecting the Events
    /// tab is not the navigation, so the link must survive the tab switch for
    /// `EventListView` to consume once a snapshot exists.
    @Test func dayLinkRoutesToEventsWithoutConsumingTheLink() {
        let route = DeepLinkTabRoute.resolve(.day(key: "2026-07-29"))

        #expect(route.tab == .events)
        #expect(route.consumesLink == false)
        #expect(route.mapFocusVenue == nil)
    }
}
