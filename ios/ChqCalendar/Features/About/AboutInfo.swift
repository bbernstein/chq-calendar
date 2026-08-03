import Foundation

/// Static content for the About screen, kept separate from the view so it
/// can be unit-tested without a view host — matching this project's
/// convention of testing logic rather than SwiftUI bodies.
///
/// The disclaimer text is duplicated in `docs/app-store/listing-fields.json`
/// (the App Store listing source of truth), on chqcal.org's /privacy and
/// /support pages, and in the site footer. A test in the frontend workspace
/// (`frontend/src/__tests__/appStoreListing.test.ts`) asserts all copies
/// match. If you change it here, change it everywhere.
enum AboutInfo {
    static let disclaimer = """
        CHQ Calendar is an independent app and is not affiliated with, endorsed by, or sponsored by Chautauqua Institution. Event information is drawn from publicly posted listings; chq.org remains the authoritative source.
        """

    struct Link: Identifiable, Equatable {
        let id: String
        let title: String
        let url: URL
    }

    static let links: [Link] = [
        Link(id: "privacy", title: "Privacy Policy", url: URL(string: "https://www.chqcal.org/privacy")!),
        Link(id: "support", title: "Support", url: URL(string: "https://www.chqcal.org/support")!),
        Link(id: "chq", title: "Chautauqua Institution", url: URL(string: "https://www.chq.org")!),
    ]

    /// Destinations surfaced directly from the calendar toolbar, matching
    /// the web header's buttons (frontend/src/components/layout/Header.tsx).
    /// Kept separate from `links`, which are the About sheet's legal and
    /// attribution links.
    static let quickLinks: [Link] = [
        Link(id: "feedback", title: "Feedback", url: URL(string: "https://www.chqcal.org/feedback")!),
        Link(id: "programs", title: "Programs", url: URL(string: "https://programs.chq.org/")!),
        Link(id: "questions", title: "Questions", url: URL(string: "https://questions.chq.org/")!),
    ]

    /// Formats the marketing version and build number for display.
    ///
    /// Blank strings are treated as missing: a bundle key present but empty
    /// would otherwise render as "Version  ()".
    static func versionString(shortVersion: String?, build: String?) -> String {
        let version = shortVersion?.trimmingCharacters(in: .whitespaces)
        guard let version, !version.isEmpty else { return "Version unknown" }

        let buildNumber = build?.trimmingCharacters(in: .whitespaces)
        guard let buildNumber, !buildNumber.isEmpty else { return "Version \(version)" }

        return "Version \(version) (\(buildNumber))"
    }

    /// Convenience over the main bundle, for the view to call.
    static func versionString(bundle: Bundle = .main) -> String {
        versionString(
            shortVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        )
    }
}
