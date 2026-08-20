import Foundation

/// How a day chip's count is symbolised and spoken.
///
/// One chip type serves two screens with different subjects — My Day counts
/// starred events, the Events rail counts matching events — and the
/// difference is entirely in the labelling. Splitting it out keeps
/// `MyDayChipContent` free of `if isMyDay` branches and makes the wording
/// testable on its own.
nonisolated struct DayChipCountStyle: Equatable, Sendable {
    /// SF Symbol rendered beside the count, or `nil` for a bare number.
    let symbol: String?
    let singular: String
    let plural: String
    /// How a zero count is spoken — "no events", not "0 events".
    let zero: String
    /// Prefixed to a **non-empty** day's spoken label ("Go to Sunday, August
    /// 16, 4 events"). `nil` for My Day, whose chips select a day rather than
    /// navigate to one.
    ///
    /// Never applied to an empty day, whatever the style says: an empty day
    /// is not a destination, so it is named as a fact. This is the rule the
    /// web rail arrived at after three review findings, recorded in
    /// `DayChip.label`'s doc comment.
    let actionPrefix: String?

    static let starred = DayChipCountStyle(
        symbol: "star.fill",
        singular: "starred event", plural: "starred events",
        zero: "no starred events", actionPrefix: nil)

    static let events = DayChipCountStyle(
        symbol: nil,
        singular: "event", plural: "events",
        zero: "no events", actionPrefix: "Go to")

    /// `"4 events"` / `"1 event"` / `"no events"`.
    func phrase(for count: Int) -> String {
        switch count {
        case 0: return zero
        case 1: return "1 \(singular)"
        default: return "\(count) \(plural)"
        }
    }
}
