import CoreGraphics
import Testing
@testable import ChqCalendar

struct WeekStripDragTests {
    // MARK: - geometry

    @Test func segmentsSplitTheWidthEvenly() {
        // 9 segments over 360pt → 40pt each; x=0 is week 1, x=359.9 week 9.
        #expect(WeekStripDrag.segment(atX: 0, width: 360, count: 9) == 1)
        #expect(WeekStripDrag.segment(atX: 39.9, width: 360, count: 9) == 1)
        #expect(WeekStripDrag.segment(atX: 40, width: 360, count: 9) == 2)
        #expect(WeekStripDrag.segment(atX: 359.9, width: 360, count: 9) == 9)
    }

    @Test func outOfBoundsTouchesClampToTheEdges() {
        // Drags routinely leave the view's bounds mid-gesture.
        #expect(WeekStripDrag.segment(atX: -50, width: 360, count: 9) == 1)
        #expect(WeekStripDrag.segment(atX: 400, width: 360, count: 9) == 9)
    }

    // MARK: - range (issue #162 rules 2 & 3)

    @Test func rangeIsOrderedRegardlessOfDragDirection() {
        #expect(WeekStripDrag.range(anchor: 3, current: 6) == 3...6)
        #expect(WeekStripDrag.range(anchor: 6, current: 3) == 3...6)
        #expect(WeekStripDrag.range(anchor: 4, current: 4) == 4...4)
    }

    // MARK: - commit (issue #162 rule 1 + toggle-off)

    @Test func tapSelectsASingleWeekReplacingOthers() {
        #expect(WeekStripDrag.commit(anchor: 6, current: 6, existing: [3]) == [6])
        #expect(WeekStripDrag.commit(anchor: 6, current: 6, existing: [1, 2, 3]) == [6])
    }

    @Test func tapOnTheOnlySelectedWeekDeselects() {
        #expect(WeekStripDrag.commit(anchor: 4, current: 4, existing: [4]) == [])
    }

    @Test func tapOnAWeekInsideALargerSelectionSelectsJustIt() {
        // Not a toggle-off: the selection wasn't exactly this one week.
        #expect(WeekStripDrag.commit(anchor: 4, current: 4, existing: [3, 4, 5]) == [4])
    }

    @Test func dragCommitsTheContiguousRange() {
        #expect(WeekStripDrag.commit(anchor: 3, current: 6, existing: []) == [3, 4, 5, 6])
        // Retreating drag (3→8→back to 6) ends with current == 6: rule 3.
        #expect(WeekStripDrag.commit(anchor: 3, current: 6, existing: [9]) == [3, 4, 5, 6])
    }

    // MARK: - extend (VoiceOver custom action)

    @Test func extendGrowsTheSelectionIntoOneContiguousRange() {
        #expect(WeekStripDrag.extended(from: [3, 4], to: 7) == [3, 4, 5, 6, 7])
        #expect(WeekStripDrag.extended(from: [5], to: 2) == [2, 3, 4, 5])
        // Non-contiguous persisted selection: the result heals to one run.
        #expect(WeekStripDrag.extended(from: [2, 8], to: 5) == [2, 3, 4, 5, 6, 7, 8])
    }

    @Test func extendFromEmptyIsPlainSelection() {
        #expect(WeekStripDrag.extended(from: [], to: 5) == [5])
    }
}
