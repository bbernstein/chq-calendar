import Testing

struct SmokeTests {
    @Test func targetBuildsAndRuns() {
        #expect(1 + 1 == 2)
    }
}
