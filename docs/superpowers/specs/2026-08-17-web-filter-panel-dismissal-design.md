# Web — how the filter panel opens and leaves — design

**Status:** designed 2026-08-17, not implemented. **Supersedes the interaction
half of `2026-08-16-web-filter-reveal-design.md`** — that document's problem
statement and its decision to reveal the filter block in place both stand; its
model of a panel that persists until explicitly dismissed does not.

**Date:** 2026-08-17

---

## Problem

The filter panel shipped in PR #238 solves reachability — the reader can get to
the filters from anywhere in the list — and creates an affordance mismatch.

Tested on a phone: **the panel looks exactly like the page header**, so readers
carry over the page header's semantics and expect scrolling the results to move
it out of the way. It does not move. The experience is unexpected in the precise
sense that matters: the interface makes a promise its behaviour breaks.

Three specific things cause the misread, all visible at 390×844:

1. **No overlay signals.** It is a plain white card with no shadow, no scrim and
   no distinct edge — visually identical to page chrome, so nothing marks it as
   floating above the list.
2. **It appears above the control that summoned it.** The Filters button sits on
   the rail *below* the panel, so the trigger looks like it is being pushed down
   by unrelated header rather than having opened something.
3. **It occupies about 63% of the viewport** (~530px of 844), with a half-cut
   event row visible beneath it — which reads as "more header was inserted", not
   "something opened".

The fix chosen here resolves the mismatch in the direction of the reader's
expectation: **make the panel behave the way it already looks.**

## Decisions

### D1 — The panel leaves when the reader scrolls

Scrolling the results dismisses it, exactly as scrolling dismisses the page
header at the top of the list.

Rejected: **keeping it until explicitly dismissed** (what ships today), which
would require teaching the panel to look unlike a header — a scrim, a grab
handle, a dimmed list — introducing a modal visual language the app does not
otherwise use, to defend a behaviour the reader did not ask for. Also rejected:
**auto-hide on scroll-down, restore on scroll-up**, the pattern mobile browser
toolbars use. It reclaims screen elegantly but is the fiddliest to get right, and
scroll-driven behaviour on this surface has already produced several defects that
only a browser could find.

### D2 — Any scroll gesture dismisses it, not scrolling past it

The first flick removes it. The reader does not scroll through ~530px of filter
block to reach results.

**Any direction, not only downward.** The decision was framed as "a downward
scroll dismisses it", because that is the motion a reader makes to get back to
results. Restricting it to downward was considered and rejected: the panel sits
at the top of the viewport with earlier events above it, so an upward flick is
still the reader scrolling the results, and a panel that survived it would
reintroduce the same "why is this still here" surprise in the opposite
direction. Direction-blind is also the simpler rule to hold in your head, and the
simpler one to test.

Rejected: leaving it in flow to be scrolled over like ordinary content. That is
the most literally header-like option and the simplest to build, but it charges
about three phone-screens of scrolling every time the panel is opened.

### D3 — Once gone, only the Filters control brings it back

Scrolling back up shows results, not the panel. The panel is never left embedded
in the document thousands of pixels down the list.

Rejected: leaving it in the document so scrolling up re-reveals it. That is the
truest analogue of a page header, and it is worse here: the panel would reappear
whenever the reader scrolled up to re-read an earlier event, which is its own
surprise.

### D4 — It still carries a small drawer affordance

A soft shadow at the bottom edge, and a centred downward caret that closes it on
tap. The panel keeps looking like the header it now behaves like; the caret adds
an honest close control that does not require scrolling, and the shadow says the
panel sits above the list.

### D5 — The toggle becomes an icon

A funnel icon replaces the word "Filters" on the rail, which is where horizontal
space is scarcest. The accessible name does not change.

## The model

| Reader state | Panel | Rail | Toggle |
|---|---|---|---|
| At the top of the page | the filter card, in flow | below it | hidden — the controls are already there |
| Scrolled, closed | **parked just above the viewport, still in flow** | stuck at viewport top | shown |
| Scrolled, open | in flow above the rail, pushing it down | stuck below the panel | shown, expanded |

**"Parked", not "absent" — corrected 2026-08-17 after the first
implementation shipped.** The panel was originally removed from flow
(`display: none`) once the reader scrolled past it, and that made the page
impossible to scroll slowly in any browser implementing scroll anchoring
(Chromium and WebKit both do): hiding it took ~290px of flow height from
above the reader, anchoring subtracted that from `scrollY`, `scrollY` clamped
at the top of the document, the sentinel came back into view and the panel
returned. Measured: 2400px of slow wheel input advanced the page 0px and
returned it to the top 20 times, on production as well as locally.

The root cause is geometric rather than a browser quirk — **a ~290px header
cannot collapse after 64px of scrolling**, because there is no room above the
reader to absorb it, so the collapse destroys its own precondition. The
header therefore rides up by exactly the card's measured height
(`--filter-card-h`) and pins there. Document height never changes, anchoring
has nothing to correct, and the card scrolls away under its own steam — which
is what "behave the way it looks" asked for in the first place. See
`frontend/src/app/filterHeaderLayout.ts`.

Two consequences follow and are not optional. A parked card is still in the
DOM and still in flow, so it must be `inert` or a keyboard reader Tabs into
it and the browser scrolls the page back to the top to show them the focused
control. And the sentinel must sit **below** the header rather than above it,
so that it moves with the height the exit animation temporarily removes.

Four things dismiss it: **a scroll gesture, the caret, the Filters toggle,
`Escape`.** Opening and closing both preserve the reader's position via the
existing reference-node correction — measure a day section's
`getBoundingClientRect().top`, re-measure after the DOM settles, `scrollBy` the
delta. Never save and restore a `scrollY` number; that invariant is wrong
whenever content above the reader changes height, which is exactly what happens
here.

## What counts as "scrolling"

**Dismissal keys off user gesture events — `wheel`, `touchstart`/`touchmove`,
scrollbar `mousedown`, and the navigation `keydown`s (arrows, page keys, space,
home/end) — and explicitly NOT the `scroll` event.** Two failure modes make this
non-negotiable, both already paid for on this branch:

- **Opening fires our own `scrollBy` correction**, which fires `scroll`. A
  `scroll` listener would dismiss the panel in the same frame it opened.
- **A filter change reflows the list** and can move `scrollY` on its own. A
  `scroll` listener would dismiss the panel the moment the reader ticked their
  first venue — contradicting the deliberate rule that a filter change does *not*
  close the panel, because choosing a venue, a category and a week is one intent.

A gesture whose target lies inside the panel is ignored, so scrolling the panel's
own overflow does not close it.

## Animation

**On dismiss the panel is removed from flow immediately**, so layout settles once
and the reference-node correction runs once. The ~200ms slide-and-fade then plays
on the same element re-rendered **out of flow** — positioned `fixed` at the
coordinates it occupied, animating **only `transform` and `opacity`**, and
unmounted when the transition ends.

Concretely: on dismiss, measure the panel's rect, switch it to
`position: fixed` at that rect, drop the in-flow placeholder in the same commit,
run the scroll correction, then transition. No DOM clone — the element moves
between layers, so the controls inside it are never duplicated.

That decoupling is the whole design of this piece. Animating `height` or
`max-height` would relayout a list of hundreds of event cards on every frame, and
would leave the scroll correction fighting a moving target continuously rather
than settling it once. Compositor-only animation avoids both.

`prefers-reduced-motion: reduce` skips the animation and removes the panel
outright.

## Tapping a day chip while the panel is open

A chip tap scrolls, so it dismisses the panel, and the day then lands below the
rail rather than under the drawer.

**This fires two scroll corrections in one commit** — the dismissal's, and the
day-navigation scroll — which is precisely the class of bug that cost this branch
a review round when `useDayAnchor`'s hold and `EventList`'s prepend settle both
called `scrollBy` on the same resize. **The two must be explicitly arbitrated:
the dismissal resolves first, then the day scroll runs against the settled
layout.** An implementation that lets both run unordered will land the reader in
neither place.

## The toggle

A funnel icon with `aria-label="Filters"`, keeping the existing `aria-expanded`
and `aria-controls`. Only the pixels change; the accessible name does not.

**A small dot on the icon when any filter is active.** An icon alone cannot tell
the reader whether they are looking at everything or at a slice, and the word it
replaces could not either — this is the one thing the change should add rather
than merely preserve.

## Accessibility

- The caret is a real control with `aria-label="Hide filters"` and a hit area of
  at least 44px, full panel width.
- Focus still moves into the panel on open and returns to the toggle on `Escape`.
- Dismissal by scroll must return focus to the toggle if focus was inside the
  panel when it left, or the reader is stranded on a detached element.
- The animation is decorative: it must not delay the panel's removal from the
  accessibility tree.

## Testing

**jsdom** pins the mechanisms: that dismissal listens for gesture events and not
`scroll`; that a gesture inside the panel is ignored; that a filter change does
not dismiss; that the dismissal and day-navigation corrections run in the stated
order; and that reduced-motion removes the panel without animating.

**Browser (Playwright, 390×844)** covers what jsdom cannot: dismissal on a real
wheel and on a real touch, the reader's day section stationary across dismissal,
that our own opening correction does not self-dismiss, the caret's hit area, and
that no frame paints the list in a shifted position.

The existing harnesses — `verify-rail.mjs` (35 checks) and
`verify-filter-reveal.mjs` (13) — both take a `URL`, so they run against a dev
server or production. The filter-reveal harness needs updating: its current
assertions encode the persist-until-dismissed model this design replaces.

## Out of scope

- Any change to which controls the filter block contains, or their order.
- Bottom-anchored chrome on web.
- Restoring the panel on scroll-up, in any form.
- Changing the rail, its chips, its chevrons or `⟳ Now`.
