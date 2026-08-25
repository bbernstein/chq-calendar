# The day rail on a narrow phone

**Status:** Design approved in chat 2026-08-25. Not yet implemented.
**Scope:** Bounded — `DayRail.tsx` plus the browser checks that guard it. No spec doc.
**Origin:** User report with an iPhone 13 mini (375pt) screenshot: the day strip
was down to one full chip and two slivers.

---

## The measurement

The rail is `flex items-center gap-1 px-1`. At a 375pt viewport its width goes:

| Element | Width |
|---|---|
| root `px-1` + five 4px gaps | 28px |
| `‹` and `›` chevrons (`min-w-11` each) | 88px |
| `⟳ Now` — `min-h-11` but **no** `min-w-11`, so text-sized | ~60px |
| week chooser (`min-w-11`) | 44px |
| Filters funnel (`min-w-11`) | 44px |
| **remaining for the day strip** | **~111px** |

A chip is 44px (`min-w-11`) plus a 4px gap, so the strip holds **2.3 chips**.
That matches the reported screenshot exactly. The strip has stopped being a strip.

`⟳ Now` is the only control on the rail that is not square, because it renders
text rather than an icon — the anomaly the user spotted.

## What was decided

1. **`⟳ Now` becomes icon-only**, 44×44, matching the chooser and the funnel.
   The accessible name (`"Go to today"`) does not change: the glyph is
   `aria-hidden` and the button keeps its explicit `aria-label`, the same
   contract `FiltersIcon` and `WeekChooserIcon` already follow.
2. **Both chevrons are removed**, along with the `prevDay` / `nextDay` props,
   the `onStepDay` callback, and `page.tsx`'s `stepTargets` plumbing that feeds
   them.

Result at 375pt: ~215px of strip, about **4.5 chips** — and roughly 5.5 once
phase 3 of #274 moves the Filters toggle into the site header.

## What removing the chevrons costs, stated plainly

The chevrons are not a duplicate of swiping. Swiping scrolls the strip without
moving the anchor; tapping a chip moves it. The chevrons did the one thing
neither does: **hop to the nearest day that has events, skipping empty ones.**
An empty chip is `aria-disabled` and deliberately does nothing when tapped.

- **Unfiltered, in season** (~1,470 events over ~64 days) nearly every day has
  something, so a chevron press was effectively "swipe one chip". Redundant.
- **Under a filter** — which is what this app is for — empty days become the
  norm. The `williamsburg` search used by browser check 18 leaves 8 of 9 weeks
  empty. There the chip row is mostly dashed-out chips, and the chevrons were
  the only fine-grained way to reach the next match.

The week chooser covers the coarse version of that hop: it lands on a week's
first day with events. What is genuinely lost is **day-to-day stepping within a
filtered stretch**. Accepted deliberately, on the grounds that floating the
chevrons over the strip's edges — the considered alternative — buys the function
back only by making an edge tap ambiguous between a chevron and the chip beneath
it, trading a clear loss for a muddy one.

## The guard that replaces the one being deleted

Browser checks `10a`–`10c` in `frontend/e2e/verify-rail.mjs` assert that two
chevrons exist and are labelled by target. They go with the chevrons.

**They are replaced by a check on the property that actually matters: at 375pt,
the day strip gets at least four chips' worth of the rail.** That guard would
have caught this crowding when the week chooser landed; `10a`'s "two chevrons
exist" never could, and never will again. Deleting a guard is only acceptable
when what replaces it is stronger, and the replacement has to be falsified by
re-adding a wide control and watching it fail.

Check `15a` ("every rail control meets the 44px minimum") is unaffected —
removing controls cannot break a minimum-size assertion, and the icon-only
`⟳ Now` gains `min-w-11`, which it did not have before.

## Sequencing

Lands on its own branch **stacked on #277** (phase 2, the week chooser), not
folded into it: #277 has been reviewed, and this touches rail chrome that phase
3a introduced rather than anything phase 2 added. It must not start while the
check-29 agent is still committing to that branch.

Phase 3 of #274 removes the Filters toggle from the rail independently. These
two changes compound and neither depends on the other.
