# Gate Pass Note in Event Detail (#163) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "General admission included with a Gate Pass" under the price in the iOS event detail view for Amphitheater events during the season (approved heuristic — no data source exposes access type; see the spec's investigation record).

**Architecture:** One pure `Domain` helper (`GatePassPolicy`) computes the heuristic from fields the app already has (`displayLocation`, `start`); `EventDetailView`'s existing ticket row renders a caption line when it returns true. No backend, network, or model changes.

**Tech Stack:** Swift 6, Swift Testing (`@Test`/`#expect`), SwiftUI.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-04-ios-gate-pass-weeks-links-design.md` (§ #163)
- Heuristic (verbatim): true iff `displayLocation` == "Amphitheater" (case-insensitive) AND `weeks.first.start <= event.start < weeks.last.end` for the event's own year (`SeasonCalendar.weeks(forYear:)`, year from `ChqTime.calendar`).
- Note copy (verbatim): `General admission included with a Gate Pass`
- The note renders only inside the existing cost row (`event.cost != nil`).
- Never commit to `main`. Branch: `feat/163-gate-pass-note` off `main`.
- iOS tests run locally (CI has no macOS runner):
  `cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO`

---

### Task 1: `GatePassPolicy` helper + tests

**Files:**
- Create: `ios/ChqCalendar/Domain/GatePassPolicy.swift`
- Create: `ios/ChqCalendarTests/GatePassPolicyTests.swift`

**Interfaces:**
- Consumes: `Event` (`displayLocation: String?`, `start: Date`), `SeasonCalendar.weeks(forYear:) -> [SeasonWeek]` (each week has `start`/`end`, noon-Saturday boundaries), `ChqTime.calendar` (Gregorian, America/New_York).
- Produces: `GatePassPolicy.includesGeneralAdmission(_ event: Event) -> Bool` — the only symbol Task 2 uses.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/163-gate-pass-note
```

- [ ] **Step 2: Write the failing tests**

Create `ios/ChqCalendarTests/GatePassPolicyTests.swift`. Note `makeEvent` (in `TestSupport.swift`) takes `location:` for `displayLocation` and defaults everything else. Dates are built through `ChqTime.calendar` so the season's noon-Eastern boundaries mean what the production code thinks they mean.

```swift
import Foundation
import Testing
@testable import ChqCalendar

struct GatePassPolicyTests {
    /// Aug 14, 2026 8:00 pm NY — in-season (Week 7), the Revivalists shape.
    private var inSeasonEvening: Date {
        date(2026, 8, 14, 20, 0)
    }

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int) -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h; c.minute = min
        return ChqTime.calendar.date(from: c)!
    }

    @Test func amphitheaterInSeasonIsIncluded() {
        let e = makeEvent(id: "rev", start: inSeasonEvening, location: "Amphitheater")
        #expect(GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func amphitheaterPostSeasonIsNotIncluded() {
        // Sept 10, 2026 — the Indigo Girls shape: same venue, after the season.
        let e = makeEvent(id: "indigo", start: date(2026, 9, 10, 19, 0), location: "Amphitheater")
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func amphitheaterPreSeasonIsNotIncluded() {
        let e = makeEvent(id: "early", start: date(2026, 6, 1, 19, 0), location: "Amphitheater")
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func otherVenuesAreNotIncluded() {
        let e = makeEvent(id: "hop", start: inSeasonEvening, location: "Hall of Philosophy")
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func missingLocationIsNotIncluded() {
        let e = makeEvent(id: "nowhere", start: inSeasonEvening, location: nil)
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func venueComparisonIsCaseInsensitive() {
        let e = makeEvent(id: "lower", start: inSeasonEvening, location: "amphitheater")
        #expect(GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func seasonBoundariesAreHalfOpen() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let first = weeks.first!, last = weeks.last!

        // Exactly at week 1's start (noon Sat): in.
        #expect(GatePassPolicy.includesGeneralAdmission(
            makeEvent(id: "open", start: first.start, location: "Amphitheater")))
        // One second before week 9's end: in.
        #expect(GatePassPolicy.includesGeneralAdmission(
            makeEvent(id: "last", start: last.end.addingTimeInterval(-1), location: "Amphitheater")))
        // Exactly at week 9's end (noon Sat): out — the season is over.
        #expect(!GatePassPolicy.includesGeneralAdmission(
            makeEvent(id: "closed", start: last.end, location: "Amphitheater")))
    }

    @Test func usesTheEventsOwnYear() {
        // An in-season 2025 date must be judged against the 2025 season,
        // not whatever year is current.
        let weeks2025 = SeasonCalendar.weeks(forYear: 2025)
        let e = makeEvent(
            id: "past-season",
            start: weeks2025.first!.start.addingTimeInterval(3600),
            location: "Amphitheater")
        #expect(GatePassPolicy.includesGeneralAdmission(e))
    }
}
```

- [ ] **Step 3: Run to verify they fail to compile**

```bash
cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/GatePassPolicyTests
```

Expected: build FAILURE — `cannot find 'GatePassPolicy' in scope`.

- [ ] **Step 4: Implement**

Create `ios/ChqCalendar/Domain/GatePassPolicy.swift`:

```swift
import Foundation

/// Whether Gate Pass holders get general admission to an event.
///
/// This is a **heuristic**, not data: chq.org stores per-event access as
/// protected WordPress post meta that no API exposes (investigation record
/// in docs/superpowers/specs/2026-08-04-ios-gate-pass-weeks-links-design.md).
/// The approved rule: Amphitheater events during the season admit Gate Pass
/// holders. Fail-safe by omission — an event this misses gets no note,
/// never a wrong one.
nonisolated enum GatePassPolicy {
    static func includesGeneralAdmission(_ event: Event) -> Bool {
        guard let location = event.displayLocation,
              location.caseInsensitiveCompare("Amphitheater") == .orderedSame
        else { return false }

        // The event's own year, in NY time — season weeks are computed per
        // year, so a 2025 event is judged against the 2025 season.
        let year = ChqTime.calendar.component(.year, from: event.start)
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let first = weeks.first, let last = weeks.last else { return false }
        return first.start <= event.start && event.start < last.end
    }
}
```

Add the new file to the Xcode project (the project uses folder-synchronized groups; confirm with `git status` that only the `.swift` files are new — if `ChqCalendar.xcodeproj/project.pbxproj` also changed, commit it too).

- [ ] **Step 5: Run tests to verify they pass**

Same command as Step 3. Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/Domain/GatePassPolicy.swift ios/ChqCalendarTests/GatePassPolicyTests.swift
git commit -m "feat(ios): GatePassPolicy heuristic — Amphitheater + in-season (#163)"
```

---

### Task 2: Render the note in the detail view's ticket row

**Files:**
- Modify: `ios/ChqCalendar/Features/Detail/EventDetailView.swift` (the `if let cost = event.cost` block, ~lines 57–61)

**Interfaces:**
- Consumes: `GatePassPolicy.includesGeneralAdmission(_:)` from Task 1; existing `detailRow(icon:content:)` helper.
- Produces: the visible note. No new API.

- [ ] **Step 1: Make the change**

Replace the cost row:

```swift
                        if let cost = event.cost {
                            detailRow(icon: "ticket") {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(cost)
                                    if GatePassPolicy.includesGeneralAdmission(event) {
                                        Text("General admission included with a Gate Pass")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
```

(The `VStack` + caption/secondary pattern is copied from the location row directly above it, so the two rows read identically.)

- [ ] **Step 2: Run the full iOS suite**

```bash
cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO
```

Expected: PASS. (View-body rendering isn't unit-tested in this project; the logic is fully covered by Task 1. The visual check is Task 3's screenshot run plus a simulator spot-check.)

- [ ] **Step 3: Spot-check in the simulator**

Launch the app (`xcodebuild build` + `xcrun simctl launch`, or via Xcode) and open one in-season Amphitheater event with a price (e.g. an evening concert): the caption must appear under the price. Open a Hall of Philosophy event with a price: no caption.

- [ ] **Step 4: Commit**

```bash
git add ios/ChqCalendar/Features/Detail/EventDetailView.swift
git commit -m "feat(ios): show Gate Pass general-admission note in detail price row (#163)"
```

---

### Task 3: Screenshots, listing copy, PR

**Files:**
- Modify (generated): `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/**`

**Interfaces:**
- Consumes: `ios/Scripts/capture-screenshots.sh`, `ios/Scripts/compose-screenshots.py`.
- Produces: an open PR closing #163.

- [ ] **Step 1: Regenerate screenshots**

The detail view changed visibly, and shot `04-detail` (also `05-articles`) shows it:

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
git status docs/app-store/
```

If the manifest changed, commit it with the review copies. If it did **not** change (the linked event the shot selects may not be an in-season Amphitheater event with a cost), the PR opt-out is: `[skip-screenshots: regenerated, no covered shot changed]`.

- [ ] **Step 2: Re-read listing copy**

Skim `docs/app-store/listing-copy.md` + `listing-fields.json`. The note adds information; it contradicts nothing. No edit expected — but confirm no claim like "shows exactly what chq.org shows" exists that the heuristic would strain.

- [ ] **Step 3: Commit screenshots (if changed), push, open PR**

```bash
git add docs/app-store/ && git commit -m "chore(app-store): regenerate screenshots for gate-pass note (#163)" || true
git push -u origin feat/163-gate-pass-note
gh pr create --title "feat(ios): Gate Pass general-admission note in event detail (#163)" --body "$(cat <<'EOF'
Closes #163.

Amphitheater events during the season now show "General admission included
with a Gate Pass" under the price in the detail view.

Why a heuristic: chq.org stores per-event access type as protected WordPress
post meta rendered server-side into event pages; no API exposes it (full
investigation record in docs/superpowers/specs/2026-08-04-ios-gate-pass-weeks-links-design.md).
The approved rule — Amphitheater + in-season — is computed from fields the
app already has, with no scraping and no new traffic. Fail-safe by omission.

- New `GatePassPolicy` (Domain) + 8 tests: venue match (case-insensitive),
  pre/in/post-season, half-open noon boundaries, event's-own-year.
- Detail view: caption under the price, same pattern as the venue-address
  subline. Renders only when a cost row renders.

iOS suite run locally (CI has no macOS runner): all tests pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_012mchpBcoJsknvac53PhHBQ
EOF
)"
```

Add the screenshot opt-out line to the body only if Step 1 concluded the manifest legitimately didn't change.
