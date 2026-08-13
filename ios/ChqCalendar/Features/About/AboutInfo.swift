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
        Link(id: "guide", title: "Guide & Features", url: URL(string: "https://www.chqcal.org/about/iphone")!),
        Link(id: "privacy", title: "Privacy Policy", url: URL(string: "https://www.chqcal.org/privacy")!),
        Link(id: "support", title: "Support", url: URL(string: "https://www.chqcal.org/support")!),
        Link(id: "chq", title: "Chautauqua Institution", url: URL(string: "https://www.chq.org")!),
    ]

    /// Destinations surfaced directly from the calendar toolbar, matching
    /// the web header's buttons (frontend/src/components/layout/Header.tsx).
    /// Kept separate from `links`, which are the About sheet's legal and
    /// attribution links.
    ///
    /// The cross-platform source of truth is `shared/links.json` at the
    /// repo root — the web header renders directly from it, and
    /// `AboutInfoTests.quickLinksMatchSharedLinksJson` asserts this list
    /// matches it. If you change one, change the other.
    static let quickLinks: [Link] = [
        Link(id: "about", title: "Guide", url: URL(string: "https://www.chqcal.org/about")!),
        Link(id: "feedback", title: "Feedback", url: URL(string: "https://www.chqcal.org/feedback")!),
        Link(id: "programs", title: "Programs", url: URL(string: "https://programs.chq.org/")!),
        Link(id: "questions", title: "Questions", url: URL(string: "https://questions.chq.org/")!),
        Link(id: "captions", title: "Captions", url: URL(string: "https://captions.chq.org/")!),
        Link(id: "bus-tram-tracker", title: "Bus Tracker", url: URL(string: "https://busandtramtracker.chq.org")!),
        Link(id: "chautauqua-fund", title: "CHQ Fund", url: URL(string: "https://giving.chq.org/")!),
    ]

    /// Example Siri phrases surfaced on the About sheet (#193). These
    /// quote the *spoken* forms — including the "Chautauqua" alternative
    /// app name — matching the registered `ChqShortcuts` phrase templates
    /// (quote phrases, not intent titles; see ChqShortcuts.swift).
    struct SiriPhrase: Identifiable, Equatable {
        let id: String
        let phrase: String
    }

    static let siriPhrases: [SiriPhrase] = [
        SiriPhrase(id: "next", phrase: "What's coming up in Chautauqua?"),
        SiriPhrase(id: "movies", phrase: "What movies are playing in Chautauqua?"),
        SiriPhrase(id: "symphony", phrase: "What's the next symphony in Chautauqua?"),
        SiriPhrase(id: "tonight", phrase: "What's happening tonight in Chautauqua?"),
        SiriPhrase(id: "speaking", phrase: "Who is speaking tomorrow in Chautauqua?"),
        SiriPhrase(id: "theme", phrase: "What's the theme this week in Chautauqua?"),
        SiriPhrase(id: "myday", phrase: "What am I doing tomorrow in Chautauqua?"),
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
