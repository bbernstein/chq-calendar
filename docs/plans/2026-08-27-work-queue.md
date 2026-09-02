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
| 2 | **iOS 1.1.4** — year-aware navigation | #186, #288, #253 | DONE | PR #298 |
| 3 | Fresh-clone empty calendar | #286 | IN PROGRESS — PR open | PR #300 |
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
| **~mid-Sept** | 1.1.4 must be submitted to clear review in time — **code is done (item 2); what remains is the owner's archive → upload → App Store Connect submission**, per `docs/app-store/RELEASE_CHECKLIST.md` | **2** |
| ~~**2026-10-01**~~ | ~~Server flips `defaultYear` to 2027 … #186 owns giving pre-season an action~~ — **closed in code by item 2**: `.preSeason` now offers "Browse the {year} season". Still needs the 1.1.4 build in users' hands to matter | ~~**2**~~ |
| **~2027-03-29** | 2027-06-27 enters `.next`'s 90-day window; the iOS pre-season state self-heals — no longer load-bearing, since #288 unbound the probe and #186 gave the state an action | — |
| **June 2027** | Next season's Daily articles begin | **10** |

Nothing else in the queue has a deadline.

---

## 3. #286 — a fresh clone renders an empty calendar

**Status:** IN PROGRESS — PR #300 open, awaiting review/merge · **Size:** S

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
with a message naming the sync step. **Met** — verified 1,687 cards / 89 days
on a tree reduced to `git ls-files frontend/public/data`, and 0 cards + 🎭 with
the defect injected back.

**The fix was neither option the issue listed.** `vite.config.ts:117-120` has
proxied `/cache` to production since 2026-03-02, for the dev server *and*
`vite preview` — so the `DEV ? '/data'` branch had been redundant for five
months and deleting it was smaller than either fetching the feed or tracking a
fixture. Escape hatch is `VITE_LOCAL_DATA=true`, explicit by design.

Three further defects fixed en route: `syncDataWithLocalFile.ts` wrote
`all-events.json` while the app reads `all-events-<year>.json` (so the
*documented remedy never worked*, which kills option 3 outright);
`setup-local.sh` checked ports, not content; `README-LOCAL-SYNC.md` still had
zero referrers.

---

## 4. #215 — CI for the Docker dev stack

**Status:** READY — entry criterion met by PR #300 · **Size:** M

Do it after #286 so the boot assertion can check *a rendered event*, not just
a 200 — the two failures that actually shipped were both silent, and a
build-only job would have caught neither.

**#300 leaves two things ready to reuse.** `check_events` in
`setup-local.sh` is the assertion in shell form, already exercised in both
directions. And #300's throwaway Playwright probe is the browser form: load
the page, `document.querySelectorAll('[data-event-id]').length > 0`, and
assert `[data-testid="empty-state"]` is absent — deliberately not committed,
because it is this job's to own. Run it against a tree reduced to
`git ls-files frontend/public/data`; that reduction *is* the fresh-clone
simulation.

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

**This does not block 1.1.4's `whatsNew`, and never did.** That was the
reading when this file was written; the controller settled it on 2026-08-31
and the note is written now. A release note describes the changes in *its
own* release, which a later release cannot invalidate — 1.1.4's says nothing
about date filtering, scope chips, or the week grid, so whichever way #285
goes it has nothing to contradict. It will need its own `whatsNew` in 1.1.5.

**Not to be confused with #186's web half**, which was folded into item 2
(`bacc6ac`). That was a *landing-state* divergence in a declared port;
this one is date filtering, deliberately relocated rather than deleted on
iOS.

Three options in the issue. **Decide now, build later**: if the answer is
"iOS follows web", it touches `DateScope`, `selectedWeeks`, `EffectiveScope`
and the persisted payload. Whichever way it goes, fix the claim in
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

## 2. iOS 1.1.4 — year-aware navigation (#186 + #288 + #253)

**Status:** DONE — **PR #298**, branch `feat/year-aware-navigation-186-253`,
2026-08-31. (Deliberately referenced by PR rather than squash sha: the sha
does not exist until merge, and a placeholder that needs hand-editing at
merge is one nobody edits. `git log --grep '#298'` finds the commits.) #288 had already merged separately (`01fa4e3`, PR #295); **#186
and #253 shipped here** and are what made this 1.1.4.

**What shipped**, in commit order: `47fbfbd` `.preSeason` carries an
`archiveYear`; `87f97a5` proves the rule is a `max` over the manifest, not a
position; `dbd4a77` `browsePastSeason(year:)` replaces the year-blind
`browseArchiveSeason()`; `5912311` `goToDay(crossingYears:)`; `4a595fc` the
day deep link switches season, taking the key exactly once; `b7e02e8` the
arming-order guard; `7fde4e3` a three-season UI fixture and the first
end-to-end coverage either issue has had; `20b9cd0` a doc correction with an
assertion behind it; `bacc6ac` the web half of #186; plus this release-chore
commit.

**Three things worth carrying forward.**

- **The web parity half of #186 was folded in here** (`bacc6ac`), and is
  **not** item 6/#285. `frontend/src/lib/utils/landingState.ts` is
  `LandingState.swift`'s declared port, so shipping the iOS archive button
  alone would have re-opened exactly the divergence class #288 closed —
  the parity trap this file already flagged
  (`OffSeasonLanding.tsx:96` hid its pre-season button too). #285 is a
  *different* divergence (date filtering, deleted on web, relocated on iOS)
  and remains open below, for 1.1.5.
- **A real navigation defect fell out of #253**, of the #234/#156 window-
  hygiene class this item's Traps predicted: a `windowStartDayKey` left over
  from the outgoing year was rewritten by `ViewWindow.make`'s per-year clamp
  to the *new* year's lower bound rather than dropped, dragging the reader
  ~2 months back from the day they asked for. The cross-year path now clears
  the outgoing season's scope-local date state.
- **The trap "no iOS UI test covers the off-season landing at all" is
  closed.** `UITestFixtureAPI` serves three seasons now (2025 archived, 2026
  the default, 2027 announced-but-empty), and `YearNavigationUITests` covers
  #186, #253, and the rail-over-landing path §A3 of the off-season design
  flagged. The 2027 payload must stay **valid and empty**, not a 404 — a 404
  routes through `AppModel.landingState`'s `guard snapshot != nil` to
  `.inSeason` and makes `.preSeason` unreachable.

**Release state.** `MARKETING_VERSION` is 1.1.4 and
`CURRENT_PROJECT_VERSION` 7 on the app and widget targets (test bundles stay
at build 1); `promotionalText`, `whatsNew` and `reviewNotes` in
`listing-fields.json` describe 1.1.4. **Screenshots were deliberately not
regenerated** — no shot in `ios/Scripts/screenshot-plan.json` is an
off-season screen, and "regenerate and confirm no change" is still
unreachable because **#294 is still open**: `capture-screenshots.sh`'s
`--time "9:41"` pins the clock but not the date, so the iPad status bar
churns nine files per run. The PR carries a `[skip-screenshots: …]` opt-out.
**What remains is the owner's**: archive → upload → create the 1.1.4 version
in App Store Connect → submit, per `docs/app-store/RELEASE_CHECKLIST.md`.

<details><summary>The original plan, kept for the reasoning</summary>

**Status:** NEXT — #288 MERGED (`01fa4e3`); #186 + #253 **designed, not
built** — read [the design doc][ynav] first, it is the plan of record ·
**Submit by ~mid-Sept, live before 2026-10-01** · **Size:** M

[ynav]: ../superpowers/specs/2026-08-28-year-aware-navigation-186-253-design.md

1.1.3 (build 6) is **live**, so this needs a new build. These three issues are
one job: each needs *a navigation that changes the year it navigates in*. Built
once, all three close; built separately, it gets built twice.

**Why the date matters.** From 2026-10-01 `defaultYear` is 2027, whose five
published events are ~265 days out — beyond `.next`'s 90-day cap
(`EventFilter.adaptiveEndDate`, `maxOffset = 90`).

**The worst of this is already fixed.** The landing used to read that cap as
"the season is over", so `LandingState.determine` returned `.preSeason` —
a countdown with **no buttons**, for six months. #288 unbound the probe from
`.next` (`01fa4e3`), so that state is no longer reached.

What is left is the reason the date still matters. The reader lands on
`noMatchesView` instead: honest enough, with a working "Show All Events",
but "No matching events" is the wrong sentence for a season 265 days out.
And anyone who *does* reach `.preSeason` still finds nothing to press —
`archiveYear` is `nil` there and the preview button is `.postSeason`-only
(`OffSeasonLandingView.swift`). **#186 is what closes that**, and #285 owns
the wording. Neither is fixed by the October flip self-healing in
~2027-03-29.

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
- **#186 + #253 — designed 2026-08-28, see [the design doc][ynav].** Both
  reduce to one primitive: a navigation that changes the year it navigates
  in. Two decisions are already taken there (Siri switches the year
  silently; the archive button offers the newest *earlier year present in
  the manifest*, not `selectedYear - 1`).

  The finding that changes the estimate: **the day key is already
  year-qualified**, so #253 needs nothing to cross the process boundary —
  the App Group plumbing this file previously assumed is not required, and
  the issue's "refuse and say so" option is the *more* expensive one.

  The doc also records a divergence to decide rather than drift into: **the
  web hides its pre-season archive button too**
  (`OffSeasonLanding.tsx:96`), so fixing iOS alone re-opens the gap class
  #288 just closed.
- **#253's mechanism**, for reference: `OpenDayIntent` resolves the year from
  `IntentDataSource.defaultYear()` (`EventIntents.swift:96`) while
  `AppModel.goToDay` bounds against `selectedYear`. Option 2 ("refuse and say
  so") is **not** cheaper — it is the one that would need the intent to read
  the app's live `selectedYear` across the process boundary. Option 1 needs
  no such thing, because the day key already names its own year.

**Release gates**

- **Screenshots: the opt-out is free, but "regenerate and confirm no
  change" is NOT reachable until #294 is fixed.** All ten shots in
  `ios/Scripts/screenshot-plan.json` are in-season screens (`01-season`
  through `10-widget`); none covers the off-season or pre-season landing,
  so an off-season logic change cannot alter what any of them depicts.
  Regenerating nonetheless rewrites **15 of the 20 files** — measured in
  #295, on a commit whose own change could not move a pixel in any shot.
  Two causes, both unrelated to whatever you changed:
  - **Nine iPad shots.** `capture-screenshots.sh:308-309` passes
    `--time "9:41"`, which is not an ISO string, so `simctl` pins the
    time but never the *date*. The iPad status bar renders the date
    (the iPhone's does not), so every iPad shot carries the day it was
    captured and changes on every run. That is #294.
  - **Five iPhone shots.** Live-feed drift: only the clock and the
    dataset year are pinned, not the feed or the article-links sidecar.
    A real staleness signal, and one that wants a human looking at the
    results rather than a script blessing them.

  Until #294 lands, record `[skip-screenshots: <reason>]` and do not
  commit the churn.
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
- ~~`LandingStateTests.swift:60` asserts an unreachable combination; every
  2027 test payload is July 2026~~ — **closed by #288.** `determine` no
  longer takes `upcomingDefaultCount` at all, and
  `events-2027-sparse.json` (production's real 2027 feed) plus
  `years-2027-default.json` now exercise the sparse-2027 path directly.
  The *unit* side of that gap is gone; the UI side above is not.
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

</details>

---

- **#274** — day strip owns date navigation. Four phases: `d75e1a1` (#276),
  `0e854fe` (#280), `d3a82fc` (#281), `3ac557b` (#282), plus `1db86b2` (#279).
  Closed 2026-08-27 after verifying every acceptance criterion.
