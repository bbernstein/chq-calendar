# Open-issue triage — 2026-08-27

**Status:** Reference. Supersedes `2026-08-23-open-issue-triage.md`, whose
ordering is spent: items 2–7 of that list (#235, #252, #234, #257, #254, #244)
all shipped between 08-23 and 08-24.

Every claim below was re-verified against `main` (`909a68f`) and, where the
issue made a data claim, against the live production feed. Verification
comments are on each issue.

## Season facts that moved the calculus

Both were assumed wrong in the 08-23 pass:

- **The 2026 feed's last event is `2026-09-10`**, not "~Aug 30". The nine-week
  season ends in late August; the feed carries programming for two more weeks.
- **2027 is already published** — 5 events, `2027-06-27` to `2027-08-09`.
  `years.json` is `{"years":[2025,2026,2027],"defaultYear":2026}`.
  `defaultYear` flips to 2027 on **2026-10-01**, which is what opens the
  pre-season window #186 is about.

## Closed this pass

| # | Why |
|---|---|
| #274 | All four phases merged (`d75e1a1`, `0e854fe`, `d3a82fc`, `3ac557b`). Every acceptance criterion verified against code and tests, including the localStorage-migration one, which has a real test at `useFilterState.test.ts:14-29`. All four open questions answered by what shipped. |

## Opened this pass

| # | Why |
|---|---|
| #285 | web/iOS date-filtering divergence. #274 phase 4 deleted date filtering on web; iOS still ships scope chips and a week-filter grid, with a doc comment saying so deliberately (`FilterSheet.swift:138-144`). Both design docs currently claim iOS deleted this machinery — it relocated it. A decision, not a bug. |
| #286 | A fresh clone renders an empty calendar. `useEventData.ts:87` reads `/data` in dev; `all-events-2026.json` is gitignored; `backend/README-LOCAL-SYNC.md` has zero referrers. Same class as #214 and #247, both found by an outside contributor. |
| #287 | **P0.** `browser-checks` aborts from 2026-09-11. Reproduced: `E2E_NOW=2026-09-15 node e2e/verify-rail.mjs` crashes at `regime.mjs:228`. `test:browser` is `&&`-chained with `verify-rail` first, so the other five suites never run. Plus an unguarded off-season check in `verify-full-list.mjs:704`. Both halves introduced by #282 three days ago. |
| #288 | From 2026-10-01 web says `in-season` and iOS says `.preSeason` for the same date, because web's rule-1 input is unbounded and iOS's is capped at 90 days (`EventFilter.swift:203-206`). `landingState.ts`'s header promises they will not disagree. Six-month window; 2027's 5-event feed is what exposed it. |

## Kept — recommended order

| Order | # | Why here |
|---|---|---|
| 1 | #287 | **Ships red in 15 days.** Reproduced locally, both halves. Small fix — the two seeded-filter pages must declare they intentionally leave the landing regime. Do this before anything else touches the e2e suite. |
| 2 | #246 | **Still not code — still a decision, now 5 days old.** No PR exists. The work is on `Woodwell/chq-calendar:feat/classes-catalog`, 57 commits / 62 files ahead, **pushed again 2026-08-27T02:47Z** — the contributor is still building against an unanswered question. Their late-season fixtures decay as sessions vanish. |
| 3 | #286 | Onboarding defect, cheap, and it is the third fresh-clone breakage. Fixing it makes #215's boot check meaningful (assert a rendered event, not just a 200). |
| 4 | #215 | The CI job that catches the #214 / #247 / #286 class. #248 changed three dev-stack files on 08-24 with zero CI coverage — a second rot event since this was filed. Per-PR path-filtered, build **and boot**. |
| 5 | #216 | Docs half of #286. The per-route audit it was blocked on is now done and posted; its own premise about CloudFront event data was wrong. Mechanical from here. |
| 6 | #217 | Recommend **delete** `deploy.sh` / `deploy-frontend.sh` / `deploy-with-validation.sh`. No workflow uses them; `deploy.sh:79-86` applies Terraform, which CI deliberately never does. A fifth uncited `npm install` at `deploy.sh:147`. |
| 7 | #186 | **Window opens 2026-10-01**, not February — five weeks out, and it bites hardest on day one, when the just-ended 2026 season is what users want and the archive button vanishes. Mitigated by the year menu, so a discoverability regression, not a block. |
| 8 | #288 | Same 2026-10-01 date as #186, and #186's fix is one of its two halves. Web's behaviour is the correct one by its own recorded reasoning (`landingState.ts:103-107` rejected exactly iOS's rule). Also: **no iOS UI test covers the off-season landing at all** — the fixture serves a single-year manifest. |
| 9 | #285 | Decide before either platform's date UI moves again. Cheapest outcome (option 3, record the divergence) is a docs fix in two design docs. |
| 10 | #253 | Off-season only. Note from verification: option 2 ("refuse and say so") is **not** the cheap option it looks — the intent cannot read the app's live `selectedYear`, so it needs most of option 1's plumbing. #186 wants the same missing capability; build it once. |
| 11 | #237 | Prerequisite satisfied — the anchor day exists (`EventListView.scrollAnchor:254`). Two things the issue lists as pending have already shipped: `DayChipCountStyle` and the `EffectiveScope` collapse. Layer 1 is smaller than the body assumes. ~10 line refs drifted. |
| 12 | #174 | Content decision. The divergence premise inverted: web already has 11 shortcuts to iOS's 2, so this is reconciling two lists, not writing one. All five claimed event counts verified exactly. Two high-weight venues missed (`Sports Club, Lawn Bowling Green`, `Sports Club, Waterfront`). |
| 13 | #283 | Retitled — the app fetches the ~5MB per-year file, never the 10MB combined one. The year-level split already shipped; what is left is a sub-year split, and a warm path that parses and decodes a second time (`useEventData.ts:66-69`). |
| 14 | #275 | Reachability shrank materially. `EventList` is deleted, and the reassert path self-cancels on `wheel`. Suggest inverting: make **middle-click autoscroll** the subject and keep the wheel case as a note on why `settling` cannot be generalised away. |
| 15 | #143 | No Daily articles until June 2027. Verified live: the Michael Chan pair scores **0.40**; either fuzzing the token *or* correcting the spelling reaches 0.75. So **the misspelling alone is the blocker** — the title-fallback half needs its own justification. `MATCHER_VERSION` is 7, not 4. |
| 16 | #198 | Biggest next-season UX win, zero location permission. Unchanged and accurate. No spec written yet. |
| 17 | #194 | Design done (`2026-08-09-apple-watch-app-design.md`). Build after #198. |
| 18 | #132 | Large. Settle #246's federation question first. Fresh branch, re-verify the 07-03 spec. |
| 19 | #200 | Hard-blocked on #132. Spec merged, `ReminderPlanner.maxPending` still 60 as pinned. |

## Verified accurate, no comment needed

#200, #198, #194, #132 — all referenced design docs still exist and their
pinned code facts are unchanged.

## The 2026-09-10 App Store deadline is dead

A note carried since the 4.2 rejection recorded **2026-09-10 as a hard
deadline**, on the reasoning that after the season's last event day the
default screen is empty until June 2027, so any later App Review would
auto-fail Guideline 4.2. Checked directly, and it no longer holds:

- **Web** — `verify-offseason.mjs` passes 14/14, and both landing buttons
  still work after phase 4 deleted `dateFilter`. Driven with real clicks at
  two pinned dates: "Browse the 2026 season" mounts 89 sections, "Preview the
  2027 season" switches to 2027 and mounts 5. `browseArchiveSeason` no longer
  sets a date filter at all — it flips `browsingArchive` in
  `useLandingDismissal.ts`.
- **iOS** — on 2026-09-15 `LandingState.determine` returns
  `.postSeason(2026, next: 2027, …)`, and `OffSeasonLandingView` renders the
  copy, the countdown card and **both** buttons. Covered by pinned unit tests
  (`AppModelTests.swift:761, 840, 863`; `LandingStateTests.swift:38, 48`).

So a review during 2026-09-11 → 09-30 lands on a usable screen on both
platforms. What replaces the cliff is thinner and later: from 2026-10-01 the
iOS landing has **no buttons** for about six months — see #288.

## How this pass was verified

Not a read-through. Where an issue made a claim about code, it was checked at
the named symbol; where it made a claim about data, it was checked against the
live production feed; where it described a failure, it was reproduced.

- #287 reproduced locally against a fresh `npx vite build` + `vite preview`,
  both halves, with the in-season control run for contrast.
- #143's Michael Chan pair scored against the real event and the real
  chqdaily article (post 49433), with two counterfactuals.
- #174's five venue counts recomputed from the feed using iOS's own
  `displayLocation` rule. All five exact.
- #274's acceptance criteria checked against code *and* the tests that guard
  them; unit suite green at 1,325 tests.
- One local `verify-rail` check-12 failure was chased and dismissed: three
  further runs came back 46/46, `railBottom` and `headerTop` both exactly
  273.0. The first run had overlapped another Playwright suite on the same
  machine.

## Nothing else outstanding

- No open PRs. #144 (SEO phase 1) and #137 (PWA auto-update) both merged in
  July; earlier notes calling them open are stale. Their post-merge
  follow-ups (run the GSC runbook; verify live cache-control headers) may
  still be outstanding.
- No open issue duplicates a closed one (checked against all 100 closed,
  which bottoms out at #43).
- No unfiled `TODO`/`FIXME` anywhere in `frontend/src`, `backend/src`,
  `ios/ChqCalendar*`, or `shared/`.
- No recently-closed issue left a follow-up undocumented.
- `APP_STORE_URL` is set (`frontend/src/lib/constants.ts:16`) — the gate
  recorded against the marketing site is closed.
