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
import { pinClock } from './fixedNow.mjs';
import { check, skip, finish } from './results.mjs';
import { enterList, currentRegime } from './regime.mjs';

const URL = process.env.URL ?? 'http://localhost:3000/';

const browser = await chromium.launch();


async function newPage({ width = 900, height = 900, storage } = {}) {
  // Chautauqua's own timezone, kept for belt-and-braces — it is no longer
  // load-bearing. The paragraph that used to be here claimed the app "treats
  // the browser's clock as event-time" because `startDate`s are
  // Institution-local and carry no offset. True when written; #243 ("resolve
  // every date in the Institution's timezone") made it false — `parseEventDate`
  // reads a naive `startDate` as Institution wall time, `dayKeyOf` resolves the
  // day key in `CHQ_ZONE`, `chqDateAt` builds instants from Institution parts.
  // Confirmed by running this whole suite under `Asia/Tokyo`: 36/36, identical
  // to Eastern. It is recorded as wrong rather than deleted because it
  // outlived its truth long enough to convince a later reader there was an
  // unfixed product bug.
  //
  // The *hour*, though, was load-bearing, and pinning the timezone never
  // addressed it. `11c ⟳ Now hides once back on today` failed on `main` at
  // 01:31Z, again at 01:58Z on a re-run, and passed on the same commit at
  // 10:17Z. Pinning the clock to that failing instant reproduces it exactly:
  //
  //     today=2026-08-19 anchor=2026-08-27
  //     mounted=2026-08-20,2026-08-21,2026-08-22 button=1
  //
  // Today is not mounted at all — once today's last event plus `Now`'s
  // one-hour grace has passed, today leaves the window, so ⟳ Now cannot land
  // on it and correctly stays visible. The app was right; the check's
  // assumption that today is always reachable was wrong.
  //
  // The boundary tracks the day's programming rather than the clock, which is
  // why no fixed "fails after N o'clock" rule ever fit: pinned to 01:30Z that
  // night `2026-08-19` is still mounted and `11c` passes; at 01:31Z it is gone
  // and it fails.
  //
  // So the clock is pinned below, and that — not the timezone — is what makes
  // these checks independent of when they run. It fixes a harness problem, not
  // a product one: whether `now` is evaluated in the Institution's timezone is
  // already settled in the app, and `verify-timezone.mjs` holds the standing
  // proof across `America/New_York`, `UTC`, `America/Los_Angeles` and
  // `Asia/Tokyo`.
  const ctx = await browser.newContext({
    viewport: { width, height },
    timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  // Shared with `verify-timezone.mjs`; see `fixedNow.mjs` for what is pinned
  // and, more importantly, what deliberately is not.
  await pinClock(page);
  // Tie the context's lifetime to the page's. Callers only ever `page.close()`,
  // so without this every check leaks a whole `BrowserContext` — roughly twenty
  // of them across a run, each holding its own browser process resources.
  page.once('close', () => { ctx.close().catch(() => {}); });
  if (storage) {
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), storage);
  }
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Off-season the default screen is the landing, not a day list; see
  // `regime.mjs` for what this does about it.
  await enterList(page);
  return page;
}

const railChips = p => p.$$eval('[data-day-rail] [data-chip]', els => els.map(e => e.dataset.chip));

/**
 * A rail chip past the current render window that a user can actually tap.
 *
 * Checks 9 and 11 need "a day several past the render window" to prove that
 * navigation can outrun it. The old selection was `chips[lastMountedIdx + 6]`,
 * which is an *index*, blind to what the chip is: the rail spans every
 * calendar day in the navigable bounds, and a day with no events is
 * `aria-disabled` with a guarded onClick — tapping it does nothing, by
 * documented design (see DayRail.tsx and checks 14a2/14b, which assert
 * exactly that contract). Mid-season every day has events and the index
 * happened to land on a live chip; in the season's tail (2026-08-24: last
 * mounted day + 6 = 2026-09-01, zero events, next event day 2026-09-10) it
 * landed on a dead one and 9a/11a failed on a correct app. Winter's sparse
 * event days would have hit the same wall.
 *
 * So the target is picked from what the rail itself declares tappable, in
 * falling order of preference:
 *
 *  1. The first enabled chip at least 6 chips past the last mounted day
 *     with >= 10 events on it and after it — the original intent, plus a
 *     floor of content below the landing point so "scrolled to it" (9b)
 *     measures a real scroll rather than a document-bottom clamp (the
 *     season's last day has 1 event; jumping there bottoms out ~470px
 *     short of the rail through no fault of the app's).
 *  2. The farthest enabled chip past the last mounted day meeting the same
 *     content floor — the season's tail, where nothing 6+ days out is
 *     viable but nearer unmounted days are.
 *  3. The farthest enabled chip past the last mounted day — almost nothing
 *     left ahead; navigation across the gap is still exercised, and 9b's
 *     bottomed-out disjunct absorbs the clamp.
 *  4. The last mounted day itself — everything reachable is already
 *     mounted (the season's final days, off-season), so "outrunning the
 *     render window" has no test to run and the checks degrade to the
 *     tap-lands-clear and ⟳-Now mechanics on a day that is already there.
 *     This mirrors the old `?? chips[chips.length - 1]` fallback, which in
 *     that regime resolved to the same already-mounted final day.
 */
async function pickFarTarget(page) {
  const chips = await page.$$eval('[data-day-rail] [data-chip]', els => els.map(e => ({
    key: e.dataset.chip,
    enabled: e.getAttribute('aria-disabled') !== 'true',
    // "…, 32 events" / "…, 1 event" / "…, no events" — the label format
    // checks 14a/14b hold stable. "no events" parses to 0 by falling
    // through the match.
    count: Number(/(\d+) events?$/.exec(e.getAttribute('aria-label') ?? '')?.[1] ?? 0),
  })));
  const mounted = await page.$$eval('[data-day-key]', e => e.map(x => x.dataset.dayKey));
  const lastMounted = mounted[mounted.length - 1];
  const from = chips.findIndex(c => c.key === lastMounted);
  // suffix[i] = events on chip i and every chip after it — an upper bound on
  // what can end up mounted below the landing point.
  const suffix = new Array(chips.length).fill(0);
  for (let i = chips.length - 1, acc = 0; i >= 0; i--) { acc += chips[i].count; suffix[i] = acc; }
  const qualifies = i => chips[i].enabled && suffix[i] >= 10;
  for (let i = from + 6; i < chips.length; i++) if (qualifies(i)) return chips[i].key;
  for (let i = chips.length - 1; i > from; i--) if (qualifies(i)) return chips[i].key;
  for (let i = chips.length - 1; i > from; i--) if (chips[i].enabled) return chips[i].key;
  return lastMounted;
}
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
//
// The guard sits OUTSIDE `newPage()` on purpose. With `this-week` persisted
// the reader has a non-default filter, so off-season they get the generic
// empty state rather than the landing — `enterList` has no branch that could
// rescue this page, and correctly refuses it.
//
// `currentRegime()` throws if nothing has bootstrapped yet, which makes the
// dependency on checks 1-2 running first loud rather than silent.
if (currentRegime() === 'off-season') {
  skip('3 persisted this-week migration',
    "off-season 'this-week' resolves to no window at all, by design — the rail " +
    'hides and no day section mounts, so 3b would assert against the contract');
} else {
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
  // A tappable day several past the current render window — the case that
  // fails if navigation cannot outrun the render window. See pickFarTarget
  // for why "tappable" is load-bearing.
  const target = await pickFarTarget(page);
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), target);
  await page.waitForTimeout(1800);
  const present = await page.$(`[data-day-key="${target}"]`);
  check('9a tapped day mounts', !!present, target);
  if (present) {
    const { top, railH, bottomedOut } = await page.evaluate(k => ({
      top: document.querySelector(`[data-day-key="${k}"]`).getBoundingClientRect().top,
      railH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h')) || 0,
      // This RELAXES 9b: the strict form is "section top within 400px of the
      // viewport top", and this alternative accepts "the page scrolled to the
      // very end of a document it actually had to scroll" instead. It can
      // fire only in the season's last days, when the target is so near the
      // rail's end that less than a viewport of content exists below it and
      // the scroll clamps before the section reaches the rail (2026-08-28
      // with the live feed: target 09-10 stops 468px short). Both conditions
      // below are required: without the scrollHeight guard, a document that
      // simply fits the viewport satisfies `scrollY(0) + innerHeight >=
      // scrollHeight` untouched, and in exactly the last-days regime — where
      // rule 4 already hands 9a an always-mounted target — 9b would become
      // unfalsifiable.
      bottomedOut: document.documentElement.scrollHeight > window.innerHeight + 2
        && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
    }), target);
    check('9b scrolled to it', Math.abs(top) < 400 || bottomedOut,
      `top=${top.toFixed(1)}px bottomedOut=${bottomedOut}`);
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
if (currentRegime() === 'off-season') {
  skip('11 ⟳ Now',
    'today is outside navBounds off-season, so reachableTodayKey is null and ' +
    'the button is correctly absent (page.tsx) — there is no navigation back ' +
    'to today left to test');
} else {
  const page = await newPage();
  // Same tappable-target rule as check 9 — the old blind index landed on an
  // aria-disabled chip in the season's tail and the tap was a no-op, so ⟳
  // Now never had a navigation to appear after.
  const far = await pickFarTarget(page);
  await page.evaluate(k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(), far);
  await page.waitForTimeout(1500);
  const nowBtn = page.getByRole('button', { name: 'Go to today' });
  const appeared = await nowBtn.count() > 0;
  // This RELAXES 11a: the strict form is "the button appeared", and this
  // alternative accepts its absence when the anchor is still on today AND
  // the page scrolled to the very end of a document it actually had to
  // scroll. It can fire only on the season's last mounted days (2026-08-31
  // with the live feed: today has 2 events, one 1-event day follows), where
  // even max scroll cannot move the anchor off today and the button is
  // *correctly* absent — its render rule is anchor !== today, which 11c
  // asserts from the other side. The scrollHeight guard is required: a
  // document that simply fits the viewport satisfies `scrollY(0) +
  // innerHeight >= scrollHeight` untouched, and combined with rule 4's
  // always-mounted target that would make 11a unfalsifiable in exactly the
  // regime this alternative exists for. A mid-season click that navigated
  // nowhere leaves the page at the top of a tall document and still fails
  // both legs.
  const [anchorNow, todayNow, bottomedOutNow] = await Promise.all([
    anchorChip(page),
    page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())),
    page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2
      && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2),
  ]);
  check('11a ⟳ Now appears once away from today',
    appeared || (anchorNow === todayNow && bottomedOutNow),
    `far=${far} anchor=${anchorNow} today=${todayNow} bottomedOut=${bottomedOutNow} button=${appeared}`);
  if (appeared) {
    const scopeBefore = await page.$$eval('button[aria-pressed]', els =>
      els.map(e => `${e.textContent.trim()}=${e.getAttribute('aria-pressed')}`).join(','));
    await nowBtn.click();
    await page.waitForTimeout(1500);
    const scopeAfter = await page.$$eval('button[aria-pressed]', els =>
      els.map(e => `${e.textContent.trim()}=${e.getAttribute('aria-pressed')}`).join(','));
    check('11b ⟳ Now changes no filter', scopeBefore === scopeAfter, scopeAfter);

    // Reported with its state on purpose. `11c` has failed on `main` at night
    // and passed the same commit in the morning, and every previous
    // investigation had to guess at the cause because this check printed
    // nothing but its own name — the log line was `11c ⟳ Now hides once back
    // on today:` with an empty detail. Whatever the cause turns out to be,
    // the next failure should be able to state it: what the app thinks today
    // is, where the anchor actually landed, and which days are mounted.
    const stillThere = await page.getByRole('button', { name: 'Go to today' }).count();
    const landedOn = await anchorChip(page);
    const [appToday, mountedNow] = await page.evaluate(() => [
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
      // Not sliced. A capped list defeats the point: if the render window ever
      // mounts more days, `today` lands past the cap and is truncated away in
      // exactly the failure this exists to explain. It is a short array of day
      // keys, so printing all of them costs nothing.
      [...document.querySelectorAll('[data-day-key]')].map(e => e.dataset.dayKey),
    ]);
    check('11c ⟳ Now hides once back on today', stillThere === 0,
      `today=${appToday} anchor=${landedOn} mounted=${mountedNow.join(',')} button=${stillThere}`);
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
    return { day: key, railBottom: r.bottom, headerTop: h.top };
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
    return [...rail.querySelectorAll('button')]
      // The band is 16px tall by design — a full-height band would dominate a
      // rail whose whole job is the chips. It is carved out here rather than
      // silently passing because nothing is reachable ONLY through it: every
      // week is also reachable from its own day chips, which 15a measures at
      // the full 44px, and 15b below is what keeps that true.
      .filter(el => !el.hasAttribute('data-week-band-button'))
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
          w: Math.round(r.width), h: Math.round(r.height),
        };
      });
  });
  if (!controls?.length) {
    check('15a rail tap targets meet the 44px minimum', false, 'no rail controls found');
  } else {
    const under = controls.filter(c => c.w < 44 || c.h < 44);
    check('15a every rail control meets the 44px minimum',
      under.length === 0,
      under.length
        ? `${under.length}/${controls.length} under: ` +
          under.slice(0, 4).map(c => `${c.name} ${c.w}x${c.h}`).join(', ')
        : `${controls.length} controls, smallest ` +
          `${Math.min(...controls.map(c => c.w))}x${Math.min(...controls.map(c => c.h))}`);
  }

  // The carve-out's premise, asserted rather than approximated: the band's
  // 16px button is never the ONLY way to reach the day it goes to. Every
  // reachable week names a destination day, and that day's own chip is a
  // full-size control — so a thumb that cannot hit the band has a 44px route
  // to exactly the same place.
  //
  // This needs the destination in the DOM, which is why the labelled band
  // button carries `data-week-band-target`. Deriving it in the browser instead
  // would mean re-implementing `weekBandDestinations` in the check — a second
  // copy of the rule, which is the thing this whole design keeps refusing to
  // have.
  const carveOut = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    const targets = [...rail.querySelectorAll('[data-week-band-button]')]
      .filter(b => b.getAttribute('aria-disabled') !== 'true')
      .map(b => b.dataset.weekBandTarget)
      .filter(Boolean);
    const missing = targets.filter(day => {
      const chip = rail.querySelector(`[data-chip="${day}"]`);
      if (!chip) return true;
      const r = chip.getBoundingClientRect();
      return r.width < 44 || r.height < 44;
    });
    return { offered: targets.length, missing };
  });
  check('15b every week the band offers has a 44px chip for the same day',
    carveOut.offered > 0 && carveOut.missing.length === 0,
    carveOut.offered === 0
      ? 'no reachable week band button found'
      : `${carveOut.offered} weeks offered, ${carveOut.missing.length} without a full-size chip` +
        (carveOut.missing.length ? `: ${carveOut.missing.join(', ')}` : ''));
  await page.close();
}

// ------------------------------------------------------------ 16. the week band
//
// Alignment is claimed to be structural — the band cell and the chip are
// block-level children of one flex column, so the cell's width EQUALS the
// chip's rather than matching it. A structural claim is still worth measuring
// once: `w-max`, `shrink-0` and a stray `min-width` on a future descendant can
// all break "equals" without breaking the markup.
{
  const page = await newPage();
  const geometry = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    if (!rail) return null;
    const columns = [...rail.querySelectorAll('[data-rail-content] > [data-rail-column]')];
    const cells = columns.map(col => {
      const cell = col.querySelector('[data-band-cell]');
      const chip = col.querySelector('[data-chip]');
      const run = col.querySelector('[data-band-run]');
      const bars = [...col.querySelectorAll('[data-band-bar]')].map(b => {
        const r = b.getBoundingClientRect();
        return {
          left: r.left, right: r.right,
          opacity: Number(getComputedStyle(b).opacity),
          // Ground truth for "same week", independent of the geometry 16b
          // tests: the ramp step is a pure function of week number and
          // `rampPercent` rounds to whole percent, so two touching bars in
          // the same week resolve to byte-identical computed colour.
          color: getComputedStyle(b).backgroundColor,
        };
      });
      return {
        day: chip?.dataset.chip ?? null,
        cellW: cell?.getBoundingClientRect().width ?? null,
        chipW: chip?.getBoundingClientRect().width ?? null,
        runLeft: run?.getBoundingClientRect().left ?? null,
        runRight: run?.getBoundingClientRect().right ?? null,
        cellLeft: cell?.getBoundingClientRect().left ?? null,
        cellRight: cell?.getBoundingClientRect().right ?? null,
        bars,
      };
    });
    const pill = document.querySelector('[data-rail-pill]')?.getBoundingClientRect();
    const bandBottom = cells[0] ? document.querySelector('[data-band-cell]').getBoundingClientRect().bottom : null;
    const labels = [...rail.querySelectorAll('[data-week-band-button]')]
      .map(b => b.dataset.weekBandButton);
    // The copy layer must lay out its CHIP BOXES pixel-identically to the
    // real row — that is what a highlighted digit is clipped against. The
    // COLUMNS themselves are `absolute inset-0` + `items-stretch`, so their
    // own rects always match regardless of what is inside them; comparing
    // columns rather than chip boxes would pass even if the copy's band
    // spacer drifted from `--rail-band-h` and pushed every chip below it
    // out of line with the real row.
    const copyChipBoxes = [...rail.querySelectorAll('[data-rail-clip] > [data-rail-column]')]
      .map(col => col.querySelector(':scope > div:not([data-band-spacer])')?.getBoundingClientRect() ?? null);
    const realChipBoxes = columns.map(col => col.querySelector('[data-chip]')?.getBoundingClientRect() ?? null);
    const worstCopyDelta = Math.max(0, ...realChipBoxes.map((r, i) => {
      const c = copyChipBoxes[i];
      if (!r || !c) return 999;
      return Math.max(
        Math.abs(r.left - c.left), Math.abs(r.width - c.width),
        Math.abs(r.top - c.top), Math.abs(r.height - c.height),
      );
    }));
    return { cells, pill, bandBottom, labels, worstCopyDelta, columns: columns.length };
  });

  if (!geometry) {
    check('16 week band present', false, 'no rail');
  } else {
    const { cells, pill, bandBottom, labels, worstCopyDelta } = geometry;
    const widthDrift = Math.max(...cells.map(c => Math.abs((c.cellW ?? 0) - (c.chipW ?? -1))));
    check('16a every band cell is exactly its chip\'s width', widthDrift < 0.5,
      `worst ${widthDrift.toFixed(2)}px over ${cells.length} columns`);

    // A week is drawn as ONE run: inside a week the fill bridges the gutter,
    // and the only break in the whole band is the seam through the Saturday
    // two weeks share. Measured off the OUTER bar on each side of the
    // gutter — the last bar of the column to the left, the first bar of the
    // column to the right — so a boundary Saturday's split cell is included
    // rather than excluded: the join between a weekday and its boundary
    // Saturday is the riskiest geometry in the design, and a
    // `bars.length === 1` filter would never measure it. "Same week" is
    // ground-truthed independently, off the bars' own computed colour (a
    // pure function of week number, rounded to whole percent — see above),
    // so the count asserted below is not just "at least one gutter touched".
    const gutters = cells.slice(0, -1).map((c, i) => {
      const next = cells[i + 1];
      if (c.bars.length === 0 || next.bars.length === 0) return { touching: false, sameWeek: false };
      const leftEdge = c.bars[c.bars.length - 1];
      const rightEdge = next.bars[0];
      return {
        touching: Math.abs(leftEdge.right - rightEdge.left) < 0.5,
        sameWeek: leftEdge.color === rightEdge.color,
      };
    });
    const bridged = gutters.filter(g => g.touching).length;
    const sameWeekGutters = gutters.filter(g => g.sameWeek).length;
    check('16b the fill bridges the gutters inside a week',
      bridged > 0 && bridged === sameWeekGutters,
      `${bridged} bridged of ${sameWeekGutters} same-week gutters`);

    const split = cells.filter(c => c.bars.length === 2);
    const seams = split.map(c => c.bars[1].left - c.bars[0].right);
    check('16c a boundary Saturday is split, and only there',
      split.length > 0 && seams.every(s => s > 0.5 && s < 6),
      `${split.length} split days, seams ${seams.map(s => s.toFixed(1)).join(', ')}`);

    check('16d WEEK n appears at most once per week',
      labels.length === new Set(labels).size && labels.length > 0,
      `${labels.length} labels: ${labels.join(',')}`);

    // Risk 1 from the design, measured rather than assumed.
    check('16e the highlight pill does not paint over the band',
      !!pill && !!bandBottom && pill.top >= bandBottom - 0.5,
      pill ? `pill.top=${pill.top.toFixed(1)} band.bottom=${bandBottom.toFixed(1)}` : 'no pill');

    // Risk 1's other half: the two layers must stay in step, or the seam the
    // shared chip-box class exists to prevent comes back one level up.
    check('16f the clipped copy lays out column for column', worstCopyDelta < 0.5,
      `worst ${worstCopyDelta.toFixed(2)}px`);
  }
  await page.close();
}

// ------------------------------------------- 17. a band tap navigates
{
  const page = await newPage();
  const before = await anchorChip(page);
  const jumped = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-week-band-button]')]
      .filter(b => b.getAttribute('aria-disabled') !== 'true');
    // The furthest reachable week from wherever the rail opened, so the check
    // cannot pass on a one-chip move.
    const target = buttons[buttons.length - 1];
    if (!target) return null;
    target.click();
    return { week: target.dataset.weekBandButton, label: target.getAttribute('aria-label') };
  });
  if (!jumped) {
    check('17a a band tap navigates', false, 'no reachable week band button');
  } else {
    await page.waitForTimeout(700);
    const after = await anchorChip(page);
    check('17a a band tap navigates', !!after && after !== before, `${before} → ${after}`);
    // Named by destination, and the destination is where it actually landed.
    const named = /Go to Week \d+, (opens|first events) (.+), \d+ events?$/.exec(jumped.label ?? '');
    check('17b the band names the day it actually lands on',
      !!named && !!after && jumped.label.includes(new Date(`${after}T12:00:00`)
        .toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })),
      `${jumped.label} → landed ${after}`);
  }
  await page.close();
}

// ------------------------------------------- 18. an unreachable week is inert
//
// The default, unfiltered feed fills every in-season week, so this check has
// to construct the unreachable state itself rather than hope for one. It is
// narrowed through PERSISTED FILTER STATE, the same route check 3 uses for
// 'this-week' — a storage seed reaches `navMatchingEvents` with no dependency
// on the filter panel's own markup, which the drive-the-UI alternative would
// have.
//
// The term is 'williamsburg': Colonial Williamsburg's themed week-6
// residency, a whole week of named partner programming rather than one
// event a routine feed refresh could drop, which is what "stable against
// feed churn" means here — not that the exact match count is fixed (it
// isn't: the local dev fixture carries 4 matching events, live production
// 9, both entirely inside week 6), but that the THEME is a fixture of the
// season rather than a coincidence of today's snapshot. It leaves every
// other in-season week with zero matches, which is the unreachable state
// 18a/18b need, and it never fully empties the reachable side either (see
// 18-pre), which is what keeps 18a from going vacuous.
//
// dateFilter is seeded to 'all' ("All Year"), not left at the default
// 'next': week 6 is in the past relative to 'now' this season, so a
// 'next'-scoped list would show zero matching events, the app would render
// the generic empty state, and `enterList`'s EMPTY branch throws before this
// check gets to assert anything.
{
  const page = await newPage({
    storage: ['chq-calendar-user-state', JSON.stringify({
      dateFilter: 'all', selectedWeeks: [], searchTerm: 'williamsburg',
      selectedTags: [], selectedLocations: [], expandedDescriptions: [],
      recentLocations: [], recentCategories: [], showFavoritesOnly: false,
      lastSaved: Date.now(),
    })],
  });
  const state = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-week-band-button]')];
    const disabled = buttons.filter(b => b.getAttribute('aria-disabled') === 'true');
    const reachable = buttons.filter(b => b.getAttribute('aria-disabled') !== 'true');
    return {
      count: disabled.length,
      reachableCount: reachable.length,
      labels: disabled.map(b => b.getAttribute('aria-label')),
      // The FILL is faded; the label is not. Fading the label is what took an
      // empty iOS chip's text to a sampled ~3.7:1.
      fillOpacity: disabled[0]
        ? Number(getComputedStyle(disabled[0].closest('[data-band-cell]')
            .querySelector('[data-band-bar]')).opacity)
        : null,
      labelOpacity: disabled[0]
        ? Number(getComputedStyle(disabled[0].querySelector('span')).opacity)
        : null,
    };
  });
  // The check now controls its own precondition — a search that failed to
  // narrow anything is a FAILURE of this check, not a reason to stand down.
  // Both counts are asserted: zero unreachable is the original gap, and zero
  // reachable would mean the term matched nothing at all (an empty
  // `weekDestinations` map dims nothing, by design — see WeekBandCell — so a
  // term with no matches would make 18a vacuously true instead of failing).
  check('18-pre the search term narrows to exactly one theme week',
    state.count > 0 && state.reachableCount > 0,
    `${state.reachableCount} reachable, ${state.count} unreachable`);
  check('18a an unreachable week says so rather than offering a trip',
    state.count > 0 && state.labels.every(l => /^Week \d+, no events$/.test(l ?? '')),
    state.labels.slice(0, 3).join(' | ') || 'no unreachable week found');
  check('18b the fill is faded and the label is not',
    state.fillOpacity !== null && state.fillOpacity < 1 && state.labelOpacity === 1,
    `fill=${state.fillOpacity} label=${state.labelOpacity}`);
  await page.close();
}

// ------------------------------------------- 19. axe over the rail
//
// `aria-hidden-focus` is the rule this design has to prove clean, not assume:
// ~64 decorative segments carry the band's pointer handlers, and every one of
// them is `aria-hidden`. A single focusable descendant among them would put a
// hidden control in the tab order.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const page = await newPage();
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const results = await page.evaluate(async () => {
    const run = await window.axe.run('[data-day-rail]', {
      runOnly: { type: 'rule', values: [
        'aria-hidden-focus', 'button-name', 'aria-allowed-attr', 'nested-interactive',
      ] },
    });
    return run.violations.map(v => `${v.id} x${v.nodes.length}`);
  });
  check('19 axe is clean over the rail with the band present',
    results.length === 0, results.join(', ') || 'no violations');
  await page.close();
}

await browser.close();
finish();
