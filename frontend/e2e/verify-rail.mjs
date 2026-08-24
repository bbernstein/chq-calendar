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

const URL = process.env.URL ?? 'http://localhost:3000/';
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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
  await page.waitForSelector('[data-day-key]', { timeout: 30000 });
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
{
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
