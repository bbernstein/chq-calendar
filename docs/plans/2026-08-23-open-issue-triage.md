# Open-issue triage — 2026-08-23

**Status:** Reference. Ordering for the 19 issues left open after this pass.
Re-triage when a batch ships or when the next season's dates change the calculus.

Context that drove the order: the 2026 season ends ~Aug 30, iOS 1.1.3 (build 6)
is waiting on the user's archive/upload, and the off-season (Sep → May) is the
window for larger features. Small fixes that clear the local test gate and the
iOS scroll machinery come first; season-dependent features are placed where
they must land before June 2027.

## Closed this pass

| # | Why |
|---|---|
| #259 | Resolved by #260 (41 → ~20 min). Option 1 (paid larger runner) deliberately declined for a public repo. Comment left on the issue. |

## Keep — in recommended order

| Order | # | Title | Why here |
|---|---|---|---|
| 1 | #246 | web: Special Studies classes page (Woodwell) | **Not code — a decision.** Contributor has it built on a branch and has waited since 08-22 for a read on direction/cadence/infra and whether to split the PR. Their late-season fixtures lose value as sessions vanish after Aug 30. |
| 2 | #235 | iOS: `containerURLIsNilInTheUnitTestHost` asserts the environment | Tiny. Makes a local suite run actually green — precondition for every iOS item below. Option 1 (assert `shouldRunAppOnlyMigration`). |
| 3 | #252 | iOS: two UI-test hooks don't compose | Tiny. Fail loudly at launch when both are passed. Removes a known trap before anyone touches scroll tests again. |
| 4 | #234 | iOS: re-tapping the active scope keeps a widened window | Small. #258 shipped the rail's `⟳ Now`; "re-tap the active scope" and "⟳ Now" must now agree. Fix is the widened `unchanged` guard in `selectScope`. |
| 5 | #257 | week filters include full boundary Saturdays | Well-specced, both platforms together, predicate swap + tests. Filed by the user this week. |
| 6 | #254 | iOS: `shouldAbandonScroll` mixes live and captured state | Phase-4 churn is over, so this is the moment to fix the bug *class* (4 instances) before the next scroll change becomes the fifth. Do after 2–4 so the suite is clean. |
| 7 | #244 | web: event title opens details, "Open on chq.org" inside | Web-only, fully specced, one file + tests. One line shorter per card. |
| 8 | #237 | iOS: My Day ↔ Events round trip, gaps in a day | Prerequisite (day rail / anchor day) shipped in #245/#258. Layer 1 (round trip) first; layers 2–3 later. Screenshot regen required. |
| 9 | #174 | iOS: venue-name shortcuts | Content decision first (which abbreviations stay recognisable), then dictionary entries; keep web `getLocationDisplayName` in parity. |
| 10 | #253 | iOS: Siri day intent silent on archived year | Cheapest honest fix is option 2 (intent carries its year and says so). Low traffic; off-season only. |
| 11 | #186 | iOS: `browsePastSeason(year:)` for pre-season archive | Recurs Feb–Jun; must land before Feb 2027. Good off-season work. |
| 12 | #217 | deploy scripts still do per-workspace `npm install` | No workflow uses them; `deploy-production.yml` is the real path. Recommend **delete** `deploy.sh`/`deploy-frontend.sh` and fix the README/DEPLOYMENT.md references rather than maintain a shadow deploy. |
| 13 | #216 | docs: local dev "has no backend" but Compose runs one | Per-route audit, then a table in DEPLOYMENT.md + README. Drop the orphan `dynamodb_data` volume. |
| 14 | #215 | ci: nothing exercises the Docker dev setup | Woodwell is an active contributor on it (#248 merged 08-20). Path-filtered build+boot job; add a bash-only shell-test harness for `setup-local.sh`. |
| 15 | #143 | matcher: fuzzy presenter/title matching | No Daily articles until June 2027; do before next season with the unmatched-article audit. Bump `MATCHER_VERSION`. |
| 16 | #198 | iOS: Home Base | Biggest next-season UX win with zero location permission; unblocks first-event departure alerts. Exclude from any future preference sync. |
| 17 | #194 | iOS: Apple Watch app | Design done; build after #198 (its origin) and iOS-first since notifications already mirror. |
| 18 | #132 | accounts + settings sync | Large. Before implementing, settle #246's question: federate with CHQ's own login or not. Start on a fresh branch, re-verify the 07-03 spec's facts. |
| 19 | #200 | shared favorite lists | Hard-blocked on #132. |
