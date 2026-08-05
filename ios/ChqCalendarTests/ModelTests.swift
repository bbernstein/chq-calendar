import Foundation
import Testing
@testable import ChqCalendar

struct ModelTests {
    // MARK: - EventEnvelope / lossy decoding

    @Test func envelopeSkipsInvalidEvent() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        #expect(envelope.data.count == 5)
    }

    @Test func kayakEventFieldsAllMapped() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let kayak = try #require(envelope.data.first { $0.id == "101037" })

        #expect(kayak.title == "Guided Kayak Eco Tour")
        #expect(kayak.displayLocation == "Sports Club, Waterfront")
        #expect(kayak.venueAddress == nil)
        #expect(kayak.categoryNames == ["Chautauqua Institution Program", "Recreation"])
        #expect(kayak.cost == "$12")
        #expect(kayak.week == 5)
        #expect(kayak.status == .scheduled)
        #expect(kayak.imageURL?.absoluteString.hasSuffix("-700x241.jpg") == true)
        #expect(kayak.filterTokens.contains("recreation"))
        #expect(kayak.pageURL?.absoluteString == "https://www.chq.org/event/guided-kayak-eco-tour-4/")
    }

    @Test func minimalEventDecodes() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let minimal = try #require(envelope.data.first { $0.id == "200001" })
        #expect(minimal.title == "Minimal Event")
        #expect(minimal.details == nil)
        #expect(minimal.displayLocation == nil)
        #expect(minimal.categoryNames.isEmpty)
        #expect(minimal.status == .scheduled)
    }

    @Test func entityDecodedTitleAndLocation() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let event = try #require(envelope.data.first { $0.id == "200002" })
        #expect(event.title == "Art & Music")
        #expect(event.displayLocation == "Bestor Plaza\u{2019}s Amphitheater")
    }

    @Test func cancelledStatusDecodes() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let event = try #require(envelope.data.first { $0.id == "200003" })
        #expect(event.status == .cancelled)
    }

    @Test func tSeparatorDateParses() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let event = try #require(envelope.data.first { $0.id == "200004" })
        #expect(ChqTime.dayKey(for: event.start) == "2026-07-04")
    }

    // MARK: - ChqTime

    @Test func parseSpaceSeparatedDate() throws {
        let date = try #require(ChqTime.parse("2026-07-27 12:45:00"))
        #expect(date == Date(timeIntervalSince1970: 1_785_170_700))
    }

    @Test func parseTSeparatedDate() throws {
        let date = try #require(ChqTime.parse("2026-07-04T15:30:00"))
        #expect(ChqTime.dayKey(for: date) == "2026-07-04")
    }

    @Test func dayKeyIsNYPinnedRegardlessOfProcessZone() throws {
        let date = try #require(ChqTime.parse("2026-07-27 12:45:00"))
        #expect(ChqTime.dayKey(for: date) == "2026-07-27")
    }

    @Test func dayTitleFormat() throws {
        let date = try #require(ChqTime.parse("2026-07-27 12:45:00"))
        #expect(ChqTime.dayTitle(for: date) == "Monday, July 27")
    }

    @Test func timeStringFormat() throws {
        let date = try #require(ChqTime.parse("2026-07-27 12:45:00"))
        #expect(ChqTime.timeString(for: date) == "12:45 PM")
    }

    @Test func endOfDayIsLastMomentOfNYDay() throws {
        let date = try #require(ChqTime.parse("2026-07-27 12:45:00"))
        let end = ChqTime.endOfDay(date)
        #expect(ChqTime.dayKey(for: end) == "2026-07-27")
        #expect(end > date)
    }

    // MARK: - HTML entities

    @Test func decodesCommonEntities() {
        #expect("Art &amp; Music".decodingHTMLEntities == "Art & Music")
        #expect("Tom &amp; Jerry&#8217;s".decodingHTMLEntities == "Tom & Jerry\u{2019}s")
        #expect("&quot;Quoted&quot;".decodingHTMLEntities == "\"Quoted\"")
        #expect("It&#039;s".decodingHTMLEntities == "It's")
        #expect("5 &lt; 10 &gt; 2".decodingHTMLEntities == "5 < 10 > 2")
        #expect("a&nbsp;b".decodingHTMLEntities == "a\u{00A0}b")
        #expect("&#8211;".decodingHTMLEntities == "\u{2013}")
    }

    // MARK: - Sidecars

    @Test func articleLinksFileDecodes() throws {
        let file = try JSONDecoder().decode(ArticleLinksFile.self, from: fixtureData("article-links-sample"))
        let links = try #require(file.links["101037"])
        #expect(links.count == 1)
        #expect(links[0].title == "Sample preview")
        #expect(links[0].kind == .preview)
    }

    @Test func weeklyThemesFileDecodes() throws {
        let file = try JSONDecoder().decode(WeeklyThemesFile.self, from: fixtureData("themes-sample"))
        #expect(file.weeks.count == 9)
        #expect(file.weeks[0].startDate == "2026-06-27")
    }

    @Test func yearsManifestDecodes() throws {
        let manifest = try JSONDecoder().decode(YearsManifest.self, from: fixtureData("years"))
        #expect(manifest.years == [2025, 2026, 2027])
        #expect(manifest.defaultYear == 2026)
    }

    @Test func programLinksFileDecodesFixture() throws {
        let file = try JSONDecoder().decode(ProgramLinksFile.self, from: fixtureData("program-links-sample"))
        #expect(file.links["event-1"]?.count == 1)
        #expect(file.links["event-1"]?.first?.title == "Best For Baby")
        #expect(
            file.links["event-1"]?.first?.url.absoluteString
                == "https://audienceaccess.co/show/CHQ-16426"
        )
    }

    @Test func programLinksFileDropsMalformedEntriesLossily() throws {
        let file = try JSONDecoder().decode(ProgramLinksFile.self, from: fixtureData("program-links-sample"))
        // The url-less entry is dropped, not fatal to the whole file.
        #expect(file.links["event-2"] == [])
    }
}
