import Foundation

nonisolated struct ArticleLink: Decodable, Hashable, Sendable {
    nonisolated enum Kind: String, Decodable, Hashable, Sendable {
        case preview
        case recap

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .preview
        }
    }

    let title: String
    let url: URL
    let kind: Kind
    let pubDate: String
}

nonisolated struct ArticleLinksFile: Decodable, Sendable {
    let links: [String: [ArticleLink]]

    private enum CodingKeys: String, CodingKey { case links }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try container.decode([String: LossyArray<ArticleLink>].self, forKey: .links)
        links = raw.mapValues { $0.wrappedValue }
    }
}

nonisolated struct WeeklyTheme: Decodable, Hashable, Sendable {
    let number: Int
    let title: String
    let description: String
    let startDate: String
    let endDate: String
}

nonisolated struct WeeklyThemesFile: Decodable, Sendable {
    let weeks: [WeeklyTheme]
}

nonisolated struct YearsManifest: Decodable, Sendable {
    let years: [Int]
    let defaultYear: Int

    init(years: [Int], defaultYear: Int) {
        self.years = years
        self.defaultYear = defaultYear
    }
}
