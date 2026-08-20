import Foundation
import Testing
@testable import ChqCalendar

/// The staleness guard behind `EventListView.landPendingScroll` — the
/// property under test is that a pending scroll set under one scope must
/// never land under a different one. The web's `shouldAbandonScroll`-only
/// approach misses exactly this: a scope change can move the window away
/// from a tapped-but-not-yet-mounted day without ever covering it, leaving
/// the pending target armed indefinitely. `PendingDayScroll.isStale` closes
/// that hole by comparing a stamped filter identity instead.
struct PendingDayScrollTests {
    private func selection(
        searchText: String = "",
        dateScope: DateScope = .next,
        selectedWeeks: Set<Int> = [],
        selectedDayKey: String? = nil,
        selectedLocations: [String] = [],
        selectedCategories: [String] = [],
        showFavoritesOnly: Bool = false,
        windowStartDayKey: String? = nil,
        windowEndDayKey: String? = nil
    ) -> FilterSelection {
        FilterSelection(
            searchText: searchText,
            dateScope: dateScope,
            selectedWeeks: selectedWeeks,
            selectedDayKey: selectedDayKey,
            selectedLocations: selectedLocations,
            selectedCategories: selectedCategories,
            showFavoritesOnly: showFavoritesOnly,
            windowStartDayKey: windowStartDayKey,
            windowEndDayKey: windowEndDayKey)
    }

    /// The steady-state case: nothing about the filter has changed since the
    /// tap, so the target is still waiting, not stale.
    @Test func sameKeyIsNotStale() {
        let armed = PendingDayScroll.key(for: selection(), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(), year: 2026)
        #expect(!PendingDayScroll.isStale(target, currentKey: current))
    }

    /// The exact bug this type exists to close: `selectScope` (and
    /// `setWeekSelection`/`browseDay`) can change scope without the new
    /// window ever covering the tapped day, so `shouldAbandonScroll` alone
    /// never fires. The stamped key must catch it instead.
    @Test func scopeChangeIsStale() {
        let armed = PendingDayScroll.key(for: selection(dateScope: .next), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(dateScope: .thisWeek), year: 2026)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    /// `setWeekSelection` is a scope change in disguise (it forces `.all`
    /// and replaces the week set) — the key must catch a bare week-set
    /// change too, independent of `dateScope`.
    @Test func weekSelectionChangeIsStale() {
        let armed = PendingDayScroll.key(for: selection(selectedWeeks: [3]), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(selectedWeeks: [3, 4]), year: 2026)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    /// The case that must NOT regress: `AppModel.goToDay` grows the window
    /// by writing `windowStartDayKey`/`windowEndDayKey` — that is the whole
    /// reason the target is waiting. If that write tripped `isStale`, every
    /// distant tap would abandon itself the instant the expansion it just
    /// requested landed.
    @Test func pureWindowExpansionIsNotStale() {
        let armed = PendingDayScroll.key(
            for: selection(windowStartDayKey: nil, windowEndDayKey: nil), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(
            for: selection(windowStartDayKey: "2026-06-27", windowEndDayKey: "2026-08-21"),
            year: 2026)
        #expect(!PendingDayScroll.isStale(target, currentKey: current))
    }

    @Test func searchTextChangeIsStale() {
        let armed = PendingDayScroll.key(for: selection(searchText: "opera"), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(searchText: "jazz"), year: 2026)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    @Test func venueSelectionChangeIsStale() {
        let armed = PendingDayScroll.key(for: selection(selectedLocations: ["Amp"]), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(selectedLocations: []), year: 2026)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    @Test func categorySelectionChangeIsStale() {
        let armed = PendingDayScroll.key(for: selection(selectedCategories: ["Lecture"]), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(selectedCategories: []), year: 2026)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    @Test func favoritesOnlyChangeIsStale() {
        let armed = PendingDayScroll.key(for: selection(showFavoritesOnly: false), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(showFavoritesOnly: true), year: 2026)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    /// A year switch is a full snapshot swap — a target armed under 2026
    /// must not survive into 2027.
    @Test func yearChangeIsStale() {
        let armed = PendingDayScroll.key(for: selection(), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(for: selection(), year: 2027)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    /// `browseDay` pins a `.day` scope via `selectedDayKey` rather than
    /// `dateScope` alone changing — the key must catch that route too.
    @Test func selectedDayKeyChangeIsStale() {
        let armed = PendingDayScroll.key(
            for: selection(dateScope: .day, selectedDayKey: "2026-07-04"), year: 2026)
        let target = PendingDayScroll.Target(day: "2026-08-21", key: armed)
        let current = PendingDayScroll.key(
            for: selection(dateScope: .day, selectedDayKey: "2026-07-05"), year: 2026)
        #expect(PendingDayScroll.isStale(target, currentKey: current))
    }

    // MARK: hasLanded — issuing a scroll is not landing one

    /// The confirmation that fixes #250. The target's header is on screen
    /// (`visibleDays` is maintained from section-header `onAppear`), so the
    /// scroll did what it was asked and the pending target is done.
    @Test func aVisibleTargetHasLanded() {
        #expect(PendingDayScroll.hasLanded(
            day: "2026-08-21",
            visibleDays: ["2026-08-20", "2026-08-21"],
            retryDeadline: Date().addingTimeInterval(5),
            now: Date()))
    }

    /// The CI failure, in one assertion: the day is nowhere on screen after
    /// the `scrollTo`, so the scroll was dropped and is still owed. Before
    /// this check existed the caller cleared `pendingScroll` here anyway and
    /// no trigger ever fired again.
    @Test func aTargetThatIsNotOnScreenHasNotLanded() {
        let now = Date()
        #expect(!PendingDayScroll.hasLanded(
            day: "2026-08-21",
            visibleDays: ["2026-07-01", "2026-07-03", "2026-07-04"],
            retryDeadline: now.addingTimeInterval(5),
            now: now))
    }

    /// Retrying is bounded: a target whose day can never become visible —
    /// the list unmounted, or it vanished for a reason neither staleness nor
    /// `shouldAbandonScroll` catches — stops being re-issued once its window
    /// closes, rather than re-scrolling forever.
    @Test func aTargetPastItsRetryDeadlineIsGivenUpOn() {
        let now = Date()
        #expect(PendingDayScroll.hasLanded(
            day: "2026-08-21",
            visibleDays: ["2026-07-01"],
            retryDeadline: now.addingTimeInterval(-0.001),
            now: now))
    }

    /// No deadline stamped means no retry — the behavior before this
    /// existed, kept as the safe fallback for any path that arms a target
    /// without going through `selectDay`.
    @Test func noRetryDeadlineMeansASingleAttempt() {
        #expect(PendingDayScroll.hasLanded(
            day: "2026-08-21",
            visibleDays: [],
            retryDeadline: nil,
            now: Date()))
    }
}
