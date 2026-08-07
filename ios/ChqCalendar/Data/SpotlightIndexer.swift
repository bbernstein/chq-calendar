import CoreSpotlight
import Foundation
import UniformTypeIdentifiers
import os

/// Indexes events into on-device Spotlight (`CSSearchableIndex`) so they're
/// searchable from the Home Screen / Lock Screen search sheet — one more
/// system search surface alongside App Intents/Siri (task 12) and widgets
/// (task 11), and the final piece of #180.
///
/// `reindex` is called as a fire-and-forget side effect of a successful
/// `AppModel.refresh()` (see that call site, right beside the reminder sync
/// and widget reload it already triggers there) — never awaited by, and
/// never allowed to fail, the refresh path itself. Every CoreSpotlight
/// error is logged and swallowed: Spotlight visibility is a nice-to-have,
/// not something that should crash the app or block a data refresh.
///
/// This is a full reindex, not an incremental diff: every call wipes this
/// app's previous Spotlight contents (everything under `domainIdentifier`)
/// and re-adds exactly what `itemsToIndex` currently selects. That mirrors
/// `ReminderCenter.sync`'s "declarative full resync" strategy for the same
/// reason — a moved start time, an un-favorited event, or a season rollover
/// are all handled automatically by construction, with no separate
/// diff/patch path that could drift from the selection logic.
nonisolated enum SpotlightIndexer {
    /// Every `CSSearchableItem` this app creates carries this domain
    /// identifier, so `reindex` can delete exactly (and only) this app's
    /// previously-indexed items before re-adding the current set.
    static let domainIdentifier = "events"

    /// `CSSearchableIndex.indexSearchableItems` accepts an unbounded array,
    /// but chunking keeps any one call's payload/latency bounded — 200 is
    /// comfortably above a single season's typical in-window event count,
    /// so most reindexes make exactly one call.
    private static let batchSize = 200

    private static let logger = Logger(subsystem: "org.chqcal.app", category: "SpotlightIndexer")

    private static let identifierPrefix = "event-"

    // MARK: - Selection (pure, testable without the CoreSpotlight runtime)

    /// The events a reindex should make searchable: the current season's
    /// `[weeks.first.start, weeks.last.end)` window, unioned with every
    /// favorited event regardless of date, minus anything cancelled.
    ///
    /// Favorites are included unconditionally — not "favorited AND
    /// in-season" — for the same reason `AppModel.reminderPlanEvents` and
    /// `EventFilter`'s favorites-only scope treat favorites as forever: a
    /// starred event a user is still tracking should stay searchable even
    /// after its week has scrolled out of the current season window.
    ///
    /// `nonisolated` and pure: no clock read of its own (`now` and `year`
    /// are both passed in), so it's directly unit-testable and safely
    /// callable from any isolation context.
    nonisolated static func itemsToIndex(events: [Event], favorites: Set<String>, year: Int, now: Date) -> [Event] {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let seasonStart = weeks.first?.start, let seasonEnd = weeks.last?.end else {
            return events.filter { $0.status != .cancelled && favorites.contains($0.id) }
        }
        return events.filter { event in
            guard event.status != .cancelled else { return false }
            if favorites.contains(event.id) { return true }
            return event.start >= seasonStart && event.start < seasonEnd
        }
    }

    // MARK: - Identifier round trip

    /// `"event-<id>"` — the `CSSearchableItem.uniqueIdentifier` this app
    /// gives every indexed event. The inverse of
    /// `eventID(fromActivityIdentifier:)` below.
    nonisolated static func identifier(for eventID: String) -> String {
        "\(identifierPrefix)\(eventID)"
    }

    /// Extracts the event id from a `CSSearchableItemActionType` user
    /// activity's `CSSearchableItemActivityIdentifier` value — the inverse
    /// of `identifier(for:)`. `nil` for anything that isn't one of this
    /// app's own `"event-<id>"` identifiers: a missing prefix, or an empty
    /// id once the prefix is stripped.
    nonisolated static func eventID(fromActivityIdentifier identifier: String) -> String? {
        guard identifier.hasPrefix(identifierPrefix) else { return nil }
        let id = String(identifier.dropFirst(identifierPrefix.count))
        return id.isEmpty ? nil : id
    }

    // MARK: - Reindex

    /// Wipes this app's previous Spotlight contents and re-adds everything
    /// `itemsToIndex` currently selects, in batches of `batchSize`.
    ///
    /// Every failure — the delete, or any one batch's index call — is
    /// logged via `os.Logger` and swallowed; a failed batch does not stop
    /// the remaining batches from being attempted. `CSSearchableIndex` is
    /// safe to call from any thread/actor, so this (like the rest of the
    /// type) is `nonisolated` — `AppModel` calls it from an unstructured
    /// `Task` off its own `MainActor`-isolated refresh path without an
    /// extra actor hop either way.
    static func reindex(events: [Event], favorites: Set<String>, year: Int, now: Date) async {
        guard CSSearchableIndex.isIndexingAvailable() else { return }

        let index = CSSearchableIndex.default()

        do {
            try await index.deleteSearchableItems(withDomainIdentifiers: [domainIdentifier])
        } catch {
            logger.error("Failed to clear previous Spotlight index: \(error, privacy: .public)")
        }

        let items = itemsToIndex(events: events, favorites: favorites, year: year, now: now)
            .map(searchableItem(for:))

        var start = items.startIndex
        while start < items.endIndex {
            let end = min(start + batchSize, items.endIndex)
            let batch = Array(items[start..<end])
            do {
                try await index.indexSearchableItems(batch)
            } catch {
                logger.error("Failed to index a batch of \(batch.count) event(s): \(error, privacy: .public)")
            }
            start = end
        }
    }

    private static func searchableItem(for event: Event) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: .content)
        attributes.title = event.title

        let when = "\(ChqTime.dayTitle(for: event.start)) at \(ChqTime.timeString(for: event.start))"
        attributes.contentDescription = [event.displayLocation, when].compactMap { $0 }.joined(separator: " · ")

        var keywords = event.categoryNames
        if let presenter = event.presenter {
            keywords.append(presenter)
        }
        attributes.keywords = keywords

        return CSSearchableItem(
            uniqueIdentifier: identifier(for: event.id),
            domainIdentifier: domainIdentifier,
            attributeSet: attributes
        )
    }
}
