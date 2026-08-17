# Web — reaching the filters after you have scrolled — design

**Status:** designed 2026-08-16, to be implemented inside PR #238 (phase 3a). The
user will not merge phase 3a without it.

**Date:** 2026-08-16

---

## Problem

The day rail is sticky; the filter block above it is not. Once you have scrolled,
the search field and every filter control are unreachable without scrolling back
to the top of the list.

Measured on a 390×844 iPhone viewport: after choosing **All Season** and browsing
a normal amount, the reader is **9,528px — 11.3 full screens** above the filter
block, and the distance **grows without bound**, because the list auto-expands
forward as you scroll.

The rail makes it sharper still. Tapping the last chip of the season teleports
you to the end of August instantly, so the scroll-back is not merely long, it is
arbitrary — a dead end the rail itself creates.

This is the initiative's own thesis turned on the new UI: *date was modelled as a
filter, and filters are walls.* Phase 3a removed the wall at the edge of the date
window and left one at the edge of the viewport.

**D4 priced the rail's vertical cost against the controls it replaced, and did
not price this.** That is the gap this design closes.

## Decision

**A Filters toggle on the sticky rail that reveals the existing filter block in
place**, over the list, without moving the reader's scroll position.

Rejected, with reasons:

- **Jump-to-top button.** One tap, almost no risk — but it throws away the
  reader's position, and the reader's position is exactly what is expensive to
  regain in a list that can be tens of thousands of pixels tall. It converts a
  long manual scroll into a long scroll back.
- **Bottom sheet.** Converges with the iOS app's bottom filter bar and suits a
  thumb, but it is the largest change to the web layout and the least like the
  page it lands in. Worth revisiting if the web ever adopts bottom chrome
  generally; not worth introducing that divergence for this one problem.

## Shape

One sticky container wraps **the existing filter card and the rail, in that
order**. Nothing is duplicated: there is exactly one instance of the search
field and of every filter control, and it is the one already on the page.

| Reader state | Filter card | Rail | Toggle |
|---|---|---|---|
| At the top of the page | visible, in flow | visible below it | hidden — the controls are already there |
| Scrolled, panel closed | hidden | stuck at viewport top | shown |
| Scrolled, panel open | visible, overlaying the list | stuck below the panel | shown, expanded |

Opening the panel pushes the rail down rather than covering it. That is
deliberate: it preserves D4's "coarse above fine" ordering, it keeps the whole
control cluster in the same relative arrangement the reader already knows from
the top of the page, and it matches the reader's own description of the fix —
the header *pulls down*.

## Requirements

1. **Scroll position never changes** when the panel opens or closes. That is the
   whole point; a design that scrolls has not solved the problem.
2. **No duplicated controls.** Two live copies of the search field would mean two
   elements with the same accessible name, and a second set of controls whose
   state can drift. The single instance moves between in-flow and revealed by
   visibility alone.
3. **The panel must scroll internally.** On a 390×844 phone the filter block —
   search, four scopes, a nine-week strip, venues, categories, active chips — can
   exceed the viewport. Cap the panel and let it scroll, or its bottom controls
   are unreachable, which would reproduce the bug being fixed one level down.
4. **The rail stays visible when the panel is open**, so the reader can always
   close it and always sees where they are.
5. **Closing is explicit** — the toggle, and `Escape`. It does **not** close on
   every filter change: choosing a venue, a category and a week is one intent,
   and a panel that vanished after the first pick would be worse than no panel.
6. **`--day-rail-h` continues to measure the rail alone**, not the container. Day
   headers and scroll targets clear the rail, which is the persistent chrome; an
   open panel is transient and is allowed to overlay them.
7. **Accessibility.** The toggle carries `aria-expanded` and `aria-controls`
   naming the panel. It is labelled by what it does, consistently with the rail's
   own rule that controls are named by their target. Focus moves into the panel
   on open and returns to the toggle on close, and `Escape` closes it.

## Out of scope

- Changing which controls exist, or their order within the filter block.
- Any bottom-anchored chrome on web.
- Making the filter block sticky in its own right at the top of the page — the
  container is sticky, the card inside it is revealed, and that is enough.
