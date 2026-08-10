# iOS Recent Filter Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the user's recently-used venues and categories at the front of the iOS filter sheet's chip clouds, and shrink chips so both facets fit on screen at once.

**Architecture:** The persistence half already ships — `RecentFilters` stores the last 10 values per facet and `AppModel.toggleLocation`/`toggleCategory` already promote on select. This plan adds a pure, testable `FacetChipOrder` type that merges recents into the existing count-descending order, rewires `FacetChipCloud` to use it, and adjusts `SheetChip` metrics. No new persistence, no new model state, no navigation changes.

**Tech Stack:** Swift 6, SwiftUI, Swift Testing (`import Testing`, `@Test`, `#expect`), Xcode 26+.

## Global Constraints

- **Never commit to `main`.** Work happens on `feat/ios-recent-filter-chips`, already created and checked out.
- **New `.swift` files need no `project.pbxproj` edit.** The project uses `PBXFileSystemSynchronizedRootGroup` for both `ChqCalendar/` and `ChqCalendarTests/`, so files are picked up by path. Do not hand-edit the pbxproj. (It has unrelated pre-existing modifications — leave them alone and never `git add` it.)
- **`docs/outreach/` is gitignored and must stay uncommitted.**
- **Tests use Swift Testing, not XCTest.** Suites are plain `struct`s; assertions are `#expect(...)`.
- `recentLimit` = **5**. `visibleLimit` = **8**. Storage stays at 10 (unchanged).
  (This plan originally said 12. That value failed Task 3's fold check — 12 chips
  wrap to seven rows on real venue names — and was reverted to 8 by human ruling,
  then re-verified by screenshot. Task 1's code block below still shows `= 12` as
  the `build` *default*; production always passes the value explicitly, so the
  default is unused. See the spec's Correction note.)
- Chip metrics: `.footnote`, horizontal padding **10**, vertical padding **6**, `minHeight` **36** (a floor, never a fixed frame). `FlowLayout` spacing **6**.
- Names in `FilterSelection` and `RecentFilters` carry the **feed's original casing**; comparison is lowercased at the point of use. Never lowercase a stored value.
- Spec: `docs/superpowers/specs/2026-08-06-ios-recent-filter-chips-design.md`. Issue: #172.

## File Structure

| File | Responsibility |
|---|---|
| `ios/ChqCalendar/Domain/FacetChipOrder.swift` (create) | Pure ordering: selected → recent → count-descending, with casing resolution and truncation. No SwiftUI. |
| `ios/ChqCalendarTests/FacetChipOrderTests.swift` (create) | Unit tests for the above. |
| `ios/ChqCalendar/Features/Filters/FacetChipCloud.swift` (modify) | Delegates ordering to `FacetChipOrder`; passes `isRecent` to chips; spacing 8 → 6. |
| `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift` (modify, `SheetChip` at :127-165) | Chip metrics + new `isRecent` marker and accessibility label. |
| `ios/ChqCalendar/Features/Filters/FilterSheet.swift` (modify, :78) | Active-chip `minHeight` 44 → 36 to match. |

**Task order rationale:** Task 1 is pure logic with no UI dependency and must land first because Tasks 2 and 3 consume its types. Task 2 changes `SheetChip`'s API (adds `isRecent`), which Task 3 calls. Task 4 is verification-only and cannot run until the UI is final.

---

### Task 1: `FacetChipOrder` — the pure ordering type

**Files:**
- Create: `ios/ChqCalendar/Domain/FacetChipOrder.swift`
- Test: `ios/ChqCalendarTests/FacetChipOrderTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `FacetChipOrder.Entry` (`let name: String`, `let isRecent: Bool`, `var id: String`) and `FacetChipOrder.build(all:isSelected:recent:count:recentLimit:visibleLimit:) -> [Entry]`. Task 3 calls exactly this.

- [ ] **Step 1: Write the failing test file**

Create `ios/ChqCalendarTests/FacetChipOrderTests.swift`:

```swift
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
xcodebuild test -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
  -only-testing:ChqCalendarTests/FacetChipOrderTests 2>&1 | tail -30
```

Expected: **compile failure**, `cannot find 'FacetChipOrder' in scope`. A compile error is the correct "red" here — the type does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendar/Domain/FacetChipOrder.swift`:

```swift
import Foundation

/// Decides which of a facet's values become chips, and in what order:
/// **selected → recently used → count-descending.**
///
/// Ordering is the feature. The feed carries 64 venues, so no flat list
/// fits and no fixed subset is right for everyone. Selected-first
/// guarantees a selection is never scrolled out of sight. Recents next
/// surface the values *this* user keeps picking — Lenna Hall ranks 21st of
/// 64 by count, so count-ordering alone can never reach it. Count-order
/// fills the rest.
///
/// Lives in `Domain/` and takes closures rather than the model so it stays
/// a pure function: `FacetChipCloud` renders it, but every rule here is
/// testable without SwiftUI.
nonisolated enum FacetChipOrder {
    /// One chip. `name` is always the **snapshot's** casing, never a
    /// stored recent's, because `DisplayNames` is an exact-match lookup.
    struct Entry: Equatable, Identifiable {
        let name: String
        let isRecent: Bool
        var id: String { name }
    }

    /// - Parameters:
    ///   - all: every value available in the current snapshot, in display order.
    ///   - isSelected: whether a value is in the current filter.
    ///   - recent: remembered values, most-recent-first, in whatever casing
    ///     was stored. Entries absent from `all` are dropped — that is what
    ///     stops a name remembered from another year rendering as a live
    ///     chip that matches nothing (#157).
    ///   - count: events a value would leave, given the rest of the selection.
    ///   - recentLimit: how many recents may show. Storage keeps more; the
    ///     surplus absorbs entries dropped by the `all` check.
    ///   - visibleLimit: soft cap. Selected values and surviving recents
    ///     always render; only the count-ordered tail is truncated.
    static func build(
        all: [String],
        isSelected: (String) -> Bool,
        recent: [String],
        count: (String) -> Int,
        recentLimit: Int = 5,
        visibleLimit: Int = 12
    ) -> [Entry] {
        let selected = all.filter(isSelected)

        // Resolve each stored recent to the snapshot's casing. `recents` is
        // never run through `normalizePersistedFilterCasing`, so the stored
        // value can differ; an unresolved name would render with raw feed
        // casing instead of its `DisplayNames` shortcut.
        let canonical = Dictionary(
            all.map { ($0.lowercased(), $0) },
            uniquingKeysWith: { first, _ in first })

        var seen = Set(selected.map { $0.lowercased() })
        var recents: [String] = []
        for name in recent {
            guard recents.count < recentLimit else { break }
            let key = name.lowercased()
            guard let resolved = canonical[key], !seen.contains(key) else { continue }
            seen.insert(key)
            recents.append(resolved)
        }

        let remaining = max(0, visibleLimit - selected.count - recents.count)
        let tail = all
            .filter { !seen.contains($0.lowercased()) }
            .sorted { count($0) > count($1) }
            .prefix(remaining)

        return selected.map { Entry(name: $0, isRecent: false) }
            + recents.map { Entry(name: $0, isRecent: true) }
            + tail.map { Entry(name: $0, isRecent: false) }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
xcodebuild test -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
  -only-testing:ChqCalendarTests/FacetChipOrderTests 2>&1 | tail -30
```

Expected: **11 tests, 0 failures.**

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Domain/FacetChipOrder.swift ios/ChqCalendarTests/FacetChipOrderTests.swift
git commit -m "feat(ios): FacetChipOrder puts recently-used values ahead of count order

Extracts chip ordering out of FacetChipCloud's private computed var into a
pure Domain type so it can be tested without SwiftUI, and adds recents
between the selected and count-ordered groups.

Recents are resolved to the snapshot's casing before use: RecentFilters is
never run through normalizePersistedFilterCasing, and DisplayNames is an
exact-match lookup, so an unresolved name renders with raw feed casing
instead of its shortcut. The same resolve drops recents absent from the
current year, which is what kept the old recents strip from shipping (#157).

Not yet wired into the view.

Refs #172"
```

---

### Task 2: `SheetChip` — 36pt metrics and the recent marker

**Files:**
- Modify: `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift:127-165`
- Modify: `ios/ChqCalendar/Features/Filters/FilterSheet.swift:78`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `SheetChip` gains `var isRecent: Bool = false`, positioned **after** `count` and **before** `isSelected` in the memberwise initializer. Task 3 calls `SheetChip(label:count:isRecent:isSelected:action:)`. The default keeps all four existing call sites compiling untouched.

- [ ] **Step 1: Replace the `SheetChip` body**

In `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift`, replace lines 127-165 (`struct SheetChip` through its closing brace) with:

```swift
struct SheetChip: View {
    let label: String
    var count: Int?
    /// Marks a value the user picked recently. Renders a leading dot, and
    /// is announced by VoiceOver — without that the distinction would be
    /// purely visual. Only ever true for *unselected* chips: a selected
    /// chip is already accent-filled with a checkmark and has moved to the
    /// front group, so a dot inside it would be noise.
    var isRecent: Bool = false
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                } else if isRecent {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 5, height: 5)
                }
                labelText
                if let count {
                    Text("\(count)")
                        .monospacedDigit()
                        .foregroundStyle(isSelected ? .white.opacity(0.7) : .secondary)
                }
            }
            // Metrics are deliberately below the 44pt HIG floor, which
            // governs isolated controls rather than dense grids of
            // same-kind, adjacent, non-destructive targets. 36pt is the
            // threshold at which Venues and Categories both clear the fold
            // at the sheet's medium detent — the whole point of the change.
            // `minHeight` is a floor, and the vertical padding is what
            // keeps the text breathing at large Dynamic Type sizes, where
            // the floor stops binding.
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(minHeight: 36)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isSelected
                    ? AnyShapeStyle(Color.accentColor)
                    : AnyShapeStyle(.quaternary),
                in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voiceOverLabel)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    /// Set explicitly rather than inferred, because the recency dot is a
    /// bare `Circle` with no implicit VoiceOver label. Keeps the count in
    /// the announcement, which the inferred label included.
    ///
    /// Named `voiceOverLabel`, not `accessibilityLabel`, so it cannot be
    /// confused with the SwiftUI modifier of that name one line above.
    private var voiceOverLabel: String {
        var parts = [label]
        if isRecent { parts.append("recently used") }
        if let count { parts.append("\(count) events") }
        return parts.joined(separator: ", ")
    }

    private var labelText: some View {
        Text(label)
            .lineLimit(1)
    }
}
```

- [ ] **Step 2: Match the Active chips in `FilterSheet`**

In `ios/ChqCalendar/Features/Filters/FilterSheet.swift`, in `activeSection` (line 78), change:

```swift
                        .frame(minHeight: 44)
```

to:

```swift
                        .frame(minHeight: 36)
```

- [ ] **Step 3: Build to verify nothing broke**

```bash
xcodebuild build -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' 2>&1 | tail -20
```

Expected: **BUILD SUCCEEDED.** `isRecent` has a default, so the existing `SheetChip` call sites in `DateFilterSheet`, `FacetChipCloud`, and `FilterSheet`'s favorites section need no change.

- [ ] **Step 4: Run the full test suite**

```bash
xcodebuild test -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' 2>&1 | tail -20
```

Expected: all pass. These are pure metric and accessibility changes; no test asserts chip geometry.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Features/Filters/DateFilterSheet.swift ios/ChqCalendar/Features/Filters/FilterSheet.swift
git commit -m "feat(ios): shrink sheet chips to 36pt and add a recency marker

36pt is the threshold at which Venues and Categories both clear the fold at
the filter sheet's medium detent, so picking a venue *and* a category stops
involving a scroll. The 44pt HIG floor governs isolated controls, not dense
grids of same-kind adjacent targets. minHeight stays a floor and gains
explicit vertical padding, which is what the 44pt frame was silently
providing at large Dynamic Type sizes.

SheetChip is shared with the date scope chips, the week chips, and the
Favorites chip, so all of them shrink together. That uniformity is intended.

The new isRecent flag draws a leading dot and is announced by VoiceOver; the
dot is a bare Circle with no implicit label, so the accessibility label is
now set explicitly and keeps the count it previously inferred.

Refs #172"
```

---

### Task 3: Wire `FacetChipCloud` to the new ordering

**Files:**
- Modify: `ios/ChqCalendar/Features/Filters/FacetChipCloud.swift`

**Interfaces:**
- Consumes: `FacetChipOrder.build(all:isSelected:recent:count:recentLimit:visibleLimit:)` and `Entry` from Task 1; `SheetChip(label:count:isRecent:isSelected:action:)` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the ordering and the chip loop**

In `ios/ChqCalendar/Features/Filters/FacetChipCloud.swift`, replace the doc comment's third paragraph, the `visibleLimit` constant, and the `ordered` computed var with:

```swift
    /// Roughly three rows of chips on an iPhone at the sheet's medium
    /// detent. Everything beyond this lives behind the drill-down.
    private static let visibleLimit = 8   // originally 12; see Global Constraints

    /// How many recents may take one of those slots. `RecentFilters` stores
    /// more (10); the surplus absorbs entries dropped for not existing in
    /// the currently-viewed year.
    private static let recentLimit = 5

    private var allNames: [String] { model.available(facet) }

    private var ordered: [FacetChipOrder.Entry] {
        FacetChipOrder.build(
            all: allNames,
            isSelected: { model.isSelected($0, in: facet) },
            recent: model.recentNames(facet),
            count: { model.count(for: $0, in: facet) },
            recentLimit: Self.recentLimit,
            visibleLimit: Self.visibleLimit)
    }
```

Replace the doc comment paragraph that begins `/// This replaces the old recents strip` with:

```swift
/// Recents sit between the two, so a value this user keeps picking is
/// reachable even when the season's counts disagree — Lenna Hall ranks
/// 21st of 64 venues, so count-ordering alone never surfaces it.
/// `FacetChipOrder` drops any recent absent from the currently-viewed
/// year, which is what makes this safe to show at all: the old strip was
/// removed because a name remembered from another year rendered
/// identically to a live one (#157).
```

Then update the `FlowLayout` block at the end of `body`:

```swift
            FlowLayout(spacing: 6) {
                ForEach(ordered) { entry in
                    SheetChip(
                        label: displayName(entry.name),
                        count: model.count(for: entry.name, in: facet),
                        isRecent: entry.isRecent,
                        isSelected: model.isSelected(entry.name, in: facet)
                    ) {
                        model.toggle(entry.name, in: facet)
                    }
                }
            }
```

Note `ForEach(ordered)` without `id:` — `Entry` is `Identifiable` on `name`.

- [ ] **Step 2: Verify the "All n" link condition still holds**

The existing condition is `if ordered.count < allNames.count`. It still compiles (`ordered` is now `[Entry]`) and still means the same thing, because `build` never emits a name twice. **Leave it and its comment unchanged.** Read the comment above it — it explains the invariant this depends on.

- [ ] **Step 3: Build and run the full test suite**

```bash
xcodebuild test -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' 2>&1 | tail -20
```

Expected: **BUILD SUCCEEDED**, all tests pass including `FacetChipOrderTests`.

- [ ] **Step 4: Verify by hand in the simulator**

```bash
xcodebuild build -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'
```

Launch the app, open **Filters**, and confirm all four:

1. Both `VENUES` and `CATEGORIES` headers are visible without scrolling at the sheet's medium detent. **This is the acceptance criterion for the density change** — if it fails, stop and report rather than adjusting metrics unilaterally.
2. Tap a low-count venue (e.g. search for and select Lenna Hall via `All 64`), close the sheet, reopen it. Lenna Hall now appears in the visible chips with a leading accent dot.
3. Selecting that recent chip moves it to the front group and the dot is replaced by a checkmark.
4. Switch year via the toolbar menu. Recents that do not exist in the newly-selected year disappear rather than showing greyed or with a 0.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Features/Filters/FacetChipCloud.swift
git commit -m "feat(ios): show recently-used venues and categories in the filter sheet

Wires FacetChipCloud to FacetChipOrder, so each facet now renders
selected, then recently-used, then count-descending. Raises the visible
limit at 8, which the 36pt chips now make roomier than the shipping release.

This restores the capability removed in PR #151 without reintroducing the
defect that caused it: FacetChipOrder drops recents absent from the
currently-viewed year, so a remembered name can no longer render as a live
chip matching nothing (#157).

Closes #157
Refs #172"
```

---

### Task 4: Regenerate App Store screenshots

**Files:**
- Modify: `docs/app-store/screenshots.manifest.json`
- Modify: `docs/app-store/screenshots/review/*`

**Interfaces:**
- Consumes: the finished UI from Tasks 2 and 3.
- Produces: nothing consumed by later tasks.

Shot `02-filters` in `ios/Scripts/screenshot-plan.json` launches with `-uitest-show-filters` and captures this exact sheet, so `[skip-screenshots: …]` is **not** available for this PR. `.github/workflows/app-store-assets.yml` enforces this by checking the manifest changed since the PR's merge-base.

- [ ] **Step 1: Regenerate**

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

- [ ] **Step 2: Confirm the manifest actually changed**

```bash
git status --short docs/app-store/
git diff --stat docs/app-store/screenshots.manifest.json
```

Expected: the manifest shows a diff. If it does not, the capture did not pick up the change — investigate rather than hand-editing the JSON. The CI guard is a git-diff check and would pass on a hand-edited file, so this is on your honour.

- [ ] **Step 3: Eyeball `02-filters`**

Open `docs/app-store/screenshots/review/iphone-6.9-02-filters.png`. Both `VENUES` and `CATEGORIES` must be visible, and more chips should fit than in the previous version. This screenshot is the marketing artefact for the filtering feature — if it looks worse, say so rather than shipping it.

- [ ] **Step 4: Check the listing copy for invalidated claims**

Read `docs/app-store/listing-copy.md` and `docs/app-store/listing-fields.json`. No feature is added or removed from the listing's point of view, so no change is expected — but confirm, and note in the PR that you checked.

- [ ] **Step 5: Commit**

```bash
git add docs/app-store/
git commit -m "chore(ios): regenerate App Store screenshots for 36pt filter chips

Shot 02-filters captures the filter sheet directly, so the smaller chips and
the recency markers change it. Assets land now and upload at the next
version submission, per the platform constraint in CLAUDE.md.

Listing copy re-read; no claims invalidated.

Refs #172"
```

---

### Task 5: Open the pull request

**Files:** none.

- [ ] **Step 1: Confirm the tree is clean except for the known exception**

```bash
git status --short
```

Expected: **only** `M ios/ChqCalendar.xcodeproj/project.pbxproj`, which was already modified before this work began. Do not commit it. `docs/outreach/` must not appear at all — it is gitignored.

- [ ] **Step 2: Run the full suite one final time**

```bash
xcodebuild test -project ios/ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' 2>&1 | tail -20
```

Expected: all pass. Record the actual test count in the PR body — do not write "all tests pass" without having seen the number.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/ios-recent-filter-chips
gh pr create --title "feat(ios): surface recently-used filters in the filter sheet" --body "$(cat <<'BODY'
Closes #172. Closes #157.

Each facet's chips now order **selected → recently used → count-descending**,
and chips shrink from 44pt to 36pt so Venues and Categories both fit on
screen at the sheet's medium detent.

## Why 36pt

Chip height was the binding constraint. At 44pt, Venues alone consumes the
medium detent and Categories sits below the fold, so selecting a venue *and*
a category — the combo case in #172 — always involved a scroll. 36pt is the
threshold where both clear the fold. The 44pt HIG floor governs isolated
controls, not dense grids of same-kind, adjacent, non-destructive targets.

`SheetChip` is shared, so the date scope chips, week chips, and Favorites
chip shrink with it. That uniformity is intended.

## Why this does not reopen #157

The recents strip was removed in PR #151 because a name remembered from
another year rendered identically to a live one, so tapping it silently
produced an empty list. `FacetChipOrder` drops any recent absent from the
currently-viewed year — hidden, not greyed. `RecentFilters` still stores it,
so switching back brings it home. Nothing about what is remembered changed.

## Scope

Recording recents already worked; only the UI was missing. No new
persistence, no new model state, no navigation changes.

Deliberately **not** included, per design: no saved filter "combos" —
repeating a combo means picking two or three individual values quickly.
Follow-ups filed as #173 (expand facet lists in place instead of pushing to
FacetAllList) and #174 (DisplayNames shortcuts for the longest venue names).

## Notes for review

- Ordering moved out of a private computed var in a SwiftUI view into
  `Domain/FacetChipOrder.swift`, a pure type, so it has tests for the first
  time.
- Recents are resolved to the snapshot's casing before use. `RecentFilters`
  is never run through `normalizePersistedFilterCasing`, and `DisplayNames`
  is exact-match, so an unresolved name would render with raw feed casing
  instead of its shortcut. Counts were never affected — `count(for:in:)`
  lowercases its key.
- Screenshots regenerated; listing copy re-read, no claims invalidated.

Design: `docs/superpowers/specs/2026-08-06-ios-recent-filter-chips-design.md`
Plan: `docs/superpowers/plans/2026-08-06-ios-recent-filter-chips.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019wcA6fuNTgGAhYASKS8Nhg
BODY
)"
```

- [ ] **Step 4: Report the PR URL and stop**

Do **not** merge. Report the URL and wait for the user.

---

## Self-Review

**Spec coverage.** Ordering rule → Task 1. Casing resolution → Task 1 Step 3 plus its test. #157 stale-recent handling → Task 1. `FacetChipOrder` extraction → Task 1. `FacetChipCloud` rewiring and limits → Task 3. `SheetChip` metrics and Dynamic Type floor → Task 2. Blast radius onto `FilterSheet.activeSection` → Task 2 Step 2. Recency dot → Task 2. Accessibility label → Task 2. All eight spec tests → Task 1 Step 1 (as eleven `@Test` cases; the spec's "recents follow in recency order" is split into two, and two extra guards were added for `visibleLimit` underflow and empty `all`). Screenshots → Task 4. Verification command → Tasks 1-5. Out-of-scope items → asserted in the PR body, not implemented.

**Type consistency.** `FacetChipOrder.Entry(name:isRecent:)` and `build(all:isSelected:recent:count:recentLimit:visibleLimit:)` are declared in Task 1 and called with those exact labels in Task 3. `SheetChip`'s new `isRecent` is declared in Task 2 between `count` and `isSelected`, and Task 3 calls `SheetChip(label:count:isRecent:isSelected:)` in that order — matching Swift's memberwise-initializer ordering requirement.

**Known open risk.** The 36pt "both facets clear the fold" claim was validated against a to-scale mockup, not on a device. Task 3 Step 4 makes it an explicit acceptance check with instructions to stop and report rather than silently adjust the metric.
