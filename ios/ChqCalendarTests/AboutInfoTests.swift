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

    // MARK: - quickLinks

    @Test func quickLinksMatchTheWebHeader() {
        #expect(AboutInfo.quickLinks.map(\.id) == ["feedback", "programs", "questions", "bus-tram-tracker", "chautauqua-fund"])
        #expect(AboutInfo.quickLinks.map(\.title) == ["Feedback", "Programs", "Questions", "Bus & Tram Tracker", "Chautauqua Fund"])
        #expect(AboutInfo.quickLinks.map { $0.url.absoluteString } == [
            "https://www.chqcal.org/feedback",
            "https://programs.chq.org/",
            "https://questions.chq.org/",
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
}
