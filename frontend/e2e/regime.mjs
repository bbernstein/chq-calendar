/**
 * Which regime the app is in, and how to get a populated list on screen
 * either way.
 *
 * Every suite used to open with `waitForSelector('[data-day-key]')`. That is
 * correct in season and a 30-second hang out of it: from the season's last
 * event day until the years manifest rolls over on October 1, the default
 * window is empty, so no day section is ever written and there is nothing to
 * wait for (#269). `verify-rail` opens twelve pages, so the job burned about
 * six minutes proving nothing before failing with no diagnosis at all.
 *
 * The race below replaces that hang with an answer.
 */
let regime = null;

/**
 * The regime this run is in.
 *
 * Throws rather than guessing when no page has bootstrapped yet: a check that
 * consults the regime before one has been established is an ordering bug, and
 * a wrong default would silently run the wrong branch — which is the same
 * class of quiet wrongness this whole module exists to remove.
 */
export function currentRegime() {
  if (regime === null) {
    throw new Error('currentRegime() before any enterList() — ordering bug');
  }
  return regime;
}

const LANDING = '[data-testid="off-season-landing"]';
const EMPTY = '[data-testid="empty-state"]';
const DAY = '[data-day-key]';

/**
 * Wait for a populated day list, entering the season first if the default
 * screen is the off-season landing. Call instead of
 * `waitForSelector('[data-day-key]')`, after `goto`.
 */
export async function enterList(page) {
  const first = await Promise.race([
    page.waitForSelector(DAY, { timeout: 30000 }).then(() => 'day'),
    page.waitForSelector(LANDING, { timeout: 30000 }).then(() => 'landing'),
    page.waitForSelector(EMPTY, { timeout: 30000 }).then(() => 'empty'),
  ]).catch(() => 'nothing');

  if (first === 'nothing') {
    // Loudly, and with what the page actually had. A bare 30s timeout was
    // #269 itself: a suite that proved nothing and then failed without
    // saying why.
    const found = await page.evaluate(() => ({
      dayKeys: document.querySelectorAll('[data-day-key]').length,
      rail: !!document.querySelector('[data-day-rail]'),
      main: document.querySelector('main')?.innerText?.slice(0, 200) ?? '(no main)',
    }));
    throw new Error(
      `enterList: no day section, landing or empty state after 30s — ${JSON.stringify(found)}`
    );
  }

  if (first === 'day') {
    announce('in-season');
    return regime;
  }

  if (first === 'empty') {
    // Not necessarily the answer — it may be the *first* answer.
    //
    // `useEventData` starts with `events: []` and `loading: false` (loading
    // only goes true once the fetch branch is reached), so there is a window
    // on every load in which the page has no events and is not loading, and
    // `EmptyState` is what renders in it. `goto`'s `networkidle` does not
    // close that window: the feed fetch is issued from the app's own code
    // after hydration, so it can start *after* the network has already gone
    // quiet once.
    //
    // Measured 2026-08-26 under WebKit against the preview server: the race
    // below resolved to `empty` while a plain `waitForTimeout(4000)` on the
    // same page found 89 day sections. Chromium is fast enough here to lose
    // that race the other way, which is exactly how a flake of this shape
    // stays invisible until a second engine runs.
    //
    // So the empty state is confirmed rather than believed: it is the answer
    // only if nothing else has arrived a few seconds later. The real
    // condition this branch exists to catch — a filter leaked in from
    // storage, a feed that came back empty — is permanent and survives the
    // wait.
    const later = await Promise.race([
      page.waitForSelector(DAY, { timeout: 15000 }).then(() => 'day'),
      page.waitForSelector(LANDING, { timeout: 15000 }).then(() => 'landing'),
    ]).catch(() => 'still-empty');

    if (later === 'still-empty') {
      throw new Error(
        'enterList: the default screen is still the generic empty state 15s ' +
        'later, which means the feed came back empty or a filter leaked in ' +
        'from storage'
      );
    }
    if (later === 'day') {
      announce('in-season');
      return regime;
    }
    announce('off-season');
    await enterSeasonFromLanding(page);
    await page.waitForSelector(DAY, { timeout: 30000 });
    await settleAtTop(page);
    return regime;
  }

  announce('off-season');
  await enterSeasonFromLanding(page);
  await page.waitForSelector(DAY, { timeout: 30000 });
  await settleAtTop(page);
  return regime;
}

/**
 * Tap the enabled rail chip nearest the middle of the rail.
 *
 * The rail is reachable from the landing: `page.tsx` renders `DayRail` as a
 * SIBLING of the card that holds the landing/empty/list branches, not inside
 * them, so it is on screen with the landing showing. `railTarget` accepts any
 * target inside `navBounds`, and #274 phase 4 mounts every day of the year as
 * soon as the list is on screen, so the tap scrolls to that day rather than
 * widening anything.
 *
 * **Why this rather than the landing's own "Browse the … season" button.**
 * Both routes were measured working against production on 2026-08-24 pinned
 * to 2026-09-15. The chip is primary because it is the route a reader takes
 * from a rail already in front of them, and because it lands mid-season:
 * there are event days on both sides of where it stops, which is the shape
 * checks 9 and 11 assume when they ask for a target "a long way from here".
 * The archive button lands at the season's start instead.
 *
 * The paragraph that used to be here justified the choice by what each route
 * did to the render WINDOW — `expandStart`, `navigationTargets`, a "Show
 * earlier" button, and checks 4/5 that consumed them. #274 phase 4 deleted
 * every one of those, and the checks with them.
 */
async function enterSeasonFromLanding(page) {
  const target = await page.$$eval('[data-day-rail] [data-chip]', els => {
    const enabled = els
      .map(e => ({ key: e.dataset.chip, ok: e.getAttribute('aria-disabled') !== 'true' }))
      .filter(c => c.ok);
    return enabled.length ? enabled[Math.floor(enabled.length / 2)].key : null;
  });

  if (target) {
    await page.evaluate(
      k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(),
      target
    );
    await page.waitForTimeout(1500);
    if (await page.$(DAY)) return;
  }

  // Fallback: the landing's own archive button, for a regime where the rail
  // has no enabled chip to offer or the tap did not land.
  const archive = page.getByRole('button', { name: /^Browse the \d{4} season$/ });
  if (await archive.count() === 0) {
    throw new Error('enterList: no enabled rail chip and no archive button on the landing');
  }
  await archive.click();
}

/**
 * Return the reader to the top of the document and let the header settle.
 *
 * The chip tap scrolls to the day it landed on, and a scrolled page is NOT
 * the state an in-season bootstrap hands to the checks: past the reveal
 * sentinel the site header is hidden and `inert` (`Header.tsx`), which takes
 * everything hanging off it — the Filters funnel, and the panel it opens —
 * out of the accessibility tree entirely. A check that reads `textContent`
 * off raw DOM nodes still finds those controls, while a `getByRole` query for
 * the same control times out against the same page. That asymmetry is what
 * this exists to prevent: the whole point of `enterList` is that a check
 * downstream cannot tell which regime it is running in, so the scroll
 * position has to match too.
 *
 * The sentinel used to be named `filterCardParked`, back when the filter card
 * sat in flow below the header rather than in an overlay hanging from it, and
 * the worked example was the deleted `All Season` scope button. #274 phase 3
 * moved the card and phase 4 deleted the scopes; the trap is the same one.
 */
async function settleAtTop(page) {
  // Scrolled back with a WHEEL, not `window.scrollTo`, and that distinction is
  // the whole of this function.
  //
  // The chip tap leaves a rail hold behind: `useDayAnchor`'s ResizeObserver
  // re-asserts the tapped day's position on any later layout change, and the
  // hold is ended by a reader's own gesture — that hook listens for
  // `wheel`/`touchstart`/`mousedown`/`keydown` — which a programmatic scroll
  // is not. Measured: `scrollTo(0, 3100)` came back as
  // `scrollY 523` with the tapped section parked at 64px, right under the
  // rail — the app pulling its target back, exactly as designed. Check 8e
  // failed on that, reporting an anchor that "never moved" when what had
  // actually happened was that its scroll was undone.
  //
  // A wheel event ends the hold and then scrolls, so the page stays where it
  // is put.
  for (let i = 0; i < 20; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === 0) {
      // Confirmed stable, not merely momentarily zero.
      await page.waitForTimeout(300);
      if (await page.evaluate(() => window.scrollY) === 0) return;
      continue;
    }
    await page.mouse.wheel(0, -Math.max(y, 400));
    await page.waitForTimeout(250);
  }
  throw new Error('enterList: the page would not settle at the top of the document');
}

let announced = false;
function announce(value) {
  // A later page disagreeing with the first is a failure, not a reassignment.
  // Every check that branches on `currentRegime()` assumes one answer per
  // run; two would mean some checks took the in-season branch and others the
  // off-season one, and the run would still report success. The empty-state
  // race above is exactly the mechanism that could produce it — it resolved
  // to `empty` under WebKit on a page where a plain wait found 89 day
  // sections — so this is reachable rather than theoretical. Thrown for the
  // same reason `currentRegime()` throws: it is an ordering bug in the
  // harness, not a finding about the app.
  if (announced && regime !== value) {
    throw new Error(
      `enterList: this run established the ${regime} regime and a later page ` +
      `detected ${value} — the checks that branch on currentRegime() cannot ` +
      'both be running against the right one'
    );
  }
  regime = value;
  if (announced) return;
  announced = true;
  // One line per RUN, not per page: `verify-rail` opens twelve pages, and
  // twelve identical lines are noise that hides the one worth reading.
  //
  // Logged rather than `check`ed, and that is a deliberate removal. This used
  // to end in `check('0 regime detected', true, value)` — a hardcoded pass,
  // recorded once in each of the six suites, because `enterList` runs in all
  // of them. `results.mjs` exits non-zero when NO check passed, precisely so
  // a suite that skipped everything or ran nothing at all cannot report
  // success; a check that could not fail made that safety net unreachable
  // everywhere it mattered. Which regime a run is in is a fact worth
  // printing, not an assertion, and the one assertion it can honestly carry
  // is the consistency check above.
  console.log(`regime: ${value}`);
}
