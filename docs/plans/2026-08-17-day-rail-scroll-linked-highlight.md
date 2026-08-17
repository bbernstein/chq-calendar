# Day rail — scroll-linked highlight

**Status:** Approved design, not yet implemented.
**Branch:** `feat/web-rail-scroll-linked-highlight`
**Follows:** phase 3a (#238, #239, #240) — the day rail itself.

## The problem

The rail's highlight arrives in two discrete jumps that do not agree with
each other:

- `useDayAnchor` emits a **day key**. It flips the instant a section's top
  crosses the sticky line.
- `DayRail`'s effect fires on `[anchorDay]` and sets `strip.scrollLeft` to
  centre that chip — instantly. Meanwhile the `bg-blue-600` swap is a CSS
  `transition-colors`, so the colour crossfades on its own timer while the
  strip has already teleported.

Reported as: "the highlight changes to the other date and then moves to the
centre location."

## The mechanism to copy

The day-title replacement in the list is **scroll-linked, not time-linked**.
The headers are `position: sticky` at `top: var(--day-rail-h)`, so the
outgoing title is pushed up by the incoming one over exactly one
header-height of scroll. Nothing animates on a duration — position is a pure
function of scroll offset, which is why it tracks the reader's finger and
stops half-done when they stop.

The rail must be driven the same way: a **fractional** anchor, not a key.

## Decisions

| Decision | Choice | Rejected |
|---|---|---|
| Placement | Centre window, days slide through | Pill moves and pins near the edges |
| Partial state | True clip — the chip splits at the window edge | Per-chip crossfade; text flips at halfway |
| Ramp | `max(headerH, min(sectionH * 0.25, 200))` | Exactly the header height; the whole section |
| Drag | Drag peeks, tap commits | Release-to-commit; live scrub |

### Why the generous ramp

Matching the title handoff exactly (~36px) is 1:1 faithful but passes in
about two frames at flick speed, so it would still read as a jump. ~200px is
roughly 12 frames. The rail then leads the title slightly into the next day,
which reads as anticipation rather than desync. The `headerH` floor keeps a
one-event day working.

### Why the whole section is wrong

`f` would never rest at 0, so a crisp "you are here" state stops existing —
and halfway through Tuesday's events the window would sit halfway between
Tue and Wed, misreporting what the reader is looking at.

### Why live scrub is wrong

~48px of rail travel is one whole day section, which can be 3,000px of page.
A 60x amplification means a lazy thumb-flick on the rail throws the list a
week, and the content underneath is unreadable for the whole gesture.

## The core invariant

> `anchorDay` is derived from page scroll and nothing else. The rail only
> ever reads it.

Every commit goes page-scroll-first; the rail redraws as a consequence.
Reversing this for the drag gesture would give the value two owners and a
feedback loop (page scrolls -> `f` changes -> writes `scrollLeft` -> ...)
that needs a mode flag to break.

## Interaction model

| Gesture | Page | Rail `scrollLeft` | Pill |
|---|---|---|---|
| Scroll the list | moves | follows, keeping the pill centred | tracks `f`, glides day->day |
| Drag/wheel the rail sideways | **still** | reader owns it; sync suspended | stays glued to its day, drifts off-centre |
| Tap a chip | scrolls to that day | resumes, tweens ~220ms | eases to centre |
| `<` `>` / `Now` | scrolls | resumes, tweens | eases to centre |
| Scroll into a new day after a peek | moves | sync resumes here | re-centres |

Dragging a day into the centre does **not** make it current. The pill is not
a selector parked at the centre; it is attached to the day being read, and it
only *appears* centred because the rail auto-scrolls to keep it there. When
the reader takes hold of the rail, that auto-scroll suspends and the pill
travels with its chip — off-centre, and off-screen if they pan far enough.
That is honest: it says "the day you are reading is back that way."

Peeking is fully undoable, and every commit stays an explicit button
activation, so assistive technology still hears "Go to Saturday, July 4, 12
events" on every navigation. A release-to-commit drag announces nothing.

**Resume rule:** sync resumes when the anchor day actually *changes*, or on
any explicit commit. Snapping back to centre the instant the reader scrolls
one pixel would destroy the peek they just made; scrolling around within
today's events keeps it, scrolling into tomorrow re-centres.

**Suspension trigger:** `pointerdown` **and** `wheel` on the strip. A
trackpad two-finger horizontal pan fires no pointer event and would otherwise
be fought by the per-frame writes.

## Architecture

### The fraction never becomes React state

A fractional anchor in `useState` would re-render `page.tsx` — the whole app
— on every scroll frame. `useDayAnchor` keeps owning the *discrete*
`anchorDay` exactly as today (state, `aria-current`, `Now` visibility, the
settle hold — all untouched). The continuous value is computed in a rAF and
written straight to three DOM properties. Zero re-renders while scrolling.

### `lib/utils/railPosition.ts` (new, pure)

Layout-free, so it unit-tests without jsdom.

```
resolveAnchor(keys, limit)        -> { key, nextKey, nextTop }
rampDistance(sectionH, headerH)   -> max(headerH, min(sectionH * 0.25, 200))
dayProgress(nextTop, limit, ramp) -> f in [0,1]
stripScrollLeft(pillCentre, clientW, maxScroll) -> clamped
lerp(a, b, t)
```

`useDayAnchor`'s existing section walk is replaced by a call to
`resolveAnchor`. This is the one refactor folded in, and it is load-bearing:
the pill and `aria-current` must never name different days, and sharing the
walk makes that structurally impossible rather than a thing two copies happen
to agree on. `f` reaching 1 coincides exactly with `useDayAnchor`'s flip, so
the endpoints agree by construction.

### `hooks/useRailHighlight.ts` (new)

Owned by `DayRail` — no prop threading through `page.tsx`. Its own passive
rAF-throttled scroll listener. Chip geometry (`left`/`width` per index) is
measured in one pass and cached, recomputed only when the chip list or size
changes. Per frame it does reads-then-writes, never interleaved, so no layout
thrash.

### DOM

```
<div ref=strip class="overflow-x-auto">                              scroller
  <div class="relative flex gap-1 w-max">                            content
    <div ref=pill  class="absolute bg-blue-600 rounded-md" />        z-0
    {chips}                                                          z-10  base colours
    <div ref=clip aria-hidden class="absolute inset-0 flex gap-1
         text-white pointer-events-none" style="clip-path: inset()"> z-20  duplicate row
      {chips as divs, not buttons}
    </div>
  </div>
</div>
```

Both layers share one `scrollLeft`, so they cannot desync.

**The pill and the clip layer live in content coordinates**, computed from
`f` alone and never touched by `scrollLeft`. `scrollLeft` is a wholly
separate, suspendable policy. This is what makes the peek gesture cost
nothing to support.

Per frame: `pill.style.transform`, `clip.style.clipPath`, and (unless
suspended) `strip.scrollLeft`.

The pill sits at the strip's centre until `stripScrollLeft` clamps at either
end of the season, at which point it drifts off-centre and pins on its own —
the ends-of-range case falls out of the same clamp rather than needing a
branch.

`bg-blue-600` comes off the anchor chip; the highlight is now the pill plus
the clipped white copy.

### Programmatic jumps

Tapping a chip does an instant `window.scrollBy`, so `scrollLeft` would
teleport across many days. When the target moves more than 1.5 days in one
frame, tween `scrollLeft` over ~220ms ease-out instead of snapping; any
gesture cancels it.

That tween is the only self-moving animation here, so it is the only thing
`prefers-reduced-motion` turns off. The scroll-linked motion is 1:1 with the
reader's own gesture and stays as-is.

## Testing

- **Pure** (`railPosition`): ramp floor on a one-event day, clamping at both
  ends of the season, `f` continuity across the flip.
- **Hook** (`useRailHighlight`): stubbed rects, following the existing
  `useDayAnchor.test.ts` pattern. Suspension on `pointerdown`/`wheel`; resume
  on anchor change.
- **Component** (`DayRail`): clip layer is `aria-hidden`, contains nothing
  focusable, `aria-current` still lands on the anchor.
- **Browser, mandatory.** Chrome on a phone viewport, with a GIF of a slow
  drag *stopped mid-transition* showing the half-and-half chip. This is the
  acceptance criterion and no test can reach it — phase 3a shipped eleven
  green task reviews with a rail that did not stick.

Existing rail tests assert `aria-current` and "the strip writes its own
`scrollLeft`". Both stay true, so test churn is minimal.

## Risks to verify early in the browser

1. Whether `clip-path` on the absolutely-positioned layer resolves against
   its own border box (expected) rather than the scroller's.
2. Whether the duplicated row's ~64 extra nodes cost anything measurable on a
   phone.
3. Whether the browser's native axis-locking on `overflow-x-auto` keeps a
   diagonal drag near the screen's top edge from stealing vertical page
   scroll.

## Files

| File | Change |
|---|---|
| `frontend/src/lib/utils/railPosition.ts` | new, pure |
| `frontend/src/hooks/useRailHighlight.ts` | new |
| `frontend/src/hooks/useDayAnchor.ts` | swap in `resolveAnchor` |
| `frontend/src/components/calendar/DayRail.tsx` | layers; delete the centring effect |
| tests for each | new / updated |
