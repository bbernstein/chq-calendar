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

Check 6 — an archived year should land at its season start — **fails on
this branch, and it is meant to.** It is a product defect, recorded in full
at the check itself.

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

`verify-rail`'s check 11 has no subject off-season and skips with a printed
reason (today is outside `navBounds`, so `⟳ Now` is correctly absent). It used
to be joined by check 3, a persisted `this-week` migration; #274 phase 4
deleted `dateFilter` from the app, so that check and its skip are gone
together with checks 1, 2 and 4/5 — the date scopes and "show earlier" they
asserted no longer exist. `verify-full-list` skips checks 5 and 7 off-season,
for the same reason in both cases: `enterList` has to tap a rail chip to get a
list at all, so there is no load-time landing left to measure.

`verify-filter-reveal`'s check 13 stands down when day sections appear or
vanish mid-wheel, which makes the reader's movement unattributable — that one
is conditional on the confounder rather than on the regime. With the render
window deleted a wheel can no longer mount anything, so it is very nearly dead
code; what can still trip it is check 10's filter landing late.

A suite where **no check passed** exits non-zero: an all-skip run has proved
nothing and must not report success.

Pin the clock to any date with `E2E_NOW`, which takes a `yyyy-mm-dd` or a full
instant:

```bash
# five days past the season's last event day
E2E_NOW=2026-09-15 URL=http://localhost:3000/ node e2e/verify-rail.mjs
```

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
