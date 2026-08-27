/**
 * What the shipped full-year list costs — the spike's gating measurement,
 * re-run against what actually ships (#274 phase 4).
 *
 * The spike (`measure-render-window.mjs` at `f606a73`, not merged) compared
 * three worlds behind URL flags: today's render window, full mount + memo,
 * and full mount + memo + `content-visibility`. Phase 4 shipped the third, so
 * there are no flags left and there is one configuration to measure. This is
 * that harness with the flags and the spike-only render counters removed, so
 * the numbers in the spec's addendum can be checked against the build a
 * reader gets rather than against a throwaway branch.
 *
 * The scroll figure is forty real 600px wheel gestures, 50ms apart, **from
 * the first day of the year**. That start matters and the spike got it for
 * free: phase 4 lands the reader on today, which in late August is ~149,000px
 * into a ~160,000px document, so a scroll started from the landing runs out
 * of document after about nine gestures and measures a clamped page.
 *
 * The clock is pinned through `fixedNow.mjs`, which fixes `Date.now()` and
 * leaves timers running — the app's own debounces and observers still work.
 * `E2E_NOW` therefore steers this harness too.
 *
 * Usage:
 *   npx vite build && npm run preview &
 *   URL=http://localhost:3000/ CPU=4 node e2e/measure-full-list.mjs
 *   URL=http://localhost:3000/ CPU=6 node e2e/measure-full-list.mjs
 */
import { chromium } from 'playwright';
import { pinClock } from './fixedNow.mjs';

const URL = process.env.URL || 'http://localhost:3000/';
const CPU = Number(process.env.CPU || 4);
const REPEATS = Number(process.env.REPEATS || 3);
const VIEWPORT = { width: 390, height: 844 };

/**
 * Installed before any app script runs, so the observers are live for the
 * first paint. A `PerformanceObserver` created after load misses `longtask`
 * entries entirely, which would report a clean main thread for the exact
 * window we care most about.
 */
function initScript() {
  window.__perf = { longTasks: [], lcp: 0, frames: [], recording: false, scrollTasks: [] };
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      window.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
      if (window.__perf.recording) window.__perf.scrollTasks.push(e.duration);
    }
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__perf.lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round = n => Math.round(n * 10) / 10;

/** `Performance.getMetrics` as a plain object. */
async function metrics(client) {
  const { metrics: m } = await client.send('Performance.getMetrics');
  return Object.fromEntries(m.map(e => [e.name, e.value]));
}

async function measure(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  await pinClock(page);
  await page.addInitScript(initScript);

  const client = await ctx.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // Attribution. A long task says the main thread was blocked; these counters
  // say by what — script time is ours to fix, style and layout over a
  // 45k-node document are the browser's.
  await client.send('Performance.enable');

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'commit' });
  await page.waitForSelector('[data-day-key]', { timeout: 120000 });
  const firstSectionMs = Date.now() - t0;

  // Settle: the feed lands, the list renders, the landing scroll happens.
  // Measured rather than assumed — `networkidle` returns while the main
  // thread is still laying out 45k nodes under a 4x throttle.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(4000);

  const load = await page.evaluate(() => {
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find(p => p.name === 'first-contentful-paint')?.startTime ?? 0;
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      fcp,
      lcp: window.__perf.lcp,
      loadEvent: nav?.loadEventEnd ?? 0,
      longTaskCount: window.__perf.longTasks.length,
      longTaskTotal: window.__perf.longTasks.reduce((a, t) => a + t.dur, 0),
      longTaskMax: window.__perf.longTasks.reduce((a, t) => Math.max(a, t.dur), 0),
      daySections: document.querySelectorAll('[data-day-key]').length,
      eventCards: document.querySelectorAll('[data-event-id]').length,
      domNodes: document.getElementsByTagName('*').length,
      docHeight: document.documentElement.scrollHeight,
      landedAt: Math.round(window.scrollY),
    };
  });

  // Heap after a forced collection, so the figure is retained memory rather
  // than whatever had not been swept yet.
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');
  const domCounters = await client.send('Memory.getDOMCounters');
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const loadMetrics = await metrics(client);

  // To the top of the list, through the app's own navigation — see the file
  // comment for why the starting point is load-bearing.
  await page.evaluate(() => {
    [...document.querySelectorAll('[data-day-rail] [data-chip]')]
      .find(e => e.getAttribute('aria-disabled') !== 'true')?.click();
  });
  await page.waitForTimeout(2000);

  // Then wait for the main thread to go quiet. The article- and program-link
  // sidecars arrive on their own schedule and re-render all 1,687 cards —
  // measured at 4x as a single 689ms long task several seconds after the day
  // sections appeared. Without this wait it lands inside the scroll window
  // and is reported as a 753ms frame, which is a load cost wearing a scroll
  // cost's clothes. The load figures above are taken before it and still
  // include it.
  const quietStart = Date.now();
  while (Date.now() - quietStart < 25000) {
    const since = await page.evaluate(() =>
      performance.now() - Math.max(0, ...window.__perf.longTasks.map(t => t.start + t.dur)));
    if (since >= 2000) break;
    await page.waitForTimeout(250);
  }

  await page.evaluate(() => {
    const p = window.__perf;
    p.frames = []; p.scrollTasks = []; p.recording = true;
    let last = performance.now();
    const tick = now => {
      p.frames.push(now - last); last = now;
      if (p.recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // One warm-up gesture, then the frame log is cleared: the first interval a
  // fresh rAF loop records spans the gap between registering the callback and
  // the first wheel arriving over CDP, which is idle time rather than a
  // rendered frame.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__perf.frames = []; window.__perf.scrollTasks = []; });

  const before = await metrics(client);
  const startY = await page.evaluate(() => Math.round(window.scrollY));
  const scrollStart = Date.now();
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(50);
  }
  const scrollMs = Date.now() - scrollStart;

  const scroll = await page.evaluate(() => {
    window.__perf.recording = false;
    return {
      frames: window.__perf.frames.slice(1),
      scrollTasks: window.__perf.scrollTasks,
      scrollY: Math.round(window.scrollY),
    };
  });

  const after = await metrics(client);
  const delta = k => (after[k] ?? 0) - (before[k] ?? 0);
  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  await page.close();
  await ctx.close();

  return {
    load, firstSectionMs, heap, heapAfter, domCounters,
    scrollCost: {
      task: delta('TaskDuration') * 1000,
      script: delta('ScriptDuration') * 1000,
      layout: delta('LayoutDuration') * 1000,
      recalc: delta('RecalcStyleDuration') * 1000,
    },
    loadCost: {
      task: (loadMetrics.TaskDuration ?? 0) * 1000,
      script: (loadMetrics.ScriptDuration ?? 0) * 1000,
      layout: (loadMetrics.LayoutDuration ?? 0) * 1000,
      recalc: (loadMetrics.RecalcStyleDuration ?? 0) * 1000,
    },
    scroll: {
      ms: scrollMs, startY, scrollY: scroll.scrollY,
      frameP50: pct(scroll.frames, 50),
      frameP95: pct(scroll.frames, 95),
      frameMax: Math.max(0, ...scroll.frames),
      framesOver50: scroll.frames.filter(f => f > 50).length,
      framesOver100: scroll.frames.filter(f => f > 100).length,
      frameCount: scroll.frames.length,
      longTasks: scroll.scrollTasks.length,
      longTaskTotal: scroll.scrollTasks.reduce((a, d) => a + d, 0),
      longTaskMax: Math.max(0, ...scroll.scrollTasks),
    },
  };
}

const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function report(runs) {
  const pick = fn => median(runs.map(fn));
  const l = r => r.load;
  console.log(`\n=== shipped full-year list (median of ${runs.length}, ${CPU}x CPU throttle, ${VIEWPORT.width}x${VIEWPORT.height}) ===`);
  console.log(`  day sections mounted   ${pick(r => l(r).daySections)}`);
  console.log(`  event cards mounted    ${pick(r => l(r).eventCards)}`);
  console.log(`  DOM nodes              ${pick(r => l(r).domNodes)} (CDP nodes ${pick(r => r.domCounters.nodes)}, listeners ${pick(r => r.domCounters.jsEventListeners)})`);
  console.log(`  document height        ${pick(r => l(r).docHeight)}px  (landed at y=${pick(r => l(r).landedAt)})`);
  console.log(`  FCP                    ${round(pick(r => l(r).fcp))}ms`);
  console.log(`  LCP                    ${round(pick(r => l(r).lcp))}ms`);
  console.log(`  first day section      ${round(pick(r => r.firstSectionMs))}ms (wall)`);
  console.log(`  long tasks (load)      ${pick(r => l(r).longTaskCount)} tasks, ${round(pick(r => l(r).longTaskTotal))}ms total, ${round(pick(r => l(r).longTaskMax))}ms longest`);
  console.log(`  JS heap                ${round(pick(r => r.heap) / 1048576)}MB (after scroll ${round(pick(r => r.heapAfter) / 1048576)}MB)`);
  console.log(`  scroll 40x600px        ${pick(r => r.scroll.ms)}ms wall, ${pick(r => r.scroll.startY)} → ${pick(r => r.scroll.scrollY)}`);
  console.log(`  frame interval         p50 ${round(pick(r => r.scroll.frameP50))}ms, p95 ${round(pick(r => r.scroll.frameP95))}ms, max ${round(pick(r => r.scroll.frameMax))}ms`);
  console.log(`  frames >50ms / >100ms  ${pick(r => r.scroll.framesOver50)} / ${pick(r => r.scroll.framesOver100)} of ${pick(r => r.scroll.frameCount)}`);
  console.log(`  long tasks (scroll)    ${pick(r => r.scroll.longTasks)} tasks, ${round(pick(r => r.scroll.longTaskTotal))}ms total, ${round(pick(r => r.scroll.longTaskMax))}ms longest`);
  console.log(`  main thread (load)     ${round(pick(r => r.loadCost.task))}ms total = script ${round(pick(r => r.loadCost.script))}ms + style ${round(pick(r => r.loadCost.recalc))}ms + layout ${round(pick(r => r.loadCost.layout))}ms`);
  console.log(`  main thread (scroll)   ${round(pick(r => r.scrollCost.task))}ms total = script ${round(pick(r => r.scrollCost.script))}ms + style ${round(pick(r => r.scrollCost.recalc))}ms + layout ${round(pick(r => r.scrollCost.layout))}ms`);
  console.log(`  per-run frame p95      ${runs.map(r => round(r.scroll.frameP95)).join(', ')}ms`);
  console.log(`  per-run worst frame    ${runs.map(r => round(r.scroll.frameMax)).join(', ')}ms`);
}

const browser = await chromium.launch();
console.log(`URL=${URL} CPU=${CPU}x REPEATS=${REPEATS}`);
const runs = [];
for (let i = 0; i < REPEATS; i++) {
  process.stdout.write(`  run ${i + 1}/${REPEATS}...\n`);
  runs.push(await measure(browser));
}
report(runs);
await browser.close();
