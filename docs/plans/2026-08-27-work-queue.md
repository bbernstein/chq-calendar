# Work queue — chq-calendar

**Status:** Living document. This is the queue a new session should read
first. Opened 2026-08-27 from the triage pass in
`2026-08-27-open-issue-triage.md` (which is the point-in-time *record*; this
is the *plan*).

---

## How to use this file

**Starting a session and asked to "continue":**

1. Read **Status at a glance** below. Anything marked `IN PROGRESS` is where
   you are — check out its branch and read its PR.
2. If nothing is in progress, take the topmost `NOT STARTED` item whose
   entry criteria are met.
3. Check **The dated calendar** — items there stop being optional on a date.
4. Re-verify before trusting: this file records what was true on
   2026-08-27. Line numbers drift, and several issue bodies in this repo
   have been wrong about their own premises. Confirm at the named symbol
   before building on it.

**Finishing an item:** update its `Status` line to `DONE (<squash sha>)`,
move it to the bottom section, and update the glance table. Do not delete
it — the reasoning is worth keeping.

**Standing rules** (from `CLAUDE.md`, repeated because they bite here):
never commit to `main`; run the verification checklist before every commit;
any PR touching `ios/ChqCalendar/Features/**`, `App/**`, `Assets.xcassets/**`,
`ChqCalendarWidgets/**` or `ChqCalendarShared/**` in a user-visible way must
regenerate App Store screenshots or record a `[skip-screenshots: <reason>]`
opt-out.

---

## Status at a glance

| # | Item | Issues | Status | Branch / PR |
|---|---|---|---|---|
| 0 | Triage record + this queue | — | DONE (`9399318`, `7ee9b72`) | PR #289, #291 |
| 1 | e2e off-season crash + 200%-zoom flake | #287, #290 | DONE (`8bee59b`) | PR #292 |
| 2 | **iOS 1.1.4** — year-aware navigation | #186, #288, #253 | **NEXT** — #288 MERGED (`01fa4e3`); #186 + #253 remain | PR #295 |
| 3 | Fresh-clone empty calendar | #286 | NOT STARTED | — |
| 4 | CI for the Docker dev stack | #215 | NOT STARTED | — |
| 5 | Dev-env docs + deploy scripts | #216, #217 | NOT STARTED | — |
| 6 | Date-filtering divergence | #285 | NEEDS A DECISION | — |
| 7 | My Day ↔ Events round trip | #237 | NOT STARTED | — |
| 8 | Feed parse cost | #283 | NOT STARTED | — |
| 9 | Venue name shortcuts | #174 | BLOCKED — content decision | — |
| 10 | Matcher fuzzy matching | #143 | NOT STARTED | — |
| 11 | Middle-click autoscroll | #275 | NOT STARTED | — |
| 12 | Off-season features | #198, #194, #132, #200 | NOT STARTED | — |
| — | Special Studies classes page | #246 | **OWNER-HANDLED — do not action** | fork `Woodwell:feat/classes-catalog` |

---

## The dated calendar

| Date | What happens | Item |
|---|---|---|
| **2026-09-10** | Last event in the 2026 feed | — |
| ~~**2026-09-11**~~ | ~~`browser-checks` starts aborting on every branch push~~ — closed by `8bee59b` | ~~**1**~~ |
| **~mid-Sept** | 1.1.4 must be submitted to clear review in time | **2** |
| **2026-10-01** | Server flips `defaultYear` to 2027. The landing no longer misreads this as pre-season (#288, done) — but the reader still lands on `noMatchesView`, and #186 owns giving pre-season an action | **2** |
| **~2027-03-29** | 2027-06-27 enters `.next`'s 90-day window; the iOS pre-season state self-heals | **2** |
| **June 2027** | Next season's Daily articles begin | **10** |

Nothing else in the queue has a deadline.

---

## 2. iOS 1.1.4 — year-aware navigation (#186 + #288 + #253)

**Status:** NOT STARTED · **Submit by ~mid-Sept, live before 2026-10-01** ·
**Size:** M

1.1.3 (build 6) is **live**, so this needs a new build. These three issues are
one job: each needs *a navigation that changes the year it navigates in*. Built
once, all three close; built separately, it gets built twice.

**Why the date matters.** From 2026-10-01 `defaultYear` is 2027, whose five
published events are ~265 days out — beyond `.next`'s 90-day cap
(`EventFilter.adaptiveEndDate:203-206`, `maxOffset = 90`). So
`upcomingDefaultCount == 0`, `now < seasonStart(2027)`, and
`LandingState.determine` returns `.preSeason`, whose `archiveYear` is `nil`
(`LandingState.swift:56-61`) and whose preview button is `.postSeason`-only
(`OffSeasonLandingView.swift:120`). Result: a countdown with **no buttons**,
until ~2027-03-29. Six months.

**Sub-items, in build order**

- **#288 option 1 — DONE, MERGED `01fa4e3` (PR #295).**
  `AppModel.landingState` now asks the snapshot's whole event set ("any
  event at or after `now - 1h`") instead of counting
  `filteredEvents(FilterSelection())`, and `LandingState.determine` takes
  `yearHasUpcomingEvents`/`yearHasEvents` rather than a count. Web's rules 3
  (no events at all is not "season over") and 4 (no countdown to a season
  that has already opened) came with it — both became *reachable* the moment
  the probe stopped being `.next`-bound, because a non-current year degrades
  `.next` to `.all` and the old count was therefore never 0 for an archived
  year. New fixtures `events-2027-sparse.json` (production's real 2027 feed)
  and `years-2027-default.json` close the "every 2027 test payload is July
  2026" gap the traps below name.

  **What it does not fix:** on 2026-10-05 the reader now gets
  `noMatchesView` — "No matching events" with a working "Show All Events"
  button — rather than a dead-end countdown. That is strictly better (there
  is a way forward, and the day rail is mounted independently of the
  landing), but the *wording* is still wrong for a season 265 days out.
  Whether `.next`'s 90-day cap should apply at all in that state is **#285**,
  and giving pre-season a real action is **#186**.
- **#186 — `browsePastSeason(year:)`.** Mirror
  `AppModel.previewNextSeason():1098-1104` (`await select(year:)` then set the
  filter). Then let `LandingState.archiveYear` return a year for `.preSeason`
  and un-hide the button in `OffSeasonLandingView.swift:126-131`. The doc
  comment at `LandingState.swift:50-56` explains precisely why it is hidden
  today — a label/outcome mismatch a reviewer flagged as Important.
- **#253 — Siri on an archived year.** `OpenDayIntent` resolves the year from
  `IntentDataSource.defaultYear()` (`EventIntents.swift:96`) while
  `AppModel.goToDay` bounds against `selectedYear` (`AppModel.swift:1467-1477`).
  Note `IntentDataSource.events(now:)` also loads the *default* year's events,
  so both inputs to `OpenDayTarget.resolve` describe the wrong season. Option 2
  ("refuse and say so") is **not** cheaper — the intent cannot read the app's
  live `selectedYear` without the app publishing it to the shared container,
  which is most of option 1's plumbing.

**Release gates**

- **Screenshots: the opt-out is free, but "regenerate and confirm no
  change" is NOT reachable until #294 is fixed.** All ten shots in
  `ios/Scripts/screenshot-plan.json` are in-season screens (`01-season`
  through `10-widget`); none covers the off-season or pre-season landing,
  so no covered shot can move. But #295 measured what regenerating
  actually does: **15 of 20 files change on a commit that moves no
  pixel.** Nine iPad shots change because `capture-screenshots.sh:308`
  passes `--time "9:41"`, which is not an ISO string, so `simctl` never
  pins the *date* — the iPad status bar (unlike the iPhone's) shows it,
  and every shot carries the real capture day. Five iPhone shots change
  from unpinned live-feed drift. Until #294 lands, record
  `[skip-screenshots: <reason>]` and do not commit the churn.
- **`whatsNew` must be rewritten.** `docs/app-store/listing-fields.json:8`
  still describes 1.1.3's chrome consolidation. Promotional Text is the only
  field changeable without a review cycle.
- Bump `MARKETING_VERSION` to 1.1.4. Note the app and widget targets carry
  `CURRENT_PROJECT_VERSION`; the two test bundles sit at 1 and do not ship.

**Traps**

- **No iOS UI test covers the off-season landing at all.** The XCUITest
  fixture serves `{"years":[2026],"defaultYear":2026}`
  (`UITestFixtureAPI.swift:83`), so no next-year path is reachable from a UI
  test. `docs/superpowers/specs/2026-08-24-off-season-landing-269-design.md`
  §A3 also says the rail-over-landing path "has never been exercised". If the
  rail is going to be the answer to "pre-season has no buttons", prove it.
- `LandingStateTests.swift:60` asserts an unreachable combination
  (`upcomingDefaultCount: 0` for `selectedYear 2027 / defaultYear 2026`; the
  real app resolves that to `.inSeason` via `EffectiveScope.resolve`). Every
  2027 test payload is `events-sample.json`, whose six events are all in July
  **2026** — so the sparse-2027 path is untested in both directions.
- `AppModel.previewNextSeason():1098` sets `dateScope: .all`, which makes
  `filter.isDefault` false permanently (`UserStateStore.swift:108-115`). A
  previewed year that is empty or 404s shows `noMatchesView` — *"your filters
  match no events"* — instead of the landing. The web port deliberately did
  not copy this.
- No `CountdownBanner` renders inside a previewed non-current year
  (`AppModel.swift:433-441` requires `isCurrentYear`).
- The `.day` scope exemption is now **one** site — `EffectiveScope.swift`
  (`09d7ea2`, #233) — not the old trio. Inherit via `EffectiveScope.resolve`.
- Window hygiene: any year-changing navigation must not leave
  `windowStartDayKey` / `windowEndDayKey` widened. See #234 and #156 for the
  shape of that bug class.
- Scope iOS test runs — the UI leg dominates wall-clock. Do not run the full
  UI suite while an agent builds.

---

## 3. #286 — a fresh clone renders an empty calendar

**Status:** NOT STARTED · **Size:** S · Can run in parallel with item 2 (web only)

`useEventData.ts:87` reads `/data` in dev, not CloudFront.
`all-events-2026.json` is gitignored (`.gitignore:63`). The 404 is a bare
`console.error` (`useEventData.ts:232`), so the reader gets `EmptyState`'s
"try reloading in a moment" — advice that can never work.
`backend/src/scripts/syncDataWithLocalFile.ts` is the remedy and
`backend/README-LOCAL-SYNC.md` documents it, but `grep -rn "README-LOCAL-SYNC"`
over the repo returns **zero referrers**.

Also refresh the tracked `frontend/public/data/years.json` — it says
`{"years":[2025,2026],"defaultYear":2026}`, six months stale against
production's `[2025,2026,2027]`, so no fresh checkout can exercise 2027.

**Done when** a fresh clone plus `docker compose up` shows events, or fails
with a message naming the sync step.

---

## 4. #215 — CI for the Docker dev stack

**Status:** NOT STARTED · **Size:** M · **Entry criterion: do #286 first**

Do it after #286 so the boot assertion can check *a rendered event*, not just
a 200 — the two failures that actually shipped were both silent, and a
build-only job would have caught neither.

Still true: zero `docker` references across the eight workflows. `#248`
(2026-08-24) changed `docker-compose.yml`, `scripts/setup-local.sh` and
`backend/Dockerfile.dev` with no CI coverage — the second rot event of this
shape. Trigger paths must now include LocalStack (`docker-compose.yml:90-103`)
and `Dockerfile.dev`'s table-init step.

The issue's own open question — per-PR vs nightly — resolves to **per-PR,
path-filtered**: both rot events came from PRs touching exactly those paths.
A nightly is a later second job for upstream image drift, not an alternative.

---

## 5. #216 + #217 — dev-env docs and deploy scripts

**Status:** NOT STARTED · **Size:** S · Both fully specced, mechanical

- **#216** — the per-route audit is done and posted as a comment; paste it in
  as a table. Note the issue's own premise was wrong: dev never touches
  CloudFront. Drop the orphan `dynamodb_data` volume
  (`docker-compose.yml:121-122`). Fix `README.md:65`, which tells developers
  to curl production.
- **#217** — **delete** `scripts/deploy.sh`, `deploy-frontend.sh`,
  `deploy-with-validation.sh`; repoint the ten doc referrers; drop the broken
  root `deploy:frontend` script; **keep and correct**
  `backend/utils/README.md:147` to root `npm ci`. `deploy.sh:79-86` applies
  Terraform, which CI deliberately never does — fixing only the `npm install`
  lines would leave that in place while implying support.

---

## 6. #285 — the date-filtering divergence

**Status:** NEEDS A DECISION (cheap) · implement in **1.1.5**, not 1.1.4

Web deleted date filtering in #274 phase 4; iOS kept scope chips and a week
grid deliberately (`FilterSheet.swift:138-144`). Both design docs currently
claim iOS *deleted* that machinery — it relocated it.

Three options in the issue. **Decide now, build later**: if the answer is
"iOS follows web", it touches `DateScope`, `selectedWeeks`, `EffectiveScope`
and the persisted payload, and it invalidates the `whatsNew` you are about to
write for 1.1.4. Whichever way it goes, fix the claim in
`2026-08-25-web-day-strip-date-navigation-design.md:39` and the iOS
consolidation design doc.

---

## 7–11. The undated queue

| Order | # | Notes |
|---|---|---|
| 7 | **#237** | Layer 1 (round trip) only. Prerequisite satisfied — the anchor day is `EventListView.scrollAnchor:254`, but it is `@State private`, so the work is a lift onto `AppModel`. Two stated blockers already shipped: `DayChipCountStyle` and the `EffectiveScope` collapse. ~10 line refs in the body have drifted; a corrected table is in the issue comments. Screenshot regen **is** required here. |
| 8 | **#283** | ~660ms cold-load task. The app fetches the **~5MB per-year** file, never the 10MB combined one. Year-level split already shipped; what remains is a sub-year split, trimming fields, chunking the parse, and moving `decodeEventHtmlEntities` to build time — it runs at **three** call sites, including the supposedly-fast warm path (`useEventData.ts:66-69`). **Do not virtualize the list**; measured, the JS version was worse. |
| 9 | **#174** | **Blocked on a content decision**, not engineering. The divergence is not hypothetical: web already has 11 shortcuts to iOS's 2, including `Hall of Christ: Sanctuary`, one of the issue's own five. So this is reconciling two lists. Add `Sports Club, Lawn Bowling Green` and `Sports Club, Waterfront`, both missed by the issue. Forces a screenshot regen (`02-filters`). |
| 10 | **#143** | Before June 2027, with the unmatched-article audit. Verified live: the Michael Chan pair scores **0.40**; fuzzing the token *or* correcting the spelling each reaches 0.75 — so **the misspelling alone is the blocker** and the title-fallback half needs separate justification. `MATCHER_VERSION` is **7**; bump to 8. |
| 11 | **#275** | Retarget the issue: the wheel half is now near-theoretical (`EventList` is deleted; the reassert self-cancels on `wheel`), and the live half is **middle-click autoscroll**, which nothing models. |

---

## 12. Off-season features, in dependency order

**#198** (Home Base — biggest next-season UX win, zero location permission;
must be excluded from any future preference sync) → **#194** (Apple Watch;
design done, iOS-first) → **#132** (accounts; large, fresh branch, re-verify
the 2026-07-03 spec) → **#200** (shared lists; hard-blocked on #132).

---

## Not in the queue

- **#246** — Special Studies classes page. The owner is handling this
  directly with the contributor. **Do not comment, close, or open a PR
  against it.** The work lives on the fork
  `Woodwell/chq-calendar:feat/classes-catalog`.

---

## Completed

*(Move items here as they land, with the squash sha.)*

## 1. #287 + #290 — the browser suite's two failure modes

**Status:** DONE — squash `8bee59b`, PR #292, merged 2026-08-28. Both issues
closed. Four commits: `8b16638` (the fixes), `478ec88` (marking this item IN
REVIEW), then `2bd819c` and `9e9b783`, both review-driven.

**What it turned out to be.** Both fixes are in the harness; `page.tsx` and
every other source file are untouched.

- **#287** — `enterList` takes `seedsOwnFilter`, which suppresses regime
  *reporting* for a page that seeded a filter into storage. The consistency
  rule still binds every page that can honestly report, and a
  `seedsOwnFilter` page running before any regime is established throws.
  `verify-full-list`'s `5-webkit the rail highlights today` got the
  off-season skip its three siblings already had.
- **#290** — **not** the `useDayAnchor` ResizeObserver lead the issue named.
  The parking loop returns on an instantaneous `|delta| <= 2`, and the
  ~152,000px jump back up from today's landing lands among ninety
  `content-visibility: auto` sections that then swap their
  `contain-intrinsic-size` estimates for real heights: the document grew
  169,546 → 172,664, ~3,100px above the target, 17ms *after* the loop
  returned. Chromium's scroll anchoring absorbed +478 and the rest pushed
  the target down. The loop now confirms against a settled document height.
  Falsified by making the day header non-sticky — check 12 fails at both
  widths, so the fix did not make it vacuous.
- **Also found, previously unreachable** (the run crashed before check 18):
  the seeds' `lastSaved: Date.now()` was Node's clock while the page's was
  pinned, so any `E2E_NOW` more than 30 days out silently dropped the seed —
  six red checks at `E2E_NOW=2026-09-30`. Seeded from `FIXED_NOW` now.

Verified: full `test:browser` chain green in both regimes; `verify-rail`
green pinned to 2026-09-11, 09-15 and 09-30, and 7 consecutive in-season
runs at 46/46 across the three commits, against a ~1-in-4 prior failure
rate.

**Two things worth carrying into the next harness change.** Copilot
returned "0 comments / Approval recommended" twice and then filed two
real inline findings on its third pass — an approval from a Lite review
is not evidence there is nothing to find, so read the inline surface
every round. And one of those findings had earlier been waved through as
"pre-existing house style": true, and beside the point. It had been
copied twice by then.

<details><summary>The original plan, kept for the reasoning</summary>

Two issues, one sitting. #287 is deterministic and dated; **#290 is already
failing on `main` today** — `verify-rail`'s check 12 fails roughly 1 in 4, and
because `test:browser` is `&&`-chained it takes the five suites after it down
too, so an unrelated PR goes red with no signal. Both live in `verify-rail.mjs`,
so fix them in one pass.

**Do this first.** Not because it is the largest problem but because every
branch pushed after Sep 11 gets a red `Build and Test` with a stack trace and
no summary — including the branches for item 2. Fixing it first is what keeps
the rest of the queue's CI readable.

**Scope**

- `frontend/e2e/verify-rail.mjs:983` and `:1148` — the two pages that seed
  `searchTerm: 'williamsburg'` into `chq-calendar-user-state`.
- `frontend/e2e/regime.mjs:227` — the "one regime per run" throw.
- `frontend/e2e/verify-full-list.mjs:704` — check `5-webkit the rail
  highlights today`, which lacks the off-season guard its three siblings have
  at `:353`, `:587` and check 7.

**Done when**

```bash
cd frontend && npx vite build && npm run preview &
E2E_NOW=2026-09-15 node e2e/verify-rail.mjs        # completes, summary, 0 failed
E2E_NOW=2026-09-15 node e2e/verify-full-list.mjs   # 0 failed
node e2e/verify-rail.mjs                            # in-season, still 46/46
```

### #290 — the 200%-zoom flake

`railBottom` is always 273.0; `headerTop` is either 273.0 (pass) or **exactly
700.0** (fail). Two discrete states, not jitter — the sticky day header appears
not to engage at all on bad runs. The harness confirms the header is flush
(`verify-rail.mjs:596-611`), waits 300ms, then measures — so the page moves
~427px *after* the scroll settled.

**Lead, untested:** `useDayAnchor.ts:204`, the `ResizeObserver` late reassert.
Since phase 4 it is one of only two announcing scrolls left in the app, and a
late reassert firing inside that 300ms window is exactly this shape. 200% zoom
is also where a reflow most plausibly trips a `ResizeObserver`.

Reproduce with plain `node e2e/verify-rail.mjs`, repeated. Check 12 is correct
as written — `:629-634` explains why equality rather than `>=` is the point —
so do not loosen it.

**Traps**

- **The app is correct; the harness is wrong.** `page.tsx:248`'s
  `!filters.hasFilters` is deliberate — the comment above it says an answer of
  "see you next season" is not a response to a reader who asked a question.
  Do not change `page.tsx`.
- **Keep the one-regime invariant.** `regime.mjs:227` exists because a run
  that took both branches would still report success. Make the two seeded
  pages opt out of the assert, or seed the filter *after* `enterList`.
- `verify-offseason.mjs` does **not** import `fixedNow.mjs` and ignores
  `E2E_NOW` entirely — it derives every instant from the live feed.
  `e2e/README.md:120` reads as if the override is universal. Worth correcting
  while here.
- **Never run two Playwright suites at once on one machine** — it produces
  contention noise of its own. But note that was my first and *wrong*
  explanation for the check-12 failure: it then reproduced in CI on a
  docs-only PR with identical numbers. See #290.

</details>

---

- **#274** — day strip owns date navigation. Four phases: `d75e1a1` (#276),
  `0e854fe` (#280), `d3a82fc` (#281), `3ac557b` (#282), plus `1db86b2` (#279).
  Closed 2026-08-27 after verifying every acceptance criterion.
