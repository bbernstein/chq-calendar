# iOS Events Tab Chrome Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim ~37% of the Events tab that is permanent chrome, by moving search and filters into the nav bar and making the day rail the primary date chooser.

**Architecture:** Search and Filters become toolbar buttons beside the year and `⋯`. The bottom pill bar and `DateFilterSheet` are deleted; the four scopes and `WeekRangeStrip` move into `FilterSheet` as a `WHEN` section. The day rail drops its step chevrons (reclaiming ~88pt, 3 chips → ~6) and gains a week band above the chips — day-granular, overlapping on the shared Saturday, coloured by a nine-step lightness ramp across the season.

**Tech Stack:** SwiftUI, Swift 6, Swift Testing (unit), XCTest/XCUITest (UI). Deployment target iOS 18.

**Spec:** `docs/superpowers/specs/2026-08-21-ios-events-chrome-consolidation-design.md`. GitHub issue #256.

## Global Constraints

- **`.searchable` must keep `placement: .navigationBarDrawer`.** Only `displayMode` changes, `.always` → `.automatic`. The iOS 26 SDK's *default* placement is bottom-anchored, which collides with `RootTabView`'s tab bar — screenshot-verified previously as "date pill, Filters and search all present but covered and unusable." Do not change `placement`.
- **CI runs 3-core hosted macOS runners.** Every `xcodebuild test` invocation must pass `-parallel-testing-enabled NO`. Never pin `OS=` in a destination — resolve the simulator at runtime.
- **`ChqCalendarShared/**` and `ChqCalendar/Features/**` are inside the App Store screenshot rule** (`.github/workflows/app-store-assets.yml`). Task 9 regenerates screenshots; the PR cannot merge without either that or an explicit `[skip-screenshots: <reason>]`.
- **`⟳ Now` and every rail control are navigation, never filter changes.** They must not touch scope, weeks, categories, or search. This is the invariant the whole design rests on.
- **`DateFilterLabel` is not deleted** — ~40 tests depend on it and it is user-visible. It re-homes to the `WHEN` section (Task 2).
- Season weeks run Saturday noon → Saturday noon; a boundary Saturday is in **both** weeks for display and navigation. The matching filter change is #257 and ships separately — this plan does not depend on it.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ChqCalendar/Features/Filters/SheetComponents.swift` | `SheetChip`, `SheetDismissButton` — shared sheet furniture | **Create** (extracted, Task 1) |
| `ChqCalendar/Features/Filters/DateFilterSheet.swift` | — | **Delete** (Task 2) |
| `ChqCalendar/Features/Filters/FilterSheet.swift` | The one filter sheet | gains `WHEN` section |
| `ChqCalendar/Features/Calendar/EventListView.swift` | The list screen and its chrome | pill bar deleted, toolbar gains 2 buttons, rail furniture |
| `ChqCalendar/Features/Calendar/CalendarView.swift` | Navigation containers + search | `displayMode`, `@FocusState` |
| `ChqCalendarShared/Domain/WeekBands.swift` | Band spans, ramp steps, label placement, nav targets | **Create** (Task 6) |
| `ChqCalendar/Features/Shared/DayRailView.swift` | The rail | renders the band |
| `ChqCalendar/Assets.xcassets/WeekBandStart.colorset`, `WeekBandEnd.colorset` | Ramp endpoints | **Create** (Task 7) |
| `ChqCalendarTests/WeekBandsTests.swift` | Band span logic | **Create** (Task 6) |
| `ChqCalendarUITests/DayRailUITests.swift`, `DayRailAccessibilityUITests.swift` | Rail behaviour | chevron references removed |

---

## Task 1: Extract the shared sheet furniture

`DateFilterSheet.swift` does not only hold `DateFilterSheet`. It also defines **`SheetChip`** (line 127, used by `FilterSheet` *and* `FacetChipCloud`) and **`SheetDismissButton`** (line 212, used by `FilterSheet`). Deleting the file in Task 2 without this task first breaks the build in two other files. This is a pure move — no behaviour change — which is exactly why it gets its own commit: a reviewer can verify "nothing changed" by diff shape alone.

**Files:**
- Create: `ios/ChqCalendar/Features/Filters/SheetComponents.swift`
- Modify: `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift` (remove the two moved types)

**Interfaces:**
- Produces: `SheetChip(label:count:isRecent:isSelected:action:)` and `SheetDismissButton(count:action:)`, unchanged in every particular, now in their own file.

- [ ] **Step 1: Move the two types**

```bash
cd ios
```

Create `ChqCalendar/Features/Filters/SheetComponents.swift` with this header, then paste `SheetChip` and `SheetDismissButton` **verbatim** — including every doc comment — from `DateFilterSheet.swift`:

```swift
import SwiftUI

// Shared furniture for the filter sheets. Extracted from
// `DateFilterSheet.swift` when that view was deleted (#256): both types
// were always shared — `SheetChip` by `FilterSheet` and `FacetChipCloud`,
// `SheetDismissButton` by `FilterSheet` — and only lived there because
// that is where the first one was written.
//
// Nothing about either type changed in the move. If you are reading this
// because a chip renders differently, the cause is elsewhere.
```

Delete both types from `DateFilterSheet.swift`. Leave `DateFilterSheet` itself and its `#Preview` intact — Task 2 deletes those.

- [ ] **Step 2: Build to verify nothing broke**

```bash
cd ios && xcodebuild build -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" 2>&1 | tail -20
```

Expected: `BUILD SUCCEEDED`. A failure here means a third consumer exists that the grep missed — find it before continuing.

- [ ] **Step 3: Run the unit suite**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO -only-testing:ChqCalendarTests 2>&1 | tail -20
```

Expected: all pass, unchanged.

- [ ] **Step 4: Commit**

```bash
git add ios/ChqCalendar/Features/Filters/SheetComponents.swift ios/ChqCalendar/Features/Filters/DateFilterSheet.swift
git commit -m "refactor(ios): extract SheetChip and SheetDismissButton (#256)

Both were always shared — SheetChip by FilterSheet and FacetChipCloud,
SheetDismissButton by FilterSheet — and only lived in DateFilterSheet.swift
because that is where the first one was written. Moving them out is a
prerequisite for deleting that file.

Pure move. No type, doc comment, or behaviour changed."
```

---

## Task 2: `FilterSheet` gains WHEN; `DateFilterSheet` and the date pill are deleted

**Files:**
- Modify: `ios/ChqCalendar/Features/Filters/FilterSheet.swift`
- Delete: `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift` (`FilterBarSheet`, `.sheet(item:)`, `pillRow`, `dateLabel`)

**Interfaces:**
- Consumes: `SheetChip` (Task 1), `WeekRangeStrip(weekNumbers:isSelected:effectiveSelection:timeState:commit:)`, `FilterChipState.isScopeSelected(_:selection:currentWeek:isCurrentYear:)`, `WeekStripState.timeState(week:now:weeks:)`, `DateFilterLabel.text(for:seasonWeekCount:isCurrentYear:)`.
- Produces: `FilterSheet` now owns every filter control. `FilterBarSheet` is gone; `EventListView` uses `@State private var isFilterSheetPresented: Bool`.

- [ ] **Step 1: Move the WHEN content into `FilterSheet`**

In `FilterSheet.swift`, add these properties to the struct (lifted from `DateFilterSheet`, keeping their doc comments):

```swift
    private var visibleScopes: [DateScope] {
        model.isCurrentYear ? [.next, .today, .season, .all] : [.all]
    }

    private var seasonWeeks: [SeasonWeek] {
        SeasonCalendar.weeks(forYear: model.selectedYear)
    }

    private var weekNumbers: [Int] { seasonWeeks.map(\.number) }

    /// What a strip gesture should treat as already-selected. A persisted
    /// `.thisWeek` scope highlights the current week without any stored
    /// weeks — treating it as that one week makes tapping it deselect
    /// (rather than confusingly "re-select") on the first touch.
    private var effectiveWeekSelection: Set<Int> {
        if model.filter.selectedWeeks.isEmpty,
           model.filter.dateScope == .thisWeek,
           let currentWeek = model.currentWeek {
            return [currentWeek]
        }
        return model.filter.selectedWeeks
    }

    /// The date range in words, above the scope chips. This is
    /// `DateFilterLabel`'s new home: it used to render into the bottom
    /// bar's date pill, which #256 deleted. The label is still exactly
    /// the right sentence for "what does the date part of this filter
    /// currently mean", and ~40 tests describe it.
    private var dateLabel: String {
        DateFilterLabel.text(
            for: model.filter,
            seasonWeekCount: seasonWeeks.count,
            isCurrentYear: model.isCurrentYear)
    }
```

Add the section itself to the `VStack` in `body`, **above** `FacetChipCloud(model: model, facet: .venues)`:

```swift
                    whenSection
```

and define it:

```swift
    /// The date controls, moved here when `DateFilterSheet` was deleted
    /// (#256). Two questions, deliberately both here and deliberately
    /// distinct from the day rail behind this sheet: the rail *navigates*
    /// ("take me to week 6"), these *filter* ("show me only weeks 3-5").
    /// Every control on the rail navigates; every filter is in this sheet.
    /// That is the rule this design exists to make learnable — do not add
    /// a filtering control to the rail, or a navigating one here.
    private var whenSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("When")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            Text(dateLabel)
                .font(.footnote)
                .foregroundStyle(.secondary)

            FlowLayout(spacing: 8) {
                ForEach(visibleScopes, id: \.self) { scope in
                    // Always defer to `FilterChipState`, even when
                    // `visibleScopes` has collapsed to the lone `.all` chip
                    // for a non-current year: a week selection made in
                    // another year survives `AppModel.select(year:)`, and
                    // only `FilterChipState.isScopeSelected` knows that a
                    // non-empty `selectedWeeks` means "All" is *not*
                    // selected. Hardcoding `true` here previously let this
                    // chip and the week grid both show as checked at once.
                    SheetChip(
                        label: scope.label,
                        isSelected: FilterChipState.isScopeSelected(
                            scope, selection: model.filter,
                            currentWeek: model.currentWeek,
                            isCurrentYear: model.isCurrentYear)
                    ) {
                        model.selectScope(scope)
                    }
                }
            }

            let now: Date? = model.isCurrentYear ? model.now() : nil
            let weeks = seasonWeeks
            WeekRangeStrip(
                weekNumbers: weekNumbers,
                isSelected: { number in
                    FilterChipState.isWeekSelected(
                        number, selection: model.filter,
                        currentWeek: model.currentWeek)
                },
                effectiveSelection: effectiveWeekSelection,
                timeState: { WeekStripState.timeState(week: $0, now: now, weeks: weeks) },
                commit: { model.setWeekSelection($0) })
        }
    }
```

- [ ] **Step 2: Restate the Clear Filters boundary**

`FilterSheet`'s toolbar button calls `clearNonDateFilters()`. With the scopes now in the same sheet, that scoping is far easier to trip over. Extend its existing comment:

```swift
                    ToolbarItem(placement: .topBarTrailing) {
                        // Clears search, venues, categories, and favorites —
                        // deliberately NOT the date scope or week selection.
                        //
                        // Since #256 those live in this same sheet's WHEN
                        // section rather than behind their own pill, which
                        // makes "surely Clear Filters should clear all of
                        // it" a much easier mistake. It should not: a
                        // reader who reached an empty list through a week
                        // selection needs a button that recovers the
                        // *other* filters without also throwing away the
                        // dates they deliberately chose. Keep this scoped
                        // to `clearNonDateFilters()`.
                        Button("Clear Filters") { model.clearNonDateFilters() }
                    }
```

- [ ] **Step 3: Delete `DateFilterSheet.swift` and the date pill**

```bash
cd ios && git rm ChqCalendar/Features/Filters/DateFilterSheet.swift
```

In `EventListView.swift`:

Delete the `FilterBarSheet` enum (lines ~265-269) and replace `@State private var activeSheet: FilterBarSheet?` (line 30) with:

```swift
    @State private var isFilterSheetPresented = false
```

Replace the `.sheet(item:)` block (lines ~330-335) with:

```swift
            .sheet(isPresented: $isFilterSheetPresented) {
                FilterSheet(model: model)
            }
```

Delete the `dateLabel` computed property (lines ~1066-1072) — it now lives in `FilterSheet`.

In `pillRow`, delete the entire first `pillButton` (the calendar/date one) and its `.accessibilityLabel("Date range: …")`. Leave the Filters pill for now; Task 3 removes the rest.

Update `presentFilterSheetIfNeeded` (line ~354) to set `isFilterSheetPresented = true` instead of `activeSheet = .filters`. Search the file for any other `activeSheet` reference and update it.

- [ ] **Step 4: Build and run the unit suite**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO -only-testing:ChqCalendarTests 2>&1 | tail -30
```

Expected: all pass. `DateFilterLabelTests`, `FilterChipStateTests` and `DateScopeExemptionTests` all test pure domain types and must be untouched by this — a failure there means a domain change leaked in.

- [ ] **Step 5: Verify the sheet on a simulator**

```bash
cd ios && xcodebuild build -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" 2>&1 | tail -5
xcrun simctl launch booted org.chqcal.app -uitest-show-filters
sleep 6 && xcrun simctl io booted screenshot /tmp/filter-sheet.png
```

Open `/tmp/filter-sheet.png` and confirm: a `WHEN` header, the date label sentence, four scope chips, the nine-week strip, then venues, categories and favorites below. At the medium detent the WHEN section must be reachable — if it is below the fold, the sheet needs `.presentationDetents([.large])` as its initial detent or the section reordered.

- [ ] **Step 6: Commit**

```bash
git add -A ios/
git commit -m "feat(ios): one filter sheet — WHEN moves in, DateFilterSheet goes (#256)

The date pill's sheet held two things and both have better homes. Day
choosing is what the rail already does, so the sheet as a container had no
reason to exist; its four scopes and its WeekRangeStrip move into
FilterSheet as a WHEN section.

DateFilterLabel comes with them, as the section's subtitle. It is still
exactly the right sentence for what the date filter currently means, and
~40 tests describe it — deleting it with the pill it happened to render
into would have orphaned all of them.

Restates why Clear Filters stays clearNonDateFilters(): with the scopes now
in the same sheet, widening it is a much easier mistake to make.

Also removes the word 'Now' from one of the two places it appeared meaning
two different things — the pill said Now for DateScope.next while the rail's
Now button navigates to today."
```

---

## Task 3: Filters becomes a toolbar button; the pill bar is deleted

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`

**Interfaces:**
- Consumes: `ActiveFilterCount.value(for:)` via the existing `filterCount`, `filtersAccessibilityLabel`.
- Produces: the Events toolbar now carries a Filters button identified `filters-toolbar-button`.

- [ ] **Step 1: Delete the pill bar**

In `EventListView.swift` delete, in full: `filterPillBar`, `pillRow(includeTrailingSpacer:)`, `pillButton(action:label:)`, and the `.safeAreaInset(edge: .bottom) { … }` in `body` that mounts them.

The long comment on `filterPillBar` about the accessibility-size `ScrollView` / `fixedSize` pairing goes with it: it existed only because two pills could not fit side by side in that row, and there is no longer a row. If `dynamicTypeSize` is now unused in this file, remove its `@Environment` declaration too — the compiler will say so.

- [ ] **Step 2: Add the toolbar button**

In `toolbarContent`, **before** the existing `⋯` menu item so the order reads `🔍 ⚌ 2026 ⋯` left-to-right within the trailing group:

```swift
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                KeyboardDismisser.dismiss()
                isFilterSheetPresented = true
            } label: {
                // The badge is what makes this legible at icon size. An
                // icon alone cannot tell "everything" from "a slice", and
                // neither could the word "Filters" it replaces — which is
                // why the count moves with it rather than being dropped as
                // decoration.
                Image(systemName: filterCount > 0
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle")
            }
            .accessibilityLabel(filtersAccessibilityLabel)
            .accessibilityIdentifier("filters-toolbar-button")
        }
```

`filtersAccessibilityLabel` already reads "Filters, N active. Double tap to change." and is unchanged — the accessible name does not depend on the control being a pill.

- [ ] **Step 3: Build and screenshot**

```bash
cd ios && xcodebuild build -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" 2>&1 | tail -5
xcrun simctl launch booted org.chqcal.app
sleep 8 && xcrun simctl io booted screenshot /tmp/no-pills.png
```

Confirm in `/tmp/no-pills.png`: no floating capsules above the tab bar, the list runs to the tab bar, and the toolbar shows the filter icon. Tap it (or relaunch with `-uitest-show-filters`) and confirm the sheet still opens.

- [ ] **Step 4: Run unit and UI suites**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO 2>&1 | tail -40
```

Expected: all pass. Any UI test that located the Filters control by its old pill will fail here — update it to `app.buttons["filters-toolbar-button"]`.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift
git commit -m "feat(ios): Filters moves to the toolbar; the pill bar is deleted (#256)

The two pills rendered as glass capsules floating over the event list,
immediately above the tab bar — they read as list content rather than
chrome. Nobody chose that placement: before the tab shell they were a real
.bottomBar, the tab bar painted over them, and the fix moved them to a
safe-area inset without ever revisiting where they belonged.

Filters becomes a toolbar button beside the year and the More menu,
keeping its count as a filled-vs-outline icon variant and its existing
accessibility label verbatim.

Removes ~54pt of permanent chrome, and with it the accessibility-size
ScrollView/fixedSize pairing that existed only to fit two pills in a row
that no longer exists."
```

---

## Task 4: Search scrolls away, with a button to bring it back

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/CalendarView.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift` (the toolbar button)

**Interfaces:**
- Produces: `CalendarView` exposes search focus to `EventListView` via `@FocusState` bound through `.searchFocused(_:)`. The button is identified `search-toolbar-button`.

- [ ] **Step 1: Relax `displayMode` and add focus state**

In `CalendarView.swift`, add to the struct:

```swift
    /// Drives the toolbar's magnifier button (#256). `.searchFocused` is
    /// iOS 18+, which is the deployment target.
    @FocusState private var isSearchFocused: Bool
```

In **both** `stackView` and `splitView`, change `displayMode: .always` to `displayMode: .automatic` and add `.searchFocused($isSearchFocused)` after `.searchable`:

```swift
        .searchable(
            text: $searchDraft,
            placement: .navigationBarDrawer(displayMode: .automatic),
            prompt: "Search events")
        .searchFocused($isSearchFocused)
        .submitLabel(.search)
        .onSubmit(of: .search) { KeyboardDismisser.dismiss() }
```

Replace the block comment above `stackView` explaining `.always` with:

```swift
    // `placement: .navigationBarDrawer` is load-bearing and must not become
    // `.automatic`: on iOS 26 the default placement is a bottom-anchored
    // field, which occupies the same screen edge as `RootTabView`'s tab bar
    // — verified by screenshot, the tab bar rendered ON TOP of the bottom
    // toolbar group and everything in it was present but unusable. Pinning
    // search under the navigation bar is what vacates the bottom edge.
    //
    // `displayMode` is `.automatic` since #256, so the field scrolls away
    // with the content instead of costing 52pt on every screen forever.
    // `.always` was originally chosen so search stayed discoverable without
    // knowing the pull-down gesture; the toolbar's magnifier button
    // (`EventListView.toolbarContent`) is what buys that discoverability
    // now, at no permanent vertical cost. Do not restore `.always` without
    // also removing that button — two ways to reach the same field, one of
    // which is always on screen, is the state this change left.
```

- [ ] **Step 2: Pass focus down and add the button**

`EventListView` needs to set the focus. Add a binding parameter to `EventListView`:

```swift
    /// Set by the toolbar's magnifier button to focus the search field that
    /// `CalendarView` owns. A `FocusState.Binding` rather than a plain
    /// `Bool` binding because `.searchFocused` requires one.
    var searchFocus: FocusState<Bool>.Binding
```

and pass it from both call sites in `CalendarView`:

```swift
            EventListView(model: model, selection: nil, searchFocus: $isSearchFocused)
```

```swift
            EventListView(model: model, selection: $selectedEvent, searchFocus: $isSearchFocused)
```

Then in `EventListView.toolbarContent`, **before** the Filters item added in Task 3:

```swift
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                searchFocus.wrappedValue = true
            } label: {
                Image(systemName: "magnifyingglass")
            }
            .accessibilityLabel("Search events")
            .accessibilityIdentifier("search-toolbar-button")
        }
```

- [ ] **Step 3: Build and verify by screenshot**

```bash
cd ios && xcodebuild build -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" 2>&1 | tail -5
xcrun simctl launch booted org.chqcal.app
sleep 8 && xcrun simctl io booted screenshot /tmp/search-top.png
```

Three things to confirm, and the third is the one that has bitten this project before:

1. `/tmp/search-top.png` shows the search field under the nav bar at rest.
2. Scrolling the list hides it (drive by hand, or check the App Store capture in Task 9).
3. **The field is under the nav bar, not at the bottom edge.** If it renders above the tab bar, `placement` was changed — revert to `.navigationBarDrawer`.

- [ ] **Step 4: Verify the button focuses the field**

```bash
xcrun simctl launch booted org.chqcal.app -uitest-search meditation
sleep 8 && xcrun simctl io booted screenshot /tmp/search-active.png
```

Confirm the field is visible and pinned with "meditation" in it — an active term must keep the field on screen so it can be seen and cleared, even though `displayMode` is now `.automatic`. If it scrolls away with a live term, add a condition that pins it while `!model.filter.searchText.isEmpty` and note it here.

- [ ] **Step 5: Run the full suite**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO 2>&1 | tail -40
```

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/CalendarView.swift ios/ChqCalendar/Features/Calendar/EventListView.swift
git commit -m "feat(ios): search scrolls away, with a toolbar button to reach it (#256)

displayMode goes .always -> .automatic, so the field stops costing 52pt on
every screen. .always existed to keep search discoverable without the
pull-down gesture; a magnifier button in the toolbar buys the same
guarantee at no permanent vertical cost.

placement stays .navigationBarDrawer and the comment saying why is
expanded rather than removed: the iOS 26 default placement is
bottom-anchored and collides with the tab bar, which is the failure that
put it there in the first place."
```

---

## Task 5: The rail drops its chevrons and gains rotor actions

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift` (`dayRail`)
- Modify: `ios/ChqCalendarUITests/DayRailUITests.swift:447`
- Modify: `ios/ChqCalendarUITests/DayRailAccessibilityUITests.swift:40,164`

**Interfaces:**
- Consumes: `DayRailNavigation.stepTargets(anchor:eventDays:)` — unchanged, still the source of "next/previous day with events".
- Produces: `DayRailView`'s Events call site passes `EmptyView()` as `trailing`. `day-step-previous` / `day-step-next` no longer exist on the Events rail. **My Day's chevrons are untouched.**

- [ ] **Step 1: Reduce the rail's furniture**

In `EventListView.dayRail(_:)`, replace the `leading:` closure and delete the `trailing:` closure:

```swift
            leading: {
                if let reachableToday {
                    nowButton(reachableToday, nav: nav)
                }
            },
            trailing: { EmptyView() })
```

Keep `let step = DayRailNavigation.stepTargets(...)` — Step 2 uses it. Keep `stepLabel(for:nav:)` for the same reason.

- [ ] **Step 2: Add the rotor actions**

The chevrons were the only control that skipped *empty* days, and their labels named the real destination. Tapping a neighbouring chip does not skip. Preserve the capability for VoiceOver by adding custom actions to the rail, immediately after the `DayRailView(...)` call's `.background(.bar)`:

```swift
        .accessibilityAction(named: Text("Previous day with events")) {
            if let previous = step.previous { selectDay(previous) }
        }
        .accessibilityAction(named: Text("Next day with events")) {
            if let next = step.next { selectDay(next) }
        }
```

These are deliberately named by capability rather than by destination, unlike the chevrons they replace: a rotor action is read from a list before it is chosen, so "Next day with events" is the useful phrasing there, where "Go to Sunday, August 16, 4 events" was the useful phrasing on a button the reader was already focused on.

- [ ] **Step 3: Fix the UI tests that name the chevrons**

`DayRailUITests.swift:447` asserts `app.buttons["day-step-previous"].isEnabled` is false at a boundary. That control no longer exists. Replace the assertion with one that covers what the change actually preserves — that the first day of the navigable bounds is the leftmost chip and there is nothing before it:

```swift
        // The step chevrons were removed in #256 (they cost ~88pt of a
        // 440pt rail, leaving 3 chips). What they guarded — that there is
        // no earlier day to reach — is now a property of the strip itself.
        let rail = app.scrollViews["day-rail"]
        let firstChip = rail.buttons.element(boundBy: 0)
        XCTAssertTrue(firstChip.exists)
```

In `DayRailAccessibilityUITests.swift`, remove `'day-step-previous', 'day-step-next'` from the identifier predicate at line 164, leaving `'day-rail-now'`, and update the comment at line 40 to match.

- [ ] **Step 4: Run the UI suite**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO -only-testing:ChqCalendarUITests 2>&1 | tail -40
```

Expected: all pass. Two XCUITest classes contending for one simulator on 3 cores fails as "Application is not running" — that is the serial-execution constraint, not a real failure. Re-run with `-parallel-testing-enabled NO` confirmed present.

- [ ] **Step 5: Verify My Day did not regress**

```bash
xcrun simctl launch booted org.chqcal.app -uitest-tab my-day
sleep 8 && xcrun simctl io booted screenshot /tmp/my-day.png
```

My Day's chevrons mean "go far" (reveal the rest of the season), not "go one", and must still be present. If they vanished, the change was made in `DayRailView` rather than at the Events call site — move it.

- [ ] **Step 6: Count the chips**

```bash
xcrun simctl launch booted org.chqcal.app -uitest-freeze-now "2026-07-27 09:00:00" -uitest-go-to-day 2026-07-30
sleep 12 && xcrun simctl io booted screenshot /tmp/rail-chips.png
```

Expected: ~6 day chips visible, up from 3. If it is still 3 or 4, the chevrons are still being rendered.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift ios/ChqCalendarUITests/
git commit -m "feat(ios): the Events rail drops its step chevrons (#256)

The chevrons sat outside the horizontal scroller (correctly — inside it
they scrolled away and became unreachable, which is why #245 pulled them
out) and cost ~88pt of a 440pt row, leaving 3 day chips on the largest
iPhone. Removing them roughly doubles that.

They were the only control that skipped empty days, and tapping a
neighbouring chip does not skip — so the capability is preserved as two
VoiceOver custom actions over the unchanged DayRailNavigation.stepTargets.
Named by capability rather than by destination, because a rotor action is
read from a list before it is chosen.

My Day keeps its own chevrons: there they mean 'go far', a different
question, and the change is made at the Events call site rather than in
DayRailView."
```

---

## Task 6: Week band spans (pure domain)

**Files:**
- Create: `ios/ChqCalendarShared/Domain/WeekBands.swift`
- Create: `ios/ChqCalendarTests/WeekBandsTests.swift`

**Interfaces:**
- Consumes: `SeasonCalendar.weeks(forYear:) -> [SeasonWeek]`, `ChqTime.parse(_:) -> Date?`, `ChqTime.dayKey(for:) -> String`, `ChqTime.calendar`.
- Produces:
  - `WeekBandSegment` — `dayKey: String`, `weekNumbers: [Int]` (1–2, ascending), `rampSteps: [Double]` (same order, 0…1), `navigationTarget: Int?`, `labelledWeek: Int?`, `id: String`.
  - `WeekBands.segments(dayKeys: [String], year: Int) -> [WeekBandSegment]`
  - `WeekBands.openingDayKey(ofWeek: Int, year: Int) -> String?`

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/WeekBandsTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// 2026 season: week 1 is Sat Jun 27 12:00 -> Sat Jul 4 12:00, so Jun 27
/// opens week 1 and Jul 4 is the week 1 / week 2 boundary.
struct WeekBandsTests {
    private func segments(_ keys: [String]) -> [WeekBandSegment] {
        WeekBands.segments(dayKeys: keys, year: 2026)
    }

    @Test func aBoundarySaturdayBelongsToBothItsWeeks() {
        let result = segments(["2026-07-04"])
        #expect(result.count == 1)
        #expect(result[0].weekNumbers == [1, 2])
    }

    @Test func aMidweekDayBelongsToOneWeek() {
        let result = segments(["2026-06-30"])
        #expect(result[0].weekNumbers == [1])
    }

    @Test func theOpeningSaturdayBelongsOnlyToWeekOne() {
        // No previous week to share with.
        let result = segments(["2026-06-27"])
        #expect(result[0].weekNumbers == [1])
    }

    @Test func anOutOfSeasonDayHasNoWeek() {
        let result = segments(["2026-01-15"])
        #expect(result[0].weekNumbers.isEmpty)
        #expect(result[0].navigationTarget == nil)
        #expect(result[0].labelledWeek == nil)
    }

    @Test func aSharedSaturdayIsNotATapTarget() {
        // Ambiguous by construction: it opens one week and closes another,
        // so a tap on it cannot mean one week. The six non-shared days
        // carry the week's navigation instead.
        let result = segments(["2026-07-04"])
        #expect(result[0].navigationTarget == nil)
    }

    @Test func aNonSharedDayNavigatesToItsOwnWeek() {
        let result = segments(["2026-06-30"])
        #expect(result[0].navigationTarget == 1)
    }

    @Test func theOpeningSaturdayOfWeekOneIsATapTarget() {
        // Week 1's opening Saturday is shared with nothing, so unlike every
        // other Saturday it is unambiguous.
        let result = segments(["2026-06-27"])
        #expect(result[0].navigationTarget == 1)
    }

    @Test func exactlyOneDayPerWeekCarriesTheLabel() {
        let keys = ChqTime.dayKeys(from: "2026-06-27", through: "2026-07-11")
        let result = segments(keys)
        let labelledForWeekOne = result.filter { $0.labelledWeek == 1 }
        let labelledForWeekTwo = result.filter { $0.labelledWeek == 2 }
        #expect(labelledForWeekOne.count == 1)
        #expect(labelledForWeekTwo.count == 1)
    }

    @Test func theLabelNeverLandsOnASharedSaturday() {
        let keys = ChqTime.dayKeys(from: "2026-06-27", through: "2026-08-29")
        for segment in segments(keys) where segment.labelledWeek != nil {
            #expect(segment.weekNumbers.count == 1)
        }
    }

    @Test func theLabelFollowsTheVisibleRunWhenAWeekIsClipped() {
        // The rail spans navigableBounds, which can start mid-week. The
        // label must land inside what is actually rendered, not at a fixed
        // offset from a week start that may not be on screen at all.
        let keys = ChqTime.dayKeys(from: "2026-07-01", through: "2026-07-03")
        let result = segments(keys)
        let labelled = result.filter { $0.labelledWeek == 1 }
        #expect(labelled.count == 1)
        #expect(keys.contains(labelled[0].dayKey))
    }

    @Test func rampRunsZeroToOneAcrossTheSeason() {
        let first = segments(["2026-06-29"])[0]   // week 1
        #expect(first.rampSteps == [0.0])

        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let lastWeek = weeks[weeks.count - 1]
        let midLastWeek = lastWeek.start.addingTimeInterval(2 * 24 * 60 * 60)
        let last = segments([ChqTime.dayKey(for: midLastWeek)])[0]
        #expect(last.rampSteps == [1.0])
    }

    @Test func aSharedSaturdayCarriesBothRampSteps() {
        let result = segments(["2026-07-04"])
        #expect(result[0].rampSteps.count == 2)
        #expect(result[0].rampSteps[0] < result[0].rampSteps[1])
    }

    @Test func openingDayKeyIsTheSaturdayThatStartsTheWeek() {
        #expect(WeekBands.openingDayKey(ofWeek: 1, year: 2026) == "2026-06-27")
        #expect(WeekBands.openingDayKey(ofWeek: 2, year: 2026) == "2026-07-04")
    }

    @Test func openingDayKeyRefusesAWeekOutsideTheSeason() {
        #expect(WeekBands.openingDayKey(ofWeek: 0, year: 2026) == nil)
        #expect(WeekBands.openingDayKey(ofWeek: 10, year: 2026) == nil)
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO -only-testing:ChqCalendarTests/WeekBandsTests 2>&1 | tail -20
```

Expected: compile failure — `WeekBands` does not exist.

- [ ] **Step 3: Implement**

Create `ios/ChqCalendarShared/Domain/WeekBands.swift`:

```swift
import Foundation

/// One day's slice of the week band above the day rail (#256).
///
/// One segment per day chip, so the band aligns with the chips **by
/// construction** rather than by two layouts happening to agree — the same
/// argument the web rail's shared chip-box class rests on. A single pixel
/// of drift shows up as a seam through a week boundary.
nonisolated struct WeekBandSegment: Equatable, Sendable, Identifiable {
    /// The day this segment sits above.
    let dayKey: String

    /// The season week(s) this day belongs to, ascending. Two entries means
    /// a boundary Saturday, which belongs to both the week it closes and
    /// the week it opens. Empty for a day outside the season.
    ///
    /// Day-granular deliberately: a Chautauqua week turns over at Saturday
    /// *noon*, but splitting a 44pt chip at its centre is a distinction no
    /// reader can use at swipe speed. This is the same model
    /// `SeasonCalendar.weekNumbers(spanningDayOf:)` gives the `Wk 5/6`
    /// day-header badge.
    let weekNumbers: [Int]

    /// Position in the season for each entry of `weekNumbers`, same order:
    /// 0 for week 1, 1 for the last week. Drives the colour ramp, which
    /// varies in lightness rather than hue so it survives colour-vision
    /// deficiency and so adjacent weeks always differ.
    let rampSteps: [Double]

    /// The week a tap here navigates to, or `nil` when a tap would be
    /// ambiguous or meaningless.
    ///
    /// `nil` for a *shared* Saturday: it opens one week and closes another,
    /// so a tap on it cannot mean one week. Each week's six non-shared days
    /// (Sunday through Friday) carry its navigation instead — plus week 1's
    /// opening Saturday and the final week's closing Saturday, which have
    /// no neighbour to share with. Also `nil` outside the season.
    let navigationTarget: Int?

    /// The week whose `WEEK n` label this segment draws, if any. At most
    /// one segment per week carries it.
    let labelledWeek: Int?

    var id: String { dayKey }
}

/// Builds the week band's per-day segments.
///
/// Pure and fully unit-testable: *which* spans a band covers is decided
/// here; where they land in pixels is the view's problem. That split is
/// deliberate — the pixel half is the part only a device can check.
nonisolated enum WeekBands {
    /// Segments for `dayKeys`, in the order given.
    ///
    /// `dayKeys` is the rail's own span (`navigableBounds`), which is a
    /// superset of the season and can start or end mid-week. Label
    /// placement therefore follows the *visible* run of each week rather
    /// than a fixed offset from a week start that may be off screen.
    static func segments(dayKeys: [String], year: Int) -> [WeekBandSegment] {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard !weeks.isEmpty else {
            return dayKeys.map {
                WeekBandSegment(dayKey: $0, weekNumbers: [], rampSteps: [],
                                navigationTarget: nil, labelledWeek: nil)
            }
        }

        let denominator = Double(max(weeks.count - 1, 1))
        let membership = dayKeys.map { key -> [Int] in
            guard let date = ChqTime.parse(key) else { return [] }
            return SeasonCalendar.weekNumbers(spanningDayOf: date, year: year)
        }

        // A week's label goes on the middle of its visible *non-shared*
        // days, so it never lands on a boundary Saturday (where it would
        // have to pick one of two weeks and would sit on the split fill).
        var labelIndexByWeek: [Int: Int] = [:]
        var soloIndicesByWeek: [Int: [Int]] = [:]
        for (index, numbers) in membership.enumerated() where numbers.count == 1 {
            soloIndicesByWeek[numbers[0], default: []].append(index)
        }
        for (week, indices) in soloIndicesByWeek {
            labelIndexByWeek[week] = indices[indices.count / 2]
        }

        return dayKeys.enumerated().map { index, key in
            let numbers = membership[index]
            let steps = numbers.map { Double($0 - 1) / denominator }
            // Unambiguous only when this day belongs to exactly one week.
            let target = numbers.count == 1 ? numbers[0] : nil
            let labelled = numbers.count == 1 && labelIndexByWeek[numbers[0]] == index
                ? numbers[0] : nil
            return WeekBandSegment(
                dayKey: key, weekNumbers: numbers, rampSteps: steps,
                navigationTarget: target, labelledWeek: labelled)
        }
    }

    /// The day key of the full Saturday that opens `number`.
    ///
    /// The navigation target for a band tap: a reader asking for week 6 is
    /// asking to be put at the top of week 6, and week 6 opens on that
    /// Saturday — even though its morning belongs to week 5, which the day
    /// header's `Wk 5/6` and the band's split fill both already say.
    ///
    /// Reachability is the caller's business: this names the day, and
    /// `EventListView.selectDay` decides whether it can be reached.
    static func openingDayKey(ofWeek number: Int, year: Int) -> String? {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let week = weeks.first(where: { $0.number == number }) else { return nil }
        return ChqTime.dayKey(for: week.start)
    }
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO -only-testing:ChqCalendarTests/WeekBandsTests 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 5: Falsify two guards**

The tests that are easiest to write worthless are the label ones. Prove they bite:

1. Change `labelIndexByWeek[week] = indices[indices.count / 2]` to `indices[0]` and confirm `theLabelFollowsTheVisibleRunWhenAWeekIsClipped` still passes (it should — index 0 is inside the visible run) but that nothing else breaks. This tells you that test is weaker than it looks; **strengthen it** to assert the label is not on the run's first or last day when the run is 3+ days:
   ```swift
   #expect(labelled[0].dayKey != keys.first)
   ```
2. Change `numbers.count == 1` to `!numbers.isEmpty` in the `labelled` line and confirm `theLabelNeverLandsOnASharedSaturday` fails. Restore.

Re-run the suite after restoring.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendarShared/Domain/WeekBands.swift ios/ChqCalendarTests/WeekBandsTests.swift
git commit -m "feat(ios): week band spans, ramp steps and label placement (#256)

One segment per day chip, so the band aligns with the chips by
construction rather than by two layouts happening to agree — a pixel of
drift reads as a seam through a week boundary.

Day-granular and overlapping: a boundary Saturday is in both its weeks,
via the same SeasonCalendar.weekNumbers(spanningDayOf:) that already
drives the Wk 5/6 day-header badge. A shared Saturday is deliberately not
a tap target — it opens one week and closes another, so a tap on it
cannot mean one week — and the label never lands on one either.

Label placement follows each week's visible non-shared run, because the
rail spans navigableBounds and can start or end mid-week; a fixed offset
from a week start would put labels off screen.

Pure and fully tested. Where the spans land in pixels is the view's
problem and only a device can check it."
```

---

## Task 7: The band renders

**Files:**
- Create: `ios/ChqCalendar/Assets.xcassets/WeekBandStart.colorset/Contents.json`
- Create: `ios/ChqCalendar/Assets.xcassets/WeekBandEnd.colorset/Contents.json`
- Modify: `ios/ChqCalendar/Features/Shared/DayRailView.swift`

**Interfaces:**
- Consumes: `WeekBands.segments(dayKeys:year:)`, `WeekBandSegment`.
- Produces: `DayRailView` gains `var bandSegments: [WeekBandSegment] = []` and `var onSelectWeek: ((Int) -> Void)? = nil`. Both default to inert, so **My Day's call site needs no change**.

- [ ] **Step 1: Add the ramp colorsets**

Create the two colorsets. Start = early season, End = late season. Keep them **desaturated** so no step competes with `DayChipSelected`, which is the only saturated fill on the rail and must stay that way.

`WeekBandStart.colorset/Contents.json` — light `#DCE6F2`, dark `#22303F`:

```json
{
  "colors" : [
    {
      "color" : { "color-space" : "srgb", "components" : { "alpha" : "1.000", "blue" : "0.949", "green" : "0.902", "red" : "0.863" } },
      "idiom" : "universal"
    },
    {
      "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "color" : { "color-space" : "srgb", "components" : { "alpha" : "1.000", "blue" : "0.247", "green" : "0.188", "red" : "0.133" } },
      "idiom" : "universal"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
```

`WeekBandEnd.colorset/Contents.json` — light `#8FA9C6`, dark `#5A7794`:

```json
{
  "colors" : [
    {
      "color" : { "color-space" : "srgb", "components" : { "alpha" : "1.000", "blue" : "0.776", "green" : "0.663", "red" : "0.561" } },
      "idiom" : "universal"
    },
    {
      "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "color" : { "color-space" : "srgb", "components" : { "alpha" : "1.000", "blue" : "0.580", "green" : "0.467", "red" : "0.353" } },
      "idiom" : "universal"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
```

These are a starting point, not a result. Step 5's audit decides whether they survive.

- [ ] **Step 2: Add the band to `DayRailView`**

Add the two properties to `DayRailView`:

```swift
    /// The week band above the chips, one entry per chip, in the same order
    /// as `entries`. Empty (the default) renders no band at all, which is
    /// what My Day passes — it has no season weeks to show.
    ///
    /// Same-length-as-`entries` is the caller's contract. A mismatch draws
    /// a partial band rather than crashing, and DEBUG builds trap on it.
    var bandSegments: [WeekBandSegment] = []

    /// Tapping a band navigates to that week. `nil` (the default) makes the
    /// band decorative.
    var onSelectWeek: ((Int) -> Void)? = nil
```

Inside the `ScrollView`'s content, wrap the existing chip `HStack` in a `VStack` and add the band row above it. Replace:

```swift
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(entries) { entry in
```

with:

```swift
                ScrollView(.horizontal, showsIndicators: false) {
                    // The band and the chips are one `VStack` per day inside
                    // one `HStack`, sharing this single `ScrollView` — so
                    // they share one `scrollLeft` and cannot desync, and each
                    // band segment is exactly its chip's width because it is
                    // laid out by the same stack. Alignment is structural,
                    // not a thing two layouts agree on.
                    HStack(spacing: 8) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            VStack(spacing: 2) {
                                bandSegment(at: index)
```

and close the `VStack` after the existing `DayChip(...)` block's `.id(entry.day)`, so the chip is the `VStack`'s second child. Keep `.id(entry.day)` on the **`VStack`**, not on the chip — `ScrollViewReader` scrolls to the outermost identified view, and moving it would leave the band out of the scrolled frame.

Add the segment builder:

```swift
    /// One day's band slice. A shared Saturday carries both weeks' tones,
    /// split down the middle — that is what says "this day is in both"
    /// rather than leaving the reader to infer it from two labels.
    @ViewBuilder
    private func bandSegment(at index: Int) -> some View {
        let segment = index < bandSegments.count ? bandSegments[index] : nil
        ZStack {
            if let segment, !segment.rampSteps.isEmpty {
                if segment.rampSteps.count == 1 {
                    rampColor(segment.rampSteps[0])
                } else {
                    HStack(spacing: 0) {
                        rampColor(segment.rampSteps[0])
                        rampColor(segment.rampSteps[1])
                    }
                }
            } else {
                // Outside the season: nothing, rather than a guess.
                Color.clear
            }

            if let week = segment?.labelledWeek {
                Text("WEEK \(week)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    // Not truncated to fit one chip — the label names a
                    // whole week and is allowed to overhang its own
                    // segment, clipped only by the scroll view.
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .frame(height: 14)
        .contentShape(Rectangle())
        .onTapGesture {
            if let week = segment?.navigationTarget { onSelectWeek?(week) }
        }
        .accessibilityElement()
        .accessibilityHidden(segment?.navigationTarget == nil)
        .accessibilityLabel(segment?.labelledWeek.map { "Week \($0)" } ?? "")
    }

    /// The ramp, interpolated between two named assets rather than nine
    /// hand-tuned colours. Lightness varies, hue does not — adjacent weeks
    /// always differ, the season reads as a gradient, and colour-vision
    /// deficiency costs nothing.
    private func rampColor(_ step: Double) -> Color {
        Color("WeekBandStart").mix(with: Color("WeekBandEnd"), by: step)
    }
```

`Color.mix(with:by:)` is iOS 18+. If the project's minimum is below that at build time, the compiler will say so — resolve by interpolating components manually rather than by lowering the target.

- [ ] **Step 3: Feed the band from `EventListView`**

In `EventListView.dayRail(_:)`, compute the segments from the same day keys the chips use and pass them:

```swift
        let railDayKeys = ChqTime.dayKeys(
            from: nav.bounds.lowerBound, through: nav.bounds.upperBound)

        return DayRailView(
            entries: MyDayChipContent.makeAll(
                days: railDayKeys,
                todayKey: todayKey,
                counts: nav.countsByDay,
                style: .events,
                includingYear: !model.isCurrentYear),
            // Same array the chips are built from, so the band's
            // one-segment-per-chip contract holds by construction.
            bandSegments: WeekBands.segments(dayKeys: railDayKeys, year: model.selectedYear),
            selectedDay: anchor,
```

(Move the existing inline `ChqTime.dayKeys(...)` call into `railDayKeys` so both consumers read the *same* array rather than two calls that happen to agree.) Leave `onSelectWeek` unset for now — Task 8 wires it.

- [ ] **Step 4: Build and screenshot**

```bash
cd ios && xcodebuild build -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" 2>&1 | tail -5
xcrun simctl launch booted org.chqcal.app -uitest-freeze-now "2026-07-27 09:00:00" -uitest-go-to-day 2026-07-30
sleep 12 && xcrun simctl io booted screenshot /tmp/band.png
```

Confirm: a band above the chips; `WEEK 5` / `WEEK 6` labels; the boundary Saturday's segment split into two tones; band and chips scroll together with no drift.

- [ ] **Step 5: Accessibility audit — the gate for this task**

This is the step most likely to send you back to Step 1. Phase 3b's on-device audit found 18 contrast failures and 21 Dynamic-Type warnings on rail chips that had passed every unit test, and the fix turned out to be sensitive to how the colour was *resolved*, not what pixels it produced. A band row plus nine new fills over that same background is squarely the shape of change that reopens it.

Add to `DayRailAccessibilityUITests.swift` an audit that visits both ends of the ramp:

```swift
    /// Week 1 and week 9 specifically. A ramp that reads fine mid-season
    /// and fails contrast at its extremes is the expected failure mode
    /// (#256), and a mid-season spot check sails straight past it.
    func testWeekBandPassesAuditAtBothEndsOfTheRamp() throws {
        for dayKey in ["2026-06-29", "2026-08-24"] {
            let app = XCUIApplication()
            app.launchArguments = ["-uitest-go-to-day", dayKey]
            app.launch()
            XCTAssertTrue(app.scrollViews["day-rail"].waitForExistence(timeout: 20))
            try app.performAccessibilityAudit()
            app.terminate()
        }
    }
```

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO \
  -only-testing:ChqCalendarUITests/DayRailAccessibilityUITests 2>&1 | tail -40
```

If contrast fails at either end, do **not** widen the audit's tolerance. Take one of the two documented fixes in the design: pull the ramp endpoints closer together (less lightness travel, still monotonic), or demote the fill to a thin rule beneath a normally-coloured label. Record which you chose and why in a comment on `rampColor`.

- [ ] **Step 6: Check Dynamic Type**

```bash
xcrun simctl ui booted content-size accessibility-extra-extra-extra-large
xcrun simctl launch booted org.chqcal.app -uitest-go-to-day 2026-07-30
sleep 12 && xcrun simctl io booted screenshot /tmp/band-axxxl.png
xcrun simctl ui booted content-size medium
```

The `WEEK n` label must remain legible and must not push the rail so tall it eats the list. If it does, cap the band's font growth with `.dynamicTypeSize(...DynamicTypeSize.accessibility1)` on the label only, and say so in a comment.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/Assets.xcassets/WeekBandStart.colorset ios/ChqCalendar/Assets.xcassets/WeekBandEnd.colorset \
        ios/ChqCalendar/Features/Shared/DayRailView.swift ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendarUITests/DayRailAccessibilityUITests.swift
git commit -m "feat(ios): the day rail gains a week band (#256)

Band and chips are one VStack per day inside one HStack inside the rail's
single ScrollView, so they share one scroll offset and each segment is
exactly its chip's width — alignment is structural rather than two
layouts agreeing.

Colour is a nine-step ramp interpolated between two named assets, not nine
hand-tuned hues: adjacent weeks always differ so boundaries pop at swipe
speed, the ramp is monotonic so it also carries position in the season, and
varying lightness rather than hue costs nothing under colour-vision
deficiency. The WEEK n label is always present, so colour is never the only
signal.

A boundary Saturday's segment is split into both weeks' tones. Out-of-season
days render nothing rather than a guess.

Adds an audit at both ends of the ramp specifically — a ramp that passes
mid-season and fails at its extremes is the expected failure, and last time
this rail's colours changed an on-device audit found 18 contrast failures
that no unit test predicted."
```

---

## Task 8: Tapping a band navigates

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`
- Test: `ios/ChqCalendarUITests/DayRailUITests.swift`

**Interfaces:**
- Consumes: `WeekBands.openingDayKey(ofWeek:year:)`, `EventListView.selectDay(_:)`, `nav.eventDays`.
- Produces: nothing new.

- [ ] **Step 1: Wire `onSelectWeek`**

In `EventListView.dayRail(_:)`, add to the `DayRailView(...)` call:

```swift
            onSelectWeek: { week in selectWeek(week, nav: nav) },
```

and add the method:

```swift
    /// Tapping a week band is navigation, exactly like tapping a chip —
    /// it must not touch scope, weeks, categories or search. A reader with
    /// a venue filter active keeps it. Filtering by week is a different
    /// control, in the Filters sheet's WHEN section.
    ///
    /// The target is the full Saturday that opens the week: a reader asking
    /// for week 6 is asking to be put at the top of week 6, and week 6 opens
    /// on that Saturday. Its morning belongs to week 5, which the day
    /// header's `Wk 5/6` and the band's own split fill both already say.
    ///
    /// Two fallbacks, because the rail never announces a destination it
    /// cannot reach: if the opening Saturday has nothing under the current
    /// non-date filters, land on the week's first day that does; if no day
    /// in the week does, do nothing.
    private func selectWeek(_ week: Int, nav: NavMatching) {
        guard let opening = WeekBands.openingDayKey(ofWeek: week, year: model.selectedYear)
        else { return }

        if nav.eventDays.contains(opening) {
            selectDay(opening)
            return
        }

        let weekDays = Set(
            WeekBands.segments(
                dayKeys: ChqTime.dayKeys(
                    from: nav.bounds.lowerBound, through: nav.bounds.upperBound),
                year: model.selectedYear
            )
            .filter { $0.weekNumbers.contains(week) }
            .map(\.dayKey))

        guard let fallback = nav.eventDays.sorted().first(where: { weekDays.contains($0) })
        else { return }
        selectDay(fallback)
    }
```

- [ ] **Step 2: Add a UI test**

Append to `DayRailUITests.swift`:

```swift
    /// Tapping a week band lands on the Saturday that opens that week, and
    /// changes no filter — the rule the whole #256 design rests on is that
    /// every control on the rail navigates and every filter is in the sheet.
    func testTappingAWeekBandNavigatesWithoutFiltering() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest-freeze-now", "2026-07-27 09:00:00",
                               "-uitest-go-to-day", "2026-07-30"]
        app.launch()

        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        let band = rail.otherElements.matching(
            NSPredicate(format: "label BEGINSWITH 'Week '")).firstMatch
        XCTAssertTrue(band.waitForExistence(timeout: 10))
        band.tap()

        // The filter button's accessible name carries the active count, so
        // it is the cheapest assertion that no filter moved.
        let filters = app.buttons["filters-toolbar-button"]
        XCTAssertTrue(filters.waitForExistence(timeout: 10))
        XCTAssertTrue(filters.label.contains("none active"))
    }
```

- [ ] **Step 3: Run the UI suite**

```bash
cd ios && xcodebuild test -scheme ChqCalendar \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro Max" \
  -parallel-testing-enabled NO -only-testing:ChqCalendarUITests 2>&1 | tail -40
```

- [ ] **Step 4: Falsify the guard**

Change `selectWeek` to also call `model.setWeekSelection([week])`, re-run `testTappingAWeekBandNavigatesWithoutFiltering`, and confirm it **fails** (the filter count is no longer "none active"). Restore. If it still passes, the assertion is not reading the thing it claims to and must be rewritten before this task is done.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift ios/ChqCalendarUITests/DayRailUITests.swift
git commit -m "feat(ios): tapping a week band navigates to that week (#256)

Navigation, not filtering — it touches no scope, week, category or search,
exactly like every other control on the rail. That is the rule the design
rests on: every rail control navigates, every filter lives in the sheet.
Filtering by week is still available, as WeekRangeStrip in the Filters
sheet's WHEN section.

Targets the full Saturday that opens the week rather than its first day
with events: a reader asking for week 6 wants the top of week 6. Falls back
to the week's first reachable day, then does nothing — the rail never
announces a destination it cannot reach.

Goes through selectDay, so edge growth, pending-scroll and re-anchoring all
come for free rather than being reimplemented."
```

---

## Task 9: Regenerate App Store assets and re-read the listing

`.github/workflows/app-store-assets.yml` blocks the PR without this. It checks that the manifest changed since the merge-base.

**Files:**
- Modify: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/*`
- Read: `docs/app-store/listing-copy.md`, `docs/app-store/listing-fields.json`

- [ ] **Step 1: Regenerate**

```bash
cd /Users/bernard/src/chq/chq-calendar
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

Do not boot five or more simulators at once — `simctl bootstatus -b` can hang indefinitely. If the script stalls, shut down all simulators and re-run.

- [ ] **Step 2: Review every regenerated shot**

`01-season` and `03-search` change most. Check specifically:

- `01-season`: no floating pills above the tab bar; the week band is present; ~6 day chips.
- `02-filters`: the sheet now opens with a `WHEN` section — confirm it is visible at the captured detent, not below the fold.
- `03-search`: the search field still shows "meditation". Its settle is 12s for a reason — a shorter one produced a blank capture against live production data.
- `07-my-day`: My Day's chevrons are still there.

A blank or placeholder detail pane on iPad means the linked-event count for `2026-07-30` dropped, not that the mechanism broke — see the note in `screenshot-plan.json`.

- [ ] **Step 3: Re-read the listing copy for claims this invalidates**

```bash
grep -n -i 'filter\|search\|pill\|button\|tap' docs/app-store/listing-copy.md
```

`01-season`'s caption is "Jump to any day with events." — still true, and the new rail serves it better. `02-filters` is "Narrow it to what you actually want." — still true. Flag anything that describes the *bottom* bar or a date pill; those controls no longer exist.

- [ ] **Step 4: Commit**

```bash
git add docs/app-store/
git commit -m "chore(ios): regenerate App Store screenshots for the chrome change (#256)

The Events tab's chrome changed visibly: no bottom pill bar, search and
filters in the toolbar, a week band on the day rail and roughly twice as
many day chips. 01-season, 02-filters and 03-search all shift.

Assets land in the repo now and upload at the next version submission —
metadata changes to a released version require a new version and a review
cycle. Promotional Text is the only field changeable without one."
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "consolidate the Events tab's chrome (#256)" --body "Closes #256.

Reclaims ~37% of the Events tab that was permanent chrome across five bands owned by four mechanisms.

- Search and Filters move into the toolbar beside the year and More. Search scrolls away; the magnifier button is the discoverability \`.always\` was buying.
- The bottom pill bar is deleted. It read as list content rather than chrome, and its placement was never chosen — it was where the tab bar collision left it.
- \`DateFilterSheet\` is deleted; its scopes and \`WeekRangeStrip\` move into \`FilterSheet\` as a WHEN section. This removes the second control called \"Now\" — the pill meant \`DateScope.next\`, the rail's button means go to today.
- The rail drops its step chevrons (3 chips → ~6) and gains a week band with a nine-step lightness ramp. Empty-day skip survives as VoiceOver rotor actions.
- Tapping a band navigates to the week's opening Saturday. Every rail control navigates; every filter is in the sheet.

**Reviewer notes.** \`.searchable\` deliberately keeps \`.navigationBarDrawer\` placement — the iOS 26 default is bottom-anchored and collides with the tab bar. \`SheetChip\` and \`SheetDismissButton\` were extracted in a separate first commit because they lived in the deleted file. The colour ramp is audited at week 1 and week 9 specifically.

Independent of #257, which fixes the week *filter* to match the band's day-granular model. The band renders identically either way."
```

Do not merge. Hand the PR to the user.

---

## Self-Review

**Spec coverage.** A1 search → Task 4. A2 Filters toolbar → Task 3. A3 pill bar deleted → Task 3. A4 chevrons → Task 5, week band → Tasks 6/7, ramp → Task 7, shared-Saturday split → Tasks 6/7, navigation target → Task 8. A5 `DateFilterSheet` deleted + WHEN section + `DateFilterLabel` re-homed + Clear Filters warning → Task 2. `WeekRangeStrip` re-parented → Task 2. Verification §1 band alignment → Task 7 Step 4; §2 audit → Task 7 Step 5; §3 `.searchable` on iOS 26 → Task 4 Step 3. Blast-radius rows for `DayRailUITests` and `DayRailAccessibilityUITests` → Task 5. Screenshots → Task 9.

**Gap found and closed:** the spec's blast-radius table did not mention that `SheetChip` and `SheetDismissButton` live inside `DateFilterSheet.swift`. Task 1 exists because of it.

**Open design items deliberately deferred to implementation**, each with a decision point in the plan: the band label at iPad-sidebar width and accessibility sizes (Task 7 Step 6), whether anything renders over out-of-season days (settled: nothing, Task 6), and filled-band vs rule-beneath-label (Task 7 Step 5 decides it from the audit result).

**Type consistency.** `WeekBandSegment`'s five properties are used with identical names in Tasks 6, 7 and 8. `WeekBands.segments(dayKeys:year:)` and `WeekBands.openingDayKey(ofWeek:year:)` keep their labels across Tasks 6, 7 and 8. `isFilterSheetPresented` is introduced in Task 2 and used in Task 3. `searchFocus` is introduced in Task 4 only. `filters-toolbar-button` is created in Task 3 and queried in Task 8.
