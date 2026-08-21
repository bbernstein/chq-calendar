# Date Navigation Phase 4 — iOS Consolidation and Release Prep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the cross-platform date-navigation initiative on iOS by routing
Siri through the same `goToDay` the day rail uses, fixing the `Filters` pill
truncation from phase 3b's device pass, and preparing the 1.1.3 release
(version sweep, day-navigation screenshot, listing copy). Phase 3b's device
pass also flagged a `Search events` placeholder clip at maximum accessibility
text size; it did not reproduce across five configurations during this phase's
own repro pass, so no fix was written and `CalendarView` still uses
`prompt: "Search events"` at both `.searchable` sites.

**Architecture:** A new `DeepLink.day(key:)` case rides the deep-link pipeline
every launch surface already funnels through (`.onOpenURL`, notification tap,
widget `widgetURL`, App Intent via `PendingIntentLink`, Spotlight) and is
consumed by `EventListView` through its existing `selectDay(_:)` — the same
function a rail chip tap calls, so voice and touch land in byte-identical state.
A new `OpenDayIntent` resolves an `IntentTimeframe` to a canonical day key,
checks it against `ViewWindow.navigableBounds` before opening, and speaks the
existing off-season dialog when the day is unreachable. Nothing new is invented:
`goToDay`, `PendingIntentLink`, `PendingDayScroll` and `IntentDialogText` all
shipped in earlier phases.

**Tech Stack:** Swift 6, SwiftUI, Swift Testing (`@Test`/`#expect`), AppIntents,
XCTest for `ChqCalendarUITests`, Xcode project settings, Python 3 for the
screenshot pipeline.

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`
(phase 4 is described at `:631` and in the "Obligations" section at `:669`; its
Siri rationale is at `:481`. Task 9 amends that section to match what shipped.)

## Global Constraints

- **Never commit to `main`.** PR A's branch is `feat/date-nav-phase-4-siri-routing`
  (already created). PR B branches off `main` after PR A merges.
- **Swift version:** Swift 6 with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`.
  Types the AppIntents/Shortcuts runtime queries off the main actor must be
  declared `nonisolated` (`DeepLink`, `IntentTimeframe`, `IntentDataSource`,
  `ChqShortcuts` all already are).
- **The window is HALF-OPEN:** `start <= x < endExclusive`. Never inclusive with
  a subtracted epsilon.
- **Day keys are `"yyyy-MM-dd"` in America/New_York**, produced by
  `ChqTime.dayKey(for:)` and validated by `ChqTime.isCanonicalDayKey(_:)`.
  `"2026-8-9"` parses but is not canonical — validate, do not merely parse.
- **Test command** (whole suite; UI tests run in the same invocation):
  ```bash
  cd ios && xcodebuild test \
    -project ChqCalendar.xcodeproj -scheme ChqCalendar \
    -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
    -parallel-testing-enabled NO \
    CODE_SIGNING_ALLOWED=NO
  ```
  Swap the `-destination` name/OS for an installed simulator
  (`xcrun simctl list devices available`). `CODE_SIGNING_ALLOWED=NO` is
  required, not cosmetic — `AppGroupTests.containerURLIsNilInTheUnitTestHost`
  asserts there is no App Group entitlement, which is exactly what this flag
  creates. `-parallel-testing-enabled NO` matches CI.
- **Prove every guard by breaking the code.** After a test passes, `git stash`
  the implementation (or invert a condition), re-run, confirm the test FAILS,
  restore. A test that cannot fail is worse than no test. This repo has shipped
  seven such tests across earlier phases.
- **App Store screenshot guard.** `.github/workflows/app-store-assets.yml` fails
  any PR touching `ios/ChqCalendar/Features/**`, `ios/ChqCalendar/App/**`,
  `ios/ChqCalendarShared/**`, `ios/ChqCalendarWidgets/**` or
  `ios/ChqCalendar/Assets.xcassets/**` unless
  `docs/app-store/screenshots.manifest.json` changed since the merge-base, OR
  the PR description carries `[skip-screenshots: <non-empty reason>]`. PR A
  qualifies for the opt-out (see Task 6); PR B regenerates for real.
- **`phrases[0]` of any `AppShortcut` must contain no `$`.** `SiriTipView` and
  the Shortcuts gallery render the first phrase with parameter slots
  *unresolved* — a `\(\.$timeframe)` there prints `${timeframe}` to users. This
  leaked on 4 of 7 actions in #193. `ChqShortcutsTests` already asserts it for
  every registered shortcut; do not weaken that test.
- **New Swift files need no `project.pbxproj` edit.** The project uses
  `PBXFileSystemSynchronizedRootGroup`, so a file created under a synced
  directory joins its target automatically. Task 7's version sweep is the only
  task that edits the project file.
- **Coverage floors** are enforced per-PR (`.coverage-floor.json`,
  `docs/coverage.md`) for the frontend/backend. This plan is iOS-only and does
  not touch them.

---

## File Structure

**PR A — Siri routing and accessibility**

| File | Responsibility |
|---|---|
| `ios/ChqCalendarShared/Domain/DeepLink.swift` | Add `case day(key: String)` + parse/serialize. |
| `ios/ChqCalendarShared/Domain/IntentTimeframe.swift` | Add `targetDayKey(now:year:)` — the one place a spoken timeframe becomes a day key. |
| `ios/ChqCalendarShared/Domain/IntentDialogText.swift` | Add `unreachableDay(year:)`. |
| `ios/ChqCalendar/Features/Root/RootTabView.swift` | Route `.day` to the Events tab without consuming the link. |
| `ios/ChqCalendar/App/AppModel.swift` | Add `resolvePendingDayDeepLinkIfPossible()`. |
| `ios/ChqCalendar/Features/Calendar/EventListView.swift` | Consume the resolved day through the existing `selectDay(_:)`; accessibility fix for the `Filters` pill. |
| `ios/ChqCalendar/Features/Calendar/CalendarView.swift` | `-uitest-go-to-day <key>` launch arg; planned search-prompt accessibility fix — not applied (see Task 6's Outcome note: the finding did not reproduce). |
| `ios/ChqCalendarShared/Domain/OpenDayTarget.swift` | The intent's whole decision — day key + reachability — as a pure, testable type. |
| `ios/ChqCalendar/Intents/EventIntents.swift` | Add `OpenDayIntent` beside `OpenEventIntent`. |
| `ios/ChqCalendar/Intents/ChqShortcuts.swift` | Register the 8th `AppShortcut`. |
| `ios/ChqCalendar/Features/About/AboutInfo.swift` | Add the example phrase to the About sheet. |
| `ios/ChqCalendarTests/DeepLinkTests.swift` | Round trip, URL shape, rejection of non-canonical keys. |
| `ios/ChqCalendarTests/AppModelTests.swift` | `resolvePendingDayDeepLinkIfPossible` behaviour. |
| `ios/ChqCalendarTests/IntentTimeframeTests.swift` | `targetDayKey` per timeframe, including the week-9 edge. |
| `ios/ChqCalendarTests/OpenDayTargetTests.swift` | Navigate-vs-refuse, including the season edge and off-season. |
| `ios/ChqCalendarTests/DeepLinkTabRouteTests.swift` | `DeepLinkTabRoute.resolve(.day)`. |
| `ios/ChqCalendarUITests/DayRailUITests.swift` | A `-uitest-go-to-day` launch lands the rail on that day. |

**PR B — release prep**

| File | Responsibility |
|---|---|
| `ios/ChqCalendar.xcodeproj/project.pbxproj` | 1.1.3 / build 6 across every target including the two test bundles. |
| `ios/Scripts/screenshot-plan.json` | `01-season` reworked into the day-navigation shot. |
| `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/` | Regenerated assets. |
| `docs/app-store/listing-fields.json`, `docs/app-store/listing-copy.md` | 1.1.3 `whatsNew` and `promotionalText`. |
| `docs/app-store/RELEASE_CHECKLIST.md` | The 1.1.3 entry. |
| `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md` | Phase-4 section amended to what shipped. |

---

# PR A — Siri routing and accessibility

Branch: `feat/date-nav-phase-4-siri-routing`

### Task 1: `DeepLink.day(key:)`

The deep-link vocabulary gains a day. Everything downstream (the tab route, the
model resolver, the intent) depends on this case existing, so it lands first and
alone.

**Files:**
- Modify: `ios/ChqCalendarShared/Domain/DeepLink.swift`
- Test: `ios/ChqCalendarTests/DeepLinkTests.swift`

**Interfaces:**
- Consumes: `ChqTime.isCanonicalDayKey(_:)` (`ChqCalendarShared/Support/ChqTime.swift:146`).
- Produces: `DeepLink.day(key: String)`, serialising to `chqcal://day/<yyyy-MM-dd>`.
  Tasks 2, 3, 5 and 8 all reference this exact case name and payload label.

- [ ] **Step 1: Write the failing tests**

Append to `ios/ChqCalendarTests/DeepLinkTests.swift`, inside `struct DeepLinkTests`,
after the existing map round-trip tests:

```swift
    @Test func dayRoundTrips() {
        let link = DeepLink.day(key: "2026-07-29")
        #expect(DeepLink.parse(link.url) == link)
    }

    @Test func dayURLHasExpectedShape() {
        #expect(DeepLink.day(key: "2026-07-29").url.absoluteString == "chqcal://day/2026-07-29")
    }

    /// `ChqTime.parse` is more permissive than its format string suggests —
    /// `"2026-7-9"` reads as July 9th and `"26-07-09"` reads as year 26 — and
    /// neither is a key `EventFilter`'s raw string comparisons will ever match.
    /// A link carrying one must be rejected at the door rather than silently
    /// resolving to a day the list cannot show.
    @Test func dayWithANonCanonicalKeyIsRejected() {
        #expect(DeepLink.parse(URL(string: "chqcal://day/2026-7-9")!) == nil)
        #expect(DeepLink.parse(URL(string: "chqcal://day/26-07-09")!) == nil)
        #expect(DeepLink.parse(URL(string: "chqcal://day/tomorrow")!) == nil)
    }

    @Test func dayWithNoKeyIsRejected() {
        #expect(DeepLink.parse(URL(string: "chqcal://day")!) == nil)
        #expect(DeepLink.parse(URL(string: "chqcal://day/")!) == nil)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/DeepLinkTests
```

Expected: FAIL to **compile** — `type 'DeepLink' has no member 'day'`. A
compile failure is the correct "red" here; do not proceed until you have seen it.

- [ ] **Step 3: Add the case**

In `ios/ChqCalendarShared/Domain/DeepLink.swift`, extend the doc comment's
recognized-shapes list with:

```swift
/// - `chqcal://day/<yyyy-MM-dd>` — open the Events tab on that day, growing
///   the window if the day lies past an edge. The key must be canonical
///   (`ChqTime.isCanonicalDayKey`); see `dayWithANonCanonicalKeyIsRejected`.
```

Add the case to the enum:

```swift
nonisolated enum DeepLink: Equatable, Sendable {
    case event(id: String)
    case myDay
    case map(venue: String?)
    case day(key: String)
```

Add to `parse`'s `switch host`, before `default`:

```swift
        case "day":
            guard let key = pathComponents.first, ChqTime.isCanonicalDayKey(key) else { return nil }
            return .day(key: key)
```

Add to `url`'s `switch self`:

```swift
        case .day(let key):
            components.host = "day"
            components.path = "/\(key)"
```

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2. Expected: PASS, all 19 `DeepLinkTests` cases.

- [ ] **Step 5: Prove the canonical-key guard can fail**

Temporarily relax the guard to `guard let key = pathComponents.first, !key.isEmpty`,
re-run, and confirm `dayWithANonCanonicalKeyIsRejected` FAILS. Restore the real
guard and re-run to green. This is the guard most likely to be written as
decoration.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DeepLink.swift ios/ChqCalendarTests/DeepLinkTests.swift
git commit -m "feat(ios): add a chqcal://day/<key> deep link case"
```

---

### Task 2: Route and resolve a pending day link

`.day` must land on the Events tab *without* the tab switch consuming the link —
the same two-phase contract `.event` uses, because the tab switch is not the
navigation. The list completes it once a snapshot exists.

**Files:**
- Modify: `ios/ChqCalendar/Features/Root/RootTabView.swift:38-48` (`DeepLinkTabRoute.resolve`)
- Modify: `ios/ChqCalendar/App/AppModel.swift` (add beside `resolvePendingEventDeepLinkIfPossible`, which ends at `:650`)
- Test: `ios/ChqCalendarTests/DeepLinkTabRouteTests.swift`, `ios/ChqCalendarTests/AppModelTests.swift`

**Interfaces:**
- Consumes: `DeepLink.day(key:)` (Task 1); `AppModel.snapshot`, `AppModel.pendingDeepLink`.
- Produces: `AppModel.resolvePendingDayDeepLinkIfPossible() -> String?` — returns
  the day key exactly once and clears `pendingDeepLink`, or `nil` if the pending
  link is not a `.day` or no snapshot has arrived yet. Task 3 calls it.

- [ ] **Step 1: Write the failing tests**

Append to `ios/ChqCalendarTests/DeepLinkTabRouteTests.swift`:

```swift
    /// `.day` behaves like `.event`, not like `.myDay`: selecting the Events
    /// tab is not the navigation, so the link must survive the tab switch for
    /// `EventListView` to consume once a snapshot exists.
    @Test func dayLinkRoutesToEventsWithoutConsumingTheLink() {
        let route = DeepLinkTabRoute.resolve(.day(key: "2026-07-29"))

        #expect(route.tab == .events)
        #expect(route.consumesLink == false)
        #expect(route.mapFocusVenue == nil)
    }
```

Append to `ios/ChqCalendarTests/AppModelTests.swift`, in the same region as the
`goToDay` tests (they start at `:1474`):

```swift
    // MARK: - Pending day deep link

    @Test func pendingDayLinkResolvesOnceASnapshotExists() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.pendingDeepLink = .day(key: "2026-08-06")

        #expect(model.resolvePendingDayDeepLinkIfPossible() == "2026-08-06")
        #expect(model.pendingDeepLink == nil)
    }

    /// Idempotent: a second call must not re-deliver a link already acted on,
    /// or every `.onChange` trigger in `EventListView` would re-scroll a reader
    /// who has since moved.
    @Test func pendingDayLinkIsDeliveredExactlyOnce() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.pendingDeepLink = .day(key: "2026-08-06")

        _ = model.resolvePendingDayDeepLinkIfPossible()

        #expect(model.resolvePendingDayDeepLinkIfPossible() == nil)
    }

    /// Before the snapshot lands there are no day sections to scroll to, so
    /// holding the link is what makes a cold launch work.
    @Test func pendingDayLinkIsHeldUntilTheSnapshotArrives() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.snapshot = nil
        model.pendingDeepLink = .day(key: "2026-08-06")

        #expect(model.resolvePendingDayDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .day(key: "2026-08-06"))
    }

    @Test func pendingEventLinkIsNotResolvedAsADay() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.pendingDeepLink = .event(id: "seed0")

        #expect(model.resolvePendingDayDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .event(id: "seed0"))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/DeepLinkTabRouteTests \
  -only-testing:ChqCalendarTests/AppModelTests
```

Expected: FAIL to compile — no `resolvePendingDayDeepLinkIfPossible`, and
`DeepLinkTabRoute.resolve` is not exhaustive over the new case.

- [ ] **Step 3: Implement the route**

In `ios/ChqCalendar/Features/Root/RootTabView.swift`, add to `resolve`'s switch:

```swift
        case .day:
            return DeepLinkTabRoute(tab: .events, consumesLink: false, mapFocusVenue: nil)
```

Update the `consumesLink` doc comment (`:28-29`), which currently says `false`
is "only for `.event`":

```swift
    /// Whether selecting `tab` fully consumes the link (clears
    /// `pendingDeepLink`). `false` for `.event` and `.day` — both need the
    /// Events tab's own content before the navigation is complete.
```

- [ ] **Step 4: Implement the resolver**

In `ios/ChqCalendar/App/AppModel.swift`, immediately after
`resolvePendingEventDeepLinkIfPossible()`:

```swift
    /// Resolves a pending `.day(key:)` deep link, clearing `pendingDeepLink`
    /// and returning the key once a snapshot exists to navigate within.
    ///
    /// Unlike the `.event` resolver above there is no "is it present?"
    /// question to retry: a day key needs no lookup, and `goToDay` is the
    /// authority on whether the day is reachable. So this clears the link as
    /// soon as the list has data, whether or not the caller's subsequent
    /// `goToDay` accepts it — a day outside `navigableBounds` is refused, not
    /// retried, and holding the link would make it fire again on the next
    /// snapshot refresh.
    ///
    /// Waiting for `snapshot` is what makes a cold launch work: before it
    /// lands there are no day sections mounted for `PendingDayScroll` to find.
    func resolvePendingDayDeepLinkIfPossible() -> String? {
        guard case .day(let key) = pendingDeepLink else { return nil }
        guard snapshot != nil else { return nil }
        pendingDeepLink = nil
        return key
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Prove the hold-until-snapshot guard can fail**

Delete the `guard snapshot != nil else { return nil }` line, re-run, and confirm
`pendingDayLinkIsHeldUntilTheSnapshotArrives` FAILS. Restore and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/Features/Root/RootTabView.swift ios/ChqCalendar/App/AppModel.swift \
  ios/ChqCalendarTests/DeepLinkTabRouteTests.swift ios/ChqCalendarTests/AppModelTests.swift
git commit -m "feat(ios): route a pending day deep link to the events tab"
```

---

### Task 3: `EventListView` consumes the day link

The payoff task: a day link now lands exactly where a rail chip tap lands,
because it calls the identical function.

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift` (the modifier
  chain ending at `:586` with `.onAppear`, and a new private helper beside
  `selectDay` at `:377`)
- Modify: `ios/ChqCalendar/Features/Calendar/CalendarView.swift` (the UI-test
  hook block; `-uitest-tab` is at `:258` and is the pattern to copy)
- Test: `ios/ChqCalendarUITests/DayRailUITests.swift`

**Interfaces:**
- Consumes: `AppModel.resolvePendingDayDeepLinkIfPossible()` (Task 2);
  `EventListView.selectDay(_:)` (`:377`, already private in this file).
- Produces: the `-uitest-go-to-day <yyyy-MM-dd>` launch argument, which Task 8's
  screenshot depends on. It sets `model.pendingDeepLink = .day(key:)` — it does
  **not** call `goToDay` directly, so the screenshot exercises the real pipeline.

- [ ] **Step 1: Write the failing UI test**

Append to `ios/ChqCalendarUITests/DayRailUITests.swift`, using that file's own
`launchFixtureApp(now:extraArgs:)` helper (`ChqCalendarUITests/UITestApp.swift:17`)
and its `day-chip-<key>` identifiers:

```swift
    /// A `chqcal://day/<key>` link — the shape `OpenDayIntent` writes — lands
    /// the list on that day and pins the rail's highlight there, exactly as a
    /// chip tap does. Driven through the launch argument, which feeds
    /// `model.pendingDeepLink` rather than calling `goToDay` directly, so this
    /// covers the whole pipeline a Siri run takes.
    ///
    /// The target is fifty-one days beyond `now`, outside the launch window —
    /// the same target `testADistantChipTapLandsOnThatDay` uses, and for the
    /// same reason: nothing here can pass by accident. The window has to grow,
    /// the day has to mount, the list has to scroll, and the rail has to adopt
    /// the pin. None of that is something a launch does on its own.
    func testADayDeepLinkLandsOnThatDay() {
        let app = launchFixtureApp(
            now: "2026-07-01 10:00:00",
            extraArgs: ["-uitest-go-to-day", "2026-08-21"])
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        // 2026-08-21 is a Friday; the fixture titles every day header through
        // ChqTime.dayTitle ("EEEE, MMMM d", en_US_POSIX, no year), same as
        // testADistantChipTapLandsOnThatDay above.
        let header = app.staticTexts["Friday, August 21"]
        XCTAssertTrue(
            header.waitForExistence(timeout: 20),
            "The linked day never mounted — the deep link never reached selectDay, or the window did not grow")
        XCTAssertTrue(
            header.isHittable,
            "The day mounted but the list never scrolled to it")
        XCTAssertTrue(
            app.buttons["day-chip-2026-08-21"].isSelected,
            "The linked day is not the rail's pinned selection")
    }
```

Read `testADistantChipTapLandsOnThatDay` (`:131`) before writing this — it is
the same assertion shape with a tap where this has a launch argument, and
matching the file beats matching this plan if the two ever disagree.

- [ ] **Step 2: Run the UI test to verify it fails**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarUITests/DayRailUITests/testADayDeepLinkLandsOnThatDay
```

Expected: FAIL — the launch argument is unknown, so the app opens on the default
day and no chip named July 30 is selected.

- [ ] **Step 3: Add the launch argument**

In `ios/ChqCalendar/Features/Calendar/CalendarView.swift`, in the UI-test hook
block, immediately after the `-uitest-tab` handler (`:258-268`):

```swift
        // `-uitest-go-to-day <yyyy-MM-dd>` lands the Events list on a named
        // day by feeding `model.pendingDeepLink` — the same channel
        // `OpenDayIntent` writes through `PendingIntentLink`. Going through
        // the link rather than calling `model.goToDay` directly is the point:
        // the screenshot and the UI test then cover the real pipeline, not a
        // shortcut around it. A non-canonical key is ignored (the link is
        // never constructed), leaving the launch behaving as if the flag were
        // absent.
        if let flagIndex = arguments.firstIndex(of: "-uitest-go-to-day"),
           arguments.index(after: flagIndex) < arguments.endIndex {
            let key = arguments[arguments.index(after: flagIndex)]
            if ChqTime.isCanonicalDayKey(key) {
                model.pendingDeepLink = .day(key: key)
            }
        }
```

- [ ] **Step 4: Consume the link in `EventListView`**

In `ios/ChqCalendar/Features/Calendar/EventListView.swift`, add beside
`selectDay(_:)`:

```swift
    /// Completes a `chqcal://day/<key>` deep link the tab route deliberately
    /// left pending (`DeepLinkTabRoute.resolve(.day)` sets
    /// `consumesLink: false`).
    ///
    /// Routes through `selectDay` — the exact function a rail chip tap calls —
    /// so a Siri "show me tomorrow" and a finger on tomorrow's chip leave the
    /// app in identical state: same window expansion, same pinned selection,
    /// same queued scroll. `selectDay` already refuses an unreachable day, so
    /// nothing extra is needed for a link naming a day outside the season.
    private func consumePendingDayLinkIfPossible() {
        guard let dayKey = model.resolvePendingDayDeepLinkIfPossible() else { return }
        selectDay(dayKey)
    }
```

Attach it to the same modifier chain that already carries `.onChange(of: pendingScroll)`
and `.onAppear` (`:582-587`), after `.onAppear`:

```swift
            // The link can arrive before this view exists (a cold launch from
            // Siri), at the moment the tab switch mounts it, or later while it
            // is already on screen — and in every case it can only be acted on
            // once `snapshot` lands. Hence three triggers, all funnelling into
            // one idempotent resolver: `resolvePendingDayDeepLinkIfPossible`
            // returns the key exactly once, so extra calls cost a nil check.
            // `snapshot?.fetchedAt` rather than `phase` for the same reason
            // `resolvePendingEventDeepLinkIfPossible`'s callers use it: a warm
            // launch sets `phase = .ready` immediately and never changes it
            // again when the background refresh replaces the snapshot.
            .onChange(of: model.pendingDeepLink) { _, _ in
                consumePendingDayLinkIfPossible()
            }
            .onChange(of: model.snapshot?.fetchedAt) { _, _ in
                consumePendingDayLinkIfPossible()
            }
            .onAppear {
                consumePendingDayLinkIfPossible()
            }
```

Note the existing `.onAppear { landPendingScroll(proxy, days: days) }` stays —
add a second `.onAppear` rather than merging them, so the two concerns stay
readable, or merge them into one closure if the file's style prefers that. Both
compile; pick the one matching the surrounding code.

- [ ] **Step 5: Run the UI test to verify it passes**

Same command as Step 2. Expected: PASS. UI tests boot the app, so allow ~2
minutes.

- [ ] **Step 6: Run the whole suite**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

Expected: PASS, no regressions. Phase 3b's rail tests are the ones to watch —
the new `.onChange(of: model.pendingDeepLink)` fires on every link, including
`.event`, where `consumePendingDayLinkIfPossible` must be a no-op.

- [ ] **Step 7: Prove the consumption is real**

Comment out the body of `consumePendingDayLinkIfPossible` (leave `return`),
re-run the new UI test, confirm it FAILS. Restore and re-run to green.

- [ ] **Step 8: Commit**

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift \
  ios/ChqCalendar/Features/Calendar/CalendarView.swift \
  ios/ChqCalendarUITests/DayRailUITests.swift
git commit -m "feat(ios): land a day deep link through the rail's own selectDay"
```

---

### Task 4: A spoken timeframe becomes a day key

Pure, shared, testable without the AppIntents runtime — the same split
`IntentDataSource` uses so `IntentSelectionTests` can exercise selection with
fixture events.

**Files:**
- Modify: `ios/ChqCalendarShared/Domain/IntentTimeframe.swift`
- Modify: `ios/ChqCalendarShared/Domain/IntentDialogText.swift` (after `noTheme()` at `:58`)
- Test: `ios/ChqCalendarTests/IntentTimeframeTests.swift`

**Interfaces:**
- Consumes: `IntentTimeframe.interval(now:year:)` (already present),
  `ChqTime.dayKey(for:)`.
- Produces: `IntentTimeframe.targetDayKey(now:year:) -> String` and
  `IntentDialogText.unreachableDay(year:) -> String`. Task 5 calls both.

- [ ] **Step 1: Write the failing tests**

Append to `ios/ChqCalendarTests/IntentTimeframeTests.swift`:

```swift
    // MARK: - targetDayKey

    /// The day a spoken timeframe should *land on* is the first day of the
    /// window it means — not the whole window. "This week" opens on today, not
    /// on Saturday: the reader asked what is happening, and the rail is right
    /// there for the rest of the week.
    @Test func targetDayKeyIsTheFirstDayOfTheInterval() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))

        #expect(IntentTimeframe.today.targetDayKey(now: now, year: 2026) == "2026-07-27")
        #expect(IntentTimeframe.tonight.targetDayKey(now: now, year: 2026) == "2026-07-27")
        #expect(IntentTimeframe.tomorrow.targetDayKey(now: now, year: 2026) == "2026-07-28")
        #expect(IntentTimeframe.thisWeek.targetDayKey(now: now, year: 2026) == "2026-07-27")
    }

    /// `tonight` is 5pm-anchored, so asking at 9pm must still mean today —
    /// `interval` clamps its start to `now`, and the day key of either is the
    /// same day. Pinned because a naive "5pm tomorrow" rewrite would pass the
    /// morning case above and break this one.
    @Test func targetDayKeyForTonightAskedLateIsStillToday() throws {
        let now = try #require(ChqTime.parse("2026-07-27 21:30:00"))

        #expect(IntentTimeframe.tonight.targetDayKey(now: now, year: 2026) == "2026-07-27")
    }

    @Test func targetDayKeyForAnExplicitWeekIsThatWeeksFirstDay() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))
        let week3 = SeasonCalendar.weeks(forYear: 2026)[2]

        #expect(IntentTimeframe.week3.targetDayKey(now: now, year: 2026)
                == ChqTime.dayKey(for: week3.start))
    }

    /// Week 9's "next week" is past the season: `interval` returns a
    /// zero-length window at the season's end. A day key still comes out — it
    /// is `OpenDayIntent`'s bounds check, not this function, that refuses it.
    /// Pinned so a later "return nil when empty" refactor has to argue with a
    /// test rather than silently change where the refusal lives.
    @Test func targetDayKeyForNextWeekInWeekNineStillProducesAKey() throws {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let inWeekNine = weeks[8].start.addingTimeInterval(3600)

        let key = IntentTimeframe.nextWeek.targetDayKey(now: inWeekNine, year: 2026)

        #expect(ChqTime.isCanonicalDayKey(key))
        #expect(key == ChqTime.dayKey(for: weeks[8].end))
    }

```

Do **not** add a "every timeframe produces a canonical key" loop over
`allCases`. `ChqTime.dayKey` produces canonical output by construction, so such
a test cannot fail no matter what `targetDayKey` does — it would read as
coverage while proving nothing. This repo has shipped seven tests with that
defect across earlier phases.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/IntentTimeframeTests
```

Expected: FAIL to compile — no member `targetDayKey`.

- [ ] **Step 3: Implement `targetDayKey`**

In `ios/ChqCalendarShared/Domain/IntentTimeframe.swift`, after `interval(now:year:)`:

```swift
    /// The single NY day this timeframe should open the Events tab on — the
    /// first day of `interval`, in `ChqTime.dayKey` form.
    ///
    /// A timeframe names a *window*; navigation needs a *day*. Taking the
    /// window's first day is what makes "what's happening this week" and
    /// "show me this week" agree about where the reader lands, and the day
    /// rail carries them onward from there.
    ///
    /// Always returns a canonical key, including for the degenerate windows
    /// `interval` produces off-season and for week 9's "next week" — whether
    /// that day is *reachable* is `ViewWindow.navigableBounds`' question, and
    /// `OpenDayIntent` asks it.
    func targetDayKey(now: Date, year: Int) -> String {
        ChqTime.dayKey(for: interval(now: now, year: year).start)
    }
```

- [ ] **Step 4: Add the dialog line**

In `ios/ChqCalendarShared/Domain/IntentDialogText.swift`, after `noTheme()`:

```swift
    /// Spoken when a requested day exists on the calendar but lies outside
    /// everything navigation can reach — e.g. "show me tomorrow" asked on the
    /// season's last day. Distinct from `offSeason`, which explains that the
    /// *season* is not running; this explains that the *day* is not in it.
    static func unreachableDay(year: Int) -> String {
        "That day is outside the \(year) season."
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Same command as Step 2. Expected: PASS.

- [ ] **Step 6: Prove `targetDayKeyForTonightAskedLateIsStillToday` can fail**

Change `targetDayKey` to use `interval(...).end` instead of `.start`, re-run, and
confirm at least `targetDayKeyIsTheFirstDayOfTheInterval` FAILS (`tomorrow` would
still return 2026-07-28's end-of-day, so check the `thisWeek` case specifically).
Restore and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendarShared/Domain/IntentTimeframe.swift \
  ios/ChqCalendarShared/Domain/IntentDialogText.swift \
  ios/ChqCalendarTests/IntentTimeframeTests.swift
git commit -m "feat(ios): resolve a spoken timeframe to a navigable day key"
```

---

### Task 5: `OpenDayIntent` and the 8th shortcut

The intent's *decision* is split out as a pure type, the same way
`IntentDataSource.selectMatching` is split out of the intents that call it.
That is not tidiness: an assertion written against `ViewWindow.navigableBounds`
directly would pass even if the intent's guard were deleted, which is the
unfalsifiable-test trap this project has been bitten by repeatedly. Testing
`OpenDayTarget.resolve` tests the thing that can actually be wrong.

**Files:**
- Create: `ios/ChqCalendarShared/Domain/OpenDayTarget.swift`
- Create: `ios/ChqCalendarTests/OpenDayTargetTests.swift`
- Modify: `ios/ChqCalendar/Intents/EventIntents.swift` (after `OpenEventIntent`, which ends at `:58`)
- Modify: `ios/ChqCalendar/Intents/ChqShortcuts.swift` (add an `AppShortcut`; update the doc comment's "seven shortcuts" at `:4`)
- Modify: `ios/ChqCalendar/Features/About/AboutInfo.swift:58-66` (`siriPhrases`)

**Interfaces:**
- Consumes: `IntentTimeframe.targetDayKey(now:year:)` and
  `IntentDialogText.unreachableDay(year:)` (Task 4); `DeepLink.day(key:)`
  (Task 1); `PendingIntentLink.write(_:to:)` (`EventIntents.swift:25`);
  `IntentDataSource.events(now:)` / `.defaultYear()`;
  `ViewWindow.navigableBounds(year:events:starredDays:)` (`ViewWindow.swift:75`);
  `IntentDialogText.offSeason(_:year:)` (`:60`) and `.coldCache()` (`:70`).
- Produces: `OpenDayTarget.resolve(timeframe:now:year:events:) -> OpenDayTarget`,
  an enum of `.navigate(dayKey: String)` / `.refuse(dialog: String)`; and
  `OpenDayIntent` with `static let openAppWhenRun = true` and a
  `@Parameter var timeframe: IntentTimeframe?`.

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/OpenDayTargetTests.swift`. `makeEvent(id:start:…)`
is a top-level function in `ios/ChqCalendarTests/TestSupport.swift:49` — every
test file in the bundle can call it; do not write a second builder.

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// `OpenDayIntent`'s whole decision, minus the AppIntents runtime.
struct OpenDayTargetTests {
    @Test func aDayInsideTheSeasonIsNavigatedTo() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))
        let events = [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-28 10:00:00")))]

        let target = OpenDayTarget.resolve(
            timeframe: .tomorrow, now: now, year: 2026, events: events)

        #expect(target == .navigate(dayKey: "2026-07-28"))
    }

    /// No timeframe spoken ("show me a day") means today — the same default
    /// every other timeframe-carrying intent uses.
    @Test func noTimeframeMeansToday() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))
        let events = [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-27 10:00:00")))]

        let target = OpenDayTarget.resolve(
            timeframe: nil, now: now, year: 2026, events: events)

        #expect(target == .navigate(dayKey: "2026-07-27"))
    }

    /// The case the refusal exists for: asked on the season's last day,
    /// "tomorrow" names a real calendar day that navigation cannot reach.
    /// Opening the app and silently doing nothing is the behaviour this
    /// prevents.
    @Test func theDayAfterTheSeasonEndsIsRefusedWithADialog() throws {
        let bounds = ViewWindow.navigableBounds(year: 2026, events: [], starredDays: [])
        let lastDay = try #require(ChqTime.parse("\(bounds.upperBound) 09:00:00"))
        let events = [makeEvent(id: "a", start: lastDay)]

        let target = OpenDayTarget.resolve(
            timeframe: .tomorrow, now: lastDay, year: 2026, events: events)

        guard case .refuse(let dialog) = target else {
            Issue.record("expected a refusal, got \(target)")
            return
        }
        #expect(!dialog.isEmpty)
    }

    /// Out of season entirely, the refusal should explain *that* rather than
    /// talk about a day — `IntentDialogText.offSeason` is the established
    /// vocabulary and must win over the generic line.
    @Test func offSeasonRefusalUsesTheOffSeasonDialog() throws {
        let now = try #require(ChqTime.parse("2026-02-01 09:00:00"))

        let target = OpenDayTarget.resolve(
            timeframe: .today, now: now, year: 2026, events: [])

        let expected = try #require(
            IntentDialogText.offSeason(SeasonStatus.make(now: now, year: 2026), year: 2026))
        #expect(target == .refuse(dialog: expected))
    }

    /// A day the reader starred outside the season widens
    /// `navigableBounds` — so reachability is a question about *this* user's
    /// data, not about the calendar. Pinned because a "clamp to the season"
    /// rewrite would pass every other test here.
    @Test func aDayReachableOnlyBecauseAnEventLivesThereIsAccepted() throws {
        let bounds = ViewWindow.navigableBounds(year: 2026, events: [], starredDays: [])
        let dayAfter = try #require(
            ChqTime.day(bounds.upperBound, offsetBy: 1))
        let asked = try #require(ChqTime.parse("\(bounds.upperBound) 09:00:00"))
        let events = [makeEvent(id: "a", start: try #require(ChqTime.parse("\(dayAfter) 10:00:00")))]

        let target = OpenDayTarget.resolve(
            timeframe: .tomorrow, now: asked, year: 2026, events: events)

        #expect(target == .navigate(dayKey: dayAfter))
    }

    @Test func aColdCacheIsRefusedWithTheColdCacheDialog() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))

        let target = OpenDayTarget.resolve(
            timeframe: .today, now: now, year: 2026, events: [])

        #expect(target == .refuse(dialog: IntentDialogText.coldCache())
                || target == .refuse(dialog: IntentDialogText.offSeason(
                    SeasonStatus.make(now: now, year: 2026), year: 2026) ?? ""))
    }
```

That last test is deliberately loose because the cold-cache and in-season paths
overlap; decide in Step 3 which one wins for an empty event list and then
**tighten the test to the single expected value**. A test asserting "one of two
things" is a test that has not decided what the code should do.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/OpenDayTargetTests
```

Expected: FAIL to compile — no `OpenDayTarget`.

- [ ] **Step 3: Implement `OpenDayTarget`**

Create `ios/ChqCalendarShared/Domain/OpenDayTarget.swift`:

```swift
import Foundation

/// `OpenDayIntent`'s decision, separated from the AppIntents runtime that
/// delivers it — the same split `IntentDataSource.selectMatching` uses, and for
/// the same reason: the rule is what can be wrong, and a rule in a `perform()`
/// body can only be tested by booting Shortcuts.
///
/// The reachability check lives here rather than in the app because an intent
/// that cannot navigate should *say so*. `AppModel.goToDay` already refuses an
/// out-of-bounds day, but it refuses silently — the user would watch the app
/// open and do nothing. Both sides ask
/// `ViewWindow.navigableBounds(year:events:starredDays: [])`, so the two
/// answers cannot drift.
nonisolated enum OpenDayTarget: Equatable, Sendable {
    case navigate(dayKey: String)
    case refuse(dialog: String)

    static func resolve(
        timeframe: IntentTimeframe?, now: Date, year: Int, events: [Event]
    ) -> OpenDayTarget {
        guard !events.isEmpty else { return .refuse(dialog: IntentDialogText.coldCache()) }

        let key = (timeframe ?? .today).targetDayKey(now: now, year: year)
        let bounds = ViewWindow.navigableBounds(year: year, events: events, starredDays: [])
        guard bounds.contains(key) else {
            let status = SeasonStatus.make(now: now, year: year)
            return .refuse(
                dialog: IntentDialogText.offSeason(status, year: year)
                    ?? IntentDialogText.unreachableDay(year: year))
        }
        return .navigate(dayKey: key)
    }
}
```

Now tighten the last test from Step 1: with this implementation an empty event
list is a **cold cache** refusal, so assert exactly
`.refuse(dialog: IntentDialogText.coldCache())` and delete the `||`. Re-check
`offSeasonRefusalUsesTheOffSeasonDialog` — it passes `events: []`, which now
hits the cold-cache branch first. Give it a fixture event inside the season so
it reaches the bounds check, or the test is asserting the wrong branch.

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Prove the bounds guard can fail**

Delete `guard bounds.contains(key) else { … }` (return `.navigate` unconditionally),
re-run, and confirm both `theDayAfterTheSeasonEndsIsRefusedWithADialog` and
`offSeasonRefusalUsesTheOffSeasonDialog` FAIL. Restore and re-run to green. This
is the whole point of extracting the type — do not skip it.

- [ ] **Step 6: Implement `OpenDayIntent`**

In `ios/ChqCalendar/Intents/EventIntents.swift`, after `OpenEventIntent`:

```swift
/// "Show a Day" — the Siri/Shortcuts equivalent of tapping a day chip on the
/// rail. Closes the inconsistency #226 recorded: `IntentTimeframe` has shipped
/// `tomorrow` and `nextWeek` as spoken targets since #193, so a user could
/// *ask* Siri for tomorrow but, until phase 3b's rail, could not *tap* their
/// way there. Routing this through the same `chqcal://day/<key>` link the rail
/// resolves means voice and touch land in identical state.
///
/// `openAppWhenRun` brings the app forward; `perform()` hands the day off via
/// `PendingIntentLink` rather than touching `AppModel` (see that type's doc
/// comment — an intent can run with the app not launched at all).
///
/// Every decision lives in `OpenDayTarget`; this is the delivery shell.
struct OpenDayIntent: AppIntent {
    static let title: LocalizedStringResource = "Show a Day"
    static let openAppWhenRun = true

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        let year = await IntentDataSource.defaultYear()

        switch OpenDayTarget.resolve(
            timeframe: timeframe, now: now, year: year, events: events) {
        case .refuse(let dialog):
            return .result(dialog: "\(dialog)")
        case .navigate(let dayKey):
            PendingIntentLink.write(.day(key: dayKey), to: AppGroup.userDefaults())
            return .result(dialog: "\((timeframe ?? .today).spokenLabel.capitalized).")
        }
    }
}
```

`openAppWhenRun` is static, so the app comes forward even on the refusal path —
that is why the refusal must speak. The success dialog uses `spokenLabel`, the
vocabulary the other seven intents already speak; if it reads awkwardly aloud,
change the line, not the structure.

- [ ] **Step 7: Register the shortcut**

In `ios/ChqCalendar/Intents/ChqShortcuts.swift`, add after the `OpenEventIntent`
entry:

```swift
        AppShortcut(
            intent: OpenDayIntent(),
            phrases: [
                "Show me a day in \(.applicationName)",
                "Show me a day at \(.applicationName)",
                "Show me \(\.$timeframe) in \(.applicationName)",
                "Show me \(\.$timeframe) at \(.applicationName)",
                "Open \(\.$timeframe) in \(.applicationName)",
                "Open \(\.$timeframe) at \(.applicationName)",
                "Take me to \(\.$timeframe) in \(.applicationName)",
                "Take me to \(\.$timeframe) at \(.applicationName)"
            ],
            shortTitle: "Show a Day",
            systemImageName: "calendar.day.timeline.left"
        )
```

The first two phrases carry **no parameter slot** — that is load-bearing, not
style. `ChqShortcutsTests` asserts `phrases[0]` contains no `$` for every
registered shortcut, because `SiriTipView` renders it with slots unresolved.

Update the type's doc comment at `:4`: "the seven shortcuts (listed in the
Shortcuts app gallery under CHQ Calendar by their `AppIntent.title`: …)" becomes
**eight**, with `"Show a Day"` added to the list.

- [ ] **Step 8: Add the About-sheet example phrase**

In `ios/ChqCalendar/Features/About/AboutInfo.swift`, append to `siriPhrases`:

```swift
        SiriPhrase(id: "show-day", phrase: "Show me tomorrow in Chautauqua?"),
```

- [ ] **Step 9: Run the whole suite**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

Expected: PASS, including `ChqShortcutsTests` — which now covers eight
shortcuts automatically and will fail loudly if `phrases[0]` carries a slot.

- [ ] **Step 10: Prove the phrase guard covers the new shortcut**

Swap the new shortcut's `phrases[0]` to `"Show me \(\.$timeframe) in \(.applicationName)"`,
re-run `-only-testing:ChqCalendarTests/ChqShortcutsTests`, and confirm it FAILS
naming `OpenDayIntent`. Restore the parameter-free phrase and re-run to green.

- [ ] **Step 11: Commit**

```bash
git add ios/ChqCalendarShared/Domain/OpenDayTarget.swift ios/ChqCalendarTests/OpenDayTargetTests.swift \
  ios/ChqCalendar/Intents/EventIntents.swift ios/ChqCalendar/Intents/ChqShortcuts.swift \
  ios/ChqCalendar/Features/About/AboutInfo.swift
git commit -m "feat(ios): add a Show a Day intent that opens the list on a spoken day"
```

---

### Task 6: The `Filters` pill accessibility fix (search-prompt finding did not reproduce)

Both were found by phase 3b's on-device `performAccessibilityAudit()` and both
are **pre-existing**, untouched by 3b's diff. The fix below is gated on
`dynamicTypeSize.isAccessibilitySize` so nothing at default text size moves a
pixel — which is what makes PR A's screenshot opt-out honest.

**Outcome:** Step 1's repro confirmed the `Filters` pill truncation, which
Step 2 fixed as written. It did **not** confirm the `Search events` placeholder
clip — across five configurations at maximum accessibility text size the
placeholder never clipped — so Step 3 below was not implemented. Steps 3–4 are
left in place as the repro/fix recipe to run again if the finding ever does
reproduce (a different device class, a longer locale string, a future prompt
change), but as of this phase `CalendarView` still uses the unconditional
`prompt: "Search events"` at both `.searchable` sites, and there is no
`searchPrompt` computed property or `dynamicTypeSize` read in that file.

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift:801-836` (`filterPillBar`)
- Modify: `ios/ChqCalendar/Features/Calendar/CalendarView.swift:147-150` and `:158-161` (both `.searchable` prompts)

**Interfaces:**
- Consumes: `@Environment(\.dynamicTypeSize)`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Reproduce both findings**

Boot a simulator, set the largest accessibility text size
(Settings › Accessibility › Display & Text Size › Larger Text, drag to maximum),
launch the app, and capture the Events tab:

```bash
xcrun simctl boot 'iPhone 17'
open -a Simulator
# set the text size by hand, then:
xcrun simctl io booted screenshot /tmp/claude-501/-Users-bernard-src-chq-chq-calendar/*/scratchpad/a11y-before.png
```

Confirm with your own eyes: the bottom `Filters` pill truncates to `…`. Check
whether the `Search events` placeholder clips too — the audit's contrast
findings on this same screen were mostly false (see the phase 3b write-up), so
verify both by human render rather than trusting the audit output. Do not
implement a fix for a finding you have not seen reproduce. (Recorded outcome:
the pill truncated on every configuration tried; the placeholder did not clip
on any of five — see this task's Outcome note above.)

- [ ] **Step 2: Fix the pill bar**

In `EventListView.swift`, add the environment read beside the view's other
`@Environment` properties:

```swift
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
```

Give the `Filters` label the same `fixedSize` the date label already has
(`:815`), and let the row scroll when the two pills no longer fit:

```swift
                    Text(filterCount > 0 ? "Filters (\(filterCount))" : "Filters")
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
```

and wrap the bar's `HStack` so it can scroll at accessibility sizes only:

```swift
    /// At accessibility text sizes the two pills no longer fit side by side —
    /// the date pill is `fixedSize` (abbreviating the date is worse than
    /// scrolling for it), so `Filters` was the one that truncated to `…`.
    /// Scrolling the row keeps both labels whole. Gated on
    /// `isAccessibilitySize` so the default layout — where both fit with room
    /// to spare — keeps its `Spacer` and stays pixel-identical.
    private var filterPillBar: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                ScrollView(.horizontal, showsIndicators: false) {
                    pillRow
                }
            } else {
                pillRow
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private var pillRow: some View {
        HStack(spacing: 10) {
            // ... the two existing pillButton calls, unchanged ...
            Spacer(minLength: 0)
        }
    }
```

Move the two `.padding` modifiers to the outer `Group` as shown — leaving them
on the inner `HStack` would inset the scroll content instead of the bar.

- [ ] **Step 3: Fix the search prompt (not run — see Outcome note above; the
  finding did not reproduce, so this step was skipped and `CalendarView` is
  unchanged)**

In `CalendarView.swift`, add:

```swift
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
```

and a computed prompt used by **both** `.searchable` call sites (`:150` and `:161`):

```swift
    /// "Search events" clips inside the system search field at accessibility
    /// text sizes; "Search" does not. Shortening only there keeps the more
    /// informative placeholder for the sizes that can render it.
    private var searchPrompt: String {
        dynamicTypeSize.isAccessibilitySize ? "Search" : "Search events"
    }
```

Replace `prompt: "Search events"` with `prompt: searchPrompt` at both sites.
Both, not one — they are the compact and regular size-class containers, and
fixing one leaves the iPad clipped.

- [ ] **Step 4: Verify on device**

Relaunch at the largest accessibility size and capture again:

```bash
xcrun simctl io booted screenshot /tmp/claude-501/-Users-bernard-src-chq-chq-calendar/*/scratchpad/a11y-after.png
```

Confirm the `Filters` label reads in full (scrolling the row if needed). The
placeholder step is moot — Step 3 was not run — but confirm it still reads
"Search events" unclipped in whatever configuration you test, since that
remains the unconditional prompt. Then set the text size back to **default**
and confirm the bar looks exactly as it did before this task — the `Spacer`
still pushes the pills left, no scroll indicator.

- [ ] **Step 5: Run the whole suite**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

Expected: PASS. (Since Step 3 was not run, there is no `searchPrompt` and no
UI test needs updating for it — this note applies only if a future pass
implements Step 3.)

- [ ] **Step 6: Commit**

Only `EventListView.swift` changed — `CalendarView.swift` is untouched because
Step 3 did not run:

```bash
git add ios/ChqCalendar/Features/Calendar/EventListView.swift
git commit -m "fix(ios): keep the Filters pill whole at accessibility text sizes"
```

- [ ] **Step 7: Open PR A**

```bash
git push -u origin feat/date-nav-phase-4-siri-routing
gh pr create --title "feat(ios): Siri routes through the day rail (phase 4, part 1)" --body "$(cat <<'BODY'
Phase 4, part 1 of the cross-platform date-navigation initiative
(docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md:631).

A new `chqcal://day/<yyyy-MM-dd>` deep link and an `OpenDayIntent` route Siri
through the same `AppModel.goToDay` a rail chip tap uses, closing the
inconsistency #226 recorded: you could *ask* Siri for tomorrow but not *tap*
your way there. The link is consumed by `EventListView.selectDay` — literally
the function a chip tap calls — so voice and touch land in identical state:
same window expansion, same pinned selection, same queued scroll.

Also fixes one of the two clipped-text findings from phase 3b's on-device
accessibility audit: the `Filters` pill truncating to `…` at the largest
accessibility text size. It is pre-existing and the fix is gated on
`dynamicTypeSize.isAccessibilitySize`, so nothing at default text size
changes. The audit's other finding — the `Search events` placeholder clipping
— did not reproduce across five configurations during this phase's repro
pass, so no fix was written; `CalendarView` still uses the unconditional
`prompt: "Search events"`.

[skip-screenshots: every visible change is gated on accessibility text sizes or
lives on the About sheet, neither of which any shot in ios/Scripts/screenshot-plan.json
covers; phase 4 part 2 regenerates for the 1.1.3 submission]
BODY
)"
```

- [ ] **Step 8: Iterate the PR to green**

Follow the project's PR-iteration rule in `CLAUDE.md`: address every review
comment, request fresh Copilot/Claude reviews, and repeat until reviewers are
empty, threads are resolved, checks pass and `mergeable_state` is `clean`.
**Read Copilot's `Suppressed comments` block and its inline comments, not just
the review summary** — it has reported "no new comments" while carrying real
findings four passes running on this initiative, and inline comments are a
separate surface from the summary. Do not merge; hand it to the user.

---

# PR B — release prep

Branch off `main` **after PR A merges**:

```bash
git checkout main && git pull && git checkout -b chore/ios-1.1.3-release-prep
```

### Task 7: The 1.1.3 version sweep

1.1.2 (build 5) is live in the App Store, so the next submission is a new
version and a new build. The 1.1.2 bump was incomplete — it left the test bundle
behind — and the UI-test target added in phase 3b has no version settings at all.
This task closes both.

**Files:**
- Modify: `ios/ChqCalendar.xcodeproj/project.pbxproj`
- Modify: any doc naming the current version (find them in Step 1)

**Interfaces:**
- Consumes: nothing.
- Produces: `MARKETING_VERSION = 1.1.3` everywhere; `CURRENT_PROJECT_VERSION = 6`
  for the app and widget targets. Task 9's listing copy quotes `1.1.3`.

- [ ] **Step 1: Inventory every version reference**

```bash
grep -rn "MARKETING_VERSION\|CURRENT_PROJECT_VERSION" ios/ChqCalendar.xcodeproj/project.pbxproj
grep -rn "1\.1\.2" docs/ ios/ --include='*.md' --include='*.json' | grep -v node_modules
```

Expected inventory in `project.pbxproj` before the change:

| Config | Bundle id | `MARKETING_VERSION` | `CURRENT_PROJECT_VERSION` |
|---|---|---|---|
| `:432`/`:450` Debug | `org.chqcal.app` | 1.1.2 | 5 |
| `:466`/`:484` Release | `org.chqcal.app` | 1.1.2 | 5 |
| `:498`/`:501` Debug | `org.chqcal.calendarTests` | 1.1.2 | 1 |
| `:516`/`:519` Release | `org.chqcal.calendarTests` | 1.1.2 | 1 |
| `:591`/`:602` Debug | `org.chqcal.app.widgets` | 1.1.2 | 5 |
| `:618`/`:629` Release | `org.chqcal.app.widgets` | 1.1.2 | 5 |
| `:409-416` Debug, `:640-647` Release | `org.chqcal.calendarUITests` | **absent** | **absent** |

Line numbers shift as you edit — re-grep rather than trusting them twice.

- [ ] **Step 2: Bump the six existing configs**

```bash
cd ios
sed -i '' 's/MARKETING_VERSION = 1\.1\.2;/MARKETING_VERSION = 1.1.3;/g' ChqCalendar.xcodeproj/project.pbxproj
grep -c "MARKETING_VERSION = 1.1.3;" ChqCalendar.xcodeproj/project.pbxproj
```

Expected: `6`.

Then bump the build number for the **app and widget targets only** — 5 is the
build that shipped, and a new upload needs a higher one. Edit by hand rather
than with `sed`: the two test-bundle configs also read `CURRENT_PROJECT_VERSION = 1`
and must not be touched, and a global substitution of `= 5;` would hit unrelated
settings. Change the four occurrences at `:432`, `:466`, `:591`, `:618` from
`5` to `6`.

```bash
grep -n "CURRENT_PROJECT_VERSION" ChqCalendar.xcodeproj/project.pbxproj
```

Expected after: four `= 6;` (app Debug/Release, widgets Debug/Release) and two
`= 1;` (test bundle Debug/Release).

- [ ] **Step 3: Give the UI-test target version settings**

Add both keys to the `org.chqcal.calendarUITests` Debug and Release
`buildSettings` blocks, alphabetically placed among the existing keys:

```
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 1.1.3;
```

This is the point of the task as much as the bump is: the 1.1.2 sweep missed the
unit-test bundle because nothing enumerated the targets, and 3b then added a
target with no version at all. After this, every target in the project carries
both keys and the next sweep is a grep.

- [ ] **Step 4: Verify the project still builds and all targets report 1.1.3**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5

xcodebuild -project ChqCalendar.xcodeproj -showBuildSettings -target ChqCalendar \
  | grep -E "MARKETING_VERSION|CURRENT_PROJECT_VERSION"
```

Expected: build succeeds; settings report `MARKETING_VERSION = 1.1.3` and
`CURRENT_PROJECT_VERSION = 6`.

- [ ] **Step 5: Run the whole suite**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

Expected: PASS. `AboutInfo.versionString` reads the bundle at runtime, so any
test asserting a literal version string would fail here — there should be none
(the tests pass explicit values), but confirm.

- [ ] **Step 6: Update the doc references found in Step 1**

Every `1.1.2` in `docs/` that names *the version being prepared* becomes
`1.1.3`. Leave historical statements alone — `RELEASE_CHECKLIST.md:265-274`
records what was folded into 1.1.2 and is a log entry, not a claim about the
current version. Task 9 adds the 1.1.3 entry beneath it.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar.xcodeproj/project.pbxproj docs/
git commit -m "chore(ios): sweep every target to 1.1.3 (build 6)"
```

---

### Task 8: `01-season` becomes the day-navigation shot

`ios/Scripts/screenshot-plan.json` is at **10 shots, which is App Store
Connect's per-device maximum** — a new shot must displace one. `01-season`
already frames the Events list with the rail on it, so it is reworked rather
than replaced. It also currently captures **live production data with no clock
pin**, the same fragility that silently produced a blank `03-search`; freezing
its clock is a fix in its own right.

**Files:**
- Modify: `ios/Scripts/screenshot-plan.json` (the `01-season` entry)
- Modify: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/` (regenerated)

**Interfaces:**
- Consumes: `-uitest-go-to-day <key>` and `-uitest-freeze-now <ts>` (Task 3 and
  `AppModel.swift:1539`).
- Produces: the regenerated manifest that satisfies `app-store-assets.yml`.

- [ ] **Step 1: Rework the shot definition**

In `ios/Scripts/screenshot-plan.json`, replace the `01-season` entry with:

```json
    {
      "id": "01-season",
      "caption": "Jump to any day in the season.",
      "launchArgs": [
        "-uitest-freeze-now", "2026-07-27 09:00:00",
        "-uitest-go-to-day", "2026-07-30"
      ],
      "settleSeconds": 12,
      "deviceLaunchArgs": { "ipad-13": ["-uitest-select-event-index", "1"] }
    }
```

Keep the **id** `01-season` — the manifest and the `review/` copies are keyed by
it, and renaming would orphan files for no gain.

Three deliberate choices: the clock is pinned so the shot is reproducible
(2026-07-27 is a Monday in week 5, mid-season); the landed day is three days
out so the rail shows `⟳ Now`, both chevrons and a selected future chip rather
than sitting at an edge; and `settleSeconds` rises from 6 to 12 to match
`03-search` — the launch now performs a deep-link resolution and a scroll
against live production data, and a fixed 6s settle is exactly what produced a
blank capture before.

- [ ] **Step 2: Capture**

```bash
ios/Scripts/capture-screenshots.sh
```

Do not boot five simulators at once — `simctl bootstatus -b` can hang
indefinitely under that load. If the script stalls, shut down all simulators
(`xcrun simctl shutdown all`) and re-run.

- [ ] **Step 3: Look at the capture with your own eyes**

```bash
open ios/Scripts/out/iphone-6.9/01-season.png
```

Confirm: real events are listed (not a blank or spinner), the day rail is
visible, and Thursday July 30 is the selected chip. **A green script exit is not
evidence the shot is right** — the 3b pass found the pipeline producing a blank
`03-search` while exiting 0. If the capture is wrong, raise `settleSeconds`
before changing anything else.

- [ ] **Step 4: Compose and check**

```bash
python3 ios/Scripts/compose-screenshots.py
python3 ios/Scripts/check-screenshots.py
```

Then open the composed `01-season` for both devices and confirm the caption
renders in full and does not collide with the rail.

- [ ] **Step 5: Commit the regenerated assets**

```bash
git add ios/Scripts/screenshot-plan.json docs/app-store/screenshots.manifest.json \
  docs/app-store/screenshots/review/
git commit -m "chore(app-store): make the lead screenshot show day navigation"
```

Confirm `docs/app-store/screenshots.manifest.json` is actually in the diff —
`app-store-assets.yml` checks that this file changed since the merge-base, and
a compose run that changed nothing means the capture did not land.

---

### Task 9: Listing copy and the spec amendment

**Files:**
- Modify: `docs/app-store/listing-fields.json` (`whatsNew`, `promotionalText`)
- Modify: `docs/app-store/listing-copy.md`
- Modify: `docs/app-store/RELEASE_CHECKLIST.md`
- Modify: `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`

**Interfaces:**
- Consumes: the shipped behaviour of PR A and Tasks 7–8.
- Produces: submission-ready copy for 1.1.3.

- [ ] **Step 1: Re-read the current copy against what shipped**

```bash
python3 -c "import json; d=json.load(open('docs/app-store/listing-fields.json')); print(d['description'])"
python3 ios/Scripts/render-listing-copy.py 2>/dev/null || cat docs/app-store/listing-copy.md
```

List every claim the date-navigation work invalidated or that is now
understated — in particular anything describing how a reader moves through the
season, and the `whatsNew` block still describing 1.1.2. Note them before
writing; the failure mode this step exists for is a description promising a
feature that changed shape.

- [ ] **Step 2: Write the 1.1.3 `whatsNew`**

Replace the `whatsNew` value in `docs/app-store/listing-fields.json`. Lead with
the rail — it is the release. Keep the house style visible in the 1.1.2 entry:
a one-line opener, then ALL-CAPS section headings with `•` bullets.

```
Version 1.1.3 is about moving through the season.

A DAY AT A TIME
• A day rail sits above the events list — tap any day to jump straight to it
• Step a day at a time with the chevrons, or tap ⟳ Now to come back to today
• The list grows as you reach its edges instead of stopping at the end
• Each day names how many events it holds, so an empty day is visible before you tap it

ASK FOR A DAY
• "Show me tomorrow in Chautauqua" now opens the app on tomorrow
• Siri and the day rail land in exactly the same place

ACCESSIBILITY
• The Filters button no longer clips its label at the largest text sizes
```

Do not claim anything you have not seen running. If the on-device pass in
Step 5 contradicts a bullet, change the bullet.

- [ ] **Step 3: Refresh `promotionalText`**

`promotionalText` is the **one field changeable without a review cycle**, which
is what it is for. Replace the 1.1.2 text with something short and true of
1.1.3, e.g.:

```
New in 1.1.3: a day rail above the events list — tap any day to jump straight to it, or ask Siri to show you tomorrow.
```

- [ ] **Step 4: Mirror the changes into `listing-copy.md` and the checklist**

`docs/app-store/listing-copy.md` carries the same copy in prose form — update it
so the two do not drift. In `docs/app-store/RELEASE_CHECKLIST.md`, add a 1.1.3
entry beneath the 1.1.2 log recording what this version contains and noting that
**further features may land before submission** — this copy is a first pass, not
the final submission artifact.

- [ ] **Step 5: On-device pass before calling the copy done**

Launch the app on a simulator and walk every bullet you wrote:

```bash
xcrun simctl boot 'iPhone 17' && open -a Simulator
```

- Tap a distant day chip → the list lands there.
- Tap `⟳ Now` → back to today.
- Reach the end of the list → it grows.
- Run "Show me tomorrow in Chautauqua" from the Shortcuts app → the app opens on
  tomorrow. (Siri proper needs a device; the Shortcuts app runs the same intent.)
- Set the largest accessibility text size → `Filters` reads in full (the search
  placeholder was never fixed — Task 6 found it did not reproduce — so nothing
  to check there).

Anything that does not behave as written is a bug or a wrong bullet — decide
which, and fix that one, before continuing.

- [ ] **Step 6: Amend the spec's phase-4 section**

In `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`:

- Update the **Status** banner (`:3-17`) to record phase 4 as complete and name
  what shipped.
- Correct the stale claim at `:678-684` that "the app and widget targets are at
  `1.1.3`" — they were at 1.1.2 until Task 7, and the test bundle was too.
  Replace it with what is now true: every target, including both test bundles,
  is at 1.1.3, app and widgets at build 6.
- In the Siri section (`:481-489`), record that routing landed as
  `OpenDayIntent` + `chqcal://day/<key>` consumed by `EventListView.selectDay`,
  and that the reachability refusal lives in the intent so it can be *spoken*.
- Record the constraint that shaped Task 8: the shot list is at App Store
  Connect's 10-shot maximum, so a new shot displaces an existing one.
- Record that the `this-week` off-season divergence is **deliberately left
  standing** (documented in `ViewWindow.swift`): null on web, a rolling 7-day
  window on iOS.

- [ ] **Step 7: Commit and open PR B**

```bash
git add docs/
git commit -m "docs(app-store): 1.1.3 listing copy and the phase 4 spec amendment"
git push -u origin chore/ios-1.1.3-release-prep
gh pr create --title "chore(ios): 1.1.3 release prep (phase 4, part 2)" --body "$(cat <<'BODY'
Phase 4, part 2: the release side of the cross-platform date-navigation
initiative.

- Every target swept to 1.1.3; app and widgets to build 6 (build 5 is the one
  live in the store). The unit-test bundle was still on 1.1.2 — the same
  incompleteness as the 1.1.2 bump — and the UI-test target added in phase 3b
  had no version settings at all. Both fixed, so the next sweep is a grep.
- The lead screenshot now shows day navigation rather than a static list, and
  its clock is pinned: it was the last shot capturing live production data with
  no `-uitest-freeze-now`, the same fragility that once produced a blank
  `03-search`. The shot list is at App Store Connect's 10-shot maximum, so this
  is a rework rather than an eleventh shot.
- 1.1.3 `whatsNew` and `promotionalText`, verified bullet by bullet against a
  running app.

The listing copy is a first pass — further features are expected before
submission.
BODY
)"
```

- [ ] **Step 8: Iterate PR B to green**

Same rule as PR A. Do not merge; hand it to the user.

---

## After both PRs merge

Not part of this plan, listed so nothing is dropped:

- **The user archives and uploads 1.1.3 (build 6)** and submits for review.
  `docs/app-store/RELEASE_CHECKLIST.md` carries the procedure and the App Store
  Connect icon troubleshooting.
- **Siri on a real device.** `SiriTipView` phrase rendering and spoken
  invocation cannot be verified in the simulator; the #193 checklist applies to
  the new "Show a Day" action too.
- **The `this-week` off-season divergence** stays documented in
  `ViewWindow.swift`, by decision.
- **The remaining 3b accessibility debt** — the 21 "Dynamic Type font sizes are
  partially unsupported" warnings — is untouched here. The contrast findings
  from that audit were mostly false (see the phase 3b write-up before acting on
  any of them).
