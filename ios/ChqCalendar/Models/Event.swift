import Foundation

nonisolated enum EventStatus: Sendable, Hashable {
    case scheduled
    case cancelled
    case rescheduled
}

nonisolated struct Event: Identifiable, Hashable, Sendable, Decodable {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let details: String?
    let displayLocation: String?
    let venueAddress: String?
    let categoryNames: [String]
    let tags: [String]
    let presenter: String?
    let cost: String?
    let pageURL: URL?
    let imageURL: URL?
    let status: EventStatus
    let week: Int?
    let filterTokens: Set<String>

    private enum CodingKeys: String, CodingKey {
        case id, title, description, startDate, endDate, location, venue,
             category, categories, tags, presenter, cost, url, image, status, week
    }

    private struct Venue: Decodable {
        let name: String?
        let address: String?
    }

    private struct Category: Decodable {
        let name: String
    }

    private struct ImageSize: Decodable {
        let url: String
    }

    private struct ImageInfo: Decodable {
        let url: String?
        let sizes: [String: ImageSize]?
    }

    nonisolated init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        let id = try container.decode(String.self, forKey: .id)
        let rawTitle = try container.decode(String.self, forKey: .title)

        let startString = try container.decode(String.self, forKey: .startDate)
        guard let start = ChqTime.parse(startString) else {
            throw DecodingError.dataCorruptedError(
                forKey: .startDate, in: container,
                debugDescription: "Unparseable startDate: \(startString)"
            )
        }

        let endString = try container.decodeIfPresent(String.self, forKey: .endDate)
        let end = endString.flatMap { ChqTime.parse($0) } ?? start

        self.id = id
        self.title = rawTitle.decodingHTMLEntities
        self.start = start
        self.end = end

        self.details = try container.decodeIfPresent(String.self, forKey: .description)?.decodingHTMLEntities

        let venue = try container.decodeIfPresent(Venue.self, forKey: .venue)
        let location = try container.decodeIfPresent(String.self, forKey: .location)
        self.displayLocation = (venue?.name ?? location)?.decodingHTMLEntities
        self.venueAddress = venue?.address?.decodingHTMLEntities

        let categories = try container.decodeIfPresent([Category].self, forKey: .categories) ?? []
        let singleCategory = try container.decodeIfPresent(String.self, forKey: .category)
        var names: [String] = []
        var seen: Set<String> = []
        for category in categories {
            let decoded = category.name.decodingHTMLEntities
            if seen.insert(decoded).inserted {
                names.append(decoded)
            }
        }
        if let singleCategory {
            let decoded = singleCategory.decodingHTMLEntities
            if seen.insert(decoded).inserted {
                names.append(decoded)
            }
        }
        self.categoryNames = names

        let rawTags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        self.tags = rawTags.map { $0.decodingHTMLEntities }

        self.presenter = try container.decodeIfPresent(String.self, forKey: .presenter)?.decodingHTMLEntities
        self.cost = try container.decodeIfPresent(String.self, forKey: .cost)?.decodingHTMLEntities

        let urlString = try container.decodeIfPresent(String.self, forKey: .url)
        self.pageURL = urlString.flatMap { URL(string: $0) }

        let image = try container.decodeIfPresent(ImageInfo.self, forKey: .image)
        let imageURLString = image?.sizes?["large"]?.url ?? image?.url
        self.imageURL = imageURLString.flatMap { URL(string: $0) }

        let statusString = try container.decodeIfPresent(String.self, forKey: .status)
        switch statusString {
        case "cancelled":
            self.status = .cancelled
        case "rescheduled":
            self.status = .rescheduled
        default:
            self.status = .scheduled
        }

        self.week = try container.decodeIfPresent(Int.self, forKey: .week)

        self.filterTokens = Set((self.tags + names).map { $0.lowercased() })
    }
}

/// Decodes a JSON array leniently: elements that fail to decode are skipped
/// instead of failing the whole array. Used to make `EventEnvelope` and
/// `ArticleLinksFile` tolerant of one malformed entry among many.
nonisolated struct LossyArray<Element: Decodable & Sendable>: Decodable, Sendable {
    var wrappedValue: [Element]

    private struct Item: Decodable {
        var element: Element?

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            element = try? container.decode(Element.self)
        }
    }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var elements: [Element] = []
        while !container.isAtEnd {
            if let item = try? container.decode(Item.self), let value = item.element {
                elements.append(value)
            }
        }
        wrappedValue = elements
    }
}

nonisolated struct EventEnvelope: Decodable, Sendable {
    let data: [Event]

    private enum CodingKeys: String, CodingKey { case data }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let lossy = try container.decode(LossyArray<Event>.self, forKey: .data)
        data = lossy.wrappedValue
    }
}
