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
import { check } from './results.mjs';

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
    throw new Error(
      'enterList: the default screen is the generic empty state, which means ' +
      'the feed came back empty or a filter leaked in from storage'
    );
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
 * The rail renders above the landing (it lives in the sticky header, outside
 * the empty/list branch, and `scopeHasWindow` is true post-season because the
 * window is non-null, merely empty). `railTarget` accepts any target inside
 * `navBounds`, and a target before `window.startDay` sets `expandStart`, so
 * the tap widens the view window to that day and mounts the season around it.
 *
 * **Why this rather than the landing's own "Browse the … season" button.**
 * Both routes were measured working against production on 2026-08-24 pinned
 * to 2026-09-15 — the archive route produced 3 day sections and a "Show
 * earlier" button, the chip route 2 and the same button. The chip is primary
 * anyway because the archive route's "Show earlier" is incidental: `season`
 * scope sets the window to the whole season, so `navigationTargets` finds an
 * earlier event day only because the 2026 feed happens to carry events from
 * January 3, outside the season. In a year whose events all fall inside the
 * season, `earlierDay` would be null, the affordance would vanish, and
 * `verify-rail`'s checks 4/5 would fail on a correct app.
 *
 * Tapping mid-season has no such dependency: there are always event days on
 * both sides of the resulting window, which is the shape those checks assume.
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
 * the state an in-season bootstrap hands to the checks: past the header
 * sentinel `filterCardParked` makes the filter card `inert`, which removes
 * its buttons from the accessibility tree entirely. Check 1 still saw "All
 * Season" — it reads `textContent` off raw DOM nodes — while check 2's
 * `getByRole('button', { name: 'All Season' })` timed out against the same
 * page. The whole point of `enterList` is that a check downstream cannot tell
 * which regime it is running in, so the scroll position has to match too.
 */
async function settleAtTop(page) {
  // Scrolled back with a WHEEL, not `window.scrollTo`, and that distinction is
  // the whole of this function.
  //
  // The chip tap leaves a rail hold behind: `useDayAnchor`'s ResizeObserver
  // re-asserts the tapped day's position on any later layout change, and the
  // hold is ended by a reader's own gesture (`cancelHold`), which a
  // programmatic scroll is not. Measured: `scrollTo(0, 3100)` came back as
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
  regime = value;
  if (announced) return;
  announced = true;
  // One line per RUN, not per page: `verify-rail` opens twelve pages, and
  // twelve identical lines are noise that hides the one worth reading.
  console.log(`regime: ${value}`);
  check('0 regime detected', true, value);
}
