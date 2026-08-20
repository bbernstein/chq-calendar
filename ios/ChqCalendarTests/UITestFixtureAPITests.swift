import Foundation
import Testing
@testable import ChqCalendar

/// The fixture is the ground truth every UI test asserts against, so its
/// shape is pinned here rather than discovered by a failing UI test — a
/// XCUITest failure tells you "the chip was not found", never "the fixture
/// stopped emitting that day".
struct UITestFixtureAPITests {
    @Test func eventsPayloadDecodesThroughTheRealRepositoryPath() async throws {
        let repo = UITestFixture.makeRepository()
        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(!snapshot.events.isEmpty)
        let days = Set(snapshot.events.map { ChqTime.dayKey(for: $0.start) })
        #expect(days.contains("2026-06-27"))
        #expect(days.contains("2026-08-23"))
    }

    /// Empty days are what make a rail interesting: a chip with no events is
    /// not a destination, and the chevrons must skip it. If the fixture were
    /// dense, Task 11's "step past the gap" assertion would pass for the
    /// wrong reason.
    @Test func everyThirdDayIsEmptySoGapsAreExercised() async throws {
        let repo = UITestFixture.makeRepository()
        let snapshot = try await repo.refresh(year: 2026, force: true)
        let days = Set(snapshot.events.map { ChqTime.dayKey(for: $0.start) })

        #expect(!days.contains("2026-06-29"))
        #expect(days.contains("2026-06-30"))
    }

    @Test func yearsManifestNamesTwentyTwentySixAsDefault() async {
        let repo = UITestFixture.makeRepository()
        let manifest = await repo.availableYears()

        #expect(manifest.defaultYear == 2026)
        #expect(manifest.years.contains(2026))
    }

    /// Sidecars are not part of what the rail shows, and `EventRepository`
    /// already degrades gracefully when they fail — pinned here so a future
    /// reader does not "fix" the fixture by inventing sidecar payloads.
    @Test func sidecarResourcesFailWithoutBreakingTheSnapshot() async throws {
        let repo = UITestFixture.makeRepository()
        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(snapshot.articleLinks.isEmpty)
        #expect(snapshot.programLinks.isEmpty)
    }
}
