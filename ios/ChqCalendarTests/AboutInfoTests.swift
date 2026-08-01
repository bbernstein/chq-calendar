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
}
