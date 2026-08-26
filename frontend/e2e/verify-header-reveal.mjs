/**
 * Browser verification for the site header's reveal on scroll up (#272).
 *
 * The header carries the "more" menu and the year selector, and below the
 * fold it used to be unreachable without scrolling the whole document back to
 * the top — from a rail tap, tens of thousands of pixels. It now reveals on a
 * small scroll up and hides on scroll down.
 *
 * Everything that can go wrong with that is geometry, and jsdom has none. In
 * particular checks 9 and 10 are the standing guard against the regression
 * `frontend/src/app/filterHeaderLayout.ts` documents at length: a header that
 * collapses by leaving the document flow changes height ABOVE the reader,
 * scroll anchoring subtracts that from `scrollY`, and the page becomes
 * impossible to scroll slowly — 40 wheel ticks advanced it 0px, returning to
 * the top 20 times, in both Chromium and WebKit, with the whole unit suite
 * green. This header is sticky and never leaves flow; checks 9 and 10 prove
 * that claim rather than asserting it.
 *
 * Run against a dev server, or any deploy: `URL=https://… node <this>`.
 */
import { chromium, webkit } from 'playwright';
import { pinClock } from './fixedNow.mjs';
import { check, skip, finish } from './results.mjs';
import { enterList } from './regime.mjs';

const URL = process.env.URL ?? 'http://localhost:3000/';

/**
 * Chromium by default, so CI is unchanged and still installs one engine.
 *
 * `E2E_ENGINE=webkit` exists for one reason: the regression checks 9 and 10
 * guard against reproduced identically in Chromium and WebKit, because scroll
 * anchoring is in both. A guard for a two-engine bug that can only ever be
 * run against one engine is half a guard, and the half it is missing is not
 * knowable from the passing half. Verified under both before this shipped.
 */
const ENGINE = process.env.E2E_ENGINE ?? 'chromium';
const engines = { chromium, webkit };
if (!engines[ENGINE]) throw new Error(`E2E_ENGINE must be chromium or webkit, got "${ENGINE}"`);
console.log(`engine: ${ENGINE}`);

const browser = await engines[ENGINE].launch();

async function phone({ reducedMotion } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // Touch emulation only under Chromium: WebKit refuses `mouse.wheel` in a
    // mobile context ("Mouse wheel is not supported in mobile WebKit"), and
    // the wheel is what checks 9 and 10 measure. The viewport is what selects
    // the mobile header — Tailwind's `lg:hidden` keys off width, not off
    // touch — so the WebKit run exercises the same layout either way.
    ...(ENGINE === 'chromium' ? { isMobile: true, hasTouch: true } : {}),
    // Not hour-sensitive, but pinned so `E2E_NOW` can reach this suite and its
    // off-season branch stays testable on any date. See `fixedNow.mjs`.
    timezoneId: 'America/New_York',
    ...(reducedMotion ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  await pinClock(page);
  // Tie the context's lifetime to the page's, or every check leaks one.
  page.once('close', () => { ctx.close().catch(() => {}); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Off-season the default screen is the landing, not a day list.
  await enterList(page);
  return page;
}

/**
 * The header's viewport rect, plus the rail's top.
 *
 * Measured, never inferred from the reveal state: the whole point of a
 * browser check is that it can disagree with what the app believes. A header
 * marked revealed that is painting off-screen — because a `calc()` was
 * dropped, or an ancestor gained a transform and broke `position: sticky` —
 * fails here and nowhere else.
 */
const geometry = p => p.evaluate(() => {
  const header = document.querySelector('header');
  const rail = document.querySelector('[data-day-rail]');
  const r = header?.getBoundingClientRect();
  return {
    top: r ? Math.round(r.top) : null,
    bottom: r ? Math.round(r.bottom) : null,
    height: r ? Math.round(r.height) : null,
    railTop: rail ? Math.round(rail.getBoundingClientRect().top) : null,
    inert: header?.hasAttribute('inert') ?? null,
    ariaHidden: header?.getAttribute('aria-hidden') ?? null,
    boxShadow: header ? getComputedStyle(header).boxShadow : null,
    scrollY: Math.round(window.scrollY),
  };
});

const moreButton = p => p.locator('[data-testid="header-mobile"] button').first();
const scrollY = p => p.evaluate(() => Math.round(window.scrollY));

/** A wheel gesture at the middle of the list, away from the rail. */
const wheel = async (p, dy) => { await p.mouse.move(195, 600); await p.mouse.wheel(0, dy); };

/**
 * Wait for the document to stop moving.
 *
 * Not a nicety — without it this suite was flaky 2 runs in 3, and it failed in
 * CI. `window.scrollTo(0, 6000)` lands short (the render window has not
 * mounted that far yet), the list then grows, and the app and the browser
 * spend the best part of a second correcting for it in a long run of small
 * scrolls. A wheel fired into the middle of that is measured NET of the
 * correction: traced at 4,935 → 4,829, so a 120px wheel DOWN moved the reader
 * 106px UP and the header stayed revealed, which the next check then reported
 * as its own failure.
 *
 * Polls rather than sleeps for a fixed time, because the settle's length
 * depends on how much list mounts — which depends on the day the suite runs.
 */
const settle = async (p, { stableSamples = 4, gapMs = 120, timeoutMs = 8000, label = 'settle' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  const seen = [];
  let last = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const y = await p.evaluate(() => Math.round(window.scrollY));
    if (y !== last) seen.push(y);
    stable = y === last ? stable + 1 : 0;
    last = y;
    if (stable >= stableSamples) return y;
    await p.waitForTimeout(gapMs);
  }
  // Timing out here used to return the last sample as though it had settled,
  // and every check downstream then measured a page still in motion — flaky at
  // best, and at worst green off a transient sample. A setup that did not hold
  // still has to say so itself, or it is reported as whatever it broke.
  //
  // Recorded only on failure, so a healthy run's check list is unchanged and
  // `finish()` still exits non-zero when this fires.
  check(`${label}: the page stopped moving`, false,
    `still moving after ${timeoutMs}ms; positions seen: ${seen.slice(-8).join(' → ')}`);
  return last;
};

/**
 * Get to the state nearly every check below starts from: deep in the list
 * with the header hidden.
 *
 * Returns the geometry so callers can assert the precondition rather than
 * assume it — every one of them does.
 */
const deepAndHidden = async (p, y = 6000) => {
  await p.evaluate((to) => window.scrollTo(0, to), y);
  await settle(p);
  // Wheel until it is actually hidden, rather than assuming one tick does it.
  //
  // One tick is not a reliable unit of scrolling. WebKit on Linux splits a
  // single tick across frames, and a correction still in flight can net
  // against it — this block skipped in CI ("the header would not park") while
  // passing three times in a row against macOS WebKit locally. A setup that
  // depends on one tick landing is a setup that reports engine differences as
  // failures of whatever it was testing.
  for (let i = 0; i < 5; i++) {
    const seen = await geometry(p);
    if (seen.bottom <= 0) return seen;
    await wheel(p, 120);
    await settle(p);
  }
  return geometry(p);
};

// ───────────────────────────────────────── hide on the way down, reveal coming back
{
  const p = await phone();
  const atTop = await geometry(p);
  check('1 header is on screen at the top of the document',
    atTop.top === 0 && atTop.bottom > 0 && !atTop.inert,
    `top=${atTop.top} bottom=${atTop.bottom} inert=${atTop.inert}`);

  const deep = await deepAndHidden(p);
  check('2 header is parked out of sight once scrolled down',
    deep.bottom <= 0, `bottom=${deep.bottom} scrollY=${deep.scrollY}`);
  // AC: "the day rail remains flush with the top edge and keeps working
  // exactly as it does today."
  check('3 the rail is flush with the top edge while the header is hidden',
    deep.railTop !== null && Math.abs(deep.railTop) <= 1, `railTop=${deep.railTop}`);

  // The acceptance criterion this whole suite exists for: a SMALL upward
  // scroll, from deep in the document, brings the whole header back.
  await wheel(p, -40);
  await settle(p);
  const revealed = await geometry(p);
  check('4 a small scroll up reveals the header from deep in the list',
    revealed.top === 0 && revealed.bottom > 0 && revealed.scrollY > 3000,
    `top=${revealed.top} bottom=${revealed.bottom} scrollY=${revealed.scrollY}`);
  // The reader chose the rail riding down over being covered: both surfaces
  // usable at once. One animated variable feeds both, so a drift here means
  // the header's `top` and the rail's have come apart.
  check('5 the rail rides down to sit below the revealed header',
    revealed.railTop !== null && Math.abs(revealed.railTop - revealed.bottom) <= 2,
    `railTop=${revealed.railTop} headerBottom=${revealed.bottom}`);

  // Revealed is worth nothing if the menu behind it does not open.
  await moreButton(p).click();
  await p.waitForTimeout(400);
  const menuOpen = await p.evaluate(() => {
    const group = document.querySelector('[data-testid="header-mobile"] [role="group"]');
    if (!group) return { open: false, items: 0 };
    const r = group.getBoundingClientRect();
    return {
      open: r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
      items: group.querySelectorAll('a').length,
    };
  });
  check('6 the "more" menu opens and is on screen', menuOpen.open && menuOpen.items > 0,
    `items=${menuOpen.items}`);
  // The other feature the issue names as unreachable.
  check('7 the year selector is on screen with the header', await p.evaluate(() => {
    const el = [...document.querySelectorAll('header button')]
      .find(b => /\d{4}/.test(b.textContent ?? ''));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
  }));

  await p.keyboard.press('Escape');
  await wheel(p, 120);
  await settle(p);
  const hiddenAgain = await geometry(p);
  check('8 scrolling down hides it again, rail flush once more',
    hiddenAgain.bottom <= 0 && Math.abs(hiddenAgain.railTop) <= 1,
    `bottom=${hiddenAgain.bottom} railTop=${hiddenAgain.railTop}`);
  await p.context().close();
}

// ─────────────────────────── the regression `filterHeaderLayout.ts` documents
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 0));
  await settle(p);

  // The measurement that found the original bug, repeated exactly: 40 slow
  // ticks of 60px. The failing shape was not "slower than expected" — it was
  // 0px of progress with the page snapping back to the top 20 times.
  const TICKS = 40;
  const PER_TICK = 60;
  const trace = [];
  await p.mouse.move(195, 600);
  for (let i = 0; i < TICKS; i++) {
    await p.mouse.wheel(0, PER_TICK);
    await p.waitForTimeout(60);
    trace.push(await scrollY(p));
  }
  const requested = TICKS * PER_TICK;
  const final = trace[trace.length - 1];
  const returnedToTop = trace.filter(y => y === 0).length;

  check('9 slow scrolling makes real progress down the page',
    final >= requested * 0.5,
    `${final}px of ${requested}px requested over ${TICKS} ticks`);
  check('10 slow scrolling never snaps back to the top',
    returnedToTop === 0,
    `returned to top ${returnedToTop}x; trace=${trace.join(',')}`);
  await p.context().close();
}

// ─────────────────────────────────── a rail tap is not the reader scrolling up
{
  const p = await phone();
  const chipKeys = () => p.$$eval(
    '[data-day-rail] [data-chip]:not([aria-disabled="true"])', e => e.map(x => x.dataset.chip));
  const tapChip = async (k) => {
    await p.evaluate(key => document.querySelector(`[data-day-rail] [data-chip="${key}"]`).click(), k);
    await p.waitForTimeout(1400);
  };

  const start = await deepAndHidden(p);

  // The jump has to go UP, and that is the whole design of this check. A chip
  // tap that scrolls DOWN proves nothing: without the resync it reads as a
  // huge scroll DOWN, which would keep the header hidden anyway and the check
  // would pass on code with no resync at all. The first version of this check
  // did exactly that — it tapped the last chip, jumped 6,120 → 12,916, and
  // passed vacuously.
  const chips = await chipKeys();
  const first = chips[0];
  const last = chips[chips.length - 1];
  if (start.bottom > 0) {
    check('11 a rail chip tap does not reveal the header', false,
      `SETUP: the header would not hide before the tap (bottom=${start.bottom}, scrollY=${start.scrollY})`);
  } else if (!first || !last || first === last) {
    skip('11 a rail chip tap does not reveal the header',
      `need two navigable chips, found ${chips.length}`);
  } else {
    await tapChip(last);
    await settle(p);
    const before = await geometry(p);
    // The rail re-windows around the day it landed on, so re-read it.
    const back = (await chipKeys())[0];
    await tapChip(back);
    const after = await geometry(p);

    const jumpedUp = before.scrollY - after.scrollY;
    if (jumpedUp < 500) {
      // Without an upward jump there is nothing here to mistake for a scroll
      // up, so the check has no subject. Saying so beats a green tick.
      skip('11 a rail chip tap does not reveal the header',
        `the tap did not jump up (${before.scrollY} → ${after.scrollY})`);
    } else {
      // Conjoined with the precondition rather than assuming it. This check
      // has already reported the wrong thing once: the setup wheel landed at
      // the document's end where there was nothing left to scroll, so the
      // header was never hidden going in, and "the tap revealed it" was a
      // misdiagnosis of "it was already revealed".
      check('11 a rail chip tap does not reveal the header',
        before.bottom <= 0 && after.bottom <= 0,
        before.bottom > 0
          ? `SETUP: header was already revealed before the tap (bottom=${before.bottom})`
          : `chip=${back}, jumped up ${jumpedUp}px, header bottom ${before.bottom} → ${after.bottom}`);
    }
  }
  await p.context().close();
}

// ─────────────────────────────────────────── a parked header is out of reach
{
  const p = await phone();
  const hidden = await deepAndHidden(p);
  // Three ways a parked header can still be present: reachable, announced, or
  // painting. A shadow paints OUTSIDE the border box, so with the box entirely
  // above the viewport `shadow-lg` still reached ~15px below it and, at
  // `z-40`, landed on the `z-30` rail. Found by screenshotting the top 24px
  // with and without it and seeing the images differ.
  check('12 the parked header is inert, unannounced, and paints nothing',
    hidden.inert === true && hidden.ariaHidden === 'true'
      && !/rgba?\((?!0, 0, 0, 0\))/.test(hidden.boxShadow ?? 'none'),
    `inert=${hidden.inert} aria-hidden=${hidden.ariaHidden} box-shadow=${hidden.boxShadow}`);

  // The attribute is the mechanism; this is the behaviour. Without `inert` the
  // browser would move focus into the parked header and then try to scroll it
  // into view — which it cannot do for a pinned sticky element, so it chases
  // the position instead.
  await p.evaluate(() => { document.activeElement?.blur?.(); });
  let landedInHeader = false;
  for (let i = 0; i < 12 && !landedInHeader; i++) {
    await p.keyboard.press('Tab');
    landedInHeader = await p.evaluate(() =>
      !!document.querySelector('header')?.contains(document.activeElement));
  }
  check('13 tabbing never lands inside the parked header', !landedInHeader,
    landedInHeader ? 'focus entered the hidden header' : '12 tabs, never entered');
  await p.context().close();
}

// ────────────────────────── the filter panel, opened with the header revealed
{
  // A composition the reader reaches in two taps: scroll up to bring the
  // header back, then open Filters from the header itself (#274 phase 3 moved
  // the funnel there from the rail). The panel hangs off the header's bottom
  // edge and both read the same `--site-header-offset`, so if the term were
  // applied to one and not the other they would overlap here and nowhere else.
  const p = await phone();
  await deepAndHidden(p);
  await wheel(p, -40);
  await settle(p);

  const revealed = await geometry(p);
  // `[aria-label="Filters"]` is load-bearing, not decorative. Narrowing on
  // `[aria-expanded]` instead is what broke this suite once already: the day
  // rail's week-chooser trigger carries it too, and so do the header's own
  // link menus.
  const toggle = p.locator('[data-site-header] button[aria-label="Filters"]').first();
  if (revealed.bottom <= 0 || await toggle.count() === 0) {
    skip('14 the filter panel opens below a revealed header',
      revealed.bottom <= 0 ? 'the header did not reveal' : 'no Filters toggle in the header');
  } else {
    // A DOM click, not `locator.click()`. Playwright scrolls an element into
    // view before clicking it, and that scroll is a real one the app has no
    // way to know is ours — it hid the header, and the check then passed
    // vacuously with the panel at the top of an empty viewport.
    await p.evaluate(() => document.querySelector('[data-site-header] button[aria-label="Filters"]').click());
    await p.waitForTimeout(700);
    const panel = await p.evaluate(() => {
      const card = document.querySelector('[data-filter-card]');
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(window.innerHeight) };
    });
    const after = await geometry(p);
    check('14 the filter panel opens below a revealed header, inside the viewport',
      panel !== null && after.bottom > 0 && panel.top >= after.bottom - 1 && panel.bottom <= panel.h,
      panel ? `header bottom=${after.bottom}, panel ${panel.top}→${panel.bottom}, viewport=${panel.h}` : 'no filter card');
  }
  await p.context().close();
}

// ─────────────────────── a header the reader can see is a header they can use
{
  // The seam a unit test cannot reach: `revealed` is a belief, and the sticky
  // header's actual position is a fact. When they disagree the header is on
  // screen and `inert` — unreachable by keyboard, unannounced by a screen
  // reader — which is precisely the trap `filterCardParked` documents.
  //
  // Reproduced before the fix in three steps a reader can take: search until
  // the list is empty (document 8,401px → 1,049px, `scrollY` clamped
  // 5,436 → 205), then let the viewport grow — a rotation to landscape, or
  // browser chrome collapsing — so the document is shorter than the viewport
  // and the browser clamps `scrollY` to 0. None of those scrolls has a gesture
  // behind it, so all of them were ignored, and the header stayed hidden while
  // sitting in plain sight at `top: 0`.
  const p = await phone();
  const hidden = await deepAndHidden(p);
  if (hidden.bottom > 0) {
    skip('15 a visible header is never inert', 'the header would not hide to begin with');
  } else {
    const emptied = await p.evaluate(() => {
      const field = document.querySelector('input[type="text"], input[type="search"]');
      if (!field) return false;
      // React/Preact listen for `input` on the native value setter.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(field, 'zzzzzzzznomatch');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    if (!emptied) {
      // The search field lives in the filter panel; open it from the rail
      // first if it is not already reachable. aria-label narrows past the
      // week chooser trigger — see `toggle` above.
      await p.evaluate(() => document.querySelector('[data-day-rail] button[aria-expanded][aria-label="Filters"]')?.click());
      await p.waitForTimeout(700);
      await p.evaluate(() => {
        const field = document.querySelector('input[type="text"], input[type="search"]');
        if (!field) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(field, 'zzzzzzzznomatch');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await p.waitForTimeout(1800);

    // The viewport grows. Nothing scrolls; the browser clamps.
    await p.setViewportSize({ width: 390, height: 1200 });
    await settle(p);
    const after = await geometry(p);

    const onScreen = after.bottom > 0;
    if (!onScreen) {
      // The clamp did not bring the header back into view, so there is no
      // disagreement to catch. Said out loud rather than passed.
      skip('15 a visible header is never inert',
        `the header stayed parked (bottom=${after.bottom}, scrollY=${after.scrollY})`);
    } else {
      check('15 a visible header is never inert',
        after.inert === false && after.ariaHidden === null,
        `bottom=${after.bottom} scrollY=${after.scrollY} inert=${after.inert} aria-hidden=${after.ariaHidden}`);
    }
  }
  await p.context().close();
}

// ───────────────────────────────────────────────── prefers-reduced-motion
{
  const p = await phone({ reducedMotion: true });
  const transitions = await p.evaluate(() =>
    getComputedStyle(document.documentElement).transitionProperty);
  check('16 the reveal does not animate under prefers-reduced-motion',
    !transitions.includes('--site-header-offset'), `transition-property=${transitions}`);

  // Not animating must still mean revealing. A reduced-motion reader gets the
  // header instantly, not never.
  check('17 reduced motion still hides on the way down', (await deepAndHidden(p)).bottom <= 0);
  await wheel(p, -40);
  await settle(p);
  const shown = await geometry(p);
  check('18 reduced motion still reveals on the way up',
    shown.top === 0 && shown.bottom > 0, `top=${shown.top} bottom=${shown.bottom}`);
  await p.context().close();
}

// ───────────────────── an open menu goes with the header it belongs to
{
  // A dropdown is positioned OUTSIDE the header's border box, so parking the
  // box does not park the menu. Measured in Chromium before the fix: header at
  // `bottom: 0` and `inert`, its menu still occupying -4 → 258 — a panel over
  // most of the screen, at `z-40`, that nothing could click.
  //
  // Appended last on purpose: every previous check that was inserted before
  // the reduced-motion block printed out of sequence and had to be renumbered.
  const p = await phone();
  await p.evaluate(() => document.querySelector('[data-testid="header-mobile"] button')?.click());
  await p.waitForTimeout(500);
  const opened = await p.evaluate(() =>
    !!document.querySelector('[data-testid="header-mobile"] [role="group"]'));
  if (!opened) {
    skip('19 a parked header takes its open menu with it', 'the "more" menu did not open');
  } else {
    const parked = await deepAndHidden(p);
    const menu = await p.evaluate(() => {
      const header = document.querySelector('header');
      const group = document.querySelector('[data-testid="header-mobile"] [role="group"]');
      const r = group?.getBoundingClientRect();
      return {
        stillOpen: !!group,
        bottom: r ? Math.round(r.bottom) : null,
        overflow: getComputedStyle(header).overflow,
        // Sticky must survive the clipping: `overflow` creates a formatting
        // context, and this header's whole design rests on staying sticky.
        position: getComputedStyle(header).position,
      };
    });
    if (parked.bottom > 0) {
      skip('19 a parked header takes its open menu with it',
        `the header would not park (bottom=${parked.bottom})`);
    } else {
      check('19 a parked header takes its open menu with it',
        menu.overflow === 'hidden' && menu.position === 'sticky',
        `overflow=${menu.overflow} position=${menu.position} menuBottom=${menu.bottom} stillOpen=${menu.stillOpen}`);
    }
  }
  await p.context().close();
}

await browser.close();
finish();
