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

    // MARK: - triggerDateComponents

    /// Pins that the components handed to `UNCalendarNotificationTrigger`
    /// reconstruct the exact intended NY wall-clock instant — the guard
    /// against a bug where trigger components were built from the device's
    /// local calendar instead of `ChqTime.calendar`, which would fire the
    /// notification at the wrong instant for any device not set to Eastern
    /// time.
    @Test func triggerDateComponentsReconstructTheIntendedNYWallClockTime() throws {
        let date = try #require(ChqTime.parse("2026-07-15 19:30:00"))
        let components = triggerDateComponents(for: date)

        #expect(components.year == 2026)
        #expect(components.month == 7)
        #expect(components.day == 15)
        #expect(components.hour == 19)
        #expect(components.minute == 30)

        let reconstructed = try #require(ChqTime.calendar.date(from: components))
        #expect(reconstructed == date)
    }

    @Test func triggerDateComponentsAreDSTSafe() throws {
        // 2026-11-01 23:30 NY time — chosen for the same DST-adversarial
        // reason as ReminderPlannerTests' equivalent case.
        let date = try #require(ChqTime.parse("2026-11-01 23:30:00"))
        let components = triggerDateComponents(for: date)

        #expect(components.year == 2026)
        #expect(components.month == 11)
        #expect(components.day == 1)
        #expect(components.hour == 23)
        #expect(components.minute == 30)

        let reconstructed = try #require(ChqTime.calendar.date(from: components))
        #expect(reconstructed == date)
    }
}
