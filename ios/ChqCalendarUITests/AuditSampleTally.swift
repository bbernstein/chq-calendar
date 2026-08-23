import Foundation

/// The majority rule `DayRailAccessibilityUITests.railIssues(in:attempts:)`
/// applies across its repeated accessibility-audit samples, lifted out of the
/// sampling loop so it can be proved exhaustively without launching an app.
///
/// **Why this exists as a separate type.** The rule itself is three lines of
/// arithmetic, but it decides whether a merge-gating audit reports or stays
/// silent, and the early exit below changes how many samples get taken. Both
/// are worth proving rather than eyeballing, and neither can be proved from
/// inside an XCUITest: reaching `railIssues` at all costs an app launch and
/// several whole-app audits, so an exhaustive check of every sample sequence
/// would be the single most expensive test in the repo. As a plain value type
/// the same check runs over every sequence in microseconds — see
/// `AuditSampleTallyTests`.
///
/// **Why the early exit is safe.** `isSettledEmpty` fires only when no
/// remaining sample could lift `nonEmpty` to a majority — that is, only when
/// the run's verdict is already `[]`. An empty verdict carries no diagnostic
/// content (`railIssues`' "report the richest sample" logic exists to make a
/// *failure* message complete, and there is no failure message here), so
/// stopping early loses nothing at all: same verdict, same reported issues,
/// fewer audits. The converse case is deliberately *not* short-circuited —
/// once a majority is already reached, sampling continues to the end so the
/// richest sample is still available for the failure message.
///
/// On the green path this is the whole point: with `attempts == 5`, three
/// empty samples settle the verdict, so a passing audit runs three whole-app
/// audits instead of five.
struct AuditSampleTally {
    /// The total number of samples the caller intends to take.
    let attempts: Int

    /// How many samples have been recorded so far.
    private(set) var taken = 0

    /// How many of those samples found at least one in-scope issue.
    private(set) var nonEmpty = 0

    init(attempts: Int) {
        self.attempts = attempts
    }

    mutating func record(foundIssues: Bool) {
        taken += 1
        if foundIssues { nonEmpty += 1 }
    }

    /// True once even a clean sweep of the remaining samples could not reach
    /// a majority — so the verdict is already `[]` and further sampling
    /// cannot change it.
    var isSettledEmpty: Bool {
        (nonEmpty + (attempts - taken)) * 2 <= attempts
    }

    /// Whether a strict majority of samples found something. Mirrors the
    /// original `nonEmptySamples.count * 2 > attempts` guard exactly; a tie
    /// (2 of 4) is not a majority and does not report.
    var foundMajority: Bool {
        nonEmpty * 2 > attempts
    }
}
