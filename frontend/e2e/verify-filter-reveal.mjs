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
import { pinClock } from './fixedNow.mjs';
import { check, skip, finish } from './results.mjs';
import { enterList, makeRoomBelow } from './regime.mjs';

const URL = process.env.URL ?? 'http://localhost:3000/';

const browser = await chromium.launch();

async function phone({ reducedMotion, viewport } = {}) {
  // Chautauqua's own timezone, kept for belt-and-braces — it is not
  // load-bearing. The paragraph that used to be here claimed the app "treats
  // the browser's clock as event-time" and that whether `now` should be
  // evaluated in the Institution's timezone was an open product question. Both
  // were true when written and #243 ("resolve every date in the Institution's
  // timezone") made them false: `parseEventDate` reads a naive `startDate` as
  // Institution wall time, `dayKeyOf` resolves the day key in `CHQ_ZONE`, and
  // `chqDateAt` builds instants from Institution parts. `verify-timezone.mjs`
  // holds the standing proof across `America/New_York`, `UTC`,
  // `America/Los_Angeles` and `Asia/Tokyo`.
  //
  // The identical stale paragraph in `verify-rail.mjs` outlived its truth long
  // enough to convince a later reader there was an unfixed product bug, which
  // is why this copy is corrected rather than left to do the same. This suite
  // is not hour-sensitive; it is pinned below all the same, so that `E2E_NOW`
  // can reach it and its off-season branch is testable on any date.
  const ctx = await browser.newContext({
    viewport: viewport ?? { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: 'America/New_York',
    ...(reducedMotion ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  // Pinned even though this suite is not hour-sensitive, and the earlier note
  // here saying it therefore needs no clock is now out of date. Without a pin
  // `E2E_NOW` cannot reach this suite at all, which leaves its off-season
  // branch — the one #269 is about — unreachable for testing eleven months of
  // the year. `setFixedTime` changes nothing the checks below measure; see
  // `fixedNow.mjs` for what is pinned and, more importantly, what is not.
  await pinClock(page);
  // Tie the context's lifetime to the page's. Callers only ever `page.close()`,
  // so without this every check leaks a whole `BrowserContext` — roughly twenty
  // of them across a run, each holding its own browser process resources.
  page.once('close', () => { ctx.close().catch(() => {}); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Off-season the default screen is the landing, not a day list; see
  // `regime.mjs` for what this does about it.
  await enterList(page);
  return page;
}

// The funnel lives in the SITE HEADER now (#274 phase 3), not on the day
// rail.
//
// `[aria-label="Filters"]` is load-bearing, not decorative, and narrowing on
// `[aria-expanded]` instead is what broke this suite once already: the day
// rail's week-chooser trigger carries `aria-expanded` too, and so do the
// header's own link menus. Any query for "the" control of a given ARIA shape
// needs a selector specific enough to survive a sibling gaining the same
// shape.
const toggle = p => p.locator('[data-site-header] button[aria-label="Filters"]').first();

/**
 * Bring the site header back, the way a reader does: a small upward flick.
 *
 * Required before every toggle press that follows a downward gesture. A hidden
 * header is parked above the viewport AND `inert`, so the funnel inside it is
 * neither hittable nor scrollable-into-view (it is sticky; there is nowhere to
 * scroll it to). That is the reachability contract this phase depends on —
 * #272's reveal is what replaces the rail toggle's `visible` flag.
 */
const revealHeader = async (p) => {
  await p.mouse.move(195, 500);
  await p.mouse.wheel(0, -80);
  await p.waitForTimeout(450);
};

/** Reveal the header, then open the panel from it. */
const openFilters = async (p) => {
  await revealHeader(p);
  await toggle(p).click();
  await p.waitForTimeout(600);
};

/** Whether the site header is showing, by its own painted position. */
const headerShown = p => p.evaluate(() => {
  const h = document.querySelector('[data-site-header]');
  if (!h) return false;
  return Math.round(h.getBoundingClientRect().top) >= -1;
});
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
/**
 * Filter panels still being PAINTED — the "stranded ghost" signal.
 *
 * Counting `position: fixed` panels is what this used to do, and it stopped
 * meaning anything in #274 phase 3: the panel is fixed in every state now,
 * closed included, so that count is 1 forever and the check it fed could
 * never fail. What must be zero after an exit is panels still occupying
 * screen — which `display: none` (from the overlay's `hidden`) makes a
 * zero-height rect.
 */
const strandedPanels = p => p.evaluate(() =>
  [...document.querySelectorAll('[data-filter-card]')]
    .filter(e => e.getBoundingClientRect().height > 0).length);

// ─────────────────────────────────────────────── reveal still works
{
  const p = await phone();
  // No filter card at the top of the page any more — search lives behind the
  // funnel everywhere (#274 phase 3). The funnel itself is present from the
  // first paint, which is the change: the rail's toggle only appeared once the
  // reader had scrolled past the in-flow card.
  check('1 no filter card in flow at page top, and a funnel in the header',
    !(await searchVisible(p)) && await toggle(p).count() > 0);
  const chips = await p.$$eval('[data-day-rail] [data-chip]:not([aria-disabled="true"])', e => e.map(x => x.dataset.chip));
  const last = chips[chips.length - 1];
  await p.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), last);
  await p.waitForTimeout(2500);
  check('2 rail teleports to the last day', (await p.evaluate(() => window.scrollY)) > 3000,
    `scrollY=${await p.evaluate(() => Math.round(window.scrollY))}, chip=${last}`);
  check('3 search is NOT reachable after the jump', !(await searchVisible(p)));

  const refKey = await pickRef(p);
  const before = await refTop(p, refKey);
  const railTopBefore = await p.evaluate(
    () => Math.round(document.querySelector('[data-day-rail]').getBoundingClientRect().top));
  await toggle(p).click();
  await p.waitForTimeout(600);
  check('5 opening reveals the search field', await searchVisible(p));
  // Stronger than it was. The panel used to insert real in-flow content above
  // the reader and `useFilterPanel` corrected for it; now there is nothing to
  // correct, so any movement at all is a defect rather than a correction that
  // came out even.
  check('6 opening does not move the reader', Math.abs((await refTop(p, refKey)) - before) <= 2,
    `day ${refKey}: ${before} → ${await refTop(p, refKey)}`);
  check('7 toggle reports expanded', (await toggle(p).getAttribute('aria-expanded')) === 'true');
  // The panel OVERLAYS the rail rather than displacing it — the rail's own
  // `top` is unchanged by opening. That is deliberate: the rail's height is
  // what every day header and scroll target is computed against
  // (`dayHeaderTop`), so a panel that moved the rail would move all of them.
  const railTopAfter = await p.evaluate(
    () => Math.round(document.querySelector('[data-day-rail]').getBoundingClientRect().top));
  check('8 the panel overlays the rail rather than displacing it',
    Math.abs(railTopAfter - railTopBefore) <= 1,
    `railTop ${railTopBefore} → ${railTopAfter}`);
  await p.context().close();
}

// ───────────────────── the funnel comes back with the header, from anywhere
//
// This is what replaces the rail toggle's `visible` flag. The rail's Filters
// button appeared once the reader had scrolled past the in-flow card; the
// header's funnel is always there, and reachability comes from #272's reveal
// instead — so the reveal is what has to be proved, not the flag.
//
// Its own page, deliberately. Running it after the rail teleport in the block
// above did not work and reported a failure against a correct app: the
// teleport leaves `useDayAnchor`'s hold pinning the anchored day across
// content changes, so a `window.scrollTo` into the middle of the list is
// undone and the reader stays at the document's end — where a downward wheel
// scrolls nothing, `scrollY` never changes, and the reveal rule is right to
// decide nothing. Probed directly: five 200px wheels, scrollY 7573 every
// time.
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  // The downward flick below needs somewhere to flick to; see `makeRoomBelow`.
  const made4a = await makeRoomBelow(p);

  // Wheel until it is actually hidden rather than assuming one tick does it —
  // the lesson `verify-header-reveal`'s own `deepAndHidden` already carries.
  // One tick is not a reliable unit of scrolling: WebKit on Linux splits a
  // single tick across frames, and a correction still in flight can net
  // against it.
  let hidden = false;
  for (let i = 0; i < 5 && !hidden; i++) {
    await p.mouse.move(195, 500);
    await p.mouse.wheel(0, 120);
    await p.waitForTimeout(450);
    hidden = !(await headerShown(p));
  }
  // The precondition is asserted, not assumed. A funnel that "came back" from
  // a header that never left proves nothing.
  check('4a the header, and the funnel with it, goes away on a downward flick',
    hidden, `headerShown=${await headerShown(p)} (made ${made4a}px of room below)`);

  await revealHeader(p);
  check('4b a small upward flick brings both back, and the funnel is usable',
    await headerShown(p) && await toggle(p).isEnabled()
      && !(await p.evaluate(() =>
        !!document.querySelector('[data-site-header]')?.hasAttribute('inert'))),
    `headerShown=${await headerShown(p)}`);

  await toggle(p).click();
  await p.waitForTimeout(600);
  check('4c and the panel opens from it, deep in the list', await searchVisible(p));
  await p.context().close();
}

// ─────────────────────────────────── dismissal: the point of this plan
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await openFilters(p);
  check('9 panel opens when scrolled', await searchVisible(p));

  // A filter change must NOT dismiss — picking a venue, a category and a week
  // is one intent. This is the guard against keying dismissal off `scroll`.
  //
  // A VENUE, since #274 phase 4. This used to click `All Season`, and the
  // paragraph here explained at length why that scope rather than `Today`
  // (off-season `Today` matched nothing, the list emptied, and the document
  // collapsed out from under checks 11-15). Phase 4 deleted every date scope,
  // so the button simply was not there any more: `?.click()` did nothing,
  // `filterChanged` went false, and the check failed loudly rather than
  // silently — which is the one thing the conjunction below was built to do.
  //
  // A venue is the same kind of thing the scope was standing in for: a filter
  // the reader picked, applied from inside the panel, that leaves a populated
  // list in either regime. The Amphitheater is the Institution's main stage
  // and carries programming in every season the feed publishes, so it is a
  // fixture rather than a coincidence of today's snapshot — the same reasoning
  // `verify-rail`'s 'williamsburg' seed records. The first location chip is
  // the fallback if it is ever renamed, so a rename degrades the check's
  // legibility rather than deleting its subject.
  //
  // Reports which button it actually clicked, and check 10 is conjoined with
  // it. `?.click()` alone is a silent no-op when the button is missing or
  // renamed — the panel then stays open because nothing happened, and the
  // check PASSES having proved nothing about dismissal. That is the vacuous
  // pass this whole suite is otherwise about, sitting in the middle of it.
  // Measured before the filter so 10b has a number to restore TO. Without it
  // that check read `restoredDays > 0`, which the narrowed list satisfies —
  // see below.
  const daysUnfiltered = await p.evaluate(() => document.querySelectorAll('[data-day-key]').length);
  const clicked = await p.evaluate(() => {
    const chips = [...document.querySelectorAll('button[title]')]
      .filter(b => b.offsetParent && b.getAttribute('title') !== 'Filters');
    const btn = chips.find(b => b.getAttribute('title') === 'Amphitheater') ?? chips[0];
    btn?.click();
    return btn?.getAttribute('title') ?? null;
  });
  await p.waitForTimeout(700);
  check('10 a filter change does NOT dismiss',
    !!clicked && await searchVisible(p),
    clicked ? `clicked the ${clicked} venue chip` : 'NO venue chip found — the click was a no-op');

  // Now put it back, with the panel still open — a second filter change,
  // which check 11 immediately re-asserts has not dismissed anything either.
  //
  // This is not tidiness. A venue narrows the list hard: measured at 390px,
  // selecting the Amphitheater took the document from 160,609px to 24,317px
  // and 89 day sections to 68, which left the reader 974px from the bottom of
  // a document they had been 11,000px inside. Check 13 then measured `moved
  // 0px` against a 120px wheel and failed on a correct app — the collapse, not
  // the dismissal, was what it was measuring. The date scope this check used
  // to click had no such effect, which is why the restore is new rather than
  // something the old version needed.
  const restored = await p.evaluate(title => {
    const btn = [...document.querySelectorAll('button[title]')]
      .find(b => b.offsetParent && b.getAttribute('title') === title);
    btn?.click();
    return !!btn;
  }, clicked);
  await p.waitForTimeout(900);
  const restoredDays = await p.evaluate(() => document.querySelectorAll('[data-day-key]').length);
  // `restoredDays > 0` was the condition here, and "restores the list" was
  // the half of this check's name that it did not test: the paragraph above
  // records that selecting the Amphitheater takes the list from 89 day
  // sections to 68, and 68 > 0. The check passed with the venue still
  // applied — with the deselect click a no-op, which is exactly the "silent
  // `?.click()` no-op" failure check 10 above was rewritten to close.
  //
  // Equality against the pre-filter count is the real form, and it is safe
  // even when the chosen chip narrows nothing (the `chips[0]` fallback):
  // both counts are then the same number and it still holds.
  check('10b deselecting it does not dismiss either, and restores the list',
    restored && restoredDays === daysUnfiltered && await searchVisible(p),
    `${restoredDays} of ${daysUnfiltered} day sections back`);

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
  const mountedBefore = await p.evaluate(() => document.querySelectorAll('[data-day-key]').length);
  const WHEEL = 120;
  await p.mouse.move(195, 700);
  await p.mouse.wheel(0, WHEEL);
  await p.waitForTimeout(900);
  check('12 a real wheel dismisses the panel', !(await searchVisible(p)));
  if (refKey && before !== null) {
    const moved = (await refTop(p, refKey)) - before;
    const mountedAfter = await p.evaluate(() => document.querySelectorAll('[data-day-key]').length);
    if (mountedAfter !== mountedBefore) {
      // Day sections appeared or vanished while the wheel was in flight, so
      // the reader's movement is no longer attributable to the dismissal and
      // this measurement cannot mean anything either way.
      //
      // **This branch is very nearly dead since #274 phase 4** and is kept
      // rather than deleted. It existed for the render window: off-season,
      // switching scope left a few days mounted with the reader near the
      // document's end, where a 120px wheel triggered an expansion (measured
      // pinned to 2026-09-15: sections 3 → 5, document 6,606 → 12,485px,
      // reader moved 449px against a 120px gesture). The window is gone and
      // every day of the year is mounted on load, so a wheel cannot mount
      // anything. What can still change the count is the filter applied by
      // check 10 above landing late, which is exactly the same confounder —
      // and it is why the skip reason below no longer names the window.
      //
      // Counted in day sections rather than document height, and that matters:
      // a height threshold guesses at a magnitude, and the first one tried
      // (8px) stood the check down in season on a 53px reflow that had
      // produced a perfect -120px result. Mounting is the mechanism, so
      // mounting is what to watch.
      skip('13 dismissal moves the reader by the gesture only, not the panel height',
        `the mounted day set changed during the wheel (${mountedBefore} → ${mountedAfter} day sections), ` +
        `so the ${moved}px the reader moved is not attributable to the dismissal`);
    } else {
      // Expected: -WHEEL (the reader's own scroll) and nothing more. An extra
      // ~281px would be the panel's height leaking in — the bug this guards.
      check('13 dismissal moves the reader by the gesture only, not the panel height',
        Math.abs(moved + WHEEL) <= 4, `moved ${moved}px, wheel was ${WHEEL}px`);
    }
  }
  check('14 no panel left painted after the exit', (await strandedPanels(p)) === 0,
    `${await strandedPanels(p)} painted panel(s)`);
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
  await openFilters(p);
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
  await openFilters(p);
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
    // aria-label narrows past the week chooser trigger — see `toggle` above.
    const t = document.querySelector('[data-site-header] button[aria-label="Filters"]');
    const panel = t && document.getElementById(t.getAttribute('aria-controls'));
    panel?.querySelector('button')?.dispatchEvent(
      new TransitionEvent('transitionend', { bubbles: true, propertyName: 'color' }));
  });
  await p.waitForTimeout(60);
  const midSlide = await p.evaluate(() => {
    // aria-label narrows past the week chooser trigger — see `toggle` above.
    const t = document.querySelector('[data-site-header] button[aria-label="Filters"]');
    const el = t && document.getElementById(t.getAttribute('aria-controls'));
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    return { found: true, position: cs.position, opacity: Number(cs.opacity), display: cs.display };
  });
  check('17 a descendant transitionend does not cut the slide short',
    midSlide.found && midSlide.position === 'fixed' && midSlide.opacity > 0 && midSlide.opacity < 1,
    `position=${midSlide.position} opacity=${midSlide.opacity} display=${midSlide.display}`);

  await p.context().close();
}
{
  const p = await phone();
  // A shallow scroll position, just past the rail.
  //
  // This block used to exist for a race that is gone: the dismissal's own
  // scroll correction could carry the reader back across the sentinel
  // mid-exit, dropping the ghost out of `position: fixed` at full opacity.
  // There is no correction and no sentinel now. It is kept because the depth
  // is where the FIRST dismissal of a session happens for most readers, and
  // the first dismissal is the one that was broken — a shallow position is a
  // different exit from the deep one every other block here uses.
  const justPast = await p.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    return Math.round(rail.getBoundingClientRect().top + window.scrollY + 120);
  });
  await p.evaluate(y => window.scrollTo(0, y), justPast);
  await p.waitForTimeout(800);
  {
    await openFilters(p);
    await p.mouse.move(195, 700);
    await p.mouse.wheel(0, 100);
    // Sample mid-exit, inside the animation window.
    await p.waitForTimeout(120);
    // Resolve the panel EXACTLY, via the toggle's aria-controls. Selecting
    // "first div containing a search input" can land on an inner wrapper
    // whose position differs from the panel root's — which is what made an
    // earlier version of this check report a false failure.
    const mid = await p.evaluate(() => {
      // aria-label narrows past the week chooser trigger — see `toggle` above.
      const t = document.querySelector('[data-site-header] button[aria-label="Filters"]');
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
    check('19 it finishes and leaves nothing behind', (await strandedPanels(p)) === 0);
  }
  await p.context().close();
}

// ─────────────────────────────────────────── caret, icon, dot, reduced motion
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await openFilters(p);

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
//
// A previous version of this block sampled ONE computed-style snapshot 80ms
// after the dismiss gesture and asserted `0 < opacity < 1` on it. That
// measures "did a frame with an intermediate opacity land inside this one
// 80ms window", which is a property of when the compositor happened to paint
// relative to an arbitrary sample point — not of whether the dismissal
// itself animates. On a slow, shared CI runner the exit fires correctly
// every time (confirmed by instrumenting the exit's own DOM mutation: it
// lands on schedule, 41-64ms) but the sampled instant can land before the
// browser has painted any in-between frame, or after opacity has already
// settled. Those two things came apart only on Linux CI, never on macOS.
//
// The fix is to watch every frame the browser actually paints for the
// dismissal's WHOLE duration, via `requestAnimationFrame`, rather than
// snapshot one instant. `rAF`, not `transitionstart`/`transitionrun`: a
// transition that gets skipped entirely — the actual bug this block exists
// to catch — may never fire those events, so keying on them would make the
// check unable to observe its own failure mode.
{
  const p = await phone();
  /**
   * Run the open/scroll/dismiss cycle once, recording the panel's computed
   * `opacity`/`position`/`display` on every animation frame from just before
   * the dismiss gesture until the exit settles (or a generous ceiling
   * elapses), and return that trace plus the diagnostics worth keeping from
   * the investigation that found the original check's flaw.
   */
  const sample = async () => {
    await p.evaluate(() => window.scrollTo(0, 6000));
    await p.waitForTimeout(700);
    await openFilters(p);
    // Diagnostic, gathered in the same round trip as arming the trace below
    // so it adds none of its own delay before the gesture: confirms the
    // panel actually opened (and isn't already mid-exit from a previous
    // cycle), and that the gesture is about to land on ordinary list
    // content rather than inside the panel or the toggle — `isExempt` in
    // `useFilterPanel.ts` reads the event's `target`, and a coordinate
    // resolving inside either would make the gesture exempt and nothing
    // would dismiss.
    const openedBefore = await p.evaluate(() => {
      const at = document.elementFromPoint(195, 700);
      const t = document.querySelector('[data-site-header] button[aria-label="Filters"]');
      const el = t && document.getElementById(t.getAttribute('aria-controls'));
      return {
        atPointInPanel: !!(el && at && el.contains(at)),
        atPointInToggle: !!(t && at && t.contains(at)),
        ariaExpanded: t?.getAttribute('aria-expanded') ?? null,
        exitingClass: el?.classList.contains('filter-panel-exit') ?? null,
        position: el ? getComputedStyle(el).position : null,
      };
    });
    const scrollYBeforeWheel = await p.evaluate(() => window.scrollY);
    // Arm the trace BEFORE the gesture, so the first frame after the exit's
    // own commit is inside the recorded window rather than racing a
    // fixed-delay sample against the compositor. Runs until the panel stops
    // being painted, or ~1500ms elapses.
    //
    // The settle signal used to be "the panel left `position: fixed`", and
    // #274 phase 3 made that unreachable: the panel is fixed in EVERY state
    // now, so the loop would run to its ceiling every time and `endedGone`
    // would be false against perfectly correct code. The end of an exit is
    // the overlay going `hidden`, which is a zero-height rect — measured
    // rather than read off `getComputedStyle().display`, which reports a
    // descendant of a `display: none` ancestor as its own specified value
    // rather than as `none`.
    await p.evaluate(() => {
      const t = document.querySelector('[data-site-header] button[aria-label="Filters"]');
      const el = t && document.getElementById(t.getAttribute('aria-controls'));
      window.__exitTrace = [];
      window.__exitTraceDone = false;
      if (!el) { window.__exitTraceDone = true; return; }
      const start = performance.now();
      let sawExitClass = false;
      const frame = () => {
        const cs = getComputedStyle(el);
        const painted = el.getBoundingClientRect().height > 0;
        sawExitClass = sawExitClass || el.classList.contains('filter-panel-exit');
        window.__exitTrace.push({
          t: Math.round(performance.now() - start),
          opacity: Number(cs.opacity),
          position: cs.position,
          painted,
          exitClass: el.classList.contains('filter-panel-exit'),
          connected: el.isConnected,
        });
        const settled = !el.isConnected || (sawExitClass && !painted);
        if (settled || performance.now() - start > 1500) { window.__exitTraceDone = true; return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await p.mouse.move(195, 700);
    await p.mouse.wheel(0, 100);
    // Poll the in-page loop to ITS OWN completion, rather than a fixed wait
    // — a fixed wait here would just move the original bug up one layer.
    await p.waitForFunction(() => window.__exitTraceDone === true, null, { timeout: 3000 });
    const trace = await p.evaluate(() => window.__exitTrace);
    const scrollYAfterWheel = await p.evaluate(() => window.scrollY);
    const opacities = trace.map(f => f.opacity);
    const alwaysFixed = trace.every(f => f.position === 'fixed');
    const sawExitClass = trace.some(f => f.exitClass);
    const lastFrame = trace[trace.length - 1] ?? null;
    return {
      openedBefore,
      scrollYBeforeWheel,
      scrollYAfterWheel,
      frames: trace.length,
      minOpacity: opacities.length ? Math.min(...opacities) : null,
      // The invariant, checked on every frame of the one state that used to
      // break it: an exiting panel is fixed for the whole animation.
      alwaysFixed,
      hadIntermediateOpacity: opacities.some(o => o > 0 && o < 1),
      // A real exit ran and ended: the panel genuinely carried the transition
      // class at some point, and by the time the loop stopped it was no
      // longer painted.
      endedGone: sawExitClass && !!lastFrame && !lastFrame.painted,
    };
  };
  const first = await sample();
  const second = await sample();
  // Two separate properties of the trace, checked separately so a failure
  // says which one broke:
  //  - `hadIntermediateOpacity` is the actual bug this block exists to
  //    catch — a dismissal that SNAPS goes opacity 1 -> gone with no frame
  //    in between, exactly what an unthrottled/instant transition produces.
  //  - `endedGone` is a sanity check that a real exit happened at all (as
  //    opposed to, say, the gesture being swallowed and nothing moving).
  //  - `alwaysFixed` is the phase-3 invariant, sampled on every painted frame
  //    of the exit — the one state in which the old code switched the panel
  //    out of flow and back.
  const passed = r => r.hadIntermediateOpacity && r.alwaysFixed && r.endedGone;
  const detail = r => `frames=${r.frames} minOpacity=${r.minOpacity} alwaysFixed=${r.alwaysFixed} `
    + `endedGone=${r.endedGone} hadIntermediateOpacity=${r.hadIntermediateOpacity} `
    + `scrollY=${r.scrollYBeforeWheel}->${r.scrollYAfterWheel} openedBefore=${JSON.stringify(r.openedBefore)}`;
  check('28 the FIRST dismissal animates', passed(first), detail(first));
  check('29 the second dismissal animates identically', passed(second), detail(second));
  await p.context().close();
}

// ─────────────────────────────────────────────────────── reduced motion
{
  const p = await phone({ reducedMotion: true });
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  await openFilters(p);
  await p.mouse.move(195, 700);
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(60);           // well inside the animation window
  check('27 reduced motion removes it immediately, no ghost', (await strandedPanels(p)) === 0
    && !(await searchVisible(p)), `painted=${await strandedPanels(p)}`);
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

  await p.context().close();
}

// ─────────────── the invariant itself: the panel is never in flow
//
// This is the strongest check in the suite, and the one that would have caught
// the original bug directly rather than through its symptom. Checks 30 and 31
// above measure the symptom — a page that could not be scrolled slowly. This
// measures the cause: **opening the filter panel must not change document
// height by one pixel.** Nothing above the reader can move if the document
// does not grow, so there is nothing for scroll anchoring to correct and
// nothing for the collapse to destroy.
//
// The checks that used to live here asserted the OPPOSITE half of the old
// design — that the card stayed in flow, that it was `inert` while parked, and
// that it sat exactly above the viewport with the rail flush at the top. All
// three are meaningless now, and deleting them is only acceptable because this
// replaces them with something stronger: they described one particular way of
// surviving the failure, and this describes the failure being unreachable.
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);

  const docHeight = () => p.evaluate(() => document.documentElement.scrollHeight);
  // Reveal the header FIRST, then take the closed baseline. The reveal is a
  // real wheel gesture, and a wheel moves the reader — which changes document
  // height for reasons that have nothing to do with the panel, as sections
  // coming into view swap their `contain-intrinsic-size` estimates for real
  // heights. (Before #274 phase 4 the render window mounting more days did
  // the same thing, and was the reason recorded here.) Measuring across it made this check report a 27px
  // change against code whose panel changes nothing (probed directly: 7417px
  // in all three states). The only thing allowed to vary between the two
  // measurements is the panel.
  await revealHeader(p);
  const closedBefore = await docHeight();
  await toggle(p).click();
  await p.waitForTimeout(700);
  const opened = await docHeight();
  const openedScrollY = await p.evaluate(() => Math.round(window.scrollY));

  check('32 opening the panel does not change document height',
    opened === closedBefore, `${closedBefore}px → ${opened}px`);

  // And it must not move the reader either — the same claim check 6 makes,
  // restated at depth and against the document rather than a day section, so
  // a correction that happened to come out even would still be visible as a
  // height change above.
  await p.evaluate(() => {
    const t = document.querySelector('[data-site-header] button[aria-label="Filters"]');
    t?.click();
  });
  await p.waitForTimeout(900);
  const closedAfter = await docHeight();
  check('33 closing the panel does not change document height either',
    closedAfter === closedBefore, `${closedBefore}px → ${opened}px → ${closedAfter}px`);
  check('34 neither open nor close moved the reader',
    Math.abs((await p.evaluate(() => Math.round(window.scrollY))) - openedScrollY) <= 1,
    `scrollY ${openedScrollY} → ${await p.evaluate(() => Math.round(window.scrollY))}`);
  await p.context().close();
}

// ───────────────────────── an open panel holds the site header revealed
//
// The one genuinely new behaviour in #274 phase 3. The panel hangs off the
// header's bottom edge; a header that hid out from under it would leave the
// panel floating against nothing.
//
// The release is one-directional and that is checked too: closing the panel
// hands the rule back rather than hiding a revealed header, and the reader's
// NEXT downward gesture is what hides it.
{
  const p = await phone();
  await p.evaluate(() => window.scrollTo(0, 6000));
  await p.waitForTimeout(800);
  // Checks 36 and 37 both turn on a downward gesture moving the page; see
  // `makeRoomBelow`.
  const made37 = await makeRoomBelow(p);
  await openFilters(p);
  check('35 the panel opens with the header shown', await headerShown(p));

  // A downward wheel over the list dismisses the panel — and during that same
  // gesture the header must not have gone anywhere underneath it.
  await p.mouse.move(195, 700);
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(900);
  check('36 the dismissing gesture leaves the header where the reader can reach it',
    await headerShown(p), `headerShown=${await headerShown(p)}`);

  // Rule handed back: a fresh downward gesture, with no panel open, hides it
  // again. A hold that was never released would pin the header open forever.
  await p.mouse.move(195, 500);
  await p.mouse.wheel(0, 300);
  await p.waitForTimeout(600);
  check('37 the header hides again once the panel is closed',
    !(await headerShown(p)),
    `headerShown=${await headerShown(p)} (made ${made37}px of room below)`);
  await p.context().close();
}

// ─────────────── the drawer handle stays a handle when the drawer overflows
//
// The panel caps its own height and scrolls internally, and the caret lives
// inside that scroll container. When the contents exceed the cap, an ordinary
// caret scrolls away with them — a drawer handle the reader has to scroll the
// drawer to find is not a drawer handle. `sticky bottom-0` on the caret is
// what stops that.
//
// Not a #274 phase 3 regression, despite a review flagging it as one: the
// caret sat inside the `max-h-[70vh] overflow-y-auto` element before that
// phase too. It has been worth fixing since it was written.
//
// **A landscape phone (844x390), not the portrait one every other block uses.**
// Portrait does not overflow and never will at this content size — measured
// 313px of content against a 768px cap at 390x844, and still 313 against 404
// at 390x480. A check written at 390x844 would pass with the `sticky` removed
// and prove nothing. The precondition is asserted below rather than assumed,
// for exactly that reason.
{
  const p = await phone({ viewport: { width: 844, height: 390 } });
  await p.evaluate(() => window.scrollTo(0, 3000));
  await p.waitForTimeout(700);
  await openFilters(p);

  const caret = await p.evaluate(() => {
    const box = document.querySelector('[data-filter-panel-box]');
    const el = [...document.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label') === 'Hide filters');
    if (!box || !el) return null;
    const b = box.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    return {
      // The precondition: the panel really is scrolling internally here.
      overflows: box.scrollHeight > box.clientHeight + 1,
      scrollH: box.scrollHeight,
      clientH: box.clientHeight,
      // And the caret is inside the panel's VISIBLE box, without anyone
      // having scrolled the panel first.
      visible: c.bottom <= b.bottom + 1 && c.top >= b.top - 1 && c.height > 0,
      caret: `${Math.round(c.top)}→${Math.round(c.bottom)}`,
      boxBottom: Math.round(b.bottom),
    };
  });
  check('38-pre the panel actually overflows its cap at this size',
    !!caret && caret.overflows,
    caret ? `scrollHeight=${caret.scrollH} clientHeight=${caret.clientH}` : 'no panel');
  check('38 the Hide filters caret stays on screen when the panel overflows',
    !!caret && caret.overflows && caret.visible,
    caret ? `caret ${caret.caret}, panel bottom ${caret.boxBottom}` : 'no caret');
  await p.context().close();
}

await browser.close();
finish();
