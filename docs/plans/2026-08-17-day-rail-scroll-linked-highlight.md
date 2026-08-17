# Day rail — scroll-linked highlight

**Status:** Implemented and browser-verified on branch. Not pushed, no PR
yet.
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

**Suspension trigger:** the strip's scroll position diverging from the last
value this hook wrote. *(Revised during the browser pass — the original plan
said `pointerdown` and `wheel` on the strip, which also fires for a plain
vertical page scroll that merely passed over the rail. See the browser
verification section below.)*

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
    {chips}                                                          static, base colours
    <div ref=pill  class="absolute inset-y-0 bg-blue-600" />         z-10
    <div ref=clip aria-hidden class="absolute inset-0 flex gap-1
         text-white pointer-events-none" style="clip-path: inset()"> z-20  duplicate row
      {chips again, as buttons with tabIndex -1}
    </div>
  </div>
</div>
```

Both layers share one `scrollLeft`, so they cannot desync.

Two details settled while building, against the sketch above:

- **The pill sits ABOVE the chips, not behind them.** Behind, a chip's
  `hover:bg-blue-50` paints over the highlight on the current day — the one
  chip whose highlight matters. Above, the pill covers the base text and the
  clipped copy puts legible text back, which is the same result the layering
  was for.
- **The copy's chips are `<button>`, not `<div>`.** The copy must match the
  real row's box metrics exactly or a width difference opens a seam through a
  digit, and a `<div>` does not inherit the same UA and preflight rules.
  `tabIndex={-1}` inside an `aria-hidden` container keeps them out of the tab
  order and the accessibility tree. Measured worst delta across 251 pairs:
  0px.

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

## Browser verification (390x844, Chromium, real production data)

All three risks resolved, plus one defect found that no test reached.

1. **`clip-path` coordinate space** — resolves against the layer's own border
   box, as expected. Measured mid-handover: `inset(0 1079.88px 0 10920.1px)`
   on a 12044px content box, and 10920.1 + 44 + 1079.88 = 12043.98.
2. **Cost of the duplicated row** — none measurable. The rail turned out to
   span **251 chips**, not the ~64 estimated here, so the copy is 502 buttons
   over a 12044px strip. Median frame 8.3ms with the copy and 8.3ms with it
   `display: none`; p95 9.9 vs 10.0. The 8.3ms is the page's own scroll cost.
3. **Layer alignment** — worst chip delta across all 251 pairs: **0px**. The
   shared `chipBoxClass` holds.
4. **Continuity** — 13 distinct pill positions across the 200px ramp
   (header 33px), and `pillLeft` is exactly the predicted function of the
   measured distance in every sample. Critically, the last pre-flip position
   equals the post-flip position (10896 + 48 = 10944), so the handover is
   continuous across the anchor change rather than merely smooth either side
   of it.
5. **Peek** — a 200px pan leaves the page at rest, the pill on its day, and
   the peek intact through subsequent same-day scrolling.
6. **Commit** — tapping a chip six days ahead scrolls the page and eases the
   strip through 24 distinct positions over ~400ms; under
   `prefers-reduced-motion` the same tap uses 2 (start and end).

### Defect found: peek detection inferred intent from event type

Suspending on `wheel`/`pointerdown` over the strip also fired for a plain
**vertical** page scroll with the pointer resting on the rail — and the rail
is sticky at the top of a phone screen, which is where swipes start.
Measured: one vertical wheel, then 120px of page scroll, moved the strip
**0px**. Centring stayed dead until the next day boundary.

Fixed by detecting divergence instead: every write goes through one
`writeScrollLeft` that reads the value back, and a strip `scroll` finding a
position other than the one we wrote means the reader moved it. Strictly
more accurate in both directions — it cannot fire for a scroll that merely
passed over the rail, and it catches touch drag, trackpad pan, scrollbar and
keyboard rather than the two events the old list named. After the fix the
same measurement gives 24px.

This was green on all 1029 tests before the browser pass.

### Remaining, not verified

Native axis-locking on a diagonal touch drag starting on the rail. Chromium
headless does not reproduce real touch gesture arbitration, so this needs a
device or simulator pass rather than a scripted one. Low risk: the strip is
an ordinary `overflow-x-auto` element with no touch-action override, so it
gets the platform's default behaviour.

## Files

| File | Change |
|---|---|
| `frontend/src/lib/utils/railPosition.ts` | new, pure |
| `frontend/src/hooks/useRailHighlight.ts` | new |
| `frontend/src/hooks/useDayAnchor.ts` | swap in `resolveAnchor` |
| `frontend/src/components/calendar/DayRail.tsx` | layers; delete the centring effect |
| tests for each | new / updated |
