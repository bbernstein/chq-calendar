# Open-issue triage — 2026-08-10

**Status:** Reference. A point-in-time audit of every open issue against
`main` at `fa25266`, checking which were quietly resolved by later work.

Scope: layout bugs, display bugs, and correctness/hygiene items. Feature
requests were deliberately excluded from the assessment (listed at the
bottom for completeness only).

## Moot — close

### #154 — iOS: filter bar never collapses for narrow-filtered lists

**Obsolete.** The mechanism the issue describes no longer exists. PR #159
(`7a530dd`, "scroll-first chrome — bottom-bar filters") replaced the
collapsing top filter bar with a fixed bottom-edge pill bar, deleting both
files the state machine lived in:

- `ios/ChqCalendar/Domain/FilterBarCollapse.swift`
- `ios/ChqCalendarTests/FilterBarCollapseTests.swift`

Both were added by PR #151 (`189235a`) and deleted by `7a530dd`; those are
the only two commits in the repo's history that touch a `FilterBarCollapse*`
path, and `git grep FilterBarCollapse origin/main` returns nothing. With no
bar that collapses there is no give-back gate and no ~190pt overflow floor.

The issue also names a `FilterBarCollapseDriver.swift`, hedged at the time
as "or wherever the give-back measurement now lives". No file by that name
ever existed — the measurement lived in the deleted state machine.

Its companion, #153 ("which filter-bar rows are pinned vs. collapsible"),
was already closed on 2026-08-04 as part of the same redesign. #154 was
missed.

### #197 item 1 — `browseDay` guards parseability, not canonicality

**Fixed before merge**, on PR #196 itself. `browseDay` now normalizes
through `ChqTime.dayKey(for: parsed)` (`AppModel.swift:1023`) rather than
storing the input verbatim, so a non-canonical-but-parseable key such as
`"2026-8-9"` can no longer produce an empty list under a pill naming a
real day. Items 2–7 of #197 remain live, so the issue stays open.

## Still live — verified against current `main`

| # | Title | Evidence |
|---|---|---|
| 189 | CI screenshot guard misses `ChqCalendarShared/` | `.github/workflows/app-store-assets.yml:52-53` still matches only `ios/ChqCalendar/(Features\|App)/`, `Assets.xcassets`, `ChqCalendarWidgets/`. **Wider than when filed:** `DisplayNames`, `DateFilterLabel`, and `MyDayChipContent` — all user-visible text — have since landed in `ChqCalendarShared/`. |
| 188 | Grounds-map venue sheet's smallest detent covers the tab bar | `GroundsMapView.swift:60` — `.presentationDetents([.height(220), .medium])`, unchanged. |
| 187 | Reminder/Spotlight sync re-decodes every cached year per trigger | `AppModel.swift:924` still loops `repository.cachedSnapshot(year:)` with no memoization. **Hotter than when filed:** two callers now (`reminderSync` :805, `runSpotlightReindex` :894). |
| 174 | DisplayNames shortcuts for the longest venue names | `DisplayNames.swift:7-10` still holds exactly the two entries the issue quotes. Content decision; nothing blocks it. |
| 156 | `extraDays` not reset when date scope changes | `selectScope` (`AppModel.swift:981-986`) clears `selectedWeeks` but not `extraDays`; `showNextDay` still wired at `EventListView.swift:182`. **Now internally inconsistent:** `browseDay`, added later by #192, *does* clear `extraDays` and documents why. |
| 146 | Move Actions off deprecated Node 20 | No progress: `actions/checkout@v4` (×8), `setup-node@v4` (×5), `upload-artifact@v4` (×2), `configure-aws-credentials@v4` (×1). |
| 143 | Matcher fuzzy name matching | No edit-distance code anywhere in `backend/`; `articleMatcher.ts:163-164` still sources the surname from `event.presenter` only, no title fallback. Later matcher work (#139/#141, MATCHER_VERSION 5) left it alone by design. |
| 197 | My Day date-model follow-ups | 6 of 7 items live — see below. |

### #197 item-by-item

| Item | Status | Evidence |
|---|---|---|
| 1. `browseDay` canonicality | **Fixed** | `AppModel.swift:1023` normalizes. |
| 2. `myDayBounds` derived twice per render | Live | `MyDayView.swift:129` — `planContent(for:)` takes only the day and calls `model.myDayWindow(...)`, which re-derives bounds. |
| 3. `selectedDayKey` survives a scope change | Live | Neither `selectScope` (:981) nor `setWeekSelection` (:994) clears it. |
| 4. Two plural test names pin one case each | Live | `UserStateStoreTests.swift:394` (`.season` only), `EventFilterTests.swift:366` (`.today` only). |
| 5. `DateFilterLabel` special-cases `.day` inside the weeks guard | Live | `DateFilterLabel.swift:49-59`. |
| 6. `MyDayChipContent.make` returns `nil` silently | Live | `MyDayChipContent.swift:46`. |
| 7. `ChqTime.parse` accepts a two-digit year | Live | Same non-lenient-but-permissive `DateFormatter`. |

## Groupings worth acting on

- **#156 + #197 item 3** are the same defect in the same two methods
  (`selectScope` / `setWeekSelection` leaving stale date state behind).
  One small PR closes #156 and a third of #197.
- **#189** is the highest-leverage of the set: it is the only one that
  can let a real regression reach the App Store silently, and its blast
  radius grew when `ChqCalendarShared/` picked up display logic.

## Excluded as feature requests

#200 (shared favorite lists), #198 (Home Base), #194 (Apple Watch),
#186 (year-aware `browsePastSeason` — confirmed unimplemented; the gap is
documented in a comment at `AppModel.swift:947`), #132 (accounts/login).

---

# Re-triage — 2026-08-10, after #203

**Status:** Active. Re-run of the audit above against `main` at `f87b959`,
restricted to bugs and problems. Features are deliberately out of scope
until the apps are in good shape; a separate feature scan comes later.

PR #203 closed #156, #189 and #154, and #197 closed with every item
addressed. That leaves **four** genuine defects among the twelve open
issues — the other eight are feature requests (#200, #198, #194, #186,
#174, #143, #132, plus #204, which its own body labels a decision rather
than a bug).

## The four, re-verified against `f87b959`

| # | Verified how | State |
|---|---|---|
| 205 | `grep -l xcodebuild .github/workflows/*.yml` → nothing, across all 7 workflows | Live |
| 187 | `AppModel.swift:944` loops `repository.cachedSnapshot(year:)`, no memoization | Live, **worse than filed** |
| 188 | `GroundsMapView.swift:60` — `.presentationDetents([.height(220), .medium])` | Live |
| 146 | `checkout@v4` ×8, `setup-node@v4` ×5, `upload-artifact@v4` ×2, `configure-aws-credentials@v4` ×1 | Live |

**#187 is hotter than either the issue or the first triage records.**
`toggleFavorite` (`AppModel.swift:625`) fires `enqueueReminderSync()` *and*
`enqueueSpotlightReindex()`, and each independently calls
`allCachedYearEvents()`. So a single star tap costs **2 × N** full JSON
decodes, not one. The issue says "per trigger"; there are two triggers per
tap.

## Sequencing

1. **#205 + #146 together** — both touch only `.github/workflows/`, so one
   `chore(ci)` PR. #205 first because it is the meta-defect: until it
   lands, every iOS fix below is unverifiable by machine, and "CI is
   green" is not evidence for a Swift change on this repo.
2. **#187 + #188** — one iOS bugfix PR. Landing #205 first makes these the
   first Swift changes actually verified by CI, which doubles as proof the
   new job works on a real change.

## #205's blocker, resolved

The issue named toolchain availability as the open question that "decides
most of it" and explicitly did not propose a design. Settled by checking
the runner image manifest: `macos-15` ships Xcode **26.3, 26.2, 26.1.1,
26.0.1** and iOS simulator runtimes **18.5, 18.6, 26.0, 26.1, 26.2** —
above both the Xcode 26 floor (synchronized folder groups) and the iOS
18.0 deployment target. The repo is public, so macOS runner minutes are
free. Xcode 26 is *not* the image default (a 16.x is), which is why the
job resolves the newest 26+ at runtime instead of pinning.

## Left to the user

**#204** — whether to trim `NextEventsIntent`'s 27 phrase templates. They
generate ~300 of the ~370 Shortcuts Library rows and appear to crowd
`OpenEventIntent`, `WhoIsSpeakingIntent` and `ShowTimeIntent` out of the
Library entirely (all three still route correctly by voice). Trading voice
coverage against browse discoverability is a product call, and it is
time-boxed to the 1.2 submission because App Shortcuts ship with the
build.
