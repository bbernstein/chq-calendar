/**
 * Task 9: what one star and one description expansion cost on the main thread
 * with the whole year mounted.
 *
 * Not part of `npm run test:browser` — a measurement harness, run by hand
 * against a preview build, before and after memoizing `EventCard`.
 *
 * Two numbers per interaction, and they measure different halves:
 *
 * - `flush` — `performance.now()` either side of `el.click()` plus a
 *   `setTimeout(0)`. Preact batches into a microtask, so draining the
 *   microtask queue is exactly the render. This is the JS cost of re-rendering
 *   the list.
 * - `longest long task` — what the page's own `PerformanceObserver` reports
 *   for the same window, which additionally carries the style/layout the
 *   render provoked.
 *
 * The first harness for this filtered long tasks by `startTime` against a mark
 * set in an earlier `evaluate` and recorded zero every time, on a page that
 * was in fact producing 489ms tasks. Hence the in-page timing: nothing between
 * the click and the number.
 */
import { chromium } from 'playwright';
import { pinClock } from './fixedNow.mjs';
import { enterList } from './regime.mjs';

const URL = process.env.URL || 'http://localhost:3000/';
const CPU = Number(process.env.CPU || 4);
const REPS = Number(process.env.REPS || 5);
const LABEL = process.env.LABEL || 'run';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
const page = await ctx.newPage();
await pinClock(page);
const client = await ctx.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
// Installed before any app code runs, so the load phase is captured too —
// the sidecar links (`articleLinks`/`programLinks`) land seconds after the day
// sections and change `EventListView`'s props, which is the pass
// `verify-full-list.mjs` records as a 689ms long task.
await page.addInitScript(() => {
  window.__tasks = [];
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__tasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask' });
});
await page.goto(URL, { waitUntil: 'networkidle' });
await enterList(page);

/** Quiet main thread: the sidecar links land seconds after the sections do. */
async function waitForQuiet(quietMs = 3000, timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const since = await page.evaluate(() => {
      const t = window.__tasks;
      if (!t.length) return performance.now();
      const last = t[t.length - 1];
      return performance.now() - (last.start + last.dur);
    });
    if (since >= quietMs) return Math.round(since);
    await page.waitForTimeout(250);
  }
  return null;
}
await waitForQuiet();

const mounted = await page.evaluate(() => ({
  days: document.querySelectorAll('[data-day-key]').length,
  cards: document.querySelectorAll('[data-event-id]').length,
}));
console.log(`[${LABEL}] mounted: ${mounted.days} day sections, ${mounted.cards} cards @ ${CPU}x CPU throttle`);

const loadTasks = await page.evaluate(() => window.__tasks.map(t => Math.round(t.dur)).sort((a, b) => b - a));
console.log(`[${LABEL}] load-phase long tasks (ms, desc): ${loadTasks.join(', ')}`);
await page.evaluate(() => { window.__tasks.length = 0; });

/** Click the nth match of `sel` and return the cost of the render it caused. */
async function measure(sel, nth) {
  const flush = await page.evaluate(async ({ sel, nth }) => {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) throw new Error('no target for ' + sel);
    const el = els[Math.min(nth, els.length - 1)];
    window.__t0 = performance.now();
    el.click();
    // Preact's default `debounceRendering` is a microtask; a `setTimeout(0)`
    // returns only once the whole microtask queue — the render — has drained.
    await new Promise(r => setTimeout(r, 0));
    return performance.now() - window.__t0;
  }, { sel, nth });
  await page.waitForTimeout(2000);
  const longest = await page.evaluate(() => {
    const after = window.__tasks.filter(t => t.start + t.dur >= window.__t0);
    return after.length ? Math.max(...after.map(t => t.dur)) : 0;
  });
  return { flush: Math.round(flush), longest: Math.round(longest) };
}

const STAR = '[data-event-id] button[aria-label="Add to favorites"]';
const TITLE = '[data-event-id] h4 button[aria-expanded="false"]';

const med = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
function report(name, rows) {
  rows.forEach((r, i) => console.log(`  ${name} #${i}  flush ${r.flush}ms  longest long task ${r.longest}ms`));
  console.log(`  ${name} MEDIAN  flush ${med(rows.map(r => r.flush))}ms  longest long task ${med(rows.map(r => r.longest))}ms`);
}

const stars = [];
for (let i = 0; i < REPS; i++) { stars.push(await measure(STAR, i)); await waitForQuiet(1500, 20000); }
console.log(`[${LABEL}] star one event:`);
report('star', stars);

const expands = [];
for (let i = 0; i < REPS; i++) { expands.push(await measure(TITLE, 0)); await waitForQuiet(1500, 20000); }
console.log(`[${LABEL}] expand one description:`);
report('expand', expands);

await browser.close();
