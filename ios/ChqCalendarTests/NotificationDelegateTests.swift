import Foundation
import Testing
@testable import ChqCalendar

/// `NotificationDelegate.didReceive` itself is not exercised here:
/// `UNNotificationResponse`/`UNNotification` have no public initializer, so
/// there is no way to construct a real one in a test process (see the type's
/// own doc comment). What actually matters — the `userInfo` → event id
/// mapping — is pulled out into `NotificationDelegate.eventID(from:)`
/// precisely so it has a seam these tests can exercise directly, leaving
/// `didReceive` a thin, deliberately-untested shim over it.
@MainActor
struct NotificationDelegateTests {
    @Test func eventIDExtractsTheStringValue() {
        let userInfo: [AnyHashable: Any] = ["eventID": "101037"]
        #expect(NotificationDelegate.eventID(from: userInfo) == "101037")
    }

    @Test func eventIDIsNilWhenTheKeyIsMissing() {
        #expect(NotificationDelegate.eventID(from: [:]) == nil)
    }

    @Test func eventIDIsNilWhenTheValueIsTheWrongType() {
        // A malformed/foreign payload (e.g. a numeric id from some other
        // notification source) must not crash the `as?` cast.
        let userInfo: [AnyHashable: Any] = ["eventID": 101_037]
        #expect(NotificationDelegate.eventID(from: userInfo) == nil)
    }

    @Test func onOpenEventFiresWithTheExtractedID() {
        let delegate = NotificationDelegate()
        var receivedID: String?
        delegate.onOpenEvent = { receivedID = $0 }

        if let eventID = NotificationDelegate.eventID(from: ["eventID": "101037"]) {
            delegate.onOpenEvent?(eventID)
        }

        #expect(receivedID == "101037")
    }
}
