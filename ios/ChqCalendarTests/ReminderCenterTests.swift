import Foundation
import UserNotifications
import Testing
@testable import ChqCalendar

/// An in-memory recorder standing in for `UNUserNotificationCenter`, in the
/// same spirit as `MockAPI`: every call is logged for later assertion, and
/// authorization state is scripted ahead of time rather than depending on a
/// real (and, in a test process, unreliable/unpromptable) system prompt.
///
/// `@MainActor` rather than `actor`: `NotificationScheduling` is itself
/// `@MainActor`-isolated, and `ReminderCenter` (its only caller) is too, so
/// there is no cross-actor traffic to guard against here.
@MainActor
final class MockScheduler: NotificationScheduling {
    struct AddCall: Equatable {
        let identifier: String
        let title: String
        let body: String
        let triggerDate: Date
        let userInfo: [String: String]
    }

    enum Call: Equatable {
        case removeAll(prefix: String)
        case add(AddCall)
    }

    var status: UNAuthorizationStatus = .authorized
    var requestAuthorizationResult = true

    private(set) var calls: [Call] = []
    private(set) var requestAuthorizationCallCount = 0
    private(set) var pendingIdentifiers: [String] = []

    /// When `true`, every `add(...)` call parks (via `withCheckedContinuation`)
    /// until `resume()` is called, instead of completing immediately. Lets a
    /// test force two `ReminderCenter.sync(plan:)` calls to genuinely
    /// overlap — one caught mid-`add` — rather than always running start-to-
    /// finish sequentially, the same way `MockAPI.setSuspended`/`resume` let
    /// `EventRepositoryTests` force overlapping fetches.
    private var suspended = false
    private var suspendedContinuations: [CheckedContinuation<Void, Never>] = []

    func authorizationStatus() async -> UNAuthorizationStatus {
        status
    }

    func requestAuthorization() async -> Bool {
        requestAuthorizationCallCount += 1
        return requestAuthorizationResult
    }

    func pending(withPrefix prefix: String) async -> [String] {
        pendingIdentifiers.filter { $0.hasPrefix(prefix) }
    }

    func removeAll(withPrefix prefix: String) async {
        calls.append(.removeAll(prefix: prefix))
        pendingIdentifiers.removeAll { $0.hasPrefix(prefix) }
    }

    func add(
        identifier: String,
        title: String,
        body: String,
        triggerDate: Date,
        userInfo: [String: String]
    ) async throws {
        if suspended {
            await withCheckedContinuation { continuation in
                suspendedContinuations.append(continuation)
            }
        }
        let call = AddCall(
            identifier: identifier,
            title: title,
            body: body,
            triggerDate: triggerDate,
            userInfo: userInfo
        )
        calls.append(.add(call))
        pendingIdentifiers.append(identifier)
    }

    func setSuspended() {
        suspended = true
    }

    /// Un-parks every `add(...)` call currently parked (and any future
    /// ones, until `setSuspended()` is called again).
    func resume() {
        suspended = false
        let waiting = suspendedContinuations
        suspendedContinuations = []
        for continuation in waiting {
            continuation.resume()
        }
    }

    /// The `add` calls recorded so far, in order — the common shape tests
    /// want to assert against.
    var addCalls: [AddCall] {
        calls.compactMap {
            if case .add(let call) = $0 { return call }
            return nil
        }
    }

    var removeAllCallCount: Int {
        calls.filter {
            if case .removeAll = $0 { return true }
            return false
        }.count
    }
}

@MainActor
struct ReminderCenterTests {
    // `nonisolated`: called from inside `@Sendable () -> Date` closures
    // handed to `ReminderCenter.init`, which must not require hopping back
    // to the main actor just to read a fixed constant.
    private nonisolated func makeStart(_ dateString: String) -> Date {
        // swiftlint:disable:next force_unwrapping
        ChqTime.parse(dateString)!
    }

    private func makePlanned(
        id: String,
        title: String = "Test Event",
        body: String = "Starts at 7:30 PM",
        triggerDate: Date,
        eventStart: Date
    ) -> ReminderPlanner.PlannedReminder {
        ReminderPlanner.PlannedReminder(
            eventID: id,
            title: title,
            body: body,
            triggerDate: triggerDate,
            eventStart: eventStart
        )
    }

    // MARK: - sync(plan:)

    @Test func syncAddsAllPlanItemsWithCorrectIdentifiersAndUserInfo() async {
        let scheduler = MockScheduler()
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let plan = [
            makePlanned(
                id: "evt-1",
                triggerDate: makeStart("2026-07-15 19:00:00"),
                eventStart: makeStart("2026-07-15 19:30:00")
            ),
            makePlanned(
                id: "evt-2",
                triggerDate: makeStart("2026-07-15 20:00:00"),
                eventStart: makeStart("2026-07-15 20:30:00")
            )
        ]

        await center.sync(plan: plan)

        #expect(scheduler.removeAllCallCount == 1)
        #expect(scheduler.addCalls.count == 2)
        #expect(scheduler.addCalls[0].identifier == "event-evt-1")
        #expect(scheduler.addCalls[0].userInfo == ["eventID": "evt-1"])
        #expect(scheduler.addCalls[0].triggerDate == plan[0].triggerDate)
        #expect(scheduler.addCalls[1].identifier == "event-evt-2")
        #expect(scheduler.addCalls[1].userInfo == ["eventID": "evt-2"])
    }

    @Test func resyncAfterMovedStartReplacesTheTrigger() async {
        let scheduler = MockScheduler()
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let originalTrigger = makeStart("2026-07-15 19:00:00")
        let movedTrigger = makeStart("2026-07-15 21:00:00")

        await center.sync(plan: [makePlanned(id: "evt-1", triggerDate: originalTrigger, eventStart: originalTrigger)])
        #expect(scheduler.addCalls.last?.triggerDate == originalTrigger)

        await center.sync(plan: [makePlanned(id: "evt-1", triggerDate: movedTrigger, eventStart: movedTrigger)])

        #expect(scheduler.removeAllCallCount == 2)
        #expect(scheduler.addCalls.count == 2)
        #expect(scheduler.addCalls.last?.identifier == "event-evt-1")
        #expect(scheduler.addCalls.last?.triggerDate == movedTrigger)
        // The mock's own pending-state view should reflect only the latest
        // sync's identifiers, same as the real notification center would
        // after a removeAll + re-add.
        #expect(scheduler.pendingIdentifiers == ["event-evt-1"])
    }

    @Test func retractedFavoriteDisappearsOnNextSync() async {
        let scheduler = MockScheduler()
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let trigger1 = makeStart("2026-07-15 19:00:00")
        let trigger2 = makeStart("2026-07-15 20:00:00")
        await center.sync(plan: [
            makePlanned(id: "evt-1", triggerDate: trigger1, eventStart: trigger1),
            makePlanned(id: "evt-2", triggerDate: trigger2, eventStart: trigger2)
        ])
        #expect(Set(scheduler.pendingIdentifiers) == ["event-evt-1", "event-evt-2"])

        // evt-2 was unfavorited/retracted: the next plan no longer includes it.
        await center.sync(plan: [makePlanned(id: "evt-1", triggerDate: trigger1, eventStart: trigger1)])

        #expect(scheduler.pendingIdentifiers == ["event-evt-1"])
    }

    @Test func deniedAuthorizationMeansZeroSchedulingCalls() async {
        let scheduler = MockScheduler()
        scheduler.status = .denied
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let trigger = makeStart("2026-07-15 19:00:00")
        await center.sync(plan: [makePlanned(id: "evt-1", triggerDate: trigger, eventStart: trigger)])

        // Not even `removeAll` — denied means nothing is touched at all.
        #expect(scheduler.calls.isEmpty)
    }

    @Test func notDeterminedAuthorizationMeansZeroSchedulingCalls() async {
        let scheduler = MockScheduler()
        scheduler.status = .notDetermined
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let trigger = makeStart("2026-07-15 19:00:00")
        await center.sync(plan: [makePlanned(id: "evt-1", triggerDate: trigger, eventStart: trigger)])

        #expect(scheduler.calls.isEmpty)
    }

    @Test func syncWithEmptyPlanStillRemovesEverythingWhenAuthorized() async {
        let scheduler = MockScheduler()
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        await center.sync(plan: [])

        #expect(scheduler.removeAllCallCount == 1)
        #expect(scheduler.addCalls.isEmpty)
    }

    // MARK: - ensureAuthorization()

    @Test func notDeterminedEnsureAuthorizationRequestsExactlyOnce() async {
        let scheduler = MockScheduler()
        scheduler.status = .notDetermined
        scheduler.requestAuthorizationResult = true
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let granted = await center.ensureAuthorization()

        #expect(granted)
        #expect(scheduler.requestAuthorizationCallCount == 1)
    }

    @Test func notDeterminedEnsureAuthorizationCanReturnDenied() async {
        let scheduler = MockScheduler()
        scheduler.status = .notDetermined
        scheduler.requestAuthorizationResult = false
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let granted = await center.ensureAuthorization()

        #expect(!granted)
        #expect(scheduler.requestAuthorizationCallCount == 1)
    }

    @Test func deniedEnsureAuthorizationNeverRequests() async {
        let scheduler = MockScheduler()
        scheduler.status = .denied
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let granted = await center.ensureAuthorization()

        #expect(!granted)
        #expect(scheduler.requestAuthorizationCallCount == 0)
    }

    @Test func alreadyAuthorizedEnsureAuthorizationNeverRequests() async {
        let scheduler = MockScheduler()
        scheduler.status = .authorized
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let granted = await center.ensureAuthorization()

        #expect(granted)
        #expect(scheduler.requestAuthorizationCallCount == 0)
    }

    // MARK: - authorizationStatus() (#178)

    /// A pure read, distinct from `ensureAuthorization()`: it must reflect
    /// whatever the scheduler currently reports without ever calling
    /// `requestAuthorization()` itself, for any status — including
    /// `.notDetermined`, where `ensureAuthorization()` would prompt.
    @Test func authorizationStatusReflectsTheSchedulerWithoutPrompting() async {
        let scheduler = MockScheduler()
        scheduler.status = .denied
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        #expect(await center.authorizationStatus() == .denied)
        #expect(scheduler.requestAuthorizationCallCount == 0)

        scheduler.status = .notDetermined
        #expect(await center.authorizationStatus() == .notDetermined)
        #expect(scheduler.requestAuthorizationCallCount == 0)
    }

    // MARK: - triggerDateComponents

    /// Pins the raw component values *and* that `timeZone` is explicitly
    /// `ChqTime.zone` — not merely that reconstructing via `ChqTime.calendar`
    /// round-trips, which would pass even with `timeZone == nil` (that
    /// reconstruction uses the same NY-pinned calendar either way, so it
    /// can't detect a missing time zone on the components themselves). The
    /// adversarial version of this check, which *can* detect that bug, is
    /// `reconstructingViaADifferentZoneCalendarStillYieldsTheNYInstant`
    /// below.
    @Test func triggerDateComponentsHaveTheExpectedNYWallClockValues() throws {
        let date = try #require(ChqTime.parse("2026-07-15 19:30:00"))
        let components = triggerDateComponents(for: date)

        #expect(components.year == 2026)
        #expect(components.month == 7)
        #expect(components.day == 15)
        #expect(components.hour == 19)
        #expect(components.minute == 30)
        #expect(components.timeZone == ChqTime.zone)
    }

    @Test func triggerDateComponentsHaveTheExpectedDSTAdjacentValues() throws {
        // 2026-11-01 23:30 NY time — chosen for the same DST-adversarial
        // reason as ReminderPlannerTests' equivalent case.
        let date = try #require(ChqTime.parse("2026-11-01 23:30:00"))
        let components = triggerDateComponents(for: date)

        #expect(components.year == 2026)
        #expect(components.month == 11)
        #expect(components.day == 1)
        #expect(components.hour == 23)
        #expect(components.minute == 30)
        #expect(components.timeZone == ChqTime.zone)
    }

    /// The real regression this guards against: `UNCalendarNotificationTrigger`
    /// (like `Calendar.date(from:)`) interprets a `DateComponents` with a
    /// `nil` `timeZone` in the *reconstructing* calendar's own zone, not
    /// implicitly in whatever zone the components were conceptually "about."
    ///
    /// This is why reconstructing via `ChqTime.calendar` (as the two tests
    /// above's predecessor did) is **not** adversarial: `ChqTime.calendar`
    /// is itself NY-pinned, so it would produce the correct instant whether
    /// or not `components.timeZone` was ever set — the bug and the fix are
    /// indistinguishable through that lens. Reconstructing instead through a
    /// calendar pinned to a *different* zone (Los Angeles, 3 hours behind
    /// New York in July) makes the two cases diverge: with `timeZone` set
    /// (the fix), `Calendar.date(from:)` honors `components.timeZone` and
    /// overrides the reconstructing calendar's own zone, so the result is
    /// unchanged — still the original NY instant. Without it (the bug this
    /// commit fixes), the same y/m/d/h/m values would instead be interpreted
    /// as 7:30 PM *Pacific*, landing exactly 3 hours (10800 seconds) later
    /// in absolute time — which is exactly the class of bug a
    /// `UNCalendarNotificationTrigger` built from these components would
    /// have hit for any user not on Eastern time.
    @Test func reconstructingViaADifferentZoneCalendarStillYieldsTheNYInstant() throws {
        let date = try #require(ChqTime.parse("2026-07-15 19:30:00"))
        let components = triggerDateComponents(for: date)

        var pacificCalendar = Calendar(identifier: .gregorian)
        pacificCalendar.timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))

        let reconstructed = try #require(pacificCalendar.date(from: components))
        #expect(reconstructed == date)
    }

    /// Same adversarial reconstruction, one layer closer to what actually
    /// gets scheduled: builds a real `UNCalendarNotificationTrigger` from
    /// `triggerDateComponents` and asks it for its own next fire date,
    /// rather than reconstructing the `DateComponents` by hand.
    /// `nextTriggerDate()` doesn't require notification authorization to
    /// call — it's pure date math over the trigger's own stored components —
    /// so this is safe to run in a unit test process. Uses a date far in the
    /// future so a non-repeating trigger's single occurrence reliably has a
    /// "next" date regardless of when this test happens to run.
    @Test func realUNCalendarNotificationTriggerFiresAtTheNYInstant() throws {
        let futureDate = try #require(ChqTime.parse("2030-07-15 19:30:00"))
        let trigger = UNCalendarNotificationTrigger(
            dateMatching: triggerDateComponents(for: futureDate),
            repeats: false
        )

        let next = try #require(trigger.nextTriggerDate())
        #expect(next == futureDate)
    }

    // MARK: - Reentrancy

    /// Forces two `sync(plan:)` calls to genuinely overlap — call A is
    /// parked mid-`add` via `MockScheduler.setSuspended()`, call B is issued
    /// (and, being chained behind A, cannot make any scheduling progress
    /// while A is still parked), then A is released — and asserts the final
    /// state is exactly plan B's, with no leftover item from plan A. Before
    /// `ReminderCenter.sync` serialized itself via `syncChain`, this
    /// interleaving (A's `removeAll` → B's `removeAll` → B's `add`s → A's
    /// leftover `add`) would have left `evt-a` incorrectly still pending
    /// alongside (or instead of) `evt-b`.
    @Test func overlappingSyncCallsConvergeOnTheLastPlanWithNoStaleLeftovers() async {
        let scheduler = MockScheduler()
        let center = ReminderCenter(scheduler: scheduler, now: { self.makeStart("2026-07-15 12:00:00") })

        let triggerA = makeStart("2026-07-15 19:00:00")
        let triggerB = makeStart("2026-07-15 20:00:00")
        let planA = [makePlanned(id: "evt-a", triggerDate: triggerA, eventStart: triggerA)]
        let planB = [makePlanned(id: "evt-b", triggerDate: triggerB, eventStart: triggerB)]

        scheduler.setSuspended()
        let taskA = Task { await center.sync(plan: planA) }

        // Wait until A has recorded its `removeAll` and is now parked
        // inside its own `add` call.
        await waitUntil("sync A reaches its parked add call") {
            scheduler.removeAllCallCount == 1
        }

        let taskB = Task { await center.sync(plan: planB) }
        // B links behind A in `syncChain` and awaits A's completion before
        // doing anything observable — give it a moment to (fail to) make
        // progress while A is still parked, proving the chain (not luck)
        // is what's holding it back.
        try? await Task.sleep(for: .milliseconds(50))
        #expect(scheduler.addCalls.isEmpty)

        scheduler.resume()
        await taskA.value
        await taskB.value

        #expect(scheduler.pendingIdentifiers == ["event-evt-b"])
        #expect(scheduler.addCalls.last?.identifier == "event-evt-b")
        #expect(!scheduler.pendingIdentifiers.contains("event-evt-a"))
    }
}
