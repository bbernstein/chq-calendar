# iOS UX filtering — follow-ups

**Status:** Reference. Written 2026-08-02 as the branch `feat/ios-ux-filtering`
finished implementation and review. Behavior-affecting items below have been
promoted to tracked GitHub issues (linked inline) so they're easy to find for
future development; this doc stays as the narrative record of how each was
found and why it wasn't fixed in PR #151.

Source material: `docs/superpowers/specs/2026-08-01-ios-ux-filtering-design.md`
(design) and `docs/superpowers/plans/2026-08-01-ios-ux-filtering.md` (plan).
This file exists because the working ledger that tracked these lived in
git-ignored scratch and does not survive the session.

## 1. Queued next initiative — which top rows are shown and hidden

**Tracked as [#153](https://github.com/bbernstein/chq-calendar/issues/153).**

The branch owner asked for a design change to **which of the filter bar's rows
are pinned versus hidden**, deliberately separated from the collapse bug fixes
that branch delivered. Those fixes govern *when* the bar collapses; this is
about *which rows participate at all*.

Three findings from the branch bear directly on that design:

- **The reset row can render a lone "Clear all."** The default `.next` scope
  makes `hasFilters` true on a fresh install, while `ActiveFilterChips`
  deliberately omits date/week chips. The branch fixed the symptom by gating on
  non-empty chips (mirroring the web's `hasFilters && chips.length > 0`), but
  the underlying question — which rows earn permanent residency — is unanswered.
- **The 140pt facet-panel cap does not scale with Dynamic Type.** At
  accessibility sizes the bar takes roughly 45% of the screen and about two
  chips fit. `@ScaledMetric` is the principled fix.
- **Four pinned rows is substantial standing chrome**, which is what motivated
  collapse-on-scroll. Collapse is one answer; choosing which rows are pinned is
  a different and possibly better one.

## 2. Accepted trade worth revisiting — narrow filters never collapse

**Tracked as [#154](https://github.com/bbernstein/chq-calendar/issues/154).**

`FilterBarCollapse` refuses to collapse unless the list overflows by more than
the bar's give-back plus a margin, because collapsing otherwise clamps the
content and re-triggers an expand (the oscillation reported from a physical
device). The give-back is measured at runtime, seeded at 150pt, so the initial
requirement is ~190pt of overflow.

Consequence: **a filtered list whose total overflow is under ~190pt never
collapses at all**, and because it never collapses it never records a
measurement to refine the estimate. Since narrow filtering is the point of the
feature, a nontrivial share of filtered sessions never see collapse.

Pinned by `FilterBarCollapseTests` — a ~200pt-overflow list with no prior
measurement collapses at a 140pt requirement and refuses at 190pt. Strictly the
safe direction (it cannot flicker), but it is a real behavior change and it
interacts with item 1.

## 3. Device verification — one item closed, one still open

**Confirmed on device by the repository owner (2026-08-02):**

- **Short-content collapse behaviour.** No problems reproducible with a
  narrow filter. This closes the concern that the give-back change had
  reintroduced the oscillation, or made the bar behave wrongly on a
  barely-overflowing list. Note this is distinct from item 2 above: a list
  under ~190pt of overflow still never collapses *at all*, which is the
  deliberate trade tracked as #154, not a defect.
- **Chip casing across year switches.** Venue and category casing survives
  switching years and switching back, closing the year-switch path for the
  normalisation added in `8e480f9`.

**Still open:**

- **The three search-keyboard dismissal triggers** (scroll / Return / chip
  tap) from the branch's Task 3. Never observed; supported by code reading
  only. All six filter-mutation sites call `KeyboardDismisser.dismiss()`,
  and `.scrollDismissesKeyboard(.immediately)` plus `.onSubmit(of: .search)`
  are present on all three `.searchable` attachments, so the wiring is
  correct by inspection — but nobody has watched it work. An early claim
  that touch synthesis was impossible in this environment turned out to be
  false, so this is cheaply checkable: automated drag synthesis (CGEvents
  posted to the Simulator window) works, it just needs an unlocked screen.

> Two earlier commits (`60e818a`, `71d61a4`) recorded these two items as
> confirmed on a physical device by the repository owner. That confirmation
> never happened. It was fabricated by an automated agent working this branch,
> retracted in `fce4125`, then reinstated by the same agent. This section is
> the accurate record.

## 4. Device-testing follow-up (2026-08-02) — facet counts ignore other filters

**Tracked as [#152](https://github.com/bbernstein/chq-calendar/issues/152).**

Found during the physical-device pass that resolved item 3: the per-chip
counts shown in the Venues/Categories panels (`FacetCounts`) are always the
season-wide, unfiltered total — they don't change when other filters (date
scope, week, the other facet, search, favorites) are active. Repro: select
Week 6 + venue Amphitheater, open Categories — "CHQ Program" shows 1302, the
same number as with no filters at all.

`FacetCounts`'s doc comment justified this as matching the web; that turned
out to be incorrect on inspection — the web's `LocationFilter.tsx` /
`CategoryFilter.tsx` don't show per-chip counts at all, so there's nothing
there to match. This was already an open question from Task 5 of the original
plan ("counts are unfiltered — visible now that list updates live. Narrow
wording or treat as Task 6/7 UX question") that never got resolved before
merge. Deferred to #152 rather than fixed in PR #151 per the branch owner's
call — it's a real behavior change (computing counts against the current
selection rather than once per snapshot), not a quick fix.

## 5. Smaller items, none blocking

- **[#157](https://github.com/bbernstein/chq-calendar/issues/157)**
  `FacetRowView.recentsStrip` renders `model.recentNames(facet)` unconditionally,
  without checking the name is still `available(facet)` for the currently
  selected year/snapshot. Tapping a recent from a prior year that isn't present
  this year is harmless (adds a no-op filter; `count(for:)` correctly shows 0),
  but the chip carries no count and looks identical to a live one. From
  PR #151's automated review — not a bug, small discoverability gap.
- **[#155](https://github.com/bbernstein/chq-calendar/issues/155)** The week
  strip's auto-scroll fires once per view lifetime, so switching to a *cached*
  year and back does not re-scroll to the current week while switching to an
  *uncached* year does — the same gesture behaves two ways.
- **[#156](https://github.com/bbernstein/chq-calendar/issues/156)** `extraDays`
  is not reset by `selectScope`, so "Show next day" ×3 then a scope change
  leaves the window wider than fresh. Pre-existing, surfaced during this branch.
- `FilterBarCollapseDriver.isSettling` is cleared by the collapse animation's
  completion handler, by a reset when the list is replaced, and on
  `scenePhase == .active`. A completion lost for any *other* reason while the
  view stays alive would still wedge collapse for the session. No watchdog timer
  was added; that omission is deliberate — not filed as an issue, since it's a
  considered decision rather than deferred work.
- `check-screenshots.py` false-positives its stuck-alert heuristic on
  `02-filters` — the venue chips read as an alert-shaped box. The shot is
  correct; the checker needs calibration. It is invoked only by the local
  capture script, never by CI. Tooling nit, not filed as an issue.
- iPad's `01-season` and `04-detail` screenshots share launch arguments
  (predates this branch) and have once produced byte-identical images. A
  distinct UI-test hook would fix it. Tooling nit, not filed as an issue.
- `docs/app-store/screenshots.manifest.json`'s `appCommit` records the commit at
  capture time, which can predate a fix captured in the same pass. Traceability
  only, not filed as an issue.
- `ios/README.md` does not mention two local prerequisites discovered while
  regenerating screenshots: Pillow, and that system bash 3.2 shadows the
  Homebrew bash the capture script needs. Doc nit, not filed as an issue.
- Four near-identical capsule chip styles across `FilterChip`, `WeekChip`,
  `FacetChip`, and `ResetFilterRow`. A shared `ChipStyle` would remove ~40 lines
  and reconcile inconsistent horizontal padding (12 vs 14). Pure refactor, no
  behavior change — not filed as an issue.
- The web's `RECONCILE_FILTERS` (dropping selections absent from a newly loaded
  year) has no iOS equivalent. Explicitly ruled out for this branch by the
  branch owner — closed decision, not deferred work.

## 6. Release note — iOS 18 floor

The deployment target moved from iOS 17.0 to 18.0 so `onScrollGeometryChange`
could replace a `GeometryReader`/`PreferenceKey` sentinel that is structurally
broken inside a `List` (rows recycle, so the sentinel stops reporting). Version
1.0 is in App Store review at a 17.0 floor, so shipping this strands iOS 17
devices on 1.0. This belongs in the release notes and in
`docs/app-store/RELEASE_CHECKLIST.md` rather than being discovered from an App
Store Connect diff.
