# iOS Weekly-Theme Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each `Wk N` badge in a day header reveal that week's Chautauqua theme in a popover — surfacing data the app already fetches but has never displayed.

**Architecture:** One pure display model does the lookup and date formatting and carries every test. A small self-contained badge view owns its own popover state, so a day showing two badges needs no shared state in the list. `EventListView` changes by one line.

**Tech Stack:** SwiftUI, Swift 6 (strict concurrency), Swift Testing, Xcode 26 synchronized folder groups, `xcodebuild` on a simulator.

**Spec:** `docs/superpowers/specs/2026-08-04-ios-week-theme-popover-design.md`

## Global Constraints

- **Deployment target stays `IPHONEOS_DEPLOYMENT_TARGET = 18.0`.** No iOS 26 API except behind `if #available(iOS 26.0, *)`, and only if unavoidable — say so first. `.popover` and `.presentationCompactAdaptation` are iOS 16.4+ and therefore fine.
- **Swift 6 language mode.** The pure type is `nonisolated` and `Sendable`, matching `EventFilter`, `FacetCounts`, `DateFilterLabel`, `ActiveFilterChips`.
- **Tests are Swift Testing, not XCTest.** `import Testing`, plain `struct` suites, `@Test`, `#expect(...)`.
- **Never edit `project.pbxproj`** — the target uses a synchronized folder group, so new files are picked up automatically.
- **CI does not build or test the iOS app** (Linux runners). Every verification is local. A green GitHub Actions run proves nothing here.
- **Never commit to `main`.** Work on `feat/ios-week-theme-popover`, already created off `main`.
- **Baseline is 233 tests passing.** Report the arithmetic whenever it changes.
- **Build/test command:**
  ```bash
  cd ios && xcodebuild test \
    -project ChqCalendar.xcodeproj -scheme ChqCalendar \
    -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
    CODE_SIGNING_ALLOWED=NO
  ```
  Narrow with `-only-testing:ChqCalendarTests/<SuiteName>`.
- **Nothing about fetching, caching, filtering, grouping, or persistence changes.** All existing suites must pass **unchanged**. A failure is a regression in this work, not a test to update — if you disagree, stop and ask.
- **You cannot synthesize taps or scrolls.** `simctl` can launch and screenshot, nothing more. Never claim interactive verification you did not perform. An agent previously fabricated device-verification claims on this repository; the retraction is a permanent note in `docs/plans/2026-08-02-ios-ux-filtering-follow-ups.md`.
- **Screenshot scripts need Pillow**, and **system bash 3.2 shadows the Homebrew bash** `capture-screenshots.sh` requires.

## Context you need before starting

**The data already flows.** `EventRepository` fetches `/data/weekly-themes/{year}.json` as a best-effort sidecar, `CalendarSnapshot.themes` carries `[WeeklyTheme]`, and `AppModel.themes` exposes it. **No view reads it.** This plan adds only presentation.

`WeeklyTheme` (in `ios/ChqCalendar/Models/Sidecars.swift`) is:

```swift
nonisolated struct WeeklyTheme: Decodable, Hashable, Sendable {
    let number: Int
    let title: String
    let description: String
    let startDate: String   // "yyyy-MM-dd"
    let endDate: String     // "yyyy-MM-dd"
}
```

**What the real data contains,** verified against production and mirrored in the test fixture `ios/ChqCalendarTests/Fixtures/themes-sample.json`: 2026 has 9 themes with populated titles and **every `description` an empty string**; 2025 returns **404**, so `themes` is `[]` for that year. Descriptions are deliberately never rendered — see spec D3. Do not add a description branch.

**One decomposition beyond the spec.** The spec says the badge becomes a `Button` inside `EventListView.dayHeader(for:)`. In practice each badge needs its own `isPresented` state, and a day on a week boundary renders two badges from a `ForEach`. Putting that state in `EventListView` would mean tracking which badge is open. **Task 3 extracts a `WeekThemeBadge` view that owns its own state instead**, so `EventListView` changes by one line and each badge is independent. This is an implementation refinement, not a design change.

---

### Task 1: `WeekThemeSummary`

**Files:**
- Create: `ios/ChqCalendar/Domain/WeekThemeSummary.swift`
- Test: `ios/ChqCalendarTests/WeekThemeSummaryTests.swift` (create)

**Interfaces:**
- Consumes: `WeeklyTheme` from `ios/ChqCalendar/Models/Sidecars.swift`.
- Produces:
  - `struct WeekThemeSummary: Equatable, Sendable` with `let weekNumber: Int`, `let title: String`, `let dateRange: String?`, and `var weekLabel: String` returning `"Week 6"`.
  - `static func WeekThemeSummary.make(forWeek: Int, in: [WeeklyTheme]) -> WeekThemeSummary?` — `nil` when that week has no theme.

  Both used by Tasks 2 and 3.

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/WeekThemeSummaryTests.swift`:

```swift
import Testing
@testable import ChqCalendar

struct WeekThemeSummaryTests {
    private func theme(
        _ number: Int,
        _ title: String,
        _ start: String,
        _ end: String,
        description: String = ""
    ) -> WeeklyTheme {
        WeeklyTheme(
            number: number, title: title, description: description,
            startDate: start, endDate: end)
    }

    private var sample: [WeeklyTheme] {
        [
            theme(1, "Icons and Instigators", "2026-06-27", "2026-07-04"),
            theme(6, "The Human Voice", "2026-08-01", "2026-08-08"),
            theme(9, "The Importance of Gathering", "2026-08-22", "2026-08-30"),
        ]
    }

    @Test func summarisesAWeekThatHasATheme() {
        let summary = WeekThemeSummary.make(forWeek: 6, in: sample)
        #expect(summary?.weekNumber == 6)
        #expect(summary?.weekLabel == "Week 6")
        #expect(summary?.title == "The Human Voice")
        #expect(summary?.dateRange == "Aug 1\u{2013}8")
    }

    @Test func returnsNilForAWeekWithNoTheme() {
        // The season has 9 weeks but this fixture only carries 3, so weeks
        // 2-5, 7 and 8 have nothing. This is the case that decides whether
        // a badge is tappable at all.
        #expect(WeekThemeSummary.make(forWeek: 5, in: sample) == nil)
    }

    @Test func returnsNilWhenThereAreNoThemesAtAll() {
        // The 2025 path: the sidecar 404s, so `themes` is empty.
        #expect(WeekThemeSummary.make(forWeek: 6, in: []) == nil)
    }

    @Test func looksUpByWeekNumberNotArrayPosition() {
        // Week 6 is at index 1 here; an implementation indexing by position
        // would return the wrong theme or crash.
        #expect(WeekThemeSummary.make(forWeek: 6, in: sample)?.title == "The Human Voice")
        #expect(WeekThemeSummary.make(forWeek: 1, in: sample)?.title == "Icons and Instigators")
        #expect(WeekThemeSummary.make(forWeek: 9, in: sample)?.title == "The Importance of Gathering")
    }

    @Test func looksUpCorrectlyWhenThemesAreOutOfOrder() {
        let shuffled = [sample[2], sample[0], sample[1]]
        #expect(WeekThemeSummary.make(forWeek: 6, in: shuffled)?.title == "The Human Voice")
    }

    @Test func collapsesARangeInsideOneMonth() {
        #expect(WeekThemeSummary.make(forWeek: 6, in: sample)?.dateRange == "Aug 1\u{2013}8")
    }

    @Test func keepsBothMonthsWhenTheRangeCrossesOne() {
        let crossing = [theme(1, "Icons", "2026-06-27", "2026-07-04")]
        #expect(WeekThemeSummary.make(forWeek: 1, in: crossing)?.dateRange == "Jun 27\u{2013}Jul 4")
    }

    @Test func malformedDatesDegradeToNoRangeRatherThanCrashing() {
        let broken = [theme(3, "Election", "not-a-date", "2026-07-18")]
        let summary = WeekThemeSummary.make(forWeek: 3, in: broken)
        // The summary still exists — the title is the point — but the
        // header line simply has no range to show.
        #expect(summary != nil)
        #expect(summary?.title == "Election")
        #expect(summary?.dateRange == nil)
    }

    @Test func outOfRangeMonthIsTreatedAsMalformed() {
        let broken = [theme(3, "Election", "2026-13-01", "2026-13-08")]
        #expect(WeekThemeSummary.make(forWeek: 3, in: broken)?.dateRange == nil)
    }

    @Test func anEmptyDescriptionIsIgnored() {
        // Every real 2026 description is empty and none is ever rendered.
        // This pins that the summary does not start depending on it.
        let withDescription = [theme(6, "The Human Voice", "2026-08-01", "2026-08-08",
                                     description: "Some prose")]
        #expect(WeekThemeSummary.make(forWeek: 6, in: sample)
                == WeekThemeSummary.make(forWeek: 6, in: withDescription))
    }
}
```

> **Implementer:** `WeeklyTheme` is `Decodable` and may only have a synthesized memberwise initializer if it is not `public`. It is internal, so `WeeklyTheme(number:title:description:startDate:endDate:)` is available inside the test target. If the compiler disagrees, decode the fixture `themes-sample.json` via the existing `fixtureData(_:)` helper in `FixtureLoading.swift` instead of constructing values — do **not** add an initializer to the model for the sake of a test.

- [ ] **Step 2: Run to verify it fails**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/WeekThemeSummaryTests
```

Expected: **compile failure** — `cannot find 'WeekThemeSummary' in scope`.

- [ ] **Step 3: Implement**

Create `ios/ChqCalendar/Domain/WeekThemeSummary.swift`:

```swift
import Foundation

/// One week's theme, formatted for display beside a day-header week badge.
///
/// The Chautauqua season is organised around a theme per week, and the app
/// has always fetched them (`EventRepository`'s weekly-themes sidecar) without
/// ever showing them. This is the display model that closes that gap.
///
/// `description` is deliberately absent. Every theme in the 2026 feed carries
/// an empty one, so rendering it — and testing both sides of the branch —
/// would be building for data that does not exist. The field stays decoded on
/// `WeeklyTheme`; see that type.
nonisolated struct WeekThemeSummary: Equatable, Sendable {
    let weekNumber: Int
    let title: String
    /// `nil` when either endpoint fails to parse. The title is the point, so
    /// a bad date costs the range and nothing else.
    let dateRange: String?

    var weekLabel: String { "Week \(weekNumber)" }

    /// The theme for `week`, or `nil` if there isn't one.
    ///
    /// `nil` is a normal, frequent answer, not an error: the 2025 sidecar
    /// 404s so `themes` is empty for that whole season, and a partial file
    /// leaves individual weeks uncovered. Callers use `nil` to decide whether
    /// the badge is interactive at all.
    ///
    /// Matched on `number`, never on array position — the feed's order is not
    /// guaranteed and it need not contain all nine weeks.
    static func make(forWeek week: Int, in themes: [WeeklyTheme]) -> WeekThemeSummary? {
        guard let theme = themes.first(where: { $0.number == week }) else { return nil }
        return WeekThemeSummary(
            weekNumber: theme.number,
            title: theme.title,
            dateRange: dateRange(from: theme.startDate, to: theme.endDate))
    }

    // MARK: Date range

    private static let monthAbbreviations = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]

    /// `"Aug 1–8"` within a month, `"Jun 27–Jul 4"` across one. En dash.
    ///
    /// Deliberately string parsing rather than `ChqTime.parse`, which expects
    /// a datetime: these are date-only `yyyy-MM-dd` values, and formatting a
    /// label needs no time zone and no clock. That keeps this function pure
    /// and its tests independent of the calendar.
    ///
    /// The web renders both months always (`Aug 1–Aug 8`); collapsing the
    /// same-month case reads better in a popover this narrow.
    private static func dateRange(from start: String, to end: String) -> String? {
        guard let (startMonth, startDay) = monthAndDay(start),
              let (endMonth, endDay) = monthAndDay(end)
        else { return nil }

        let startLabel = "\(monthAbbreviations[startMonth - 1]) \(startDay)"
        if startMonth == endMonth {
            return "\(startLabel)\u{2013}\(endDay)"
        }
        return "\(startLabel)\u{2013}\(monthAbbreviations[endMonth - 1]) \(endDay)"
    }

    /// Parses `"yyyy-MM-dd"`. Returns `nil` for anything else, including a
    /// well-shaped string with an impossible month — the array index below
    /// would trap on it.
    private static func monthAndDay(_ iso: String) -> (month: Int, day: Int)? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3,
              let month = Int(parts[1]), (1...12).contains(month),
              let day = Int(parts[2]), (1...31).contains(day)
        else { return nil }
        return (month, day)
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Same command as Step 2. Expected: 10 tests pass.

- [ ] **Step 5: Run the full suite**

Full command from Global Constraints. Expected: **243** (233 + 10).

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/Domain/WeekThemeSummary.swift ios/ChqCalendarTests/WeekThemeSummaryTests.swift
git commit -m "feat(ios): WeekThemeSummary — display model for a week's theme

Looks a theme up by week number and formats its date range. Returns nil
when the week has no theme, which is a normal and frequent answer: the
2025 sidecar 404s, so that whole season has none, and callers use nil to
decide whether the badge is interactive at all.

Dates are parsed as strings rather than through ChqTime.parse, which
expects a datetime — these are date-only values and formatting a label
needs no clock, which keeps the type pure and its tests calendar-free.
A malformed date costs the range and nothing else; the title still shows."
```

---

### Task 2: `WeekThemePopover`

**Files:**
- Create: `ios/ChqCalendar/Features/Calendar/WeekThemePopover.swift`

**Interfaces:**
- Consumes: `WeekThemeSummary` (Task 1).
- Produces: `WeekThemePopover(summary: WeekThemeSummary)`, used by Task 3.

This view holds no logic — every string it draws comes from the summary.

- [ ] **Step 1: Write the view**

Create `ios/ChqCalendar/Features/Calendar/WeekThemePopover.swift`:

```swift
import SwiftUI

/// The contents of the popover a themed day-header week badge presents.
///
/// Deliberately just a caption line, the theme title, and a link out. Theme
/// descriptions are empty throughout the 2026 feed and are never rendered
/// (see `WeekThemeSummary`), so the link is the only route to any detail the
/// app cannot show — which is exactly why it is here.
struct WeekThemePopover: View {
    let summary: WeekThemeSummary

    /// The same destination the web app's popover links to.
    private static let themesURL = URL(
        string: "https://www.chq.org/things-to-do/events/weekly-themes/")!

    private var headerLine: String {
        guard let range = summary.dateRange else { return summary.weekLabel }
        return "\(summary.weekLabel) \u{00B7} \(range)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(headerLine)
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            Text(summary.title)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            Link(destination: Self.themesURL) {
                HStack(spacing: 3) {
                    Text("View on chq.org")
                    Image(systemName: "arrow.up.right")
                        .font(.caption2)
                }
                .font(.caption)
            }
        }
        .padding(16)
        .frame(maxWidth: 280, alignment: .leading)
        .presentationCompactAdaptation(.popover)
    }
}

#Preview("Same-month range") {
    WeekThemePopover(summary: WeekThemeSummary(
        weekNumber: 6,
        title: "The Human Voice: Song, Speech, and Story",
        dateRange: "Aug 1\u{2013}8"))
}

#Preview("No range (malformed dates)") {
    WeekThemePopover(summary: WeekThemeSummary(
        weekNumber: 3,
        title: "The 2026 Election: What\u{2019}s at Stake?",
        dateRange: nil))
}

#Preview("Longest real title") {
    // The real feed's longest title, 83 characters — the case that decides
    // whether the popover's width and wrapping hold up.
    WeekThemePopover(summary: WeekThemeSummary(
        weekNumber: 9,
        title: "The Importance of Gathering: A Collaboration with the Smithsonian Folklife Festival",
        dateRange: "Aug 22\u{2013}30"))
}
```

`.presentationCompactAdaptation(.popover)` is what stops iPhone adapting the popover into a sheet. It belongs on the popover's content, which is why it is here rather than at the call site.

- [ ] **Step 2: Build**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: **BUILD SUCCEEDED**.

- [ ] **Step 3: Full suite**

Expected: **243**, unchanged — this task adds no tests.

- [ ] **Step 4: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/WeekThemePopover.swift
git commit -m "feat(ios): WeekThemePopover — the themed badge's popover contents

Caption line, theme title, and a link to chq.org. No description block:
every 2026 theme description is empty, so the link is the only route to
detail the app cannot show.

presentationCompactAdaptation(.popover) sits on the content so iPhone
renders a real popover instead of adapting it into a sheet."
```

---

### Task 3: `WeekThemeBadge` and the day header

**Files:**
- Create: `ios/ChqCalendar/Features/Calendar/WeekThemeBadge.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift` — `dayHeader(for:)`

**Interfaces:**
- Consumes: `WeekThemeSummary.make(forWeek:in:)` (Task 1), `WeekThemePopover(summary:)` (Task 2).
- Produces: `WeekThemeBadge(weekNumber: Int, themes: [WeeklyTheme])`.

**Why a separate view:** each badge needs its own `isPresented` state, and a day on a week boundary renders two badges from a `ForEach`. Keeping that state inside the badge means `EventListView` needs none and the two badges cannot interfere.

**The conditional affordance is the point of this task.** When a week has no theme the badge must render *exactly* as it does today — plain text, no button, no accessibility action, no accent colour. A badge that looks tappable and does nothing is worse than one that never invited the tap.

- [ ] **Step 1: Write the badge**

Create `ios/ChqCalendar/Features/Calendar/WeekThemeBadge.swift`:

```swift
import SwiftUI

/// A `Wk 6` capsule in a day header, which reveals that week's theme when
/// one exists.
///
/// Owns its own presentation state so that a day spanning a week boundary —
/// which renders two of these side by side — needs no coordination from the
/// list, and so `EventListView` holds no popover state at all.
///
/// When the week has no theme this renders exactly what shipped before this
/// view existed: plain text in a capsule, no button, no accent, no
/// accessibility action. That is deliberate. The 2025 season has no themes
/// at all, and a badge that looks tappable but does nothing is worse than one
/// that never invited the tap.
struct WeekThemeBadge: View {
    let weekNumber: Int
    let themes: [WeeklyTheme]

    @State private var isShowingTheme = false

    private var summary: WeekThemeSummary? {
        WeekThemeSummary.make(forWeek: weekNumber, in: themes)
    }

    var body: some View {
        if let summary {
            Button {
                isShowingTheme = true
            } label: {
                capsule.foregroundStyle(Color.accentColor)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(summary.weekLabel) theme: \(summary.title)")
            .accessibilityHint("Shows this week's theme")
            .popover(isPresented: $isShowingTheme) {
                WeekThemePopover(summary: summary)
            }
        } else {
            capsule
        }
    }

    /// The badge itself, identical in both states apart from its colour, so
    /// a themed and an unthemed badge never differ in size or position.
    private var capsule: some View {
        Text("Wk \(weekNumber)")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.secondary.opacity(0.15), in: Capsule())
    }
}
```

- [ ] **Step 2: Use it in the day header**

In `ios/ChqCalendar/Features/Calendar/EventListView.swift`, `dayHeader(for:)` currently renders the badge inline:

```swift
            ForEach(day.weekNumbers, id: \.self) { number in
                Text("Wk \(number)")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.15), in: Capsule())
            }
```

Replace the body of that `ForEach` with:

```swift
            ForEach(day.weekNumbers, id: \.self) { number in
                WeekThemeBadge(weekNumber: number, themes: model.themes)
            }
```

Change nothing else in `dayHeader(for:)` — the title, the `Spacer`, and the layout all stay.

- [ ] **Step 3: Build and run the full suite**

Expected: **BUILD SUCCEEDED**, **243** tests passing.

- [ ] **Step 4: Verify the unthemed badge is unchanged**

```bash
grep -n 'accentColor\|buttonStyle\|accessibilityLabel' ios/ChqCalendar/Features/Calendar/WeekThemeBadge.swift
grep -c 'Capsule()' ios/ChqCalendar/Features/Calendar/EventListView.swift
```

Expected: the badge's accent, button style, and accessibility label all appear in `WeekThemeBadge` only; and `EventListView` reports **0** occurrences of `Capsule()`, proving the inline badge is gone rather than duplicated.

Expected: the badge text and capsule styling exist once, in `WeekThemeBadge`; `EventListView` no longer draws a badge itself. Confirm by reading `WeekThemeBadge` that the `else` branch applies **no** `foregroundStyle`, **no** `Button`, and **no** accessibility modifiers.

- [ ] **Step 5: Launch and screenshot**

```bash
xcrun simctl launch booted org.chqcal.app
xcrun simctl io booted screenshot /tmp/theme-badge.png
```

Open the image. The app opens on 2026, which **has** themes, so day-header badges should now be accent-coloured rather than grey. Report what you see.

You cannot tap, so you cannot verify the popover itself — say so plainly rather than implying otherwise.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/WeekThemeBadge.swift ios/ChqCalendar/Features/Calendar/EventListView.swift
git commit -m "feat(ios): reveal a week's theme from its day-header badge

Each Wk N badge becomes a button presenting that week's theme in a
popover. The badge owns its own state, so a day spanning a week boundary
renders two independent badges and EventListView holds no popover state.

When a week has no theme the badge renders exactly as before — no button,
no accent, no accessibility action. The 2025 season has none at all, and
a badge that looks tappable but does nothing is worse than one that never
invited the tap."
```

---

### Task 4: Screenshots and docs

**Files:**
- Modify: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/`
- Modify: `ios/README.md`

Day-header badges change colour on any themed year, which is a visible change under `ios/ChqCalendar/Features/**` — the root `CLAUDE.md` gates on exactly that.

- [ ] **Step 1: Regenerate**

```bash
cd /Users/bernard/src/chq/chq-calendar
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

Pillow required; system bash 3.2 shadows the Homebrew bash the capture script needs. Do **not** hand-edit the manifest — the CI guard only checks that the file changed, so a hand-edit satisfies it while defeating its purpose.

- [ ] **Step 2: Review every regenerated image**

Open each file under `docs/app-store/screenshots/review/` and report per-shot what you saw. Badges on list screens should be accent-coloured. No shot presents the popover — no launch argument opens it — so the popover itself is unphotographed; say so rather than implying coverage.

- [ ] **Step 3: Document the feature**

Add a short note to `ios/README.md`'s architecture section: weekly themes are fetched as a best-effort sidecar and surfaced by tapping a day-header week badge, which is inert on years with no themes. Do not restructure sections that are still accurate.

- [ ] **Step 4: Commit**

```bash
git add docs/app-store/ ios/README.md
git commit -m "chore(ios): regenerate screenshots, document the theme badge"
```

---

### Task 5: Open the PR

- [ ] **Step 1: Full suite one last time**

Expected: **243 passing**. Put the real number in the PR body — never write "tests pass" without reading the output.

- [ ] **Step 2: Push and open the PR**

The body should cover: that the data was already fetched and never displayed; the badge-only surface and why the filter chips were rejected; that descriptions are empty throughout the feed so only the title and range are shown; that 2025 has no themes so the badge is deliberately inert there; the test arithmetic from 233; and the device checklist below.

**Do not merge.** Request the merge from the repository owner.

---

## Device checklist for the repository owner

None of this can be verified by an agent — `simctl` cannot tap.

1. **Tap a `Wk N` badge on 2026.** The popover should appear anchored to that badge, showing `WEEK 6 · AUG 1–8` and the theme title.
2. **Tap outside it.** It should dismiss without navigating or losing your scroll position.
3. **Scroll with the popover open.** Confirm it dismisses or stays sensibly placed rather than detaching from its badge.
4. **Switch to 2025.** Badges should be grey and completely inert — no highlight, no response to a tap.
5. **A boundary day** (a Saturday between two weeks) shows two badges. Each should open its own week's theme.
6. **Tap "View on chq.org".** It should open the weekly-themes page in Safari.
7. **VoiceOver on a themed badge.** It should announce the week and the theme title, not "Wk 6".

## Self-Review

**Spec coverage:** D1 (badge-only surface) → Task 3. D2 (popover, not sheet or inline) → Task 2's `presentationCompactAdaptation`, Task 3's `.popover`. D3 (no description rendering) → Task 1 omits it from the model, Task 2 never draws it, and a test pins that the summary ignores it. D4 (chq.org link) → Task 2. D5 (conditional affordance) → Task 3, with an explicit verification step. Date-range formatting → Task 1. Accessibility → Task 3. Per-badge behaviour on boundary days → Task 3's decomposition rationale and device check 5.

**Deliberate divergence from the spec:** the spec places the button inside `EventListView.dayHeader`; this plan extracts `WeekThemeBadge` so each badge owns its popover state. Rationale is stated in Context and in Task 3. No behavioural difference.

**Known gap:** the popover's presentation, anchoring, and dismissal are untested — this project has no snapshot or UI testing, and no screenshot launch argument opens the popover. That rests entirely on the device checklist, which is why the checklist is part of the deliverable rather than an afterthought.
