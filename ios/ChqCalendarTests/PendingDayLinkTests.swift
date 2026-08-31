import Foundation
import Testing
@testable import ChqCalendar

/// The ordering `PendingDayLink` exists to hold: a pending day link is taken
/// **synchronously**, and the navigation it starts runs one at a time.
///
/// Both rules are invisible in the finished code — nothing in `EventListView`
/// reads differently whether they hold or not — and both are broken by edits
/// that read as simplifications. That is the whole reason the rules live in a
/// named type instead of inline in the view: here they can be watched to fail.
@MainActor
struct PendingDayLinkTests {
    /// A mutable recorder the navigation closures can write to.
    ///
    /// A `final class`, not a captured `var`: `PendingDayLink.consume` takes an
    /// escaping `@MainActor` closure, and a local `var` captured by one is not
    /// legal under Swift 6 concurrency checking.
    @MainActor
    final class NavigationLog {
        private(set) var entries: [String] = []
        var armedKey: PendingDayScroll.Key?

        func record(_ entry: String) { entries.append(entry) }
    }

    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    /// The minimum a day link needs to be resolvable at all:
    /// `resolvePendingDayDeepLinkIfPossible` gates on `snapshot != nil` and
    /// nothing else, and these tests spy on the navigation rather than
    /// performing it — the one that performs a real cross-year navigation
    /// builds a two-season model instead.
    private func makeModelWithASnapshot() throws -> AppModel {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )
        model.snapshot = CalendarSnapshot(
            year: 2026, events: [], articleLinks: [:], programLinks: [:], themes: [],
            fetchedAt: now)
        return model
    }

    // MARK: - the take is synchronous

    /// **The guard the whole design hangs on.** `consume` must take the key
    /// out of the model *before it returns*, not as the first line of the task
    /// it queues.
    ///
    /// Consuming a day link is asynchronous now: it routes through
    /// `AppModel.goToDay(crossingYears:)`, which may select and fetch another
    /// season. `AppModel.select(year:)` replaces `snapshot`, and
    /// `EventListView` watches `snapshot?.fetchedAt` — so the navigation this
    /// call starts re-triggers this same call while it is suspended. That
    /// re-entrant call has to find nothing pending, and it only does because
    /// the take already happened synchronously.
    ///
    /// Folding the take into the task is a one-line simplification that opens a
    /// window in which `pendingDeepLink` is still set and each of the three
    /// triggers can take the same key again.
    ///
    /// **What that would actually cost today is less than it sounds, and this
    /// test is shaped around saying so honestly.** The chaining in `consume`
    /// serializes those extra takes, so the second finds the key already gone
    /// and the reader is not navigated twice —
    /// `theKeyIsConsumedOnceAcrossAYearSwitch` stays green under the edit. The
    /// take-once ordering is the *first of two independent defences*, not the
    /// only one. It is worth guarding regardless, and worth guarding
    /// **directly**: this asserts "the model no longer holds the link once
    /// `consume` returns", the property the window's existence contradicts,
    /// rather than a downstream double-navigation that only the chaining
    /// currently prevents. So if the chaining is ever removed, this rule does
    /// not quietly become unguarded along with it.
    @Test func theKeyIsTakenBeforeTheTaskIsQueued() async throws {
        let model = try makeModelWithASnapshot()
        model.pendingDeepLink = .day(key: "2026-08-06")
        let log = NavigationLog()

        let navigation = PendingDayLink.consume(from: model, after: nil) { key in
            log.record(key)
        }

        #expect(
            model.pendingDeepLink == nil,
            "the take must happen before `consume` returns, not inside the task it queues")
        #expect(
            log.entries.isEmpty,
            "and the navigation itself must not have run yet — only the take is synchronous")

        await navigation?.value
        #expect(log.entries == ["2026-08-06"])
    }

    /// Nothing pending means nothing to do — and, specifically, means the task
    /// already in flight is handed straight back rather than replaced with
    /// `nil`.
    ///
    /// `EventListView` assigns the result to `dayLinkNavigation`
    /// unconditionally. Returning `nil` here would drop the handle on a
    /// navigation still running, and the next link — the one this whole
    /// serialization exists for — would start beside it instead of behind it.
    @Test func nothingPendingHandsBackTheNavigationAlreadyInFlight() async throws {
        let model = try makeModelWithASnapshot()
        model.pendingDeepLink = .day(key: "2026-08-06")
        let log = NavigationLog()

        let first = PendingDayLink.consume(from: model, after: nil) { log.record($0) }
        // A second trigger in the same SwiftUI commit — `.onAppear` and
        // `.onChange(of: snapshot?.fetchedAt)` really can both fire from one.
        let second = PendingDayLink.consume(from: model, after: first) { log.record($0) }

        #expect(second == first, "no new task, and the in-flight one not dropped")
        await second?.value
        #expect(log.entries == ["2026-08-06"], "one trigger's worth of navigation, not two")
    }

    // MARK: - one navigation at a time

    /// Two links that are genuinely distinct — a reader naming a second day
    /// before the first has finished switching seasons — must run in sequence.
    ///
    /// The synchronous take does not help here: both keys are real and both
    /// were asked for. Running them concurrently is what breaks, because
    /// `EventListView.selectDay` stamps `PendingDayScroll.Target` from
    /// `model.selectedYear`/`model.filter` *after* its own await — two
    /// interleaved navigations read each other's half-applied state and arm a
    /// target that is stale the moment it exists.
    ///
    /// The log is written on both sides of a suspension point, so an
    /// interleaving shows up as `start B` between `start A` and `end A` rather
    /// than as a timing-dependent flake: `MainActor` runs one job at a time, so
    /// `Task.yield()` deterministically hands over to anything already queued.
    @Test func aSecondLinkWaitsForTheFirstRatherThanRunningBesideIt() async throws {
        let model = try makeModelWithASnapshot()
        let log = NavigationLog()

        model.pendingDeepLink = .day(key: "2026-08-06")
        let first = PendingDayLink.consume(from: model, after: nil) { key in
            log.record("start \(key)")
            await Task.yield()
            await Task.yield()
            log.record("end \(key)")
        }

        model.pendingDeepLink = .day(key: "2026-08-07")
        let second = PendingDayLink.consume(from: model, after: first) { key in
            log.record("start \(key)")
            log.record("end \(key)")
        }

        #expect(second != first, "a second, genuinely different key gets its own task")
        await second?.value

        #expect(
            log.entries == [
                "start 2026-08-06", "end 2026-08-06", "start 2026-08-07", "end 2026-08-07",
            ],
            "the later link is honoured, and honoured last — never woven through the first")
    }

    // MARK: - the arm runs after the switch, or not at all

    /// The other half of the race, and the half `consume` cannot see: the
    /// scroll target must be stamped from the state the year switch *left*,
    /// not the state it started from.
    ///
    /// `EventListView.armScroll` builds a `PendingDayScroll.Key` out of
    /// `selectedYear`, `filter` and `scopeResetCount`, and
    /// `resolvePendingScroll` throws away any target whose key no longer
    /// matches. A cross-year jump moves two of those three. So arming before
    /// the await produces a target that is stale on arrival — discarded, with
    /// no error and nothing else out of place, leaving a reader who was told
    /// "Opening tomorrow." exactly where they were.
    ///
    /// The assertion is the one that would catch that: the key `arm` sees is
    /// the key the model ends on. Hoisting `arm(dayKey)` above the
    /// `guard await` in `navigate` — the whole reason that function exists
    /// rather than three lines in the view — reds it.
    @Test func theTargetIsArmedOnlyAfterTheYearSwitchHasLanded() async throws {
        let model = try await makeTwoSeasonModel(defaults: makeDefaults())
        await model.select(year: 2025)
        let log = NavigationLog()

        await PendingDayLink.navigate(to: "2026-07-27", in: model) { day in
            log.record(day)
            log.armedKey = PendingDayScroll.key(
                for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount)
        }

        let settled = PendingDayScroll.key(
            for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount)
        let armed = try #require(log.armedKey, "the jump was accepted, so it must have armed")
        #expect(log.entries == ["2026-07-27"])
        #expect(armed.year == 2026, "stamped from the season arrived in, not the one left")
        #expect(
            !PendingDayScroll.isStale(
                PendingDayScroll.Target(day: "2026-07-27", key: armed), currentKey: settled),
            "a target armed here must survive to be landed, not be discarded on arrival")
    }

    /// A refused jump arms nothing. `AppModel.goToDay`'s contract is that a
    /// caller "can decide not to queue a scroll for a day that will never
    /// arrive", and this is the deep-link path deciding exactly that — an
    /// armed target for an unreachable day would sit waiting and hijack a
    /// later commit.
    @Test func aRefusedJumpArmsNothing() async throws {
        let model = try await makeTwoSeasonModel(defaults: makeDefaults())
        #expect(!model.years.contains(2024))
        let log = NavigationLog()

        await PendingDayLink.navigate(to: "2024-07-01", in: model) { log.record($0) }

        #expect(log.entries.isEmpty)
        #expect(model.selectedYear == 2026, "and an unpublished season is not selected")
    }

    // MARK: - across a real year switch

    /// The brief's own test: the key is consumed exactly once across a year
    /// switch, end to end, with a real `goToDay(crossingYears:)` doing the
    /// switching.
    ///
    /// The re-entrant consume is issued at the moment it really fires — after
    /// the navigation has begun (`selectedYear` has moved, so `select(year:)`
    /// is under way) and before it has finished. It must take nothing and
    /// navigate nothing; the reader must end up on 2026-07-27 in 2026, once.
    ///
    /// **Disclosure: this stays green if the take is folded into `consume`'s
    /// task.** `consume`'s chaining serializes the re-entrant take behind the
    /// first one, which has by then already emptied `pendingDeepLink`. What
    /// this pins is the outcome — consumed once across a real year switch —
    /// and it does fail if `AppModel`'s take-once is removed (the log then
    /// reads `["2026-07-27", "2026-07-27"]`). The *ordering* is pinned by
    /// `theKeyIsTakenBeforeTheTaskIsQueued`, which is the only test the
    /// folding edit reds. Do not read this test's name as covering it.
    @Test func theKeyIsConsumedOnceAcrossAYearSwitch() async throws {
        let model = try await makeTwoSeasonModel(defaults: makeDefaults())
        await model.select(year: 2025)
        #expect(!model.navigableBounds.contains("2026-07-27"), "unreachable from 2025")
        model.pendingDeepLink = .day(key: "2026-07-27")
        let log = NavigationLog()

        let navigation = PendingDayLink.consume(from: model, after: nil) { key in
            log.record(key)
            _ = await model.goToDay(crossingYears: key)
        }

        // Hand the executor over so the navigation runs up to its first
        // suspension — inside `select(year:)`, which has already moved
        // `selectedYear` and is waiting on the repository for 2026's snapshot.
        await Task.yield()
        #expect(model.selectedYear == 2026, "the year switch is under way, not finished")

        let reentrant = PendingDayLink.consume(from: model, after: navigation) { key in
            log.record(key)
            _ = await model.goToDay(crossingYears: key)
        }
        await reentrant?.value

        #expect(log.entries == ["2026-07-27"], "consumed once, not once per trigger")
        #expect(model.pendingDeepLink == nil)
        #expect(model.selectedYear == 2026)
        #expect(model.filter.windowStartDayKey == "2026-07-27")
        #expect(model.currentWindow?.startDay == "2026-07-27")
    }

    /// A link naming a day the app cannot reach — an unpublished season —
    /// still gets consumed, so it cannot fire again on the next snapshot
    /// refresh and teleport a reader minutes later.
    ///
    /// This is `resolvePendingDayDeepLinkIfPossible`'s documented "clear it
    /// whether or not the caller's navigation accepts it" contract, asserted
    /// through the consumer that now depends on it.
    @Test func aRefusedLinkIsStillConsumed() async throws {
        let model = try await makeTwoSeasonModel(defaults: makeDefaults())
        #expect(!model.years.contains(2024))
        model.pendingDeepLink = .day(key: "2024-07-01")
        let log = NavigationLog()

        let navigation = PendingDayLink.consume(from: model, after: nil) { key in
            log.record("refused \(await model.goToDay(crossingYears: key))")
        }
        await navigation?.value

        #expect(log.entries == ["refused false"])
        #expect(model.pendingDeepLink == nil)
        #expect(model.selectedYear == 2026, "an unpublished season is not selected")
    }
}
