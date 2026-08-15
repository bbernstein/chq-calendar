import Foundation
import Testing
@testable import ChqCalendar

struct EffectiveScopeTests {

    @Test func currentYearKeepsEveryRelativeScope() {
        for scope in [DateScope.next, .today, .thisWeek, .season, .all] {
            #expect(
                EffectiveScope.resolve(scope: scope, selectedDayKey: nil, isCurrentYear: true) == scope,
                "scope \(scope)")
        }
    }

    @Test func pastSeasonDowngradesEveryScopeButDay() {
        for scope in [DateScope.next, .today, .thisWeek, .season] {
            #expect(
                EffectiveScope.resolve(scope: scope, selectedDayKey: nil, isCurrentYear: false) == .all,
                "scope \(scope)")
        }
    }

    @Test func activeDaySurvivesThePastSeasonDowngrade() {
        #expect(
            EffectiveScope.resolve(
                scope: .day, selectedDayKey: "2026-07-15", isCurrentYear: false) == .day)
    }

    @Test func keylessDayResolvesToAllOnBothYearAxes() {
        // A .day naming no date filters nothing, which is exactly what .all
        // means. Resolving it here is what lets all three consumers stop
        // special-casing it.
        for isCurrentYear in [true, false] {
            #expect(
                EffectiveScope.resolve(
                    scope: .day, selectedDayKey: nil, isCurrentYear: isCurrentYear) == .all,
                "isCurrentYear=\(isCurrentYear)")
        }
    }

    @Test func allStaysAll() {
        for isCurrentYear in [true, false] {
            #expect(
                EffectiveScope.resolve(
                    scope: .all, selectedDayKey: nil, isCurrentYear: isCurrentYear) == .all)
        }
    }

    @Test func resolvingIsIdempotent() {
        // Resolving a resolved scope must be a no-op, or a consumer that
        // resolves twice (or resolves an already-resolved value handed to it)
        // gets a different answer than one that resolves once.
        for scope in DateScope.allCases {
            let once = EffectiveScope.resolve(
                scope: scope, selectedDayKey: "2026-07-15", isCurrentYear: false)
            let twice = EffectiveScope.resolve(
                scope: once, selectedDayKey: "2026-07-15", isCurrentYear: false)
            #expect(once == twice, "scope \(scope): \(once) then \(twice)")
        }
    }
}
