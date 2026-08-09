import Foundation
import Testing
@testable import ChqCalendar

/// Pins every spoken dialog shape for the #193 Siri surface. These are the
/// strings Siri reads aloud — changes here are user-facing copy changes.
struct IntentDialogTextTests {
    private var amp: Event {
        makeEvent(id: "a", start: ChqTime.parse("2026-07-14 20:15:00")!,
                  title: "An Evening with Yo-Yo Ma", location: "Amphitheater")
    }

    @Test func nextUpWithKind() {
        let s = IntentDialogText.nextUp(kindTitle: "symphony concerts", event: amp)
        #expect(s == "Next for symphony concerts: An Evening with Yo-Yo Ma — Tuesday, July 14 at 8:15 PM, Amphitheater.")
    }

    @Test func nextUpWithoutKindOrVenue() {
        let e = makeEvent(id: "b", start: ChqTime.parse("2026-07-14 20:15:00")!, title: "Mystery Event")
        #expect(IntentDialogText.nextUp(kindTitle: nil, event: e)
            == "Next up: Mystery Event — Tuesday, July 14 at 8:15 PM.")
    }

    @Test func listSummaryCountsAndNamesTheFirst() {
        let s = IntentDialogText.listSummary(count: 4, kindTitle: "movies", timeframeLabel: "this week", first: amp)
        #expect(s == "4 movies this week — first: An Evening with Yo-Yo Ma, Tuesday, July 14 at 8:15 PM.")
    }

    @Test func listSummaryWithoutKindSaysEvents() {
        let s = IntentDialogText.listSummary(count: 12, kindTitle: nil, timeframeLabel: "tomorrow", first: amp)
        #expect(s.hasPrefix("12 events tomorrow — first: "))
    }

    @Test func noMatchWithNextSuggestsIt() {
        let s = IntentDialogText.noMatch(kindTitle: "movies", timeframeLabel: "tonight", next: amp)
        #expect(s == "No movies tonight. Next one: Tuesday, July 14 at 8:15 PM.")
    }

    @Test func noMatchWithoutNextOrTimeframe() {
        #expect(IntentDialogText.noMatch(kindTitle: nil, timeframeLabel: nil, next: nil)
            == "No events coming up.")
    }

    @Test func whoIsSpeakingLeadsWithPresenter() {
        let e = makeEvent(id: "c", start: ChqTime.parse("2026-07-15 10:45:00")!,
                          title: "The Future of Democracy", location: "Amphitheater", presenter: "Jane Goodall")
        #expect(IntentDialogText.whoIsSpeaking(event: e)
            == "Jane Goodall speaks Wednesday, July 15 at 10:45 AM in the Amphitheater: The Future of Democracy.")
    }

    @Test func whoIsSpeakingWithoutPresenterFallsBackToNextUp() {
        let e = makeEvent(id: "d", start: ChqTime.parse("2026-07-15 10:45:00")!,
                          title: "Morning Lecture", location: "Amphitheater")
        #expect(IntentDialogText.whoIsSpeaking(event: e)
            == IntentDialogText.nextUp(kindTitle: "lectures", event: e))
    }

    @Test func showTime() {
        #expect(IntentDialogText.showTime(slotLabel: "evening show", event: amp)
            == "The evening show Tuesday, July 14 is An Evening with Yo-Yo Ma at 8:15 PM.")
    }

    @Test func myScheduleListsUpToThreeTitles() {
        let e1 = makeEvent(id: "1", start: ChqTime.parse("2026-07-15 09:00:00")!, title: "A")
        let e2 = makeEvent(id: "2", start: ChqTime.parse("2026-07-15 10:00:00")!, title: "B")
        #expect(IntentDialogText.mySchedule(timeframeLabel: "tomorrow", events: [e1, e2])
            == "You have 2 starred events tomorrow: A, B.")
        #expect(IntentDialogText.mySchedule(timeframeLabel: "today", events: [e1])
            == "You have 1 starred event today: A.")
        #expect(IntentDialogText.mySchedule(timeframeLabel: "today", events: [])
            == "Nothing starred for today yet.")
    }

    @Test func themeAndNoTheme() {
        let summary = WeekThemeSummary(weekNumber: 7, title: "The Human Brain", dateRange: "August 8–15")
        #expect(IntentDialogText.theme(summary: summary) == "Week 7 (August 8–15): The Human Brain.")
        #expect(IntentDialogText.noTheme() == "No theme is listed for that week.")
    }

    @Test func offSeasonMessages() throws {
        let start = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        #expect(IntentDialogText.offSeason(.preSeason(start: start), year: 2026)
            == "The 2026 season starts \(ChqTime.dayTitle(for: start)).")
        #expect(IntentDialogText.offSeason(.postSeason, year: 2026)
            == "The 2026 season has ended. Check back when next season is announced.")
        #expect(IntentDialogText.offSeason(.inSeason, year: 2026) == nil)
    }

    @Test func coldCache() {
        #expect(IntentDialogText.coldCache()
            == "Open CHQ Calendar once to load the season schedule, then ask again.")
    }
}
