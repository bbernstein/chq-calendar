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

Two `verify-rail` checks have no subject off-season and skip with a printed
reason: check 3 (a persisted `this-week` resolves to no window at all, by
design) and check 11 (today is outside `navBounds`, so `⟳ Now` is correctly
absent). `verify-filter-reveal`'s check 13 stands down when the render window
mounts sections mid-wheel, which makes the reader's movement unattributable —
that one is conditional on the confounder rather than on the regime, so it
still runs in season.

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

`.github/workflows/build-and-test.yml` runs all four (via
`npm run test:browser`) against a preview server built from the branch. That
server proxies `/cache` to production, which is how the pinned regime matrix
reaches the live feed. There is no path filtering — they run on every push
and every fork PR, like the rest of that workflow. Chromium only: these are
geometry checks against one engine, not a browser-support matrix.

The job carries the same `if:` guard as `test-backend` and `test-frontend`,
which reads as though it disables the job for same-repo pull requests. It
does not, and it is worth knowing why before someone "fixes" it: the
workflow triggers on both `push` and `pull_request`, so a same-repo branch
would otherwise run everything twice. The guard routes same-repo work
through the `push` event and fork PRs — where no push fires in the base
repo — through `pull_request`. On a PR you will therefore see the job
listed twice, once skipped and once green.
