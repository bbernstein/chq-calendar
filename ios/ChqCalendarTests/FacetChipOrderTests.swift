import Testing
@testable import ChqCalendar

struct FacetChipOrderTests {
    /// Four venues whose count order is deliberately *not* their
    /// alphabetical order, so a test that accidentally sorts by name fails.
    private let all = ["Amphitheater", "Bestor Plaza", "Lenna Hall", "Norton Hall"]
    private let counts = ["amphitheater": 166, "bestor plaza": 69, "lenna hall": 25, "norton hall": 40]

    private func count(_ name: String) -> Int { counts[name.lowercased()] ?? 0 }

    private func build(
        selected: Set<String> = [],
        recent: [String] = [],
        all: [String]? = nil,
        recentLimit: Int = 5,
        visibleLimit: Int = 8
    ) -> [FacetChipOrder.Entry] {
        let names = all ?? self.all
        let lowered = Set(selected.map { $0.lowercased() })
        return FacetChipOrder.build(
            all: names,
            isSelected: { lowered.contains($0.lowercased()) },
            recent: recent,
            count: count,
            recentLimit: recentLimit,
            visibleLimit: visibleLimit)
    }

    @Test func withNoRecentsOrderIsCountDescending() {
        let result = build()
        #expect(result.map(\.name) == ["Amphitheater", "Bestor Plaza", "Norton Hall", "Lenna Hall"])
        #expect(result.allSatisfy { !$0.isRecent })
    }

    @Test func selectedLeadInAvailableOrder() {
        // Alphabetical (Lenna, Norton) and count-descending (Norton 40 >
        // Lenna 25) disagree here, so a selected group accidentally
        // re-sorted by count would fail this — unlike the old fixture
        // (Bestor, Lenna), where both orderings coincided.
        let result = build(selected: ["Lenna Hall", "Norton Hall"])
        #expect(result.map(\.name) == ["Lenna Hall", "Norton Hall", "Amphitheater", "Bestor Plaza"])
    }

    @Test func recentsFollowSelectedAndBeatHigherCounts() {
        let result = build(recent: ["Lenna Hall"])
        #expect(result.map(\.name) == ["Lenna Hall", "Amphitheater", "Bestor Plaza", "Norton Hall"])
        #expect(result[0].isRecent)
        #expect(!result[1].isRecent)
    }

    @Test func recentsKeepRecencyOrderNotCountOrder() {
        let result = build(recent: ["Lenna Hall", "Amphitheater"])
        #expect(result.prefix(2).map(\.name) == ["Lenna Hall", "Amphitheater"])
    }

    /// Closes #157: a name remembered from another year is not in `all`,
    /// so it must not render at all — it would carry a count of 0 and
    /// silently produce an empty list.
    @Test func recentAbsentFromAllIsOmitted() {
        let result = build(recent: ["Hall of Christ", "Lenna Hall"])
        #expect(!result.map(\.name).contains("Hall of Christ"))
        #expect(result[0].name == "Lenna Hall")
    }

    /// `recents` is never casing-normalized against the snapshot, so the
    /// stored value may differ. The emitted name must be the snapshot's,
    /// because `DisplayNames` is an exact-match lookup.
    @Test func recentResolvesToCanonicalCasing() {
        let result = build(recent: ["lenna HALL"])
        #expect(result[0].name == "Lenna Hall")
        #expect(result[0].isRecent)
    }

    @Test func recentLimitCapsHowManyRecentsShow() {
        let result = build(recent: ["Lenna Hall", "Norton Hall", "Bestor Plaza"], recentLimit: 2)
        #expect(result.filter(\.isRecent).map(\.name) == ["Lenna Hall", "Norton Hall"])
    }

    @Test func aValueThatIsBothSelectedAndRecentAppearsOnce() {
        let result = build(selected: ["Lenna Hall"], recent: ["Lenna Hall"])
        #expect(result.filter { $0.name == "Lenna Hall" }.count == 1)
        #expect(result[0].name == "Lenna Hall")
        #expect(!result[0].isRecent)
    }

    /// Before `tailFloor` (FIX 1), a selected value and a recent always
    /// survived together and only the count-ordered tail was cut. That
    /// guarantee was deliberately narrowed: `tailFloor` reserves room for
    /// the count-ordered tail ahead of recents, so at a small enough
    /// `visibleLimit` a recent can lose its slot entirely. Here
    /// `recentsAllowed = min(5, max(0, 2 - 1 - 3)) = 0`, so "Norton Hall"
    /// is dropped from recents and the freed slot goes to the top
    /// count-ordered name instead. This is intentional, not a regression —
    /// do not "fix" it back to reserving the recent's slot.
    @Test func recentsYieldToTailFloorAtASmallVisibleLimit() {
        let result = build(selected: ["Lenna Hall"], recent: ["Norton Hall"], visibleLimit: 2)
        #expect(result.map(\.name) == ["Lenna Hall", "Amphitheater"])
        #expect(result.allSatisfy { !$0.isRecent })
    }

    /// Still guards the `prefix(negative)` trap in the `remaining`
    /// computation — that part of FIX 1 was left untouched. What changed
    /// is the expected output: with `tailFloor` in effect, the recent
    /// ("Bestor Plaza") no longer survives a `visibleLimit` this small
    /// (`recentsAllowed = min(5, max(0, 1 - 2 - 3)) = 0`); only the two
    /// selected values do. Intentional narrowing from FIX 1, not a bug.
    @Test func visibleLimitNeverGoesNegative() {
        let result = build(selected: ["Lenna Hall", "Norton Hall"], recent: ["Bestor Plaza"], visibleLimit: 1)
        #expect(result.map(\.name) == ["Lenna Hall", "Norton Hall"])
    }

    /// The invariant that DID survive FIX 1: every selected value renders
    /// no matter what, even when selections alone blow past `visibleLimit`
    /// and `tailFloor` would zero out everything else. `tailFloor` narrows
    /// the *recents* budget, never the selected set.
    @Test func selectedAlwaysRendersEvenWhenSelectionsExceedVisibleLimit() {
        let result = build(
            selected: ["Amphitheater", "Bestor Plaza", "Norton Hall"],
            recent: ["Lenna Hall"],
            visibleLimit: 1)
        #expect(result.map(\.name) == ["Amphitheater", "Bestor Plaza", "Norton Hall"])
        #expect(result.allSatisfy { !$0.isRecent })
    }

    @Test func emptyAllProducesEmptyResult() {
        #expect(build(recent: ["Lenna Hall"], all: []).isEmpty)
    }

    // MARK: - Production pair (recentLimit 5, visibleLimit 8)

    /// Pins the constants the feature actually ships with: with ~10 names
    /// available and no selection, all 5 recents fit and 3 count-ordered
    /// slots remain — the tail is never squeezed to zero.
    @Test func productionPairWithNoSelectionShowsAllRecentsAndTailFloor() {
        let names = [
            "Amphitheater", "Bestor Plaza", "Norton Hall", "Lenna Hall",
            "Hall of Philosophy", "Smith Wilkes Hall", "Hurlbut Church",
            "Sports Club", "Miller Bell Tower", "Turner Community Center",
        ]
        let recentCounts: [String: Int] = [
            "amphitheater": 166, "bestor plaza": 69, "norton hall": 40,
            "lenna hall": 25, "hall of philosophy": 90, "smith wilkes hall": 30,
            "hurlbut church": 20, "sports club": 15, "miller bell tower": 10,
            "turner community center": 5,
        ]
        let recent = ["Miller Bell Tower", "Sports Club", "Hurlbut Church", "Smith Wilkes Hall", "Norton Hall"]
        let result = FacetChipOrder.build(
            all: names,
            isSelected: { _ in false },
            recent: recent,
            count: { recentCounts[$0.lowercased()] ?? 0 },
            recentLimit: 5,
            visibleLimit: 8)
        #expect(result.filter(\.isRecent).map(\.name) == recent)
        let tail = result.filter { !$0.isRecent }
        #expect(tail.count == 3)
        #expect(tail.map(\.name) == ["Amphitheater", "Hall of Philosophy", "Bestor Plaza"])
    }

    /// With 3 selections at the production pair, `tailFloor` caps recents to
    /// 2 (not the full `recentLimit` of 5) so 3 count-ordered slots survive.
    @Test func productionPairWithThreeSelectedReservesTailFloor() {
        let names = [
            "Amphitheater", "Bestor Plaza", "Norton Hall", "Lenna Hall",
            "Hall of Philosophy", "Smith Wilkes Hall", "Hurlbut Church",
            "Sports Club", "Miller Bell Tower", "Turner Community Center",
        ]
        let selected: Set<String> = ["Hurlbut Church", "Sports Club", "Miller Bell Tower"]
        let recentCounts: [String: Int] = [
            "amphitheater": 166, "bestor plaza": 69, "norton hall": 40,
            "lenna hall": 25, "hall of philosophy": 90, "smith wilkes hall": 30,
            "hurlbut church": 20, "sports club": 15, "miller bell tower": 10,
            "turner community center": 5,
        ]
        let recent = ["Turner Community Center", "Lenna Hall", "Norton Hall"]
        let result = FacetChipOrder.build(
            all: names,
            isSelected: { selected.contains($0) },
            recent: recent,
            count: { recentCounts[$0.lowercased()] ?? 0 },
            recentLimit: 5,
            visibleLimit: 8)
        #expect(result.prefix(3).map(\.name) == ["Hurlbut Church", "Sports Club", "Miller Bell Tower"])
        let recents = result.filter(\.isRecent)
        #expect(recents.count == 2)
        #expect(recents.map(\.name) == ["Turner Community Center", "Lenna Hall"])
        let tail = result.filter { !$0.isRecent && !selected.contains($0.name) }
        #expect(tail.count == 3)
        #expect(tail.map(\.name) == ["Amphitheater", "Hall of Philosophy", "Bestor Plaza"])
    }
}
