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
 * Load is not necessarily over when the list appears. The article- and
 * program-link sidecars arrive on their own schedule; if they land after the
 * list has rendered they change `EventListView`'s props, and a scroll
 * measurement started before that happens attributes their cost to scrolling.
 * That is how a page which was not scrolling badly at all once reported a
 * 753ms "frame".
 *
 * **The 689ms long task this comment used to describe no longer reproduces,
 * and the note is kept rather than deleted because the wait still earns its
 * place.** Re-measured 2026-08-27 at 4x throttle with a render counter and a
 * response listener: both sidecars return 200, 573 link badges render, and
 * `EventListView` renders exactly ONCE — no post-list long task above 84ms.
 * Two changes account for it. `EventCard` is memoized and the links are
 * passed per card (`articleLinks?.[event.id]`), so a sidecar can only
 * re-render the cards that actually gained a link, not all 1,687. And
 * `useEventData` no longer delivers the year twice, so the list's single
 * render already has the sidecar data in it.
 *
 * The wait stays because both of those are timing arguments, not guarantees:
 * on a slower network the sidecars land after the list, and the re-render —
 * smaller now, but real — moves back into the scroll window.
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
// ## The defect it caught, and why no unit test could have
//
// This check was written failing (task 7) and is green as of task 8. What it
// found, measured against the branch's own preview build with real clicks:
// picking 2025 and pressing "Browse the 2025 season" left the reader at
// `2025-03-13` — the first day of the archived year's feed — with `scrollY
// 0`, where the season starts `2025-06-21`. Reproduced on every attempt and
// independent of timing.
//
// Confirmed by instrumenting `landingDayKey` and `useInitialLanding` and
// driving the same clicks. The three lines that say the whole thing:
//
//   landingDayKey     {"isCurrentYear":false,"seasonStartDay":"2025-06-21",
//                      "n":89,"first":"2026-01-03","last":"2026-09-10",
//                      "result":"2026-01-03"}
//   useInitialLanding {"targetDay":"2026-01-03","year":2025,
//                      "listMounted":true,"landedFor":2026,"hasSection":true}
//   ...then, after "Browse the 2025 season":
//   useInitialLanding {"targetDay":"2025-06-21","year":2025,
//                      "listMounted":true,"landedFor":2025,"hasSection":true}
//
// `selectedYear` flips to 2025 a commit before `navEventDays` does —
// `useEventData` clears `events` in an EFFECT — so `landingDayKey` ran with
// the new year's `seasonStartDay` and the old year's 89 event days and
// answered `2026-01-03`. 2026's sections were still mounted, so
// `useInitialLanding` scrolled there and latched `landedFor = 2025`; two
// commits later the real `2025-06-21` was refused by its own
// `landedFor.current === year` guard, and nothing re-triggered the effect.
//
// Fixed in `landingDay.ts`: a day key carries its own year, so a landing
// target is never chosen from events that are not the selected year's. See
// that module's own doc, and the two unit tests named for the torn commit.
//
// **Why the browser is the only place this was visible.** Every part is
// individually correct — the hook's guards, the year reset, the memo. The
// defect is one commit's worth of disagreement between two of them, and the
// unit tests that now pin it were written from what the instrumented browser
// printed, not the other way round.
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
// 5-webkit — the reader lands on today in WEBKIT too.
//
// Every other check in this suite runs in Chromium, and this file's own
// engine loop existed only for the slow-scroll pair. **The landing — the
// app's primary function, "show me what is on today" — had never been
// verified in the engine every iPhone actually runs.** It was reported from
// an iPhone simulator as opening on January 3, eight months from today, and
// the first thing that investigation found was that no check could have
// caught it.
//
// Falsified by returning `eventDays[0]` from `landingDayKey`: lands on
// 2026-01-03, FAIL in both engines.
{
  const wk = await webkit.launch();
  const page = await newPageOn(wk, {});
  await settle(page);
  const landed = await landedSection(page);
  const restore = await page.evaluate(() => history.scrollRestoration);
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()));
  if (currentRegime() === 'off-season') {
    skip('5-webkit the reader lands on today (webkit)',
      'today is outside the season off-season, so there is no "today" section to land on');
  } else {
    check('5-webkit the reader lands on today (webkit)', landed.key === today,
      `landed on ${landed.key}, today is ${today} (of ${landed.days} sections, first ${landed.first})`);
  }
  // The app owns where a load lands: a browser restoring an offset against a
  // document whose height is entirely data-dependent cannot be right, and it
  // fights the landing above.
  check('5-webkit the app owns scroll restoration (webkit)',
    restore === 'manual', `history.scrollRestoration = ${restore}`);

  // Landing on the right day is only half of arriving there. The rail
  // centres the day being read, and after the landing it was coming to rest
  // half a chip off — reported as the highlight "looking a little off, not
  // centered", with the previous day clipped mid-label at the left edge.
  //
  // Asserted against the CHIP carrying `aria-current`, not against the pill:
  // the pill is what `useRailHighlight` centres on, so centring the pill is
  // the implementation restating itself. The chip is what the reader sees,
  // and this also fails if the two ever come apart.
  //
  // The clamp is not slack — near the ends of the season the strip cannot
  // scroll far enough to centre anything, and pinning to the edge is the
  // correct answer there. Off-season the rail may not be on screen at all,
  // in which case there is nothing to assert.
  // Asserted against the day the reader actually LANDED on, taken from
  // geometry, rather than against whichever chip carries `aria-current`.
  // Those are two different claims and the first version of this check made
  // them as one: CI reported "2026-01-03 rests 11223px off centre" while
  // `5-webkit the reader lands on today` passed on the same page, which says
  // the highlight and the geometry disagreed and tells you nothing about
  // whether the strip was centred. They are separate checks now, so a run
  // names which half is wrong.
  const rail = await page.evaluate((landedKey) => {
    const strip = document.querySelector('[data-rail-strip]');
    const content = document.querySelector('[data-rail-content]');
    if (!strip || !content) return null;
    const chips = [...content.querySelectorAll('button[data-chip]')];
    const anchor = chips.find(c => c.getAttribute('aria-current'));
    const chip = chips.find(c => c.dataset.chip === landedKey);
    if (!chip) return null;
    const cr = content.getBoundingClientRect();
    const kr = chip.getBoundingClientRect();
    const centre = (kr.left - cr.left) + kr.width / 2;
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    const want = Math.min(Math.max(0, maxScroll), Math.max(0, centre - strip.clientWidth / 2));
    return {
      landedKey,
      anchorKey: anchor?.dataset.chip ?? null,
      anchorCount: chips.filter(c => c.getAttribute('aria-current')).length,
      off: Math.round((strip.scrollLeft - want) * 10) / 10,
      at: Math.round(strip.scrollLeft), want: Math.round(want),
      maxScroll: Math.round(maxScroll), clientWidth: Math.round(strip.clientWidth),
    };
  }, landed.key);

  // The tell, gathered here because this happens only on Linux WebKit in CI
  // and reproduces on no local engine at any CPU throttle.
  //
  // One pixel of page scroll separates "the rail computed the wrong answer"
  // from "the rail never computed one": its highlight and strip position are
  // only ever updated from a `scroll` event, so if the landing's own scroll
  // is missed and the page then goes still, the rail stays where it started
  // — showing the first day of the YEAR — for the rest of the session. That
  // is the same shape as the settling-tween defect fixed earlier on this
  // branch, where a single further pixel snapped a 23.5px error to 0.5px.
  //
  // If the nudge repairs these values, the rail missed the movement. If it
  // changes nothing, the rail computed the wrong answer and the cause is
  // elsewhere.
  const nudged = !rail ? null : await (async () => {
    await page.evaluate(() => window.scrollBy(0, 1));
    await page.waitForTimeout(500);
    // A SYNTHETIC scroll event as well as the real 1px one. Together they
    // separate three things a stuck rail could mean, which two runs of
    // guessing did not: whether the sections are measurable at all, whether
    // anything is listening for a scroll, and whether the answer it computes
    // is wrong. `daySectionTop` returns null only when the element is
    // missing, so `measurable` is the direct test of the walk's input.
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await page.waitForTimeout(400);
    return page.evaluate((landedKey) => {
      const strip = document.querySelector('[data-rail-strip]');
      const content = document.querySelector('[data-rail-content]');
      const chips = [...content.querySelectorAll('button[data-chip]')];
      const anchor = chips.find(c => c.getAttribute('aria-current'));
      const chip = chips.find(c => c.dataset.chip === landedKey);
      const cr = content.getBoundingClientRect();
      const kr = chip?.getBoundingClientRect();
      const centre = kr ? (kr.left - cr.left) + kr.width / 2 : null;
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      const want = centre === null ? null
        : Math.min(Math.max(0, maxScroll), Math.max(0, centre - strip.clientWidth / 2));
      const secs = [...document.querySelectorAll('[data-day-key]')];
      const tops = secs.map(e => e.getBoundingClientRect().top);
      const passed = tops.filter(t => t <= 140).length;
      return {
        anchorKey: anchor?.dataset.chip ?? null,
        off: want === null ? null : Math.round((strip.scrollLeft - want) * 10) / 10,
        at: Math.round(strip.scrollLeft),
        scrollY: Math.round(window.scrollY),
        sections: secs.length,
        passed,
        firstTop: tops.length ? Math.round(tops[0]) : null,
        lastTop: tops.length ? Math.round(tops[tops.length - 1]) : null,
        chips: chips.length,
      };
    }, landed.key);
  })();
  const tell = nudged
    ? ` — after a 1px nudge and a synthetic scroll: aria-current ${nudged.anchorKey}, ` +
      `scrollLeft ${nudged.at}, ${nudged.off}px off, scrollY ${nudged.scrollY}, ` +
      `${nudged.sections} sections (${nudged.passed} above the chrome, ` +
      `first top ${nudged.firstTop}, last ${nudged.lastTop}), ${nudged.chips} chips`
    : '';

  if (!rail) {
    skip('5-webkit the rail centres the day it landed on (webkit)',
      'no rail on screen, or no chip for the landed day');
    skip('5-webkit the rail highlights the day it landed on (webkit)',
      'no rail on screen, or no chip for the landed day');
  } else {
    // The clamp is not slack — near the ends of the season the strip cannot
    // scroll far enough to centre anything, and pinning to the edge is the
    // right answer there.
    check('5-webkit the rail centres the day it landed on (webkit)',
      Math.abs(rail.off) <= 2,
      `${rail.landedKey} rests ${rail.off}px off centre ` +
      `(scrollLeft ${rail.at}, centred would be ${rail.want}, max ${rail.maxScroll}, ` +
      `strip ${rail.clientWidth}px)${tell}`);
    // `useDayAnchor` and `useRailHighlight` resolve the anchor through the
    // same `resolveAnchor`, so they are not supposed to be able to name
    // different days. `resolveAnchor` falls back to `keys[0]` — the first day
    // of the YEAR — when nothing has passed the chrome, which is what a
    // disagreement here would look like.
    check('5-webkit the rail highlights the day it landed on (webkit)',
      rail.anchorKey === rail.landedKey,
      `aria-current is on ${rail.anchorKey ?? '(no chip)'}, reader landed on ` +
      `${rail.landedKey} (${rail.anchorCount} chip(s) carry it)${tell}`);
  }
  await page.close();
  await wk.close();
}

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
// ## It asserts on p50 and p95, and DELIBERATELY not on the worst frame
//
// The worst frame is not a property of the build. Eight measurements of the
// same shipped build, same forty gestures, same 4x throttle:
//
//     p50    8-9ms      (stable)
//     p95    17-25ms    (stable)
//     worst  43, 50, 84, 117, 138, 249, 699, 3881ms
//
// Two of those runs had nothing else executing on the machine. The old form
// of this check asserted `over100 === 0`, which at least three of those eight
// runs fail — on a build with no regression in it. A check that red-lights a
// clean build half the time teaches its next reader to re-run rather than to
// investigate, which is worse than not having it.
//
// p50 and p95 are the stable statistics, and they are also the ones that
// match the pre-implementation spike (8.3 / 17.4) almost exactly, so they are
// what the phase's premise was actually gated on. `worst`, `over100` and
// `over50` still PRINT, every run — a genuine multi-second stall is visible
// in the message even though it does not fail the check.
//
// Re-measured on a second machine on 2026-08-26, eight more runs of this
// exact body against the shipped preview build:
//
//     p50    16ms on all eight
//     p95    21, 24, 24, 24, 25, 25, 25, 28ms
//     worst  43, 44, 47, 47, 48, 48, 48, 62ms
//
// Two further runs of the whole suite on that machine measured p95 24 and
// 30ms, so the honest range there is 21-30 over ten observations — and 30 is
// exactly the figure the OTHER machine recorded for a build with
// `content-visibility` DELETED. Ten observations is not many, and that is the
// point: a good build here and a broken build there are indistinguishable by
// p95. It is the strongest available statement that this check cannot be the
// layout-containment guard no matter how the threshold is set.
//
// p50 is rock stable per machine and differs by ~2x BETWEEN machines, which
// is what sets the headroom below: the thresholds have to survive a CI runner
// nobody has measured, so they are 2-2.5x the worst figure any machine has
// produced. If this goes red on CI rather than on a regression, the number to
// raise is p50 — do not raise p95 to hide a tail, and do not re-add an
// assertion on `worst`.
//
// ## What DOES falsify it
//
// A `while (performance.now() - t0 < N)` busy-wait injected into the app's
// own `scroll` listener (`useSiteHeaderReveal`), confirmed present in the
// SERVED bundle each time, two runs each:
//
//     N = 40ms    p50 27, 28ms   p95 58, 66ms    -> PASS, FAIL  (marginal)
//     N = 120ms   p50 26, 26ms   p95 155, 165ms  -> FAIL, FAIL  (clean)
//
// So the thresholds below catch a per-scroll-event stall somewhere around
// 40ms and everything worse outright, which is the "gross regression" this
// check is scoped to. Note which statistic did the work: p95, not p50. Only
// ~40 of the ~95-135 sampled frames carry a scroll event at all, so even a
// 120ms stall on every one of them leaves the MEDIAN frame at 26ms. p50 is
// asserted because it is the stable statistic and a sustained collapse in
// frame rate would show there first; p95 is what has teeth against a
// periodic stall.
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
// ~25% separation in p95 and it is nowhere near the threshold — and it cannot
// be brought near one, because 29-30ms on that machine is below the 21-28ms
// this machine measures on a GOOD build. So p95 is a weak guard for layout
// containment by construction, not merely by a threshold choice: **check 3 is
// the guard on `content-visibility`, and it is the only one.** (3a and 3c
// both FAIL on that same build: `content-visibility: visible`.)
//
// Three other measures were tried against the same pair of builds and were
// flatter still: raising the throttle to 6x (p95 80-90 both ways — noise, not
// signal), time from navigation to a mounted list (2.76s vs 2.80s), and a
// forced full-document layout (0ms median, 1ms worst, both ways). The only
// quantity that moved reliably was document height, 160,636px against
// 174,331px, which is checks 3 and 4's subject rather than this one's.
//
// So what this check is for is a GROSS regression — the multi-second stalls
// the phase was worried about, which would move the median frame, not just
// one frame — and nothing subtler. Do not read a pass here as evidence that
// the layout containment is doing its job.
//
// ## On the spike's numbers
//
// The pre-implementation spike reported p50 8.3ms, p95 17.4ms and 0 frames
// over 50ms in 253. The frame COUNT is the tell that it is not quite the same
// measurement: the same forty gestures sample ~135 frames here, so the
// spike's run was roughly twice as long in wall-clock and its percentiles are
// diluted by idle frames this loop does not have.
{
  // A browser of its own, and that is the whole reason this check is
  // trustworthy.
  //
  // Every other check shares the module-level `browser`. By the time control
  // reaches here that process has created and destroyed eleven
  // contexts and seen a WebKit instance launched and closed alongside it, and
  // the cost lands squarely on the one check that measures frame intervals.
  // Measured on the same build, same gestures, same 4x throttle: p50 27ms /
  // p95 169ms with 39 frames over 100ms on the shared process, against p50
  // 8-9ms / p95 17-25ms in a fresh one — the latter matching the
  // pre-implementation spike (8.3 / 17.4) that this whole phase was gated on.
  //
  // So the shared-process numbers were measuring the harness, not the app.
  // This is the third time in this project a browser check has done that; the
  // other two are recorded in `verify-rail.mjs` and in check 10's own history
  // above. A dedicated process costs one browser launch and removes the
  // confound by construction rather than by tuning a threshold around it.
  const ownBrowser = await chromium.launch();
  const page = await newPageOn(ownBrowser, { cpu: 4 });
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
  // p50 and p95 only — see this check's header for the eight-sample evidence
  // that the worst frame is not a property of the build. `worst`, `over100`
  // and `over50` are printed as diagnostics on every run, pass or fail.
  check('10 forty gestures over the whole year stay smooth',
    f.p50 < 40 && f.p95 < 60,
    `p50 ${f.p50}ms, p95 ${f.p95}ms (asserted: p50 < 40, p95 < 60) — diagnostics: ` +
    `worst ${f.worst}ms, ${f.over100} frames over 100ms and ${f.over50} over 50ms ` +
    `of ${f.count}, ${f.startY} → ${f.scrollY}`);
  await page.close();
  await ownBrowser.close();
}

// ---------------------------------------------------------------------------
// 12 — pressing the off-season landing's own button still lands.
//
// The regime with nothing behind it: after the season's last event day and
// before the manifest rolls over, a cold load opens on the landing and the
// list NEVER mounts, so nothing has ever landed and `useInitialLanding`'s
// once-per-year latch is still null. That is the only state in which its
// "the reader took over" guard can fire on a first landing — and a press on
// the landing's own CTA was arming it. The list the reader had just asked
// for opened at `scrollY 0`, on January 3.
//
// **This must be a real mouse click.** `element.click()` dispatches a bare
// `click` and no `mousedown` at all, which is why check 6 drives the same
// button and could never have seen this. Measured before the fix: real click
// scrollY 0 near 2026-01-03, synthetic click scrollY 159,757.
//
// `enterSeasonFromLanding` cannot stand in for it either — it taps a rail
// chip, which travels as an EXPLICIT navigation and bypasses the guard on
// purpose. Nothing else in any suite presses this button.
//
// The clock is derived from the feed rather than hardcoded: five days past
// the last day the current year has any event on, clamped inside September so
// it cannot cross the October manifest rollover.
{
  const probe = await newPage();
  const lastDay = await probe.evaluate(() => {
    const keys = [...document.querySelectorAll('[data-day-key]')].map(e => e.dataset.dayKey);
    return keys.sort()[keys.length - 1] ?? null;
  });
  await probe.close();

  if (!lastDay) {
    skip('12 pressing the landing CTA lands on the season it asked for',
      'no day sections to read a season end from');
  } else {
    const after = new Date(`${lastDay}T12:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 5);
    const rollover = new Date(`${lastDay.slice(0, 4)}-09-30T12:00:00Z`);
    const pinned = after > rollover ? rollover : after;

    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York',
    });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(pinned);
    await page.goto(URL, { waitUntil: 'networkidle' });
    const landing = await page.waitForSelector('[data-testid="off-season-landing"]', { timeout: 30000 })
      .then(() => true).catch(() => false);

    if (!landing) {
      // The pin did not produce the regime this check is about. Said out
      // loud rather than silently passing: a check that quietly stops
      // exercising its subject is worse than one that is not there.
      skip('12 pressing the landing CTA lands on the season it asked for',
        `pinned to ${pinned.toISOString().slice(0, 10)} and the off-season landing did not appear`);
      await page.close();
    } else {
      const buttons = await page.$$('[data-testid="off-season-landing"] button');
      const labelled = await Promise.all(
        buttons.map(async b => [b, (await b.textContent()).trim()]));
      const cta = labelled.find(([, t]) => /^Browse the \d{4} season$/.test(t));
      if (!cta) {
        skip('12 pressing the landing CTA lands on the season it asked for',
          `no "Browse the N season" button — offered: ${labelled.map(l => l[1]).join(' | ')}`);
        await page.close();
      } else {
        await cta[0].click(); // a REAL press: mousedown, mouseup, click
        await page.waitForSelector('[data-day-key]', { timeout: 30000 });
        await settle(page);
        const landed = await landedSection(page);
        check('12 pressing the landing CTA lands on the season it asked for',
          landed.scrollY > 0 && landed.key !== landed.first,
          `landed on ${landed.key} at scrollY ${landed.scrollY} ` +
          `(first section ${landed.first}, ${landed.days} sections, ` +
          `clock pinned to ${pinned.toISOString().slice(0, 10)})`);
        await page.close();
      }
    }
  }
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
