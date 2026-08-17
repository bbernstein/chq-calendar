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

`URL` defaults to `http://localhost:3000/`. Each harness exits non-zero on
the first failing check and prints every check it ran.

Running them against **production** is worth doing deliberately: it is how
the filter-header regression was confirmed to be live, and how the fix was
confirmed to have reached readers. A check that passes on a build known to
be broken is a check that cannot fail — production is the control that
proves it can.

## In CI

`.github/workflows/build-and-test.yml` runs both against a preview server
built from the branch, on changes under `frontend/`. Chromium only: the
harnesses are geometry checks, not a browser-support matrix.
