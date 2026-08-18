/**
 * Browser verification for phase 3a's day rail.
 *
 * Everything this phase risks is geometry, and jsdom computes none of it.
 * Phase 2's browser pass found a 3,903px jump that three green unit tests had
 * no opinion about, so this exists to produce numbers rather than impressions.
 *
 * Each check prints PASS/FAIL plus the value it measured. Run against a dev
 * server on :3000.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:3000/';
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();

async function newPage({ width = 900, height = 900, storage } = {}) {
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
    viewport: { width, height },
    timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  if (storage) {
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), storage);
  }
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-day-key]', { timeout: 30000 });
  return page;
}

const railChips = p => p.$$eval('[data-day-rail] [data-chip]', els => els.map(e => e.dataset.chip));
const anchorChip = p => p.$$eval('[data-day-rail] [data-chip][aria-current="date"]', e => e[0]?.dataset.chip ?? null);
const railHeight = p => p.evaluate(() =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h')) || 0);

// ---------------------------------------------------------------- 1. scopes
{
  const page = await newPage();
  const names = await page.$$eval('button', els => els.map(e => e.textContent.trim()));
  const wanted = ['Now', 'Today', 'All Season', 'All Year'];
  check('1a four scopes present', wanted.every(w => names.includes(w)), names.filter(n => wanted.includes(n)).join(', '));
  check('1b This Week button gone', !names.includes('This Week'));
  check('1c Selected: line gone', !(await page.locator('text=/^Selected:/').count()));
  await page.close();
}

// ------------------------------------------------------- 2. mutual exclusion
{
  const page = await newPage();
  await page.getByRole('button', { name: 'All Season', exact: true }).click();
  await page.waitForTimeout(300);
  const pressed = await page.getByRole('button', { name: 'All Season', exact: true }).getAttribute('aria-pressed');
  check('2a All Season activates', pressed === 'true', `aria-pressed=${pressed}`);
  const allYear = await page.getByRole('button', { name: 'All Year', exact: true }).getAttribute('aria-pressed');
  check('2b All Year not simultaneously active', allYear === 'false', `aria-pressed=${allYear}`);
  await page.close();
}

// ------------------------------------------- 3. persisted 'this-week' migration
{
  const page = await newPage({
    storage: ['chq-calendar-user-state', JSON.stringify({
      dateFilter: 'this-week', selectedWeeks: [], searchTerm: '',
      selectedTags: [], selectedLocations: [], expandedDescriptions: [],
      recentLocations: [], recentCategories: [], showFavoritesOnly: false,
      lastSaved: Date.now(),
    })],
  });
  const names = await page.$$eval('button', els => els
    .filter(e => !/^Remove filter/.test(e.getAttribute('aria-label') ?? ''))
    .map(e => e.textContent.trim()));
  const highlighted = await page.$$eval('button', els =>
    els.filter(e => /^\d$/.test(e.textContent.trim()) && /bg-blue-600/.test(e.className)).map(e => e.textContent.trim()));
  check('3a no This Week button after restore', !names.includes('This Week'));
  check('3b page renders with a persisted this-week', (await page.$$('[data-day-key]')).length > 0,
    `${(await page.$$('[data-day-key]')).length} day sections, week chips highlighted: ${highlighted.join(',') || 'none'}`);
  await page.close();
}

// ------------------------------------------------------------ 4/5. show earlier
for (const scrolled of [false, true]) {
  const page = await newPage();
  if (scrolled) { await page.mouse.wheel(0, 1400); await page.waitForTimeout(400); }
  const before = await page.$$eval('[data-day-key]', e => e.map(x => x.dataset.dayKey));
  const btn = page.getByRole('button', { name: /show earlier/i });
  if (await btn.count() === 0) { check(`4/5 show-earlier present (scrolled=${scrolled})`, false, 'no button'); await page.close(); continue; }
  const refKey = before[0];
  const topOf = () => page.$eval(`[data-day-key="${refKey}"]`, e => e.getBoundingClientRect().top);
  const t0 = await topOf();
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => /show earlier/i.test(b.textContent)).click());
  await page.waitForTimeout(1200);
  const t1 = await topOf();
  const after = await page.$$eval('[data-day-key]', e => e.map(x => x.dataset.dayKey));
  const drift = Math.abs(t1 - t0);
  check(`${scrolled ? '5' : '4'}a show-earlier drift ≈0 (scrolled=${scrolled})`, drift < 2, `${(t1 - t0).toFixed(1)}px`);
  check(`${scrolled ? '5' : '4'}b nothing already-rendered unmounted`, before.every(k => after.includes(k)),
    `before ${before.length} → after ${after.length}`);
  await page.close();
}

// -------------------------------------------------------------- 8. rail exists
{
  const page = await newPage();
  const chips = await railChips(page);
  check('8a rail renders chips', chips.length > 0, `${chips.length} chips, ${chips[0]}..${chips[chips.length - 1]}`);
  const h = await railHeight(page);
  check('8b --day-rail-h is measured, not 0', h > 0, `${h}px`);
  const role = await page.$eval('[data-day-rail]', e => `${e.getAttribute('role')}/${e.getAttribute('aria-label')}`);
  check('8c rail is a labelled group', role === 'group/Days', role);
  check('8d no role=menu anywhere', (await page.$$('[role=menu]')).length === 0);

  // Highlight tracks scroll.
  const a0 = await anchorChip(page);
  // Scroll past the FIRST day section's full height — a fixed wheel delta is
  // not guaranteed to cross a header, and a test that never crosses one
  // proves nothing about whether the highlight tracks.
  const targetY = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('[data-day-key]')];
    const railH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h')) || 0;
    // Land just past the point where the SECOND day's header crosses the
    // sticky offset — that is the exact moment the highlight must advance.
    // Overshoot generously. A 5px margin is inside the noise once the list
    // auto-expands during the scroll and shifts section positions; day
    // sections are thousands of px tall, so +200 still crosses only this
    // one header.
    return Math.round(window.scrollY + secs[1].getBoundingClientRect().top - railH + 200);
  });
  await page.evaluate(y => window.scrollTo(0, y), targetY);
  await page.waitForTimeout(700);
  const a1 = await anchorChip(page);
  check('8e highlight follows scroll', !!a0 && !!a1 && a0 !== a1, `${a0} → ${a1}`);
  await page.close();
}

// --------------------------------------------------- 9. rail tap lands clear
{
  const page = await newPage();
  const chips = await railChips(page);
  const mounted = await page.$$eval('[data-day-key]', e => e.map(x => x.dataset.dayKey));
  // A day several past the current render window — the case that fails if
  // navigation cannot outrun the render window.
  const target = chips[chips.indexOf(mounted[mounted.length - 1]) + 6] ?? chips[chips.length - 1];
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), target);
  await page.waitForTimeout(1800);
  const present = await page.$(`[data-day-key="${target}"]`);
  check('9a tapped day mounts', !!present, target);
  if (present) {
    const { top, railH } = await page.evaluate(k => ({
      top: document.querySelector(`[data-day-key="${k}"]`).getBoundingClientRect().top,
      railH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h')) || 0,
    }), target);
    check('9b scrolled to it', Math.abs(top) < 400, `top=${top.toFixed(1)}px`);
    check('9c lands below the rail, not under it', top >= railH - 2, `top=${top.toFixed(1)} railH=${railH}`);
  }
  await page.close();
}

// ---------------------------------------------------------------- 10. chevrons
{
  const page = await newPage();
  const before = await anchorChip(page);
  const next = await page.$('[data-day-rail] button:not([data-chip]):nth-of-type(2)');
  const chevrons = await page.$$eval('[data-day-rail] button:not([data-chip])',
    els => els.map(e => ({ label: e.getAttribute('aria-label'), disabled: e.hasAttribute('disabled') })));
  check('10a two chevrons, labelled by target', chevrons.length >= 2,
    chevrons.map(c => `${c.label}${c.disabled ? ' [disabled]' : ''}`).join(' | '));
  check('10b chevron labels are not directional when enabled',
    chevrons.filter(c => !c.disabled).every(c => !/the (next|previous) day/.test(c.label)),
    chevrons.filter(c => !c.disabled).map(c => c.label).join(' | '));
  if (next) { await next.click(); await page.waitForTimeout(1200); }
  const after = await anchorChip(page);
  check('10c forward chevron moves the anchor', before !== after, `${before} → ${after}`);
  await page.close();
}

// ------------------------------------------------------------------ 11. ⟳ Now
{
  const page = await newPage();
  const chips = await railChips(page);
  const mounted = await page.$$eval('[data-day-key]', e => e.map(x => x.dataset.dayKey));
  const far = chips[chips.indexOf(mounted[mounted.length - 1]) + 6] ?? chips[chips.length - 1];
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), far);
  await page.waitForTimeout(1500);
  const nowBtn = page.getByRole('button', { name: 'Go to today' });
  const appeared = await nowBtn.count() > 0;
  check('11a ⟳ Now appears once away from today', appeared);
  if (appeared) {
    const scopeBefore = await page.$$eval('button[aria-pressed]', els =>
      els.map(e => `${e.textContent.trim()}=${e.getAttribute('aria-pressed')}`).join(','));
    await nowBtn.click();
    await page.waitForTimeout(1500);
    const scopeAfter = await page.$$eval('button[aria-pressed]', els =>
      els.map(e => `${e.textContent.trim()}=${e.getAttribute('aria-pressed')}`).join(','));
    check('11b ⟳ Now changes no filter', scopeBefore === scopeAfter, scopeAfter);
    check('11c ⟳ Now hides once back on today', (await page.getByRole('button', { name: 'Go to today' }).count()) === 0);
  }
  await page.close();
}

// ------------------------------------------- 12. sticky stack, narrow + zoomed
for (const [label, width, zoom] of [['320px', 320, 1], ['200% zoom', 900, 2]]) {
  const page = await newPage({ width, height: 800 });
  if (zoom !== 1) {
    await page.evaluate(z => { document.documentElement.style.fontSize = `${16 * z}px`; }, zoom);
    await page.waitForTimeout(600);
  }

  // Park deliberately inside a day whose header is genuinely stuck, rather
  // than scrolling a fixed distance and measuring whatever is there.
  //
  // `mouse.wheel(0, 1800)` used to do the latter, and where 1800px lands
  // depends on how many events the current scope is showing — so it depended
  // on the wall-clock hour. At 200% zoom it landed in the gap between two
  // days: the outgoing header was being pushed up by the end of its own
  // section (correct `position: sticky` behaviour, bounded by its containing
  // block) while the next day's header had not reached the rail yet. Nothing
  // was stuck, so there was nothing for the assertion below to be about, and
  // it failed on `main` as well as on every branch.
  //
  // Iterated rather than scrolled once: the render window mounts more days as
  // the reader descends, which moves the target out from under a single
  // computed delta. Loop until the section is actually in position, then stop.
  const parked = await page.evaluate(async () => {
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Null-returning rather than throwing: an exception inside `evaluate`
    // aborts the whole script, where every other failure in this harness is
    // reported as a named check with the value it measured.
    const railBottom = () => {
      const rail = document.querySelector('[data-day-rail]');
      return rail ? rail.getBoundingClientRect().bottom : null;
    };
    // `[data-day-header]` rather than `.sticky`: the attribute is the declared
    // DOM contract (`DAY_SECTION_ATTR`'s neighbour in `daySections.ts`), while
    // the class is a Tailwind utility that would silently match any other
    // sticky descendant a section gained later.
    const headerOf = (sec) => sec.querySelector('[data-day-header]');

    if (railBottom() === null) return { ok: false, why: 'no day rail on the page' };

    // A day tall enough that its header is still stuck once we are inside it:
    // it must outlast the rail, its own header, and the margin we park at.
    const MARGIN = 120;
    const roomy = () => [...document.querySelectorAll('[data-day-key]')].find((e) => {
      const header = headerOf(e);
      if (!header) return false;
      const bottom = railBottom();
      if (bottom === null) return false;
      return e.getBoundingClientRect().height
        > bottom + header.getBoundingClientRect().height + MARGIN * 2;
    });

    // Search as the window grows, not once before it has.
    //
    // The day list is lazily windowed: the first render mounts only enough
    // days to reach RENDER_BATCH_EVENTS, and more arrive as an
    // IntersectionObserver on a bottom sentinel is tripped. Choosing the
    // target from the initially-mounted set alone would make this check
    // depend on whether the first batch happens to contain a tall day —
    // a property of whatever the season is showing today, which is the exact
    // class of data-dependence this whole change exists to remove. So the
    // search is retried as the window grows, and only a genuine exhaustion
    // of the list is reported as a failure.
    let target = roomy();
    for (let grow = 0; grow < 20 && !target; grow++) {
      const before = document.querySelectorAll('[data-day-key]').length;
      window.scrollBy(0, window.innerHeight);
      await frame();
      await frame();
      target = roomy();
      // The window stopped growing and still has nothing tall enough — more
      // scrolling cannot help, so stop rather than spin out the loop.
      if (!target && document.querySelectorAll('[data-day-key]').length === before) break;
    }
    if (!target) {
      return { ok: false, why: 'no mounted day was tall enough to hold a stuck header, even after growing the render window' };
    }

    const key = target.dataset.dayKey;
    for (let i = 0; i < 25; i++) {
      const sec = document.querySelector(`[data-day-key="${key}"]`);
      if (!sec) return { ok: false, why: `target day ${key} left the DOM while homing in on it` };
      const bottom = railBottom();
      if (bottom === null) return { ok: false, why: 'the day rail left the page while homing in' };
      // Aim to sit MARGIN pixels past the section's start, so the header has
      // stuck and the section has not yet begun pushing it back out.
      const delta = sec.getBoundingClientRect().top - bottom + MARGIN;
      if (Math.abs(delta) <= 2) return { ok: true, key };
      window.scrollBy(0, delta);
      await frame();
    }
    // Distinct from the search failure above: a day WAS found, the scroll just
    // never settled on it. Worth telling apart — one is about the fixture, the
    // other about the page moving under the scroll.
    return { ok: false, why: `scroll did not settle on ${key} within 25 attempts` };
  });
  await page.waitForTimeout(300);

  const geom = !parked.ok ? null : await page.evaluate((key) => {
    const rail = document.querySelector('[data-day-rail]');
    const sec = document.querySelector(`[data-day-key="${key}"]`);
    const header = sec?.querySelector('[data-day-header]');
    if (!rail || !header) return null;
    const r = rail.getBoundingClientRect(), h = header.getBoundingClientRect();
    return { day: key, railBottom: r.bottom, headerTop: h.top, headerText: header.textContent.trim().slice(0, 30) };
  }, parked.key);

  if (!geom) {
    // Said out loud rather than skipped: "no day was tall enough to park in"
    // is a fact about the fixture the next reader needs, not a pass.
    check(`12 header clears the rail @ ${label}`, false, parked.why ?? 'rail or header missing');
    await page.close();
    continue;
  }
  // Stuck AT the rail's bottom edge, not merely somewhere below it.
  // `headerTop >= railBottom - 2` was the old form and is satisfied by a
  // header sitting a thousand pixels down the page, having never stuck at
  // all — so it could pass while proving nothing. Equality is the property
  // this check exists for: the day title comes to rest flush under the rail
  // rather than sliding beneath it.
  check(`12 header clears the rail @ ${label}`, Math.abs(geom.headerTop - geom.railBottom) <= 2,
    `day=${geom.day} railBottom=${geom.railBottom.toFixed(1)} headerTop=${geom.headerTop.toFixed(1)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`12 no horizontal page overflow @ ${label}`, overflow <= 1, `${overflow}px`);
  await page.close();
}

// ---------------------------------------------------------------- 13. keyboard
{
  const page = await newPage();
  const chips = await railChips(page);
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).focus(), chips[0]);
  const f0 = await page.evaluate(() => document.activeElement?.dataset?.chip ?? null);
  await page.keyboard.press('ArrowRight');
  const f1 = await page.evaluate(() => document.activeElement?.dataset?.chip ?? null);
  check('13a ArrowRight moves focus along the rail', !!f1 && f0 !== f1, `${f0} → ${f1}`);
  const mountedBefore = (await page.$$('[data-day-key]')).length;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const mountedAfter = (await page.$$('[data-day-key]')).length;
  check('13b arrowing does not refilter the list', mountedBefore === mountedAfter,
    `${mountedBefore} → ${mountedAfter} day sections`);
  await page.close();
}

// ------------------------------------------------------------ 14. accessibility
{
  const page = await newPage();
  const chips = await page.$$eval('[data-day-rail] [data-chip]', els => els.map(e => ({
    label: e.getAttribute('aria-label'),
    unavailable: e.getAttribute('aria-disabled') === 'true',
  })));
  // A reachable chip names its destination; an unavailable one names the day
  // as a FACT and must not promise a destination it cannot deliver.
  const reachable = chips.filter(c => !c.unavailable);
  const unavailable = chips.filter(c => c.unavailable);
  check('14a every reachable chip labelled by target', reachable.length > 0
    && reachable.every(c => c.label && c.label.startsWith('Go to ')),
    `${reachable.length} reachable, e.g. ${reachable[0]?.label}`);
  check('14a2 no unavailable chip promises a destination', unavailable.every(c => !/^Go to /.test(c.label)),
    `${unavailable.length} unavailable, e.g. ${unavailable[0]?.label ?? 'none'}`);
  const empty = chips.map(c => c.label).find(l => /no events/.test(l));
  check('14b an empty day says so', !!empty, empty ?? 'no empty day in range');
  const bad = chips.map(c => c.label).filter(l => /\bnext\b|\bprevious\b/.test(l));
  check('14c no chip labelled by direction', bad.length === 0, bad.join(' | ') || 'none');
  await page.close();
}

// ------------------------------------------- 15. tap targets on a phone
//
// Measured on production before this check existed: 245 of 255 rail controls
// were under the 44px minimum — the prev/next chevrons at 21x32 and ⟳ Now at
// 57x28, with every day chip one pixel short at 44x43. This is a phone-first
// app and the rail is its primary navigation, so the numbers are asserted
// rather than the classes: a class can be present and still lose to a
// competing rule, and only the rendered box is what a thumb hits.
{
  const page = await newPage({ width: 390, height: 844 });
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(700);
  const controls = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    if (!rail) return null;
    return [...rail.querySelectorAll('button')].map(el => {
      const r = el.getBoundingClientRect();
      return {
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
  });
  if (!controls?.length) {
    check('15 rail tap targets meet the 44px minimum', false, 'no rail controls found');
  } else {
    const under = controls.filter(c => c.w < 44 || c.h < 44);
    check('15 every rail control meets the 44px minimum',
      under.length === 0,
      under.length
        ? `${under.length}/${controls.length} under: ` +
          under.slice(0, 4).map(c => `${c.name} ${c.w}x${c.h}`).join(', ')
        : `${controls.length} controls, smallest ` +
          `${Math.min(...controls.map(c => c.w))}x${Math.min(...controls.map(c => c.h))}`);
  }
  await page.close();
}

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map(f => `  - ${f.name}: ${f.detail ?? ''}`).join('\n'));
  process.exit(1);
}
