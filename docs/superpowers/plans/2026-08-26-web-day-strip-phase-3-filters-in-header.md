# Web day strip, phase 3 — Filters in the site header Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Every task ends with a falsification step: break the code
> the task just wrote and watch the new guard fail.

**Goal:** Move the Filters toggle off the day rail and into the site header, and
make the filter panel a **fixed overlay that is never in flow, in either state**.
Every control left on the rail then navigates, which is the whole point of #274.

**Architecture:** The panel stops being an in-flow card that the sticky header
parks above the viewport, and becomes a `position: fixed` sheet hanging off the
bottom edge of the site header — attached to it not by DOM parentage but by
reading the same `--site-header-offset` the header's own `top` reads, so the two
hold the same offset on every frame of the reveal. Because the panel never
enters flow, opening and closing it cannot change document height, which deletes
the entire apparatus built to survive that: the height measurement, the parking
offset, the `inert` treatment for a parked card, the sentinel, the exit-rect
freeze, and the scroll correction that compensated for the height change.

**Tech Stack:** Vite 7 + Preact 10 + TypeScript 5 + Tailwind CSS 4, Vitest for
unit tests, Playwright (`frontend/e2e/*.mjs`) for browser verification.

**Spec:** `docs/superpowers/specs/2026-08-25-web-day-strip-date-navigation-design.md`
— read "Phase 3 — Filters in the site header, panel as a fixed overlay", plus
"Testing" and "Falsification".

**Issue:** #274.

**Branch:** `feat/274-filters-in-header`, cut from `main` (phases 1 and 2 are
merged: `d75e1a1`, `0e854fe`, plus the narrow-phone rail fix `1db86b2`). Never
commit to `main`.

---

## Global Constraints

- **The invariant this phase exists to establish: the filter panel is never in
  flow.** It must be stated in code, in `filterHeaderLayout.ts`'s doc comment,
  not left as an implementation detail. A future change that makes it in-flow
  "just at the top of the page" reintroduces the exact toggle that made the page
  unscrollable — see that file for the measured failure (40 slow wheel ticks,
  2400px requested, 0px travelled, in both Chromium and WebKit).
- **`dateFilter` and `selectedWeeks` are NOT touched.** `DateFilter`,
  `WeekSelector`, `useFilterState` all stay exactly as they are. They go in
  phase 4.
- **Checks 30 and 31 in `verify-filter-reveal.mjs` ("slow scrolling actually
  advances the page", "never snaps the reader backwards") must survive this
  phase unchanged and still pass.** They are the regression guard for the
  original bug. A phase that deletes the parking machinery and also deletes the
  checks proving the parking was not needed has proved nothing.
- The rail keeps its own `data-day-rail` root as the sticky element. Do **not**
  wrap it in a positioning `<div>`: in #238 a wrapper sized to fit only the rail
  became its containing block and gave `position: sticky` zero travel, and
  eleven green task reviews missed it.

## What this phase deletes

Enumerated by the spec, plus one the spec does not name:

| Deleted | Why it existed |
|---|---|
| `useFilterCardHeight` + `--filter-card-h` + its test | measured how far the header had to ride up to park the card |
| `filterHeaderTop`, `PARKED_TOP` | the parking offset itself |
| `filterCardParked` | made the parked (still in-flow) card unreachable |
| `useScrolledPastFilters` + its test + the sentinel `<div>` | told the page the card had gone by |
| `useElementOutOfView` + its test | the card's own visibility, for `inert` |
| `filtersExitRect` / `filtersExitScrolledPast` / `filtersExitingVisible` | froze the rect for the in-flow → fixed switch |
| `DayRail`'s `filtersToggle` prop + `DayRailFiltersToggleProps` | the rail's funnel |
| `page.tsx`'s `data-filter-header` sticky wrapper | held card + rail together |
| **`useFilterPanel`'s scroll correction** (`captureScrollReference`, `pendingScrollCorrectionRef`, the `useLayoutEffect`, the `topmostVisibleDaySection` / `scrollWindowBy` imports) | **not in the spec's list.** It corrected for the panel's height entering and leaving flow. A panel that is never in flow changes no height, so the correction computes `0` on every path. A correction that is structurally always zero is worse than no correction: it reads as load-bearing. Guarded by browser check 6 ("opening does not move the reader"), which becomes a stronger claim rather than a weaker one. |

`scrollWindowBy` and `topmostVisibleDaySection` themselves stay — `EventList`
and `useDayAnchor` are their other callers.

## Decided before any code

1. **The panel renders from `page.tsx`, not inside `<header>`.** All the filter
   state lives in `page.tsx`; threading a SearchBar, four scopes, a nine-week
   strip, venues, categories and active chips through `Header`'s props to get
   DOM parentage buys nothing. Visual attachment comes from both elements
   reading `--site-header-offset`, which is stronger than nesting: the reveal
   animates that one registered property, so the header's bottom edge and the
   panel's top edge cannot drift apart mid-animation even by a frame.
2. **The panel overlays the rail rather than pushing it down.** The spec sizes
   the panel's cap "against the viewport below the revealed header", which puts
   its top at `var(--site-header-offset)` — the same coordinate the rail sticks
   at. Pushing the rail down instead would mean an open panel changes where the
   rail is, and the rail's height is what every day header and every scroll
   target is computed against (`dayHeaderTop`). An overlay changes nothing
   underneath it, which is the property that makes "never in flow" true for the
   whole page and not just for document height.
3. **The horizontal box mirrors `<main>` rather than measuring it.** A fixed
   `left-0 right-0` shell wrapping `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` —
   `<main>`'s own classes, copied — lands the panel on the content column at
   every breakpoint with no measurement and nothing to keep in sync.
4. **The exit becomes a plain CSS transition.** `.filter-panel-exit` already
   exists in `globals.css` and already does the right thing (compositor-only
   `transform`/`opacity`). On an element that was always fixed there is no rect
   to freeze, no `position` to switch, and no first-frame `display: none`
   problem — which is the entire reason `exitRect` and `exitScrolledPast` were
   invented. `exiting` itself stays: it is what keeps the element mounted for
   the ~200ms the transition runs.
5. **Z-order: header `z-40`, panel `z-30`, rail `z-20`, day headers `z-10`.**
   The rail's existing `z-20` is left alone. It previously sat inside the
   `z-30` container's stacking context; now it competes directly in `<main>`,
   where `z-20` still outranks the day headers it must cover.

---

## File Structure

```
frontend/src/
├── app/
│   ├── filterHeaderLayout.ts        MODIFIED  — invariant doc; delete parking, add panel geometry
│   ├── globals.css                  MODIFIED  — .filter-panel-exit doc; no --filter-card-h
│   └── page.tsx                     MODIFIED  — panel becomes a fixed overlay; toggle moves to Header
├── components/
│   ├── calendar/DayRail.tsx         MODIFIED  — filtersToggle deleted; sticky at the header offset
│   ├── filters/FilterPanelCaret.tsx MODIFIED  — doc only (now unconditional)
│   └── layout/Header.tsx            MODIFIED  — renders the funnel; holds revealed while open
├── hooks/
│   ├── useFilterCardHeight.ts       DELETED
│   ├── useScrolledPastFilters.ts    DELETED
│   ├── useElementOutOfView.ts       DELETED
│   ├── useFilterPanel.ts            MODIFIED  — loses scrolledPast, exitRect, scroll correction
│   └── useSiteHeaderReveal.ts       MODIFIED  — gains holdRevealed
└── __tests__/
    ├── app/filterHeaderLayout.test.ts        MODIFIED
    ├── app/siteHeaderStyles.test.ts          MODIFIED
    ├── components/calendar/DayRail.test.tsx  MODIFIED
    ├── components/layout/Header.test.tsx     NEW
    ├── hooks/useElementOutOfView.test.ts     DELETED
    ├── hooks/useFilterCardHeight.test.ts     DELETED
    ├── hooks/useScrolledPastFilters.test.ts  DELETED
    ├── hooks/useFilterPanel.test.tsx         MODIFIED
    ├── hooks/useSiteHeaderReveal.test.ts     MODIFIED
    └── integration/filterHeader.test.tsx     MODIFIED

frontend/e2e/
├── verify-filter-reveal.mjs   MODIFIED  — toggle moves; parked-card checks replaced
├── verify-header-reveal.mjs   MODIFIED  — toggle moves; open panel holds the header
└── verify-rail.mjs            MODIFIED  — the funnel is no longer a rail control
```

---

## Task 1: `filterHeaderLayout.ts` — state the invariant, delete the parking

- [ ] Rewrite the file's top doc comment. It currently explains why the card is
      *parked rather than hidden*. That question is gone; what replaces it is the
      invariant, and the measured failure has to be **kept**, because it is the
      reason the invariant exists. Structure: the panel is never in flow, in
      either state → here is what happened the one time something above the
      reader changed height → note that a fixed panel makes the failure
      unreachable by construction rather than by choreography.
- [ ] Delete `PARKED_TOP`, `filterHeaderTop`, `filterCardParked`.
- [ ] Keep `siteHeaderTop` and `dayHeaderTop` byte-identical.
- [ ] Add `filterPanelTop()` → `SITE_HEADER_OFFSET`. It is one token today, and
      that is exactly why it is a function: it names the coupling ("the panel's
      top edge IS the header's bottom edge") in the one place the header's own
      `top` is also written, so the two cannot be changed apart.
- [ ] Add `filterPanelMaxHeight()` → `calc(100dvh - ${SITE_HEADER_OFFSET} - 1rem)`.
      `dvh`, not `vh`: on a phone `vh` is the *largest* viewport, so a panel
      capped in `vh` extends under the browser's own bottom chrome and its last
      control is unreachable — which is the bug this cap exists to prevent, one
      unit off.
- [ ] Update `src/__tests__/app/filterHeaderLayout.test.ts`: delete the
      `filterHeaderTop` / `filterCardParked` describes, keep `siteHeaderTop` and
      `dayHeaderTop`, add cases for the two new functions asserting both include
      `--site-header-offset` and both carry the `0px` fallback.

**Falsify:** change `filterPanelMaxHeight` to use `vh`, confirm the new test
fails; change `filterPanelTop` to a literal `0px`, confirm the new test fails.

## Task 2: `useSiteHeaderReveal` gains `holdRevealed`

- [ ] Signature becomes `useSiteHeaderReveal({ holdRevealed = false } = {})`.
- [ ] A `heldRef` mirrors it, read inside `decide()` — the listeners are
      captured once, on first render, so a prop read directly would be stale.
- [ ] `decide()` returns early **after** updating `stateRef` when held. Reason:
      the baseline must keep tracking `scrollY` while the reader scrolls with
      the panel open, otherwise releasing the hold hands `nextHeaderReveal` a
      baseline from wherever the page was when the panel opened, and the first
      gesture after closing is measured against a stale position. Use
      `resyncHeaderReveal(prev, window.scrollY)`, which is exactly the "move the
      baseline, decide nothing" operation.
- [ ] An effect on `holdRevealed`: when it turns true and the header is hidden,
      set `revealed` true, `revealedRef` true, `publish(true)`, and resync the
      baseline. When it turns false, do **nothing** — the header stays revealed
      until the reader's next downward gesture. That is the release the spec
      describes ("the hold is released by the panel closing"), and it is also
      the only behaviour that does not move chrome the reader did not ask to
      move.
- [ ] `Header` passes `holdRevealed={filtersOpen}`, so the prop arrives from
      `page.tsx` through `Header`'s own new `filtersToggle` prop.
- [ ] Tests in `useSiteHeaderReveal.test.ts`: (a) a downward gesture that would
      hide the header does not hide it while held; (b) the offset property is
      republished to the shown value when the hold begins on a hidden header;
      (c) after the hold is released, a downward gesture hides it again — this
      is the one that fails if the baseline is not resynced during the hold.

**Falsify:** remove the `heldRef` check from `decide()`; test (a) must fail.
Remove the resync inside the held branch; test (c) must fail.

## Task 3: `Header` renders the funnel

- [ ] `HeaderProps` gains an optional `filtersToggle?: HeaderFiltersToggleProps`
      — `{ open, onToggle, panelId, toggleRef, hasActiveFilters }`. Optional
      because `Header`'s contract should not require a filter panel; `page.tsx`
      is its only caller today and that is not a reason to hard-wire it.
- [ ] **No `visible` field.** The rail's toggle had one (`scrolledPast`); the
      header's funnel is unconditional. That is the reachability change: the
      header returns on any upward flick, so the funnel is one gesture from
      anywhere.
- [ ] Render it inside a new wrapper `<div className="flex items-center gap-2">`
      that also contains the existing `header-desktop` and `header-mobile`
      divs, so the outer `justify-between` keeps exactly two children and the
      funnel renders once at every breakpoint rather than twice.
- [ ] Copy the button's `aria-label="Filters"`, `aria-expanded`,
      `aria-controls`, `ref` and `min-h-11 min-w-11` treatment from `DayRail`'s
      current markup verbatim. The accessible name must not change — screen
      reader users have learned this control.
- [ ] `useSiteHeaderReveal({ holdRevealed: filtersToggle?.open ?? false })`.
- [ ] New `src/__tests__/components/layout/Header.test.tsx`: the funnel renders
      with accessible name "Filters"; `aria-expanded` tracks `open`;
      `aria-controls` is the given `panelId`; the active dot paints only when
      `hasActiveFilters`; clicking calls `onToggle`; and **`Header` renders
      without a `filtersToggle` prop at all** (the optionality is real, not
      decorative).

**Falsify:** let `FiltersIcon`'s SVG lose its `aria-hidden` and confirm the
accessible-name test fails — that is the assertion protecting the name.

## Task 4: `useFilterPanel` sheds the in-flow apparatus

- [ ] Delete the `{ scrolledPast }` parameter; the hook takes no arguments.
- [ ] Delete `exitRect`, `exitScrolledPast` and their setters from state and
      from the return type. `beginExit` becomes: reduced-motion (or no panel
      element) → `setOpen(false)`; otherwise `setExiting(true); setOpen(false)`.
- [ ] Delete `captureScrollReference`, `pendingScrollCorrectionRef`, the
      `useLayoutEffect` that corrected scroll, and the now-unused
      `topmostVisibleDaySection` / `scrollWindowBy` / `useLayoutEffect` imports.
- [ ] Keep, unchanged: `toggle`, `closeViaEscape`, `closeViaGesture`,
      `returnFocusIfStranded`, `isExempt` (including the `Home`-on-a-chip
      exemption), `useDismissOnScrollGesture`, the focus-into-panel effect, the
      Escape listener, and the whole `transitionend` + `EXIT_FALLBACK_MS`
      cleanup effect. Note the fallback timer is **not** redundant now: it
      exists for an element that is never painted (a background tab), which has
      nothing to do with flow.
- [ ] Rewrite the hook's doc: the "Scroll preservation" section goes, replaced
      by two paragraphs — why there is nothing to preserve (the panel is never
      in flow; see `filterHeaderLayout.ts`), and the record of what the deleted
      code was for, so nobody re-derives the need for it from first principles
      and adds it back. The "Exit animation" section shrinks to "the element
      was always fixed, so the exit is a class".
- [ ] Update `useFilterPanel.test.tsx`: delete the `scrollBy`-delta tests and
      the `exitRect` tests; keep every focus, Escape, gesture-dismiss,
      double-dismiss and fallback-timer test. Add one asserting `scrollWindowBy`
      is **never** called on any open or close path — the deletion's own guard,
      so a re-added correction fails a test instead of passing silently.

**Falsify:** re-add a `scrollWindowBy(0)` call on the open path; the new test
must fail.

## Task 5: `page.tsx` — the panel becomes a fixed overlay

- [ ] Delete the `useScrolledPastFilters`, `useFilterCardHeight`,
      `useElementOutOfView` imports and calls, the `filtersExitingVisible` /
      `filtersPanelOverlaying` / `filtersCardBeyondReach` derivations, the
      merged `filtersCardRef` callback (it becomes plain `filtersPanelRef`), and
      the sentinel `<div ref={filtersSentinelRef}>`.
- [ ] Delete the `data-filter-header` sticky wrapper. `DayRail` and the panel
      become siblings directly under `<main>`.
- [ ] Render the panel **before** the rail in source order (it paints over it
      anyway via `z-30`, but source order matching visual order is what a
      screen-reader user walks).
- [ ] Shell: `<div data-filter-overlay className="fixed left-0 right-0 z-30 px-4 sm:px-6 lg:px-8" style={{ top: filterPanelTop() }} hidden={!filtersOpen && !filtersExiting}>`,
      inner `<div className="max-w-7xl mx-auto">`, then the panel card carrying
      `id={filtersPanelId}`, `data-filter-card`, `ref={filtersPanelRef}`,
      `shadow-lg`, `overflow-y-auto`, `style={{ maxHeight: filterPanelMaxHeight() }}`,
      and `className={filtersExiting ? 'filter-panel-exit' : ''}`.
- [ ] `aria-hidden` + `inert` while `filtersExiting` — a panel mid-exit is
      decorative. Closed needs neither: `hidden` gives `display: none`, which
      takes it out of the tab order and the accessibility tree for free. That
      is now safe **precisely because** it was never in flow.
- [ ] `shadow-lg` and the height cap become unconditional, and
      `<FilterPanelCaret>` becomes unconditional — the panel is always an
      overlay now, so the three things that were conditional on
      `filtersPanelOverlaying` have no other state to be in.
- [ ] Pass `filtersToggle` to `<Header>` (dropping `visible`), and delete the
      `filtersToggle` prop from `<DayRail>`. Keep `hasActiveFilters:
      filters.hasNonDefaultFilters` and its comment verbatim — `hasFilters` is
      true on a default visit and would light the dot for everyone.

## Task 6: `DayRail` loses the funnel and becomes the sticky element

- [ ] Delete `DayRailFiltersToggleProps`, the `filtersToggle` prop, its doc
      block, the toggle's JSX, and the `FiltersIcon` import.
- [ ] Root className `sticky top-0 z-20 …` becomes `sticky z-20 …` with
      `style={{ top: filterPanelTop() }}` — the rail sticks at the header's
      bottom edge, which is what the deleted wrapper used to do for it.
- [ ] Add a `NOTE:` comment on the root recording that `<main>` is the
      containing block and that a wrapper `<div>` here re-breaks #238's sticky.
- [ ] `DayRail.test.tsx`: delete the toggle tests; keep the
      `button:not([data-chip]):not([data-week-band-button])` count assertion and
      **lower its expected count by one**, rather than letting the funnel's
      removal be absorbed into a looser number. Add an assertion that no control
      inside the rail has accessible name "Filters".

**Falsify:** re-add a stray button to the rail root; the count assertion must
fail.

## Task 7: CSS and the invariant's stylesheet half

- [ ] Delete `--filter-card-h` from `globals.css` if it is declared there.
- [ ] Update `.filter-panel-exit`'s doc comment: it no longer says the panel "is
      moved out of flow before this runs" — it never was in flow.
- [ ] `siteHeaderStyles.test.ts`: keep the `@property` and reduced-motion
      brace-counting checks as they are; add one asserting `globals.css` no
      longer references `--filter-card-h`, so the variable cannot be
      resurrected in CSS alone.

## Task 8: browser verification — `verify-filter-reveal.mjs`

- [ ] Retarget `toggle`: `[data-site-header] button[aria-label="Filters"]`.
      **Not** `button[aria-expanded]` — the week chooser's trigger also carries
      `aria-expanded`, and that exact selector collision broke both e2e suites
      in phase 2 (fixed in `171c348`). Same lesson, one surface along.
- [ ] Checks 1–3 change meaning and must be **rewritten, not repointed**: there
      is no longer a search field at page top. Replace with: "1 the filters
      funnel is present in the header at page top", "2 no filter card is in flow
      at page top", "3 the funnel is still present after the rail teleports".
- [ ] Delete checks 32, 33, 34 (parked card in flow / out of reach / parked
      above the viewport). Nothing is parked.
- [ ] **Keep 30 and 31 verbatim** (slow scrolling advances; never snaps
      backwards). See Global Constraints.
- [ ] Add the invariant's own guard — the strongest check in this phase:
      **`document.documentElement.scrollHeight` is identical with the panel
      open and closed**, sampled at a scroll position well into the list. This
      is what "never in flow" means operationally, and it is the check that
      would have caught the original bug directly rather than through its
      symptom.
- [ ] Add: an open panel holds the site header revealed (header `top` is `0`
      after a downward wheel with the panel open), and a wheel dismissal then
      lets the header hide again on the next downward gesture.
- [ ] Re-verify check 26 (no horizontal overflow at 390px) against the new
      fixed shell — `left-0 right-0` plus `px-4` is where an overlay most easily
      goes one padding wider than the column it is imitating.

## Task 9: browser verification — `verify-header-reveal.mjs` and `verify-rail.mjs`

- [ ] `verify-header-reveal.mjs`: retarget the Filters locator the same way.
      Its existing checks now exercise a toggle that lives in the surface under
      test, so read each one and confirm it still asserts what its name says.
- [ ] `verify-rail.mjs`: the funnel is no longer a rail control. Update check
      15a's control inventory, and **re-measure the 375pt day-strip check** —
      the strip should now hold roughly 5.5 chips rather than 4.06, and that
      check's threshold should rise to match. A threshold left at the old value
      is a guard that has stopped guarding.

## Task 10: full verification, docs, PR

- [ ] `cd frontend && npm run build` (validate + unit suite + bundle).
- [ ] `npm run validate --workspace=backend` — unchanged by this phase, run it
      anyway; the checklist is the checklist.
- [ ] All five `test:browser` suites, against the local dev server **and** once
      against production for the suites that support `URL=`.
- [ ] Re-read the spec's phase 3 section and confirm every bullet is either done
      or recorded as a deliberate deviation in an addendum, the way phase 2
      recorded the `WeekSelector` decision.
- [ ] Update `docs/superpowers/specs/…-design.md` phase 4's opening note if
      anything here changes its premises (in particular: the off-season landing
      still shows only because `dateFilter: 'next'` yields an empty list — phase
      3 does not change that, and phase 4 still owns it).
- [ ] Open the PR against `main`. Never merge without the user's say-so.

---

## Self-Review — the traps this phase is most likely to fall into

1. **Deleting a guard and its subject together.** Checks 30/31 exist to prove
   the scroll-anchoring bug is gone. Deleting the parking machinery is only
   safe if those checks still run and still pass.
2. **A wrapper around the rail.** #238's sticky-zero-travel bug, one careless
   `<div>` away, and invisible to every unit test.
3. **`aria-expanded` as a selector.** Broke both e2e suites in phase 2. The
   week chooser still carries it.
4. **A test absorbing a removed control into a smaller count.** Phase 1's
   lesson, running in reverse this time: exclude by attribute, assert the
   number.
5. **`vh` instead of `dvh`** in the panel cap — reproduces the unreachable
   bottom control the cap exists to prevent.
6. **Assuming jsdom can see any of this.** No layout, no stylesheet: the fixed
   positioning, the height cap, the overlay's width and the document-height
   invariant are all browser-pass properties. The unit suite pins the
   mechanism; the browser pass is the only thing that tests the seams.

---

## Addendum, 2026-08-26 — what the implementation changed about this plan

Five things came out differently from the plan above. All five were found by
running something, not by reading.

### 1. The positioned element must be the one `aria-controls` names

The plan's Task 5 put `position: fixed` on an outer shell and the panel's `id`
on the white card inside it. That satisfies the invariant — the card is out of
flow because its ancestor is — but it makes the invariant **unobservable**:
every check that resolves the panel the way the accessibility tree does
(`aria-controls` → `getElementById`) read `position: static` and could not see
it. Three browser checks failed against correct code, and the "always fixed"
trace in checks 28/29 read `alwaysFixed=false`.

Fixed by collapsing the two: one element carries the `id`, the `panelRef`, the
positioning, the `hidden`, the `inert` and the exit class. The `max-w-7xl
mx-auto` centring and the white card are plain children.

**The general form:** an invariant that must be checkable has to hold on the
element the checker can find. No unit test could have caught this — jsdom
computes no `position`.

### 2. Deleting the scroll correction was right, and its guard needed teeth

The extra deletion the plan proposed (beyond the spec's list) was correct: the
panel changes no layout, so the correction computed zero. What the plan did not
say is that a "never calls `scrollBy`" test is worthless on a fixture where
nothing moves. The tests keep `mockDaySectionTrackingPanel` — a day section
rigged to shift 281px with the panel's open/hidden class — as an **adversarial**
fixture: it models a world that no longer exists, which is exactly what makes it
a guard, because it is the input under which the old code demonstrably
corrected.

### 3. Three falsifications passed, and each exposed a weak test

- **`useSiteHeaderReveal`'s baseline-during-hold test.** The first version had
  the reader scroll *down* while held, which leaves a stale baseline *above*
  them — so the next downward gesture measures a large positive delta and hides
  the header either way. It had to be scrolling *up* while held, which strands
  the baseline *below* the reader and pins the header open against the very
  gesture asking it to go.
- **The Filters toggle's accessible name, twice.** `FiltersIcon`'s `aria-hidden`
  does not protect the name — an explicit `aria-label` outranks the button's
  contents entirely. Nor does the `aria-label` alone: `title="Filters"` is the
  last resort in the accessible-name computation and silently takes over. The
  honest claim is that the name survives unless *both* are dropped.

### 4. Two browser checks were measuring the harness, not the app

- **The reachability check could not be run after the rail teleport.** The
  teleport leaves `useDayAnchor`'s hold pinning the anchored day, so a
  `window.scrollTo` into the middle of the list is undone and the reader stays
  at the document's end — where a downward wheel scrolls nothing, `scrollY`
  never changes, and the reveal rule is right to decide nothing. Probed
  directly: five 200px wheels, `scrollY` 7573 every time. It now has its own
  page, and asserts its precondition (the header actually left) rather than
  assuming it.
- **The document-height check was measuring its own setup.** `revealHeader` is
  a real wheel gesture, and a wheel moves the reader — which can grow the render
  window. Measuring the closed baseline across it reported a 27px change against
  code whose panel changes nothing (probed: 7417px in all three states). The
  baseline is now taken after the reveal, so the only thing varying between the
  two measurements is the panel.

### 5. The narrow-phone threshold moved, and one diagnostic became a guard

`verify-rail`'s check 10 measured 191px of day strip (4.06 chips) at 375pt
before this phase and 239px (5.06) after — the funnel's 44px plus a 4px gutter.
The threshold is raised 4 → 5, because a threshold left at 4 would pass with the
funnel put straight back. `filtersVisible` was a diagnostic in the detail
string; it is now asserted, since where that control lives is a claim this phase
makes.

Falsified by adding a 44px control back to the rail: 239 → 191px, 5.06 → 4.06
chips, exactly the state the original bug report described.

### What did not change

Checks 30 and 31 ("slow scrolling actually advances the page", "never snaps the
reader backwards") survive verbatim and pass. The invariant check that replaces
32–34 was falsified by making the panel `relative`: document height 7417 →
7730px and the reader moved 313px — the original bug's mechanism, reproduced on
demand.

### Results

- Unit: 1454 passed / 104 files.
- Browser: 150 checks across five suites, **0 failed, 0 skipped**. Check 14 in
  `verify-header-reveal` had been skipping ("no Filters toggle on the rail") and
  now runs.
