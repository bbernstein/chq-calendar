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
        visibleLimit: Int = 12
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
        let result = build(selected: ["Lenna Hall", "Bestor Plaza"])
        #expect(result.prefix(2).map(\.name) == ["Bestor Plaza", "Lenna Hall"])
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

    @Test func visibleLimitTruncatesOnlyTheCountOrderedTail() {
        let result = build(selected: ["Lenna Hall"], recent: ["Norton Hall"], visibleLimit: 2)
        // Both the selected and the recent survive even though they alone
        // meet the limit; only the count-ordered tail is cut.
        #expect(result.map(\.name) == ["Lenna Hall", "Norton Hall"])
    }

    @Test func visibleLimitNeverGoesNegative() {
        let result = build(selected: ["Lenna Hall", "Norton Hall"], recent: ["Bestor Plaza"], visibleLimit: 1)
        #expect(result.map(\.name) == ["Lenna Hall", "Norton Hall", "Bestor Plaza"])
    }

    @Test func emptyAllProducesEmptyResult() {
        #expect(build(recent: ["Lenna Hall"], all: []).isEmpty)
    }
}
