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
  const ctx = await browser.newContext({ viewport: { width, height } });
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
  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(600);
  const geom = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    const railH = rail.getBoundingClientRect().bottom;
    // The stuck header belongs to the section spanning the viewport top. The
    // FIRST section's header legitimately scrolls away once you are past it,
    // so measuring that one tests nothing.
    const sec = [...document.querySelectorAll('[data-day-key]')]
      .find(e => { const r = e.getBoundingClientRect(); return r.top <= railH + 1 && r.bottom > railH + 1; });
    const header = sec?.querySelector('.sticky');
    if (!rail || !header) return null;
    const r = rail.getBoundingClientRect(), h = header.getBoundingClientRect();
    return { railBottom: r.bottom, headerTop: h.top, headerText: header.textContent.trim().slice(0, 30) };
  });
  if (!geom) { check(`12 sticky stack @ ${label}`, false, 'rail or header missing'); await page.close(); continue; }
  check(`12 header clears the rail @ ${label}`, geom.headerTop >= geom.railBottom - 2,
    `railBottom=${geom.railBottom.toFixed(1)} headerTop=${geom.headerTop.toFixed(1)}`);
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
