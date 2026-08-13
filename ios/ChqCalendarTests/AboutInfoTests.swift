import Foundation
import Testing
@testable import ChqCalendar

struct AboutInfoTests {
    // MARK: - versionString

    @Test func versionStringCombinesShortVersionAndBuild() {
        #expect(AboutInfo.versionString(shortVersion: "1.0", build: "2") == "Version 1.0 (2)")
    }

    @Test func versionStringOmitsBuildWhenMissing() {
        #expect(AboutInfo.versionString(shortVersion: "1.0", build: nil) == "Version 1.0")
    }

    @Test func versionStringFallsBackWhenShortVersionMissing() {
        // A bundle with no CFBundleShortVersionString is a packaging error,
        // but the About screen must still render rather than crash.
        #expect(AboutInfo.versionString(shortVersion: nil, build: "2") == "Version unknown")
        #expect(AboutInfo.versionString(shortVersion: nil, build: nil) == "Version unknown")
    }

    @Test func versionStringTreatsBlankValuesAsMissing() {
        #expect(AboutInfo.versionString(shortVersion: "  ", build: "2") == "Version unknown")
        #expect(AboutInfo.versionString(shortVersion: "1.0", build: "  ") == "Version 1.0")
    }

    // MARK: - disclaimer

    @Test func disclaimerStatesNoAffiliationAndNamesChqAsAuthoritative() {
        // Pinned because this exact wording is what the App Store listing,
        // the website, and App Review Notes all repeat. Drift here weakens
        // the Guideline 5.2.1 position.
        #expect(AboutInfo.disclaimer.contains("not affiliated with, endorsed by, or sponsored by Chautauqua Institution"))
        #expect(AboutInfo.disclaimer.contains("chq.org remains the authoritative source"))
    }

    // MARK: - links

    @Test func linksCoverPrivacySupportAndChqOrg() {
        let urls = AboutInfo.links.map(\.url.absoluteString)
        #expect(urls.contains("https://www.chqcal.org/privacy"))
        #expect(urls.contains("https://www.chqcal.org/support"))
        #expect(urls.contains("https://www.chq.org"))
    }

    @Test func linkIdentifiersAreUnique() {
        let ids = AboutInfo.links.map(\.id)
        #expect(Set(ids).count == ids.count)
    }

    @Test func everyLinkHasATitle() {
        #expect(AboutInfo.links.allSatisfy { !$0.title.isEmpty })
    }

    /// The About sheet is the only in-app route to the guide site, so the
    /// link has to be present and has to point at the iOS-specific page
    /// rather than the cross-platform overview.
    @Test func linksLeadWithTheGuide() throws {
        let first = try #require(AboutInfo.links.first)
        #expect(first.id == "guide")
        #expect(first.title == "Guide & Features")
        #expect(first.url.absoluteString == "https://www.chqcal.org/about/iphone")
    }

    // MARK: - quickLinks

    @Test func quickLinksMatchTheWebHeader() {
        #expect(AboutInfo.quickLinks.map(\.id) == ["about", "feedback", "programs", "questions", "captions", "bus-tram-tracker", "chautauqua-fund"])
        // "Guide", not "About": the ellipsis menu renders these quick links
        // directly above an in-app "About" sheet button, and two items both
        // reading "About" made the menu ambiguous.
        #expect(AboutInfo.quickLinks.map(\.title) == ["Guide", "Feedback", "Programs", "Questions", "Captions", "Bus Tracker", "CHQ Fund"])
        #expect(AboutInfo.quickLinks.map { $0.url.absoluteString } == [
            "https://www.chqcal.org/about",
            "https://www.chqcal.org/feedback",
            "https://programs.chq.org/",
            "https://questions.chq.org/",
            "https://captions.chq.org/",
            "https://busandtramtracker.chq.org",
            "https://giving.chq.org/",
        ])
    }

    /// The cross-platform source of truth is shared/links.json (also
    /// consumed by the web header via frontend/src/lib/quickLinks.ts).
    /// This test reads it from the repo checkout so any drift between the
    /// Swift list and the JSON fails CI on either side.
    @Test func quickLinksMatchSharedLinksJson() throws {
        struct SharedLinksFile: Decodable {
            struct SharedLink: Decodable {
                let id: String
                let title: String
                let url: String
            }
            let quickLinks: [SharedLink]
        }

        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // AboutInfoTests.swift
            .deletingLastPathComponent() // ChqCalendarTests
            .deletingLastPathComponent() // ios
        let jsonURL = repoRoot.appendingPathComponent("shared/links.json")
        let data = try Data(contentsOf: jsonURL)
        let shared = try JSONDecoder().decode(SharedLinksFile.self, from: data)

        #expect(AboutInfo.quickLinks.map(\.id) == shared.quickLinks.map(\.id))
        #expect(AboutInfo.quickLinks.map(\.title) == shared.quickLinks.map(\.title))
        #expect(AboutInfo.quickLinks.map { $0.url.absoluteString } == shared.quickLinks.map(\.url))
    }

    @Test func quickLinksAreDistinctFromTheAboutSheetLinks() {
        let aboutIDs = Set(AboutInfo.links.map(\.id))
        #expect(Set(AboutInfo.quickLinks.map(\.id)).isDisjoint(with: aboutIDs))
    }

    // MARK: - siriPhrases

    @Test func siriPhrasesQuoteSpokenFormsWithAnAppName() {
        #expect(!AboutInfo.siriPhrases.isEmpty)
        for p in AboutInfo.siriPhrases {
            // Every listed phrase must contain a form Siri actually routes
            // on — the app name or an INAlternativeAppNames entry.
            #expect(p.phrase.contains("Chautauqua") || p.phrase.contains("CHQ"),
                    "phrase lacks an app name: \(p.phrase)")
        }
        #expect(Set(AboutInfo.siriPhrases.map(\.id)).count == AboutInfo.siriPhrases.count)
    }
}
