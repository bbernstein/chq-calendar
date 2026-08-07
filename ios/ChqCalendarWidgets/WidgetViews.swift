import SwiftUI
import WidgetKit

/// Shared timeline entry for both widgets — a `TimelineEntry` wrapper
/// around the `WidgetTimelineBuilder.Slice` state computed for a given
/// instant. `nonisolated`, matching `WidgetTimelineBuilder`/every other
/// `Sendable` domain type this carries (see `NextUpWidget.swift`'s doc
/// comment on why the *providers* need that; this is `Sendable` for the
/// same reason).
nonisolated struct WidgetEntry: TimelineEntry {
    let date: Date
    let state: WidgetTimelineBuilder.State
}

// MARK: - Time formatting

private let monthDayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = ChqTime.zone
    formatter.dateFormat = "MMMM d"
    return formatter
}()

private let shortMonthDayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = ChqTime.zone
    formatter.dateFormat = "MMM d"
    return formatter
}()

private let weekdayTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = ChqTime.zone
    formatter.dateFormat = "EEE, h:mm a"
    return formatter
}()

/// "Today, 7:30 PM" when `date` falls on the same NY calendar day as `now`,
/// else "Wed, 7:30 PM" — a widget's tiny surface needs a day cue without
/// spelling out a full date the way `EventRow`'s bare `ChqTime.timeString`
/// can get away with (that view sits under a day-header that already says
/// which day it is).
private func dayTimeLabel(for date: Date, now: Date) -> String {
    guard ChqTime.dayKey(for: date) == ChqTime.dayKey(for: now) else {
        return weekdayTimeFormatter.string(from: date)
    }
    return "Today, \(ChqTime.timeString(for: date))"
}

private func dayCount(_ n: Int) -> String {
    "\(n) day\(n == 1 ? "" : "s")"
}

// MARK: - Next Up

/// `NextUpWidget`'s view: every family it supports, switched on
/// `\.widgetFamily`. A single `widgetURL` covers `.systemSmall` and both
/// accessory families (there's one event to link to); `.systemMedium`
/// deliberately gets none here — `MediumEventsView` wraps each row in its
/// own `Link` instead, and a `widgetURL` on the container would win over
/// those and send every row to the same event.
struct NextUpWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WidgetEntry

    var body: some View {
        content
            .widgetURL(family == .systemMedium ? nil : tapURL)
    }

    @ViewBuilder
    private var content: some View {
        switch entry.state {
        case .events(let events):
            eventsContent(events)
        case .countdown(let opening, let daysUntil):
            CountdownView(family: family, opening: opening, daysUntil: daysUntil)
        case .empty:
            EmptyStateView(family: family, message: "No upcoming events", systemImage: "calendar")
        }
    }

    @ViewBuilder
    private func eventsContent(_ events: [WidgetTimelineBuilder.EventSummary]) -> some View {
        switch family {
        case .systemMedium:
            MediumEventsView(events: events, now: entry.date)
        case .accessoryRectangular:
            if let first = events.first {
                RectangularEventView(event: first, now: entry.date)
            } else {
                EmptyStateView(family: family, message: "No upcoming events", systemImage: "calendar")
            }
        case .accessoryInline:
            InlineEventView(events: events)
        default:
            SmallEventView(events: events, now: entry.date)
        }
    }

    /// No event to link to: `.countdown`/`.empty`, or an `.events` slice
    /// whose list has run dry (the final slice in a rolling timeline shows
    /// zero remaining events — see `WidgetTimelineBuilderTests`). `nil`
    /// leaves the system's default tap behavior (open the app) in place.
    private var tapURL: URL? {
        guard case .events(let events) = entry.state, let first = events.first else {
            return nil
        }
        return DeepLink.event(id: first.id).url
    }
}

/// `StarredWidget`'s view — same state machine as `NextUpWidgetView`, but
/// only for the two families `StarredWidget` declares
/// (`.systemSmall`/`.accessoryRectangular`), and with copy that names the
/// cause of emptiness ("star some events") rather than a generic
/// "no events" message — the widget's whole premise is the user's own
/// starred set, so an empty one has an obvious, actionable next step.
struct StarredWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WidgetEntry

    private static let emptyMessage = "Star events in CHQ Calendar to see them here"

    var body: some View {
        content
            .widgetURL(tapURL)
    }

    @ViewBuilder
    private var content: some View {
        switch entry.state {
        case .events(let events):
            eventsContent(events)
        case .countdown(let opening, let daysUntil):
            CountdownView(family: family, opening: opening, daysUntil: daysUntil)
        case .empty:
            EmptyStateView(family: family, message: Self.emptyMessage, systemImage: "star")
        }
    }

    @ViewBuilder
    private func eventsContent(_ events: [WidgetTimelineBuilder.EventSummary]) -> some View {
        switch family {
        case .accessoryRectangular:
            if let first = events.first {
                RectangularEventView(event: first, now: entry.date)
            } else {
                EmptyStateView(family: family, message: Self.emptyMessage, systemImage: "star")
            }
        default:
            SmallEventView(events: events, now: entry.date, caption: "STARRED", emptyMessage: Self.emptyMessage)
        }
    }

    private var tapURL: URL? {
        guard case .events(let events) = entry.state, let first = events.first else {
            return nil
        }
        return DeepLink.event(id: first.id).url
    }
}

// MARK: - Family-specific content

/// `.systemSmall`: the single soonest event, a "NEXT UP"/"STARRED" caption,
/// and a fallback message when the slice's event list is empty (either a
/// true `.empty` state never reaches here — callers map that to
/// `EmptyStateView` — or, per `WidgetTimelineBuilder`, the last slice of a
/// rolling day with nothing left to show).
private struct SmallEventView: View {
    let events: [WidgetTimelineBuilder.EventSummary]
    let now: Date
    var caption: String = "NEXT UP"
    var emptyMessage: String = "No more events today"

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(caption)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let event = events.first {
                Text(dayTimeLabel(for: event.start, now: now))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(event.title)
                    .font(.headline)
                    .lineLimit(2)
                if let venue = event.venue {
                    Text(venue)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            } else {
                Text(emptyMessage)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// `.systemMedium`: up to 3 rows (time column, title, venue), each its own
/// tap target via `Link`.
private struct MediumEventsView: View {
    let events: [WidgetTimelineBuilder.EventSummary]
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NEXT UP")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            if events.isEmpty {
                Spacer(minLength: 0)
                Text("No more events today")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            } else {
                ForEach(events.prefix(3), id: \.id) { event in
                    Link(destination: DeepLink.event(id: event.id).url) {
                        row(for: event)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(for event: WidgetTimelineBuilder.EventSummary) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(ChqTime.timeString(for: event.start))
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title)
                    .font(.subheadline)
                    .lineLimit(1)
                    .foregroundStyle(.primary)
                if let venue = event.venue {
                    Text(venue)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// `.accessoryRectangular` (Lock Screen / StandBy): title + time, two lines.
private struct RectangularEventView: View {
    let event: WidgetTimelineBuilder.EventSummary
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(event.title)
                .font(.headline)
                .lineLimit(1)
            Text(dayTimeLabel(for: event.start, now: now))
                .font(.caption2)
        }
    }
}

/// `.accessoryInline` (Lock Screen single line): "7:30 PM · Amphitheater".
private struct InlineEventView: View {
    let events: [WidgetTimelineBuilder.EventSummary]

    var body: some View {
        if let event = events.first {
            Text("\(ChqTime.timeString(for: event.start)) · \(event.venue ?? "Chautauqua")")
        } else {
            Text("No more events today")
        }
    }
}

/// The `.countdown` state, shared by both widgets: "Season starts <Month
/// Day>" + "<N> days", styled per family — a full block for the two
/// home-screen families, a compact two-line block for `.accessoryRectangular`,
/// and one line for `.accessoryInline`.
private struct CountdownView: View {
    let family: WidgetFamily
    let opening: Date
    let daysUntil: Int

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("Season starts in \(dayCount(daysUntil))")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Season starts \(shortMonthDayFormatter.string(from: opening))")
                    .font(.caption2.weight(.semibold))
                Text(dayCount(daysUntil))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text("Season starts")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(monthDayFormatter.string(from: opening))
                    .font(.title3.weight(.semibold))
                Text(dayCount(daysUntil))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/// The `.empty` state, shared by both widgets — callers supply the copy
/// (`NextUpWidgetView` says "No upcoming events"; `StarredWidgetView` says
/// "Star events..."), so this only owns layout per family. Never renders a
/// literal empty box: every family gets an icon-plus-message (home-screen
/// families) or a plain message (accessory families, which have no room for
/// an icon).
private struct EmptyStateView: View {
    let family: WidgetFamily
    let message: String
    let systemImage: String

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(message)
        case .accessoryRectangular:
            Text(message)
                .font(.caption2)
                .lineLimit(2)
        default:
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
