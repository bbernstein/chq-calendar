/**
 * The list is the whole year (#274 phase 4).
 *
 * jsdom has no layout, no `content-visibility`, no scroll anchoring and no
 * compositor, so every claim this phase rests on is unreachable from the unit
 * suite. These are the checks that can fail.
 *
 * Each check names the defect that falsifies it, and the result of actually
 * injecting that defect — see the task 7 report for the raw output. A check
 * whose falsification was never run is a check nobody has any reason to
 * believe.
 */
import { chromium, webkit } from 'playwright';
import { pinClock } from './fixedNow.mjs';
import { check, skip, finish } from './results.mjs';
import { enterList, currentRegime } from './regime.mjs';

const URL = process.env.URL || 'http://localhost:3000/';
const browser = await chromium.launch();

async function newPageOn(engine, { width = 390, height = 844, storage, cpu, query = '', traceScrolls = false } = {}) {
  const ctx = await engine.newContext({ viewport: { width, height }, timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  await pinClock(page);
  page.once('close', () => { ctx.close().catch(() => {}); });
  if (storage) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), storage);
  // Records how the app moves the reader, for check 7c. Installed before any
  // app code runs so nothing is missed, and it wraps rather than replaces —
  // the scroll still happens, so the page behaves exactly as it would
  // untraced.
  if (traceScrolls) {
    await page.addInitScript(() => {
      window.__scrollOps = [];
      const by = window.scrollBy.bind(window);
      const to = window.scrollTo.bind(window);
      window.scrollBy = function (...a) {
        window.__scrollOps.push({ op: 'scrollBy', delta: a.length > 1 ? a[1] : a[0]?.top });
        return by(...a);
      };
      window.scrollTo = function (...a) {
        window.__scrollOps.push({ op: 'scrollTo', delta: a.length > 1 ? a[1] : a[0]?.top });
        return to(...a);
      };
    });
  }
  if (cpu) {
    const client = await ctx.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }
  await page.goto(URL + query, { waitUntil: 'networkidle' });
  await enterList(page);
  return page;
}
const newPage = opts => newPageOn(browser, opts);

/**
 * How far below the viewport top the sticky chrome reaches — the same sum
 * `useDayAnchor.stickyOffset()` computes, read from the same two custom
 * properties the app publishes rather than hardcoded, so browser text zoom
 * and the header reveal (#272) cannot make this check disagree with the app
 * about where "under the chrome" is.
 */
const STICKY_OFFSET = `
  (function () {
    const cs = getComputedStyle(document.documentElement);
    return (parseFloat(cs.getPropertyValue('--site-header-offset-target')) || 0)
         + (parseFloat(cs.getPropertyValue('--day-rail-h')) || 0);
  })()
`;

/** The day section parked under the sticky chrome, and how far off it is. */
const landedSection = page => page.evaluate(`
  (function () {
    const off = ${STICKY_OFFSET};
    const secs = [...document.querySelectorAll('[data-day-key]')];
    const under = secs.find(s => s.getBoundingClientRect().top >= off - 2);
    return {
      off,
      key: under ? under.dataset.dayKey : null,
      top: under ? Math.round(under.getBoundingClientRect().top * 100) / 100 : null,
      scrollY: Math.round(window.scrollY),
      days: secs.length,
      first: secs[0] ? secs[0].dataset.dayKey : null,
    };
  })()
`);

/**
 * Wait until the page stops moving on its own.
 *
 * The landing scroll, the settle hold's `ResizeObserver` reasserts, and the
 * document shrinking as `contain-intrinsic-size` estimates are replaced by
 * real heights all happen after `enterList` returns. A fixed `waitForTimeout`
 * would either be too short (measuring mid-flight) or a tax on every check.
 */
async function settle(page, { quietMs = 600, timeoutMs = 12000 } = {}) {
  const started = Date.now();
  let last = null;
  let stableSince = 0;
  while (Date.now() - started < timeoutMs) {
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) {
      if (stableSince && Date.now() - stableSince >= quietMs) return y;
      if (!stableSince) stableSince = Date.now();
    } else {
      last = y;
      stableSince = 0;
    }
    await page.waitForTimeout(150);
  }
  return last;
}

/**
 * Wait until the main thread has been quiet for `quietMs`.
 *
 * Load is not over when the list appears. The article- and program-link
 * sidecars arrive on their own schedule and change `EventListView`'s props,
 * which re-renders all 1,687 cards — measured 2026-08-26 at 4x throttle as a
 * single 689ms long task landing several seconds after the day sections did.
 * A scroll measurement that starts before that has happened attributes it to
 * scrolling, and reports a 753ms "frame" for a page that was not scrolling
 * badly at all. With this wait in front of it the same scroll records zero
 * long tasks.
 *
 * `longtask` rather than a fixed sleep: the arrival time depends on the CDN
 * and the throttle rate, so any constant is either wrong or wasteful.
 */
async function waitForQuiet(page, { quietMs = 2000, timeoutMs = 25000 } = {}) {
  await page.evaluate(() => {
    if (window.__quiet) return;
    window.__quiet = { last: performance.now() };
    new PerformanceObserver(() => { window.__quiet.last = performance.now(); })
      .observe({ type: 'longtask' });
  });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const since = await page.evaluate(() => performance.now() - window.__quiet.last);
    if (since >= quietMs) return Math.round(since);
    await page.waitForTimeout(250);
  }
  return null;
}

/** The year the app itself says it is showing — the header's own pill. */
const selectedYear = page => page.evaluate(() => {
  const pill = [...document.querySelectorAll('header button')]
    .map(b => /^(\d{4}) Season$/.exec(b.textContent.trim()))
    .find(Boolean);
  return pill ? Number(pill[1]) : null;
});

// ---------------------------------------------------------------------------
// 1 — the whole year is mounted.
//
// FALSIFIED 2026-08-26 against this branch's own preview build. Injected
// `groupedEvents.slice(0, 12)` at the `<EventListView>` call site in
// `page.tsx`, confirmed the marker prop reached the bundle, and measured:
// 12 sections of 89 and 12 cards of 1,687 — 1a FAIL, 1b FAIL.
{
  const page = await newPage();
  const year = await selectedYear(page);
  const seen = await page.evaluate(async y => {
    // The same per-year file `useEventData` fetches, not the combined
    // `all-events.json`: the app never reads the combined one, and counting
    // against a file the app does not use would be a check on the CDN rather
    // than on the app.
    const res = await fetch(`/cache/calendar-cache/all-events-${y}.json`);
    const { data } = await res.json();
    const days = new Set(data.map(e => e.startDate.slice(0, 10)));
    return {
      expectedDays: days.size,
      expectedEvents: data.length,
      mountedDays: document.querySelectorAll('[data-day-key]').length,
      mountedCards: document.querySelectorAll('[data-event-id]').length,
    };
  }, year);
  check('1a every day of the year is mounted', seen.mountedDays === seen.expectedDays,
    `${seen.mountedDays} sections of ${seen.expectedDays} day keys in the ${year} feed`);
  check('1b every event of the year is mounted', seen.mountedCards === seen.expectedEvents,
    `${seen.mountedCards} cards of ${seen.expectedEvents} events in the ${year} feed`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 2 — there is no growth sentinel left.
//
// The render window is deleted, so nothing may observe a bottom sentinel to
// mount more days. Asserted at the top AND at the bottom: a sentinel that
// only ever appears once the reader reaches the end is exactly the shape this
// would take if it came back.
{
  const page = await newPage();
  await settle(page);
  const atTop = await page.$$('[data-testid="event-list-sentinel"]');
  const before = await page.$$eval('[data-day-key]', e => e.length);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1200);
  const atBottom = await page.$$('[data-testid="event-list-sentinel"]');
  const after = await page.$$eval('[data-day-key]', e => e.length);
  check('2a no growth sentinel on load', atTop.length === 0, `${atTop.length} sentinels`);
  check('2b no growth sentinel at the bottom either', atBottom.length === 0, `${atBottom.length} sentinels`);
  check('2c the list did not grow on the way down', before === after, `${before} → ${after} sections`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 3 — day sections skip their own layout off screen.
//
// This is what makes mounting the whole year affordable, and it is a style
// the browser either applies or does not — jsdom reports whatever string was
// set on the inline style and can never tell the difference.
//
// FALSIFIED 2026-08-26. Deleted `contentVisibility: 'auto'` from
// EventListView's style object, confirmed the prop key was gone from the
// served bundle, and measured `content-visibility: visible` on both the first
// and the last section — 3a FAIL, 3c FAIL. 3b still passed, correctly:
// `contain-intrinsic-size` was left in place by that injection, and 3b is the
// check that speaks for it.
//
// **This is the check that speaks for `content-visibility`, and it is the
// only one that does.** Check 10 was written to be the performance half of
// that argument and measurably is not — see its own note.
{
  const page = await newPage();
  const style = await page.evaluate(() => {
    const first = document.querySelector('[data-day-key]');
    const cs = getComputedStyle(first);
    const last = document.querySelector('[data-day-key]:last-of-type');
    return {
      contentVisibility: cs.contentVisibility,
      containIntrinsicSize: cs.containIntrinsicSize,
      lastContentVisibility: last ? getComputedStyle(last).contentVisibility : null,
    };
  });
  check('3a the first day section skips layout off screen',
    style.contentVisibility === 'auto', `content-visibility: ${style.contentVisibility}`);
  check('3b it carries an intrinsic size to stand in for the layout it skipped',
    typeof style.containIntrinsicSize === 'string' && /\d/.test(style.containIntrinsicSize),
    `contain-intrinsic-size: ${style.containIntrinsicSize}`);
  check('3c the last section too, not just the one that happens to be rendered',
    style.lastContentVisibility === 'auto', `content-visibility: ${style.lastContentVisibility}`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 4 — the intrinsic size is in the right order of magnitude.
//
// The guard on the two magic numbers in `daySectionSize.ts`. Their product is
// read back off the section's own computed `contain-intrinsic-size` rather
// than recomputed here: that IS `estimatedDaySectionHeight(cardCount)`'s
// output, so a check that recomputed it would only prove this file can
// multiply.
//
// A mid-list section, scrolled into view so the browser lays it out for real
// — `getBoundingClientRect().height` on a section that is still SKIPPED
// reports the estimate itself, which would make this check compare a number
// with itself and pass for any estimate whatsoever.
//
// FALSIFIED 2026-08-26. Set `EVENT_CARD_ESTIMATE_PX = 8` in
// `daySectionSize.ts`, confirmed the marker reached the served bundle, and
// measured 2026-07-30 (32 cards): estimate 300px against a real 2,851px,
// ratio 0.11 — FAIL. The same section reads 2,988px against 2,851px on the
// shipped constants, ratio 1.05.
{
  const page = await newPage();
  await settle(page);
  const measured = await page.evaluate(async () => {
    const secs = [...document.querySelectorAll('[data-day-key]')];
    // A section with enough cards that the header estimate is not most of
    // the number, taken from the middle of the list.
    const candidates = secs
      .map((el, i) => ({ el, i, cards: el.querySelectorAll('[data-event-id]').length }))
      .filter(c => c.cards >= 8);
    const pick = candidates[Math.floor(candidates.length / 2)];
    if (!pick) return null;
    const estimate = parseFloat(
      /(\d[\d.]*)px/.exec(getComputedStyle(pick.el).containIntrinsicSize)?.[1] ?? 'NaN');
    // Scrolled into view so the section renders for real. `scrollIntoView`
    // rather than the app's own navigation on purpose: this measures layout,
    // not navigation, and it must not depend on the rail being right.
    pick.el.scrollIntoView();
    await new Promise(r => setTimeout(r, 800));
    const real = pick.el.offsetHeight;
    return { key: pick.el.dataset.dayKey, cards: pick.cards, estimate, real };
  });
  if (!measured) {
    check('4 the intrinsic size is in the right order of magnitude', false,
      'no day section with 8+ cards to measure');
  } else {
    const ratio = measured.estimate / measured.real;
    check('4 the intrinsic size is in the right order of magnitude',
      ratio >= 0.4 && ratio <= 1.6,
      `${measured.key}: ${measured.cards} cards, estimate ${measured.estimate}px vs real ` +
      `${measured.real}px (ratio ${ratio.toFixed(2)}, ±60% allowed)`);
  }
  await page.close();
}

// ---------------------------------------------------------------------------
// 5 — the reader lands on today.
//
// With the date scope deleted, nothing about the list itself says "start
// here": the landing is the only thing that puts the reader anywhere but
// January.
//
// FALSIFIED 2026-08-26. Made `landingDayKey` return `eventDays[0]`,
// confirmed the marker reached the served bundle, and measured: landed on
// 2026-01-03 with today pinned to 2026-08-26 — FAIL.
//
// Worth noting what that same injection did to check 7: nothing. 7a still
// read `top 140` against a sticky offset of 140, because the reader was
// parked perfectly on the WRONG day. The two checks are not redundant.
if (currentRegime() === 'off-season') {
  skip('5 the reader lands on today',
    'today is outside the season off-season, so there is no "today" section to ' +
    'land on — `enterList` had to tap a rail chip to get a list at all');
} else {
  const page = await newPage();
  await settle(page);
  const landed = await landedSection(page);
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()));
  check('5 the reader lands on today', landed.key === today,
    `landed on ${landed.key}, today is ${today} (of ${landed.days} sections, first ${landed.first})`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 6 — an archived year lands at the season start.
//
// Reached the way a reader reaches it: the header's year pill, then the
// landing's own "Browse the N season". The expected day is the first event
// day at or after that year's season start — noon on the Saturday before the
// 4th Sunday of June, the rule `getChautauquaSeasonWeeks` implements and the
// one `verify-offseason` check 3c reads back out of the countdown copy
// ("The 2026 season begins June 27").
//
// ## THIS CHECK FAILS ON THIS BRANCH, AND IT IS RIGHT TO
//
// Measured 2026-08-26 against the branch's own preview build, with real
// clicks, on a clean tree: picking 2025 and pressing "Browse the 2025 season"
// leaves the reader at `2025-03-13` — the first day of the archived year's
// feed — with `scrollY 0`. The expected landing is `2025-06-21`. Reproduced
// on every attempt, and independent of timing: identical whether the 2026
// landing was allowed to finish first or the year was switched immediately.
//
// The mechanism, from a scroll trace taken during the switch:
//
//     scrollBy -149315  ->  y=32, section under the chrome = 2026-01-03
//     ...then NOTHING at all after "Browse the 2025 season"
//
// `selectedYear` flips to 2025 a commit before `navEventDays`/`groupedEvents`
// do. In that commit `landingDayKey` is called with 2025's `seasonStartDay`
// and `isCurrentYear: false` but with **2026's** event days, so it resolves
// to the first 2026 day at or after 2025-06-21 — `2026-01-03` — and
// `listMounted` is still true because 2026's 89 sections are still in the
// DOM. `useInitialLanding` therefore lands on that day and latches
// `landedFor.current = 2025`. When the real 2025 list finally mounts, the
// hook's own `landedFor.current === year` guard returns early and the
// season-start landing never happens.
//
// This is a product defect, not a harness artifact, and it is deliberately
// left failing rather than fixed here: writing the check and letting it fail
// is this task's remit. It is the same class of bug as the two the task 6
// commits on this branch already fixed (`explicit`, the year-reset), reached
// by a route neither of them covers — the guard consumed by data from the
// year the reader just left.
{
  const page = await newPage();
  const current = await selectedYear(page);
  // Opened and read in two steps: the menu is rendered by a state update, so
  // a single `evaluate` that clicks the pill and then reads `[role=menuitem]`
  // synchronously finds nothing and this check skips itself with "the
  // manifest offers no year before N" — a silent pass for a check that never
  // ran. (It did exactly that on the first run.)
  await page.evaluate(() => {
    [...document.querySelectorAll('header button')]
      .find(b => /^\d{4} Season$/.test(b.textContent.trim()))?.click();
  });
  await page.waitForSelector('[role=menuitem]', { timeout: 5000 }).catch(() => {});
  const years = await page.$$eval('[role=menuitem]', els => els
    .map(b => Number(/^(\d{4}) Season/.exec(b.textContent.trim())?.[1]))
    .filter(Boolean));
  const archived = years.filter(y => y < current).sort((a, b) => b - a)[0];
  if (!archived) {
    skip('6 an archived year lands at the season start',
      `the manifest offers no year before ${current}: ${years.join(', ')}`);
    await page.close();
  } else {
    // The Saturday before the 4th Sunday of June, as a day key.
    const june1 = new Date(Date.UTC(archived, 5, 1));
    const firstSunday = 1 + ((7 - june1.getUTCDay()) % 7);
    const start = new Date(Date.UTC(archived, 5, firstSunday + 21 - 1));
    const seasonStart = start.toISOString().slice(0, 10);

    await page.evaluate(y => {
      [...document.querySelectorAll('[role=menuitem]')]
        .find(b => b.textContent.trim().startsWith(`${y} Season`))?.click();
    }, archived);
    await page.waitForTimeout(2000);
    // An archived year opens on the landing, not the list — it is a season
    // that has ended. "Browse the N season" is the reader's way past it.
    await page.evaluate(() => {
      [...document.querySelectorAll('[data-testid="off-season-landing"] button')]
        .find(b => /^Browse the \d{4} season$/.test(b.textContent.trim()))?.click();
    });
    await page.waitForTimeout(2000);
    await settle(page);
    const landed = await landedSection(page);
    const expected = await page.evaluate(([y, from]) => {
      const days = [...document.querySelectorAll('[data-day-key]')].map(e => e.dataset.dayKey);
      return { day: days.find(d => d >= from) ?? days[days.length - 1], count: days.length, y };
    }, [archived, seasonStart]);
    check('6 an archived year lands at the season start', landed.key === expected.day,
      `${archived}: landed on ${landed.key}, season starts ${seasonStart}, first event day ` +
      `at or after it is ${expected.day} (of ${expected.count} sections, first ${landed.first}, ` +
      `scrollY ${landed.scrollY})`);
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 7 — the landing parks the reader exactly, and it got there relatively.
//
// `scrollToDay` scrolls by a delta read from the target's own rect, which
// forces that one section's real layout; every section above it is still a
// `contain-intrinsic-size` estimate. An absolute `scrollTo` computed by
// summing those estimates lands NEAR the day and then drifts as the document
// resolves.
//
// ## 7c exists because 7a/7b cannot see that difference
//
// The brief for this suite said 7a/7b were "the check that would catch
// someone replacing `scrollToDay` with an absolute `scrollTo`". They are not,
// and the falsification is what said so. Injecting exactly that — replacing
// `scrollWindowBy(delta)` with `window.scrollTo({ top: window.scrollY + delta
// - 400 })`, marker confirmed in the served bundle — left 7a reading `top
// 139.5` against a sticky offset of 140. It PASSED on the broken code.
//
// The scroll trace says why. `useDayAnchor`'s settle hold re-parks the target
// on the next `ResizeObserver` callback, and the document is still resolving
// its `content-visibility` estimates at that moment, so the callback always
// comes:
//
//     scrollTo {"top":148939}   after 148939   <- the injected defect, 400px short
//     scrollBy 400             after 149339   <- the hold repairing it
//     scrollBy 7.5             after 149347
//
// So 7a/7b are a real invariant about the END STATE — the reader does end up
// parked at the sticky offset, and stays there — but the hold makes them
// blind to how the app got there. 7c watches the mechanism instead: the app's
// own scrolls are relative, and nothing in `src/` calls `window.scrollTo` at
// all (`programmaticScroll.ts` is the single writer, and it calls
// `scrollBy`). That is the assertion the injection actually breaks.
if (currentRegime() === 'off-season') {
  skip('7 the landing is relative, not absolute',
    'the automatic landing has no target off-season — `enterList` reaches the ' +
    'list through a rail tap and then returns to the top, so there is no ' +
    'load-time landing left to measure');
} else {
  const page = await newPage({ traceScrolls: true });
  await settle(page);
  const at0 = await landedSection(page);
  await page.waitForTimeout(2500);
  const at2500 = await landedSection(page);
  check('7a the landed section is parked at the sticky offset',
    at0.top !== null && Math.abs(at0.top - at0.off) <= 2,
    `top ${at0.top} vs sticky offset ${at0.off}`);
  check('7b and it is still there 2.5s later, after the document has resolved',
    at2500.key === at0.key && at2500.top !== null && Math.abs(at2500.top - at2500.off) <= 2,
    `${at0.key} at ${at0.top} → ${at2500.key} at ${at2500.top} (drift ${
      at2500.top !== null && at0.top !== null ? (at2500.top - at0.top).toFixed(2) : '?'}px)`);
  const ops = await page.evaluate(() => window.__scrollOps ?? []);
  const absolute = ops.filter(o => o.op === 'scrollTo');
  check('7c the app moved the reader relatively, never by an absolute offset',
    ops.length > 0 && absolute.length === 0,
    `${ops.length} scrolls, ${absolute.length} absolute — ` +
    (ops.map(o => `${o.op}(${Math.round(o.delta ?? 0)})`).join(' ') || 'NONE, so nothing was proved'));
  await page.close();
}

// ---------------------------------------------------------------------------
// 8 — a rail jump into the middle of the list lands to the pixel.
//
// The spike measured this on a throwaway build (jumps to 25%, 50% and 75% of
// the year each landed at the sticky offset with 0px of drift 2.5s later);
// this reproduces it against what ships. Mid-list rather than the last day on
// purpose: the browser clamps at maximum scroll, which would mask any error.
{
  const page = await newPage();
  await settle(page);
  const days = await page.$$eval('[data-day-rail] [data-chip]', els => els
    .filter(e => e.getAttribute('aria-disabled') !== 'true')
    .map(e => e.dataset.chip));
  for (const fraction of [0.25, 0.5, 0.75]) {
    const target = days[Math.floor(days.length * fraction)];
    await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), target);
    await page.waitForTimeout(1200);
    const now = await landedSection(page);
    const landedOn = await page.evaluate(k => {
      const el = document.querySelector(`[data-day-key="${k}"]`);
      return el ? Math.round(el.getBoundingClientRect().top * 100) / 100 : null;
    }, target);
    await page.waitForTimeout(2500);
    const after = await page.evaluate(k => {
      const el = document.querySelector(`[data-day-key="${k}"]`);
      return el ? Math.round(el.getBoundingClientRect().top * 100) / 100 : null;
    }, target);
    check(`8 a jump to ${Math.round(fraction * 100)}% of the year lands at the sticky offset`,
      landedOn !== null && Math.abs(landedOn - now.off) <= 2 && after !== null
        && Math.abs(after - landedOn) <= 2,
      `${target}: top ${landedOn} vs offset ${now.off}, ${after !== null && landedOn !== null
        ? (after - landedOn).toFixed(2) : '?'}px of drift after 2.5s`);
  }
  await page.close();
}

// ---------------------------------------------------------------------------
// 9 — slow scrolling still advances the page, in both engines.
//
// The filter-header regression this whole browser suite exists for showed up
// as a page that would not scroll slowly. Re-run here because the list is now
// a different document: 89 sections whose heights change under the reader as
// `content-visibility` resolves them, which is precisely the ingredient
// scroll anchoring reacts to.
//
// A gesture is not one scroll event: WebKit on Linux delivers one wheel tick
// as several frames, so this drives 30 real ticks and asserts the trace, not
// one jump.
for (const engineName of ['chromium', 'webkit']) {
  const launched = engineName === 'chromium' ? browser : await webkit.launch();
  const page = await newPageOn(launched, {});
  await settle(page);
  const TICKS = 30;
  const STEP = 80;
  const trace = [];
  const start = await page.evaluate(() => Math.round(window.scrollY));
  for (let i = 0; i < TICKS; i++) {
    await page.mouse.move(195, 500);
    await page.mouse.wheel(0, STEP);
    await page.waitForTimeout(120);
    trace.push(await page.evaluate(() => Math.round(window.scrollY)));
  }
  const advanced = trace[trace.length - 1] - start;
  const backwards = trace.filter((y, i) => y < (i === 0 ? start : trace[i - 1])).length;
  check(`9a slow scrolling advances the page (${engineName})`,
    advanced >= TICKS * STEP * 0.9,
    `${advanced}px of ${TICKS * STEP} requested over ${TICKS} ticks`);
  check(`9b slow scrolling never snaps the reader backwards (${engineName})`,
    backwards === 0, `${backwards} of ${TICKS} ticks moved up`);
  await page.close();
  if (engineName !== 'chromium') await launched.close();
}

// ---------------------------------------------------------------------------
// 10 — scrolling the whole year does not jank, on a throttled phone CPU.
//
// Forty 600px wheel gestures under 4x CPU throttling, from the first day of
// the year. The numbers print whatever the verdict, so a drift is legible
// rather than merely red.
//
// ## Its named falsification does NOT falsify it — check 3 is what does
//
// This check was specified as the performance half of the argument for
// `content-visibility`, to be proved by deleting it and watching the numbers
// collapse. That was tried on 2026-08-26 against this exact body, with the
// prop key confirmed absent from the SERVED bundle, two runs each side:
//
//     with content-visibility     p95 23-24ms   worst 49-56ms   0 frames >100ms
//     without content-visibility  p95 29-30ms   worst 56-57ms   0 frames >100ms
//
// The check PASSED on the broken build, both times. There is a consistent
// ~25% separation in p95 and it is nowhere near the threshold, so this is not
// the guard on `content-visibility` — **check 3 is, and it is the only one.**
// (3a and 3c both FAIL on that same build: `content-visibility: visible`.)
//
// Three other measures were tried against the same pair of builds and were
// flatter still: raising the throttle to 6x (p95 80-90 both ways — noise, not
// signal), time from navigation to a mounted list (2.76s vs 2.80s), and a
// forced full-document layout (0ms median, 1ms worst, both ways). The only
// quantity that moved reliably was document height, 160,636px against
// 174,331px, which is checks 3 and 4's subject rather than this one's.
//
// So what this check is for is a GROSS regression — the multi-second stalls
// the phase was worried about — and nothing subtler. Do not read a pass here
// as evidence that the layout containment is doing its job.
//
// ## On the spike's numbers
//
// The pre-implementation spike reported p50 8.3ms, p95 17.4ms and 0 frames
// over 50ms in 253. The frame COUNT is the tell that it is not the same
// measurement: the same forty gestures sample ~135 frames here, so the
// spike's run was roughly twice as long in wall-clock and its percentiles are
// diluted by idle frames this loop does not have. Compare the verdicts, not
// the percentiles.
{
  const page = await newPage({ cpu: 4 });
  await settle(page);
  // Started from the FIRST day of the year, not from wherever the load
  // landing left the reader.
  //
  // The first version of this check did the latter and measured its own
  // setup: in season the landing parks the reader on today, which in late
  // August is ~149,000px into a ~160,000px document, so 40 x 600px of wheel
  // ran out of document after about nine gestures and the rest scrolled a
  // clamped page. Measured 2026-08-26 on the shipped build: p95 55ms, worst
  // 168ms and 129 frames sampled from the clamped start, against p95 25-30ms
  // and ~142 frames from the top of the list.
  //
  // A rail tap rather than `scrollTo`: it is the app's own navigation, it
  // leaves the settle hold in the state a reader's jump would, and the first
  // wheel gesture cancels that hold exactly as a reader's would.
  await page.evaluate(() => {
    const first = [...document.querySelectorAll('[data-day-rail] [data-chip]')]
      .find(e => e.getAttribute('aria-disabled') !== 'true');
    first?.click();
  });
  await page.waitForTimeout(1500);
  await waitForQuiet(page);
  // One warm-up gesture INSIDE the recording, then the frame log is cleared.
  // The first interval a fresh rAF loop records spans the gap between
  // registering the callback and the first wheel arriving over CDP — idle
  // time, not a rendered frame, and it reported 110-149ms on a page that was
  // not doing anything. Clearing after a real gesture removes it by
  // construction rather than by slicing an arbitrary count off the front.
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = now => {
      window.__frames.push(now - last); last = now;
      if (!window.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__frames = [];
    window.__startY = Math.round(window.scrollY);
  });
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(50); }
  const f = await page.evaluate(() => {
    window.__stop = true;
    const frames = window.__frames.slice(1).sort((a, b) => a - b);
    return {
      p50: Math.round(frames[Math.floor(frames.length * 0.5)] ?? 0),
      p95: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0),
      worst: Math.round(frames[frames.length - 1] ?? 0),
      over50: frames.filter(x => x > 50).length,
      over100: frames.filter(x => x > 100).length,
      count: frames.length,
      startY: window.__startY,
      scrollY: Math.round(window.scrollY),
    };
  });
  check('10 forty gestures over the whole year stay smooth',
    f.over100 === 0 && f.p95 < 60,
    `p50 ${f.p50}ms, p95 ${f.p95}ms, worst ${f.worst}ms, ${f.over100} frames over 100ms and ` +
    `${f.over50} over 50ms of ${f.count}, ${f.startY} → ${f.scrollY}`);
  await page.close();
}

// ---------------------------------------------------------------------------
// 11 — axe over the list, with the whole year mounted.
//
// `aria-hidden-focus` specifically: 1,687 cards are in the DOM at once and
// most of them are inside a section the browser has skipped. A skipped
// section is not `aria-hidden`, and this is what says so.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const page = await newPage();
  await settle(page);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const results = await page.evaluate(async () => {
    const run = await window.axe.run('main', {
      runOnly: { type: 'rule', values: ['aria-hidden-focus', 'button-name', 'aria-allowed-attr'] },
    });
    return {
      violations: run.violations.map(v => `${v.id} x${v.nodes.length}`),
      sections: document.querySelectorAll('[data-day-key]').length,
    };
  });
  check('11 axe is clean over a list holding the whole year',
    results.violations.length === 0,
    `${results.violations.join(', ') || 'no violations'} over ${results.sections} sections`);
  await page.close();
}

await browser.close();
finish();
