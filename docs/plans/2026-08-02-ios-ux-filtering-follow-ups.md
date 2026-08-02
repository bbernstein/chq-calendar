# iOS UX filtering — follow-ups

**Status:** Reference. Written 2026-08-02 as the branch `feat/ios-ux-filtering`
finished implementation and review.

Source material: `docs/superpowers/specs/2026-08-01-ios-ux-filtering-design.md`
(design) and `docs/superpowers/plans/2026-08-01-ios-ux-filtering.md` (plan).
This file exists because the working ledger that tracked these lived in
git-ignored scratch and does not survive the session.

## 1. Queued next initiative — which top rows are shown and hidden

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

## 3. Open verification — needs a physical device or an unlocked Mac

Automated drag synthesis works (CGEvents posted to the Simulator window), but
requires an unlocked screen; the machine locked mid-session. Outstanding:

- **The four flip-count scenarios** after the give-back change — specifically
  the short-content case. The question is "does it still collapse when it
  should," which is not answerable by reading.
- **The three search-keyboard dismissal triggers** (scroll / Return / chip tap)
  from the branch's Task 3. Never observed; verified by code reading only.
  Earlier rounds claimed touch synthesis was impossible here — that claim was
  false, so this is now cheaply checkable.

## 4. Smaller items, none blocking

- `FilterBarCollapseDriver.isSettling` is cleared by the collapse animation's
  completion handler, by a reset when the list is replaced, and on
  `scenePhase == .active`. A completion lost for any *other* reason while the
  view stays alive would still wedge collapse for the session. No watchdog timer
  was added; that omission is deliberate.
- `check-screenshots.py` false-positives its stuck-alert heuristic on
  `02-filters` — the venue chips read as an alert-shaped box. The shot is
  correct; the checker needs calibration. It is invoked only by the local
  capture script, never by CI.
- iPad's `01-season` and `04-detail` screenshots share launch arguments
  (predates this branch) and have once produced byte-identical images. A
  distinct UI-test hook would fix it.
- `docs/app-store/screenshots.manifest.json`'s `appCommit` records the commit at
  capture time, which can predate a fix captured in the same pass. Traceability
  only.
- `ios/README.md` does not mention two local prerequisites discovered while
  regenerating screenshots: Pillow, and that system bash 3.2 shadows the
  Homebrew bash the capture script needs.
- Four near-identical capsule chip styles across `FilterChip`, `WeekChip`,
  `FacetChip`, and `ResetFilterRow`. A shared `ChipStyle` would remove ~40 lines
  and reconcile inconsistent horizontal padding (12 vs 14).
- The week strip's auto-scroll fires once per view lifetime, so switching to a
  *cached* year and back does not re-scroll to the current week while switching
  to an *uncached* year does — the same gesture behaves two ways.
- `extraDays` is not reset by `selectScope`, so "Show next day" ×3 then a scope
  change leaves the window wider than fresh. Pre-existing.
- The web's `RECONCILE_FILTERS` (dropping selections absent from a newly loaded
  year) has no iOS equivalent. Explicitly ruled out for this branch.

## 5. Release note — iOS 18 floor

The deployment target moved from iOS 17.0 to 18.0 so `onScrollGeometryChange`
could replace a `GeometryReader`/`PreferenceKey` sentinel that is structurally
broken inside a `List` (rows recycle, so the sentinel stops reporting). Version
1.0 is in App Store review at a 17.0 floor, so shipping this strands iOS 17
devices on 1.0. This belongs in the release notes and in
`docs/app-store/RELEASE_CHECKLIST.md` rather than being discovered from an App
Store Connect diff.
