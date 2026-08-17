/**
 * Browser verification for the filter panel's reveal AND its dismissal.
 *
 * Everything this plan risks is geometry, motion and event ordering, and jsdom
 * computes none of it. Two defects on the preceding branch were found only
 * here, and this plan's own review surfaced two more (a bubbling
 * `transitionend`, and a scroll correction knocking out the sentinel that
 * gates its own animation) that no unit test can see.
 *
 * The invariant that matters is NOT that `scrollY` is unchanged — opening and
 * closing insert and remove in-flow content above the reader, so `scrollY`
 * SHOULD move by exactly that height. What must not move is the content the
 * reader is looking at.
 *
 * Run against a dev server, or any deploy: `URL=https://… node <this>`.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:3000/';
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();

async function phone({ reducedMotion } = {}) {
  // Chautauqua's own timezone, pinned rather than inherited from the runner.
  //
  // Event `startDate`s are Institution-local and carry no offset, so the app
  // effectively treats the browser's clock as event-time. CI runs UTC, which
  // in the afternoon Eastern means the app believes the day's programming has
  // already ended — under the default `Now` scope today then has no upcoming
  // events, and `11c ⟳ Now hides once back on today` fails because the anchor
  // cannot land on today. Reproduced by A/B: this suite passes in Eastern and
  // fails in UTC on `main` as well as on any branch, so `browser-checks` was
  // failing for everyone after roughly 20:00 UTC and passing earlier in the
  // day. Pinning makes every date-sensitive check here independent of the
  // wall-clock hour and of where it is run.
  //
  // This pins the TEST's clock, not the app's. Whether `now` ought to be
  // evaluated in the Institution's timezone rather than the device's is a real
  // product question — a visitor on a non-Eastern device late in their local
  // day sees today's events as already past — and is deliberately left alone
  // here rather than answered by a test harness.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: 'America/New_York',
    ...(reducedMotion ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-day-key]');
  return page;
}

const toggle = p => p.locator('[data-day-rail] button[aria-expanded]').first();
const searchVisible = p => p.evaluate(() => {
  const el = document.querySelector('input[type="text"], input[type="search"]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
});
// The reader's frame of reference: a day section's viewport-relative top.
const pickRef = p => p.evaluate(() => {
  const railBottom = document.querySelector('[data-day-rail]').getBoundingClientRect().bottom;
  const s = [...document.querySelectorAll('[data-day-key]')]
    .find(e => e.getBoundingClientRect().bottom > railBottom + 10);
  return s?.dataset.dayKey ?? null;
});
const refTop = (p, k) => p.evaluate(
  key => Math.round(document.querySelector(`[data-day-key="${key}"]`).getBoundingClientRect().top), k);
const fixedGhosts = p => p.evaluate(() =>
  [...document.querySelectorAll('div')].filter(e => getComputedStyle(e).position === 'fixed'
    && e.querySelector('input[type="text"], input[type="search"]')).length);

// ─────────────────────────────────────────────── reveal still works
{
  const p = await phone();
  check('1 search visible at page top', await searchVisible(p));
  const chips = await p.$$eval('[data-day-rail] [data-chip]:not([aria-disabled="true"])', e => e.map(x => x.dataset.chip));
  const last = chips[chips.length - 1];
  await p.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), last);
  await p.waitForTimeout(2500);
  check('2 rail teleports to the last day', (await p.evaluate(() => window.scrollY)) > 3000,
    `scrollY=${await p.evaluate(() => Math.round(window.scrollY))}, chip=${last}`);
  check('3 search is NOT reachable after the jump', !(await searchVisible(p)));
  check('4 a filters toggle is present', await toggle(p).count() > 0);

  const refKey = await pickRef(p);
  const before = await refTop(p, refKey);
  await toggle(p).click();
  await p.waitForTimeout(600);
  check('5 opening reveals the search field', await searchVisible(p));
  check('6 opening does not move the reader', Math.abs((await refTop(p, refKey)) - before) <= 2,
    `day ${refKey}: ${before} → ${await refTop(p, refKey)}`);
  check('7 toggle reports expanded', (await toggle(p).getAttribute('aria-expanded')) === 'true');
  check('8 rail still visible with panel open', await p.evaluate(() => {
    const r = document.querySelector('[data-day-rail]')?.getBoundingClientRect();
    return !!r && r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 0;
  }));
  await p.context().close();
}

// ─────────────────────────────────── dismissal: the point of this plan
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await toggle(p).click();
  await p.waitForTimeout(600);
  check('9 panel opens when scrolled', await searchVisible(p));

  // A filter change must NOT dismiss — picking a venue, a category and a week
  // is one intent. This is the guard against keying dismissal off `scroll`.
  await p.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Today')?.click());
  await p.waitForTimeout(700);
  check('10 a filter change does NOT dismiss', await searchVisible(p));

  // Scrolling the panel's own overflow must not dismiss either.
  await p.evaluate(() => {
    const el = document.querySelector('input[type="text"], input[type="search"]')
      ?.closest('[class*="overflow-y-auto"]');
    el?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
  });
  await p.waitForTimeout(400);
  check('11 a gesture inside the panel does NOT dismiss', await searchVisible(p));

  // A real wheel over the list does dismiss. The wheel scrolls by its own
  // delta, so the reader legitimately moves by that much — subtract it, or the
  // check measures the gesture rather than the correction.
  const refKey = await pickRef(p);
  const before = refKey ? await refTop(p, refKey) : null;
  const WHEEL = 120;
  await p.mouse.move(195, 700);
  await p.mouse.wheel(0, WHEEL);
  await p.waitForTimeout(900);
  check('12 a real wheel dismisses the panel', !(await searchVisible(p)));
  if (refKey && before !== null) {
    const moved = (await refTop(p, refKey)) - before;
    // Expected: -WHEEL (the reader's own scroll) and nothing more. An extra
    // ~281px would be the panel's height leaking in — the bug this guards.
    check('13 dismissal moves the reader by the gesture only, not the panel height',
      Math.abs(moved + WHEEL) <= 4, `moved ${moved}px, wheel was ${WHEEL}px`);
  }
  check('14 no fixed ghost left behind after the exit', (await fixedGhosts(p)) === 0,
    `${await fixedGhosts(p)} fixed panel(s)`);
  // Scrolling back up must NOT bring it back — only the toggle does.
  await p.evaluate(() => window.scrollBy(0, -400));
  await p.waitForTimeout(700);
  check('15 scrolling up does NOT restore it', !(await searchVisible(p)));
  await p.context().close();
}

// ─────────────────────────────── touch dismissal, the phone's real gesture
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await toggle(p).click();
  await p.waitForTimeout(600);
  await p.touchscreen.tap(195, 780);
  await p.waitForTimeout(900);
  check('16 a touch gesture dismisses the panel', !(await searchVisible(p)));
  await p.context().close();
}

// ─────────────────── the two defects review found that no unit test sees
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await toggle(p).click();
  await p.waitForTimeout(600);
  // A chip's Tailwind colour transition ends and bubbles to the panel. If the
  // exit listener does not filter on target, that cuts the slide short.
  //
  // This MUST happen mid-exit: the listener only exists while `exiting` is
  // true, so an earlier version of this check — which dispatched while the
  // panel was merely open — reached nobody and passed no matter what the
  // code did. Dismiss first, then dispatch, then assert the panel is still
  // genuinely mid-animation.
  await p.mouse.move(195, 700);
  await p.mouse.wheel(0, 100);
  await p.waitForTimeout(60);
  await p.evaluate(() => {
    const t = document.querySelector('[data-day-rail] button[aria-expanded]');
    const panel = t && document.getElementById(t.getAttribute('aria-controls'));
    panel?.querySelector('button')?.dispatchEvent(
      new TransitionEvent('transitionend', { bubbles: true, propertyName: 'color' }));
  });
  await p.waitForTimeout(60);
  const midSlide = await p.evaluate(() => {
    const t = document.querySelector('[data-day-rail] button[aria-expanded]');
    const el = t && document.getElementById(t.getAttribute('aria-controls'));
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    return { found: true, position: cs.position, opacity: Number(cs.opacity), display: cs.display };
  });
  check('17 a descendant transitionend does not cut the slide short',
    midSlide.found && midSlide.position === 'fixed' && midSlide.opacity > 0 && midSlide.opacity < 1,
    `position=${midSlide.position} opacity=${midSlide.opacity} display=${midSlide.display}`);

  // The dismissal's own correction scrolls ~panel-height toward the top, which
  // can carry the reader back above the sentinel mid-exit. If the gate is not
  // latched, the half-faded ghost snaps back into flow, fully opaque.
  await p.context().close();
}
{
  const p = await phone();
  // Park just past the sentinel, so the correction's upward scroll crosses it.
  const justPast = await p.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    return Math.round(rail.getBoundingClientRect().top + window.scrollY + 120);
  });
  await p.evaluate(y => window.scrollTo(0, y), justPast);
  await p.waitForTimeout(800);
  if (await toggle(p).count() > 0) {
    await toggle(p).click();
    await p.waitForTimeout(500);
    await p.mouse.move(195, 700);
    await p.mouse.wheel(0, 100);
    // Sample mid-exit, inside the animation window.
    await p.waitForTimeout(120);
    // Resolve the panel EXACTLY, via the toggle's aria-controls. Selecting
    // "first div containing a search input" can land on an inner wrapper
    // whose position differs from the panel root's — which is what made an
    // earlier version of this check report a false failure.
    const mid = await p.evaluate(() => {
      const t = document.querySelector('[data-day-rail] button[aria-expanded]');
      const el = t && document.getElementById(t.getAttribute('aria-controls'));
      if (!el) return { found: false };
      const cs = getComputedStyle(el);
      return { found: true, position: cs.position, opacity: Number(cs.opacity) };
    });
    // Assert the opacity too. Reading it into the detail string without
    // asserting it is what let an exit that jumped straight to its end state
    // (opacity 0, no slide) pass this check.
    check('18 the exiting panel is mid-animation, not snapped back or jumped to the end',
      !mid.found || (mid.position === 'fixed' && mid.opacity > 0 && mid.opacity < 1),
      `mid-exit position=${mid.position} opacity=${mid.opacity}`);
    await p.waitForTimeout(900);
    check('19 it finishes and leaves nothing behind', (await fixedGhosts(p)) === 0);
  } else {
    check('18/19 sentinel-race scenario reachable', false, 'no toggle at that scroll position');
  }
  await p.context().close();
}

// ─────────────────────────────────────────── caret, icon, dot, reduced motion
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await toggle(p).click();
  await p.waitForTimeout(600);

  const caret = p.getByRole('button', { name: /hide filters/i });
  check('20 a Hide filters caret is present', await caret.count() > 0);
  if (await caret.count() > 0) {
    const box = await caret.first().boundingBox();
    check('21 caret hit area is at least 44px tall', !!box && box.height >= 44,
      box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'no box');
    const panelW = await p.evaluate(() => {
      const el = document.querySelector('input[type="text"], input[type="search"]')
        ?.closest('[class*="overflow-y-auto"]');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    });
    check('22 caret spans the panel width', !!box && !!panelW && box.width >= panelW - 8,
      `caret=${box ? Math.round(box.width) : '?'} panel=${panelW}`);
    await caret.first().click();
    await p.waitForTimeout(900);
    check('23 the caret closes the panel', !(await searchVisible(p)));
  }
  check('24 toggle accessible name is still Filters',
    (await toggle(p).getAttribute('aria-label')) === 'Filters',
    `aria-label=${await toggle(p).getAttribute('aria-label')}`);
  check('25 the toggle renders an icon, not the word', !/filters/i.test(
    (await toggle(p).innerText()).trim()), `text=${JSON.stringify((await toggle(p).innerText()).trim())}`);
  check('26 no horizontal overflow at 390px', (await p.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  await p.context().close();
}

// ─── the FIRST dismissal of a page is the one that was broken; prove both
{
  const p = await phone();
  const sample = async () => {
    await p.evaluate(() => window.scrollTo(0, 6000));
    await p.waitForTimeout(700);
    await toggle(p).click();
    await p.waitForTimeout(500);
    await p.mouse.move(195, 700);
    await p.mouse.wheel(0, 100);
    await p.waitForTimeout(80);
    const r = await p.evaluate(() => {
      const t = document.querySelector('[data-day-rail] button[aria-expanded]');
      const el = t && document.getElementById(t.getAttribute('aria-controls'));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { position: cs.position, opacity: Number(cs.opacity), display: cs.display };
    });
    await p.waitForTimeout(800);
    return r;
  };
  const first = await sample();
  const second = await sample();
  const animating = r => !!r && r.display !== 'none' && r.position === 'fixed'
    && r.opacity > 0 && r.opacity < 1;
  check('28 the FIRST dismissal animates', animating(first), JSON.stringify(first));
  check('29 the second dismissal animates identically', animating(second), JSON.stringify(second));
  await p.context().close();
}

// ─────────────────────────────────────────────────────── reduced motion
{
  const p = await phone({ reducedMotion: true });
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await toggle(p).click();
  await p.waitForTimeout(500);
  await p.mouse.move(195, 700);
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(60);           // well inside the animation window
  check('27 reduced motion removes it immediately, no ghost', (await fixedGhosts(p)) === 0
    && !(await searchVisible(p)), `ghosts=${await fixedGhosts(p)}`);
  await p.context().close();
}

// ──────────────────────────────── the header parks, it does not disappear
//
// The regression these guard shipped to production in #238 and made the site
// nearly unusable in Chrome: hiding the filter card removed ~290px of flow
// height above the reader, scroll anchoring subtracted that from `scrollY`,
// which clamped at the top of the document, which put the sentinel back in
// view, which un-hid the card. 2400px of slow wheel input advanced the page
// 0px and returned it to the top 20 times.
//
// No unit test can see this: it needs layout, a real sentinel, and a browser
// that implements scroll anchoring. Both Chromium and WebKit do.
{
  const p = await phone();
  const TICKS = 30, DELTA = 60;
  await p.mouse.move(195, 500);
  const ys = [];
  for (let i = 0; i < TICKS; i++) {
    await p.mouse.wheel(0, DELTA);
    await p.waitForTimeout(90);
    ys.push(await p.evaluate(() => Math.round(scrollY)));
  }
  const requested = TICKS * DELTA;
  const reversals = ys.filter((y, i) => i > 0 && y < ys[i - 1]).length;
  // Generous: the list's own lazy expansion means the page need not advance
  // the full requested amount. What must not happen is going BACKWARDS, or
  // stalling near the top.
  check('30 slow scrolling actually advances the page', ys.at(-1) > requested * 0.7,
    `${requested}px requested -> scrollY=${ys.at(-1)}`);
  check('31 slow scrolling never snaps the reader backwards', reversals === 0,
    `${reversals} of ${TICKS} ticks moved up`);

  // The mechanism, asserted directly, so a refactor back to `display: none`
  // fails here even if the scroll numbers happened to look acceptable.
  const parked = await p.evaluate(() => {
    // Identify the card the way the accessibility tree does — the element the
    // toggle names — not by guessing at a class or a shape. A fallback
    // selector here found a different element entirely on a build where the
    // card was `display: none`, and reported it as passing.
    const btn = document.querySelector('[data-day-rail] button[aria-expanded]');
    const id = btn?.getAttribute('aria-controls');
    const card = id ? document.getElementById(id) : null;
    if (!card) return null;
    const cs = getComputedStyle(card);
    const rail = document.querySelector('[data-day-rail]');
    return {
      display: cs.display,
      inert: card.hasAttribute('inert'),
      bottom: Math.round(card.getBoundingClientRect().bottom),
      railTop: rail ? Math.round(rail.getBoundingClientRect().top) : null,
    };
  });
  check('32 the parked card stays in flow rather than being removed from it',
    !!parked && parked.display !== 'none', JSON.stringify(parked));
  check('33 the parked card is out of reach of keyboard and screen readers',
    !!parked && parked.inert, `inert=${parked?.inert}`);
  check('34 the card is parked above the viewport with the rail flush at the top',
    !!parked && parked.bottom <= 1 && Math.abs(parked.railTop) <= 1,
    `cardBottom=${parked?.bottom} railTop=${parked?.railTop}`);
  await p.context().close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map(f => `  - ${f.name}: ${f.detail ?? ''}`).join('\n'));
  process.exit(1);
}
