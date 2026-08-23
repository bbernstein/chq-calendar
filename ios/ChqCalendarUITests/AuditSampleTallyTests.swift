import XCTest

/// Proves `AuditSampleTally`'s early exit changes only the *cost* of
/// `DayRailAccessibilityUITests.railIssues(in:attempts:)`, never its verdict.
///
/// This class launches no app. It is in `ChqCalendarUITests` because the type
/// it proves is UI-test infrastructure and belongs next to its only caller;
/// costing nothing to run, it does not meaningfully add to the UI leg it
/// exists to shorten.
///
/// The central test is exhaustive rather than exemplary: an off-by-one in a
/// majority rule is exactly the kind of defect a handful of hand-picked cases
/// walks past, and the whole state space here is small enough to enumerate.
final class AuditSampleTallyTests: XCTestCase {
    /// The pre-early-exit implementation, verbatim in behaviour: take every
    /// sample, then require a strict majority of them to be non-empty. This
    /// is the oracle the early-exit version must match.
    private func referenceReportsIssues(_ samplesFoundIssues: [Bool]) -> Bool {
        let nonEmpty = samplesFoundIssues.filter { $0 }.count
        return nonEmpty * 2 > samplesFoundIssues.count
    }

    /// Replays a sample sequence through `AuditSampleTally` the way
    /// `railIssues` does, stopping as soon as the verdict is settled empty.
    /// Returns the verdict and how many samples were actually consumed.
    private func earlyExit(_ samplesFoundIssues: [Bool]) -> (reportsIssues: Bool, taken: Int) {
        var tally = AuditSampleTally(attempts: samplesFoundIssues.count)
        for found in samplesFoundIssues {
            tally.record(foundIssues: found)
            if tally.isSettledEmpty { return (false, tally.taken) }
        }
        return (tally.foundMajority, tally.taken)
    }

    /// Every possible sequence of sample outcomes, for every plausible
    /// `attempts`, must produce the identical verdict with and without the
    /// early exit. This is the claim the change rests on — that it is a
    /// pure cost reduction — and enumerating 0...8 attempts covers 511
    /// sequences in well under a second. Zero is included because it is the
    /// one case the loop cannot reach by early exit; see
    /// `testZeroAttemptsReportsNothing`.
    func testEarlyExitNeverChangesTheVerdictForAnySampleSequence() {
        for attempts in 0...8 {
            for bits in 0..<(1 << attempts) {
                let samples = (0..<attempts).map { bits & (1 << $0) != 0 }
                let expected = referenceReportsIssues(samples)
                let actual = earlyExit(samples)
                XCTAssertEqual(
                    actual.reportsIssues, expected,
                    "verdict diverged for \(samples)")
                XCTAssertLessThanOrEqual(
                    actual.taken, attempts,
                    "early exit consumed more samples than it was given for \(samples)")
            }
        }
    }

    /// The saving this change exists to buy, pinned to a number: on the green
    /// path — every sample clean, which is every passing CI run — a 5-attempt
    /// audit performs three audits, not five.
    func testAnAllCleanRunStopsAfterThreeOfFiveSamples() {
        let result = earlyExit([false, false, false, false, false])
        XCTAssertFalse(result.reportsIssues)
        XCTAssertEqual(result.taken, 3)
    }

    /// The guard that keeps the saving from becoming a false negative: two
    /// clean samples are *not* enough to conclude, because samples 3, 4 and 5
    /// could still form a majority.
    func testTwoCleanSamplesDoNotSettleTheVerdict() {
        var tally = AuditSampleTally(attempts: 5)
        tally.record(foundIssues: false)
        tally.record(foundIssues: false)
        XCTAssertFalse(
            tally.isSettledEmpty,
            "settling after two of five would drop a regression found on the last three samples")
    }

    /// A real regression — the falsification runs in
    /// `DayRailAccessibilityUITests`' doc comment reproduced across every
    /// attempt — must still be reported, and must consume every sample so the
    /// richest one is available for the failure message.
    func testAConsistentRegressionIsReportedAndUsesEverySample() {
        let result = earlyExit([true, true, true, true, true])
        XCTAssertTrue(result.reportsIssues)
        XCTAssertEqual(
            result.taken, 5,
            "a reporting run must not short-circuit; railIssues picks the richest sample for its message")
    }

    /// The mistimed-sample case the resampling was added to absorb: a single
    /// spurious finding among clean samples stays unreported.
    func testOneSpuriousSampleAmongCleanOnesIsAbsorbed() {
        XCTAssertFalse(earlyExit([true, false, false, false, false]).reportsIssues)
        XCTAssertFalse(earlyExit([false, false, true, false, false]).reportsIssues)
    }

    /// The degenerate case, pinned because it is the one path on which
    /// `railIssues`' closing `guard tally.foundMajority` is still live logic
    /// rather than an invariant: with no attempts the loop never runs, nothing
    /// is tallied, and an empty tally must read as "nothing found" rather than
    /// as a majority of zero samples.
    func testZeroAttemptsReportsNothing() {
        let result = earlyExit([])
        XCTAssertFalse(result.reportsIssues)
        XCTAssertEqual(result.taken, 0)
        XCTAssertFalse(AuditSampleTally(attempts: 0).foundMajority)
    }

    /// A majority is strict: with an even `attempts`, a tie does not report.
    /// Pinned because `>` versus `>=` here is the difference between absorbing
    /// a mistimed sample and failing the build on one.
    func testATieIsNotAMajority() {
        XCTAssertFalse(earlyExit([true, true, false, false]).reportsIssues)
        XCTAssertTrue(earlyExit([true, true, true, false]).reportsIssues)
    }
}
