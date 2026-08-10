import Foundation

/// A remote payload the app fetches from the CDN. `path` is relative to
/// `LiveCalendarAPI`'s base URL; `cacheKey` is the identifier used to store
/// the payload via `DataCaching`.
///
/// `.version` is never cached — its `cacheKey` is unused (there is no
/// corresponding `EventRepository` entry point that writes it to disk).
nonisolated enum RemoteResource: Sendable, Hashable {
    case years
    case events(year: Int)
    case articleLinks(year: Int)
    case programLinks(year: Int)
    case weeklyThemes(year: Int)
    case version

    var path: String {
        switch self {
        case .years:
            return "/cache/calendar-cache/years.json"
        case .events(let year):
            return "/cache/calendar-cache/all-events-\(year).json"
        case .articleLinks(let year):
            return "/cache/calendar-cache/article-links-\(year).json"
        case .programLinks(let year):
            return "/cache/calendar-cache/program-links-\(year).json"
        case .weeklyThemes(let year):
            return "/data/weekly-themes/\(year).json"
        case .version:
            return "/version.json"
        }
    }

    var cacheKey: String {
        switch self {
        case .years:
            return "years"
        case .events(let year):
            return "events-\(year)"
        case .articleLinks(let year):
            return "article-links-\(year)"
        case .programLinks(let year):
            return "program-links-\(year)"
        case .weeklyThemes(let year):
            return "themes-\(year)"
        case .version:
            return "version"
        }
    }
}

/// The outcome of a conditional fetch against `CalendarAPIClient`.
nonisolated enum FetchResult: Sendable {
    /// The server responded `304 Not Modified` for the given `ifNoneMatch`
    /// validator — the caller should keep using its cached payload.
    case notModified

    /// The server returned a fresh payload, with an optional new `ETag` to
    /// store for the next conditional request.
    case success(data: Data, etag: String?)
}

/// Errors surfaced by `CalendarAPIClient` implementations.
nonisolated enum CalendarAPIError: Error, Sendable, Equatable {
    /// The server responded with a status code other than 200 or 304.
    case httpStatus(Int)

    /// The response wasn't an `HTTPURLResponse` at all.
    case invalidResponse
}

/// Fetches a `RemoteResource`'s bytes, honoring conditional `If-None-Match`
/// requests. Implementations must not touch any on-disk cache themselves —
/// `EventRepository` owns that.
nonisolated protocol CalendarAPIClient: Sendable {
    /// - Parameters:
    ///   - ifNoneMatch: When non-nil, sent as the `If-None-Match` header so
    ///     the server can answer `304` if unchanged.
    ///   - timeout: When non-nil, overrides the session's default request
    ///     timeout for this call.
    func fetch(_ resource: RemoteResource, ifNoneMatch: String?, timeout: TimeInterval?) async throws -> FetchResult
}

/// `CalendarAPIClient` backed by a real `URLSession` against
/// `https://www.chqcal.org`.
///
/// Uses an ephemeral session because `EventRepository` (via `DataCaching`)
/// owns all caching decisions — the URL loading system's own cache would
/// only get in the way of the ETag/TTL logic above it.
nonisolated struct LiveCalendarAPI: CalendarAPIClient {
    private static let baseURL = URL(string: "https://www.chqcal.org")!

    private let session: URLSession

    init(session: URLSession = URLSession(configuration: .ephemeral)) {
        self.session = session
    }

    private func url(for resource: RemoteResource) -> URL {
        URL(string: resource.path, relativeTo: Self.baseURL)!.absoluteURL
    }

    func fetch(_ resource: RemoteResource, ifNoneMatch: String?, timeout: TimeInterval?) async throws -> FetchResult {
        var request = URLRequest(url: url(for: resource))

        if let ifNoneMatch {
            request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match")
        }

        if case .version = resource {
            request.cachePolicy = .reloadIgnoringLocalCacheData
        }

        if let timeout {
            request.timeoutInterval = timeout
        }

        let (data, response) = try await session.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw CalendarAPIError.invalidResponse
        }

        switch http.statusCode {
        case 304:
            return .notModified
        case 200:
            let etag = http.value(forHTTPHeaderField: "ETag")
            return .success(data: data, etag: etag)
        default:
            throw CalendarAPIError.httpStatus(http.statusCode)
        }
    }
}
