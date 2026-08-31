# Browser checks

Playwright verification for the parts of the calendar that only a real
browser can judge: sticky geometry, scroll corrections, animation timing,
tap-target size, and the interaction between our own scroll handling and the
browser's scroll anchoring.

**These exist because unit tests could not see the defects.** Two examples,
both of which shipped to production with a full green suite:

- The day rail was not sticky at all — a wrapper div gave `position: sticky`
  zero travel. Eleven task reviews passed first.
- Hiding the filter card on scroll removed ~290px of flow height above the
  reader; scroll anchoring subtracted that from `scrollY`, which clamped at
  the top, which put the card back. Slow scrolling advanced the page 0px.
  954 unit tests and every CI check passed.

jsdom has no layout, no sticky positioning, no scroll anchoring and no
compositor, so none of that is reachable from the normal suite. What the
suite covers is the composition rules those bugs broke — see
`src/__tests__/integration/filterHeader.test.tsx`.

## Running

```bash
# against the dev server
npm run dev
URL=http://localhost:3000/ npm run test:browser

# against production, or any deploy
URL=https://www.chqcal.org/ npm run test:browser
```

`URL` defaults to `http://localhost:3000/`. Each harness runs every check,
prints them all as it goes, and exits non-zero at the end if any failed —
it does not stop at the first failure. A run that fails check 12 still tells
you about checks 13 onward, which usually matters: these failures cluster.

Running them against **production** is worth doing deliberately: it is how
the filter-header regression was confirmed to be live, and how the fix was
confirmed to have reached readers. A check that passes on a build known to
be broken is a check that cannot fail — production is the control that
proves it can.

## `verify-full-list.mjs` — the list is the whole year

#274 phase 4 deleted date filtering. The list is now every day of the
selected year, mounted in one commit — 89 day sections and 1,687 event
cards for 2026 — with the day strip and the week chooser as the only date
navigation. Nothing in the unit suite can see whether that works: the
things holding it up are `content-visibility: auto` on each day section,
`contain-intrinsic-size` standing in for the layout the browser skipped,
and a landing that scrolls by a *relative* delta so the estimates above the
target cannot throw it off. jsdom has none of layout, `content-visibility`,
scroll anchoring or a compositor.

So this suite is where the phase is actually proved. It asserts that every
day and every event of the year is mounted, that no growth sentinel
survives anywhere, that day sections really are skipping layout, that the
intrinsic-size estimate is within ±60% of a real measured section, that the
reader lands on today and stays parked at the sticky offset, that mid-list
rail jumps land to the pixel, that slow scrolling advances in **both**
Chromium and WebKit, and that axe is clean over the whole mounted year.

Two things about it are worth knowing before trusting a green run:

- **Check 3 is the only guard on `content-visibility`.** Check 10 was
  written to be the performance half of that argument and measurably is
  not: deleting `content-visibility` and re-running moved p95 from 23-24ms
  to 29-30ms and left the check passing, twice. Check 3 fails on that same
  build. A pass on 10 is not evidence the containment is doing its job.
- **Check 7c, not 7a/7b, is what catches an absolute scroll.** 7a/7b assert
  the reader ends up parked at the sticky offset, which is a real
  invariant — but `useDayAnchor`'s settle hold re-parks the target on the
  next `ResizeObserver` callback, so it repairs a broken `scrollToDay`
  before either can see it. Replacing the relative `scrollWindowBy` with an
  absolute `window.scrollTo` 400px off left 7a reading `top 139.5` against
  an offset of 140. 7c watches the mechanism instead: the app's own scrolls
  are relative, and nothing in `src/` calls `window.scrollTo` at all.

Check 6 — an archived year lands at its season start — was red when it was
written, and that was the point: it named a real product defect rather than
being tuned around it. It is **green as of `bc6c36a`**, which stopped
`landingDayKey` offering the previous year's days as candidates during the one
commit in which `seasonStartDay` already describes the new year and
`eventDays` still holds the old one's. If it goes red again, that is a
regression, not a known state.

## Regimes

The calendar has three: before the season opens, during it, and after the last
event until the years manifest rolls over on October 1. Only the middle one
puts a day list on the default screen.

Every suite therefore bootstraps through `enterList` (`regime.mjs`) rather
than `waitForSelector('[data-day-key]')`. It races the day section against the
off-season landing and the generic empty state, and off-season taps a
mid-season rail chip to widen the view window into the season, then returns
the reader to the top so downstream checks cannot tell which regime they are
in. It prints one `regime:` line per run.

There is a fourth state the three above do not name, because it is not a
regime but the *tail* of the middle one: the season is still open, today is
still mounted, and yet there is no longer enough programme left after today to
fill a viewport. Measured on 2026-08-31 against the live feed — today carried 2
events, the only day after it 1 — the load landed the reader at `scrollY`
161,024, which **is** `maxScroll`, with today's section top 213px down against
a sticky offset of 81. The document simply runs out 133px short.

Two checks assumed their way past that and went red on `main` for everyone.
Neither was a regression and neither was about the app, which behaves
correctly at the clamp:

- **`8e highlight follows scroll`** wheeled *forward* to move the highlight,
  and forward headroom was 0px. It now asks the document which way it can
  still move and goes that way, printing the direction and both headrooms.
  Backwards there were 161,024px. The plan is computed from the DOM's own
  geometry, never from the rail's reported anchor — that is the thing under
  test, and the first draft of the fix, which did read the anchor, stood the
  check *down* on precisely the build that breaks it.
- **`11 ⟳ Now`** needs a today the reader can be parked on, which the tail
  stops providing: `⟳ Now` renders on `anchorDay !== todayKey`, and no scroll
  position puts today's header under the rail. Worse than the red 11c was what
  was still green beside it — nothing in the check moved the page at all, so
  11a passed on a button that had been on screen since load and 11b compared a
  state to itself. The block now pins its own clock to a day derived from the
  feed each run (the middle mounted day of the year), which restores a real
  navigation away and back. `pinClock` takes that instant; `fixedNow.mjs`
  exports `atMidMorning` so the 14:00Z rule has one home.

Two more suites fell to the same tail, and were invisible until `verify-rail`
went green because `test:browser` is `&&`-chained:

- **`verify-filter-reveal` 4a and 37** and **six checks in
  `verify-header-reveal`** all prove something about a DOWNWARD gesture, and
  all opened with `window.scrollTo(0, 6000)` — which has never worked, because
  `useDayAnchor`'s hold undoes a programmatic scroll. That was harmless while
  the landing left headroom below; at the tail the landing IS the bottom.
  `makeRoomBelow` (`regime.mjs`) now makes the room with a wheel, which is the
  one gesture that both releases the hold and moves the page.
- **`verify-rail`'s check 9** — found by review, not by the red build, because
  it was not red: it runs the same `pickFarTarget` on an unpinned page, and at
  the tail the tap is a no-op. Measured by deleting `onSelectDay(chip.key)`
  from the chip's `onClick`: `PASS 9b top=468.0px bottomedOut=true` and
  `PASS 9c top=468.0 railH=80` — **two green checks over a rail tap that
  navigated nowhere**, 9b absorbing it through the very `bottomedOut`
  relaxation written for the tail. It is pinned now, and 9b takes its strict
  branch (`top=156.0px bottomedOut=false`).
- **`verify-full-list` checks 5, 7 and the WebKit trio** assert the reader is
  left parked *exactly* on today, to a 2px tolerance. They pin their clock the
  way `verify-rail` 11 does rather than relax six exact assertions — check 5's
  own header records that a broken `landingDayKey` left check 7 completely
  green, because the reader was parked perfectly on the WRONG day, so exactness
  is what these are worth. **9a** ("slow scrolling advances the page") read
  `0px of 2400` in both engines and takes `makeRoomBelow` instead.

This is the same shape as #249, one level up. That fix removed the *hour* from
"today is reachable" after 11c went red at night and green in the morning on
the same commit. This one removes the *date*: the boundary is not a time of
day and not a fixed date either, it is how much programme is left.

Every one of these was red on `main` before any of this work, on an app that is
correct at a clamp it does not control. None is a regression.

`verify-rail`'s check 11 has no subject off-season and skips with a printed
reason (today is outside `navBounds`, so `⟳ Now` is correctly absent). It used
to be joined by check 3, a persisted `this-week` migration; #274 phase 4
deleted `dateFilter` from the app, so that check and its skip are gone
together with checks 1, 2 and 4/5 — the date scopes and "show earlier" they
asserted no longer exist. `verify-full-list` skips checks 5, 7 and the WebKit
`5-webkit the rail highlights today` off-season, for the same reason in all
three cases: `enterList` has to tap a rail chip to get a list at all, so there
is no load-time landing left to measure — and once `settleAtTop` has returned
the reader to the top of the document, the day being read is the first day of
the year, which is precisely the walk fallback that last check exists to
reject. It cannot tell the right answer from the wrong one there.

**A page that seeds a filter into `localStorage` before load cannot report the
regime, and must say so** — `enterList(page, { seedsOwnFilter: true })`.
Off-season the landing shows only for a reader who has narrowed nothing, so a
seeded filter suppresses it and a day list renders on a date where an unseeded
page gets the landing. `verify-rail`'s checks 18 and 20h both seed
`searchTerm: 'williamsburg'`; before #287 they announced `in-season` in the
middle of an off-season run and `announce`'s consistency throw took the whole
suite — and the five suites `&&`-chained after it — down with a stack trace
and no summary. The consistency rule itself is untouched: it still fires for
every page that can honestly speak to which regime it found, and a
`seedsOwnFilter` page that runs before any regime has been established is an
ordering bug and throws as one.

`verify-filter-reveal`'s check 13 stands down when day sections appear or
vanish mid-wheel, which makes the reader's movement unattributable — that one
is conditional on the confounder rather than on the regime. With the render
window deleted a wheel can no longer mount anything, so it is very nearly dead
code; what can still trip it is check 10's filter landing late.

A suite where **no check passed** exits non-zero: an all-skip run has proved
nothing and must not report success.

Both new stand-downs are guarded so they cannot absorb a real defect. `8e`
skips only when no day header can be moved across the sticky line in *either*
direction — the whole document inside one viewport — and prints what the
geometry said next to what the rail said. `9` and `11` skip only when the
year's MIDDLE mounted day is unparkable or has too little behind it; and
`11b`/`11c`, which live inside `if (appeared)`, now print a skip instead of
silently vanishing from the run.

**That middle-day guard is not quite as unreachable as it looks, and the reason
is worth writing down.** It is true that no *season* puts its sparse tail in
the middle of the year. But at the October 1 manifest rollover `defaultYear`
becomes the next year, and a year that has been announced with a handful of
events published — 2027 already carries five — has a middle day with almost
nothing behind it. The guard would fire there. What actually happens first is
the **regime** check: today is outside `navBounds`, so `11` skips off-season and
`9` runs unpinned. So the ordering is load-bearing rather than incidental, and
"no real season produces this" is true only because something else catches that
year one step earlier.

The two suites ask the same survey for different margins, deliberately.
`verify-rail` wants `after >= 7` because `pickFarTarget`'s first rule looks for
a tappable chip at least **6** chips past the anchor — a day with fewer days
behind it can only reach that rule's fallbacks. `verify-full-list` wants
`after >= 3`: its landing checks need the pinned day to sit comfortably inside
the document, not to support a navigation away from it.

**What checks 9 and 11 no longer cover, plainly:** the real today. It cannot — that
is the finding rather than a shortcut around it. The pin is applied every run
rather than only in the tail, because a branch that runs two weeks a year rots
between Septembers, which is the same reason `verify-offseason.mjs` runs its
matrix year-round.

Pin the clock to any date with `E2E_NOW`, which takes a `yyyy-mm-dd` or a full
instant:

```bash
# five days past the season's last event day
E2E_NOW=2026-09-15 URL=http://localhost:3000/ node e2e/verify-rail.mjs
```

It reaches the five suites that go through `fixedNow.mjs` —
`verify-rail`, `verify-filter-reveal`, `verify-timezone`,
`verify-header-reveal` and `verify-full-list`. **`verify-offseason.mjs` does
not import `fixedNow.mjs` and ignores `E2E_NOW` entirely**, so prefixing it is
a silent no-op; it derives every instant from the live feed instead, which is
the next paragraph's subject.

`verify-offseason.mjs` runs a five-entry matrix over pinned instants derived
from the feed — post-season, the September 30 edge, pre-season, mid-season,
and the October manifest rollover. It exists because the off-season path is
unreachable eleven months of the year and would otherwise rot between
Septembers.

Two of its entries replace what the CDN serves, and both stubs are load-bearing
rather than convenient:

- **The rollover entry stubs `years.json`.** `defaultYear` is
  server-generated — `useAvailableYears` reads it from the manifest, and
  `getDefaultYear()` in `constants.ts` is only the failed-fetch fallback — so
  pinning the clock past October 1 does not reproduce the rollover at all.
- **The pre-season entry stubs the events feed empty.** With events published,
  the `next` scope's adaptive window keeps reaching forward until it has 50 of
  them however far off they are, so the list is never empty and `in-season` is
  the correct answer. The countdown belongs to a year that has been announced
  but whose programme is not up yet, which is a year with no events in it.

Everything not named in those two stubs stays live production data.

## In CI

`.github/workflows/build-and-test.yml` runs all six (via
`npm run test:browser`) against a preview server built from the branch. That
server proxies `/cache` to production, which is how the pinned regime matrix
reaches the live feed. There is no path filtering — they run on every push
and every fork PR, like the rest of that workflow. Chromium: these are
geometry checks against one engine, not a browser-support matrix.

With one deliberate exception. `verify-header-reveal.mjs` also runs under
WebKit, in a second step, selected with `E2E_ENGINE=webkit`:

```bash
E2E_ENGINE=webkit URL=http://localhost:3000/ node e2e/verify-header-reveal.mjs
```

The site header (#272) reads scroll direction, and scroll ANCHORING is what
makes that hard — the two engines disagree about it in both directions.
WebKit corrects the page 122px after a rail chip tap where Chromium corrects
nothing; Chromium anchors when the filter panel is inserted where WebKit does
not. Each was a real bug the other engine could not see, and the
scroll-anchoring regression its checks 9 and 10 guard against reproduced
identically in both. A guard for a two-engine bug that only ever runs against
one engine is half a guard, and the half it is missing is not knowable from
the half that passes.

WebKit refuses `mouse.wheel` in a mobile context, so that suite emulates
touch only under Chromium. The viewport width is what selects the mobile
layout (`lg:hidden` keys off width, not touch), so both engines exercise the
same header.

The job carries the same `if:` guard as `test-backend` and `test-frontend`,
which reads as though it disables the job for same-repo pull requests. It
does not, and it is worth knowing why before someone "fixes" it: the
workflow triggers on both `push` and `pull_request`, so a same-repo branch
would otherwise run everything twice. The guard routes same-repo work
through the `push` event and fork PRs — where no push fires in the base
repo — through `pull_request`. On a PR you will therefore see the job
listed twice, once skipped and once green.

## `measure-card-renders.mjs` — a measurement, not a check

Deliberately outside `npm run test:browser`. It has no pass/fail: it prints
what one star and one description expansion cost on the main thread with the
whole year mounted, so a claim about card rendering can be made from a number
rather than from reading the code.

```bash
npx vite build && npm run preview          # port 3000, /cache proxied to prod
LABEL=before node e2e/measure-card-renders.mjs
```

`CPU` (default 4) is the throttle rate and `REPS` (default 5) the repeat
count; it reports the median. It is what produced the before/after table in
`EventCard.tsx`'s memo comment.

Two numbers per interaction, measuring different halves. `flush` is
`performance.now()` either side of `el.click()` plus a `setTimeout(0)` —
preact batches into a microtask, so draining the microtask queue *is* the
render, and this is its JS cost. `longest long task` is what the page's own
`PerformanceObserver` reports for the same window, which additionally carries
the style and layout the render provoked.

The in-page timing is not incidental. The first version of this harness set a
mark in one `evaluate` and filtered `longtask` entries by `startTime` in
another, and recorded zero long tasks on a page that was in fact producing
489ms ones. Nothing now sits between the click and the number.
