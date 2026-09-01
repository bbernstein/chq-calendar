/**
 * The off-season regimes, pinned.
 *
 * From the season's last event day until the years manifest rolls over on
 * October 1, the default window is empty and the app shows the off-season
 * landing instead of a day list (#269). That path is unreachable for eleven
 * months of the year, so without this suite it would be proved once and then
 * rot — and the next anyone heard of it would be the following September, in
 * exactly the same way.
 *
 * Every pinned instant is derived from the feed rather than written down. A
 * literal date would be wrong the moment the next season is published, which
 * is the same staleness that made `verify-rail`'s old `chips[lastMounted + 6]`
 * target fail in the season's tail (#268).
 */
import { chromium } from 'playwright';
import { check, finish } from './results.mjs';

const URL = process.env.URL ?? 'http://localhost:3000/';
const FEED = 'https://www.chqcal.org/cache/calendar-cache';

const browser = await chromium.launch();

/** The default year's first and last event day, straight from the feed. */
async function seasonEdges() {
  const manifest = await (await fetch(`${FEED}/years.json`)).json();
  const year = manifest.defaultYear;
  const feed = await (await fetch(`${FEED}/all-events-${year}.json`)).json();
  const days = [...new Set(feed.data.map(e => e.startDate.slice(0, 10)))].sort();
  return { year, years: manifest.years, first: days[0], last: days[days.length - 1] };
}

/** `yyyy-mm-dd` shifted by whole calendar days, via UTC so no DST is involved. */
function shift(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * A minimal published season for `year`, for the entries that must not depend
 * on what production happens to be serving. Mid-July is inside the season in
 * every year — it runs from the Saturday before the 4th Sunday of June for
 * nine weeks — so these always fall within the scope's reach.
 */
function seasonFixture(year) {
  return {
    data: [1, 2, 3].map(n => ({
      id: `fixture-${year}-${n}`,
      title: `Fixture Lecture ${n}`,
      startDate: `${year}-07-1${n} 10:45:00`,
      endDate: `${year}-07-1${n} 11:45:00`,
      location: 'Amphitheater',
      description: 'A fixture event.',
      categories: [{ name: 'Lecture' }],
    })),
  };
}

/**
 * Open the app with the clock pinned to `day` at mid-morning Institution time.
 *
 * `manifest` and `routeEvents` replace what the CDN would serve. Both are
 * narrow on purpose — everything not named here stays live production data,
 * which is what makes the other assertions worth anything.
 */
async function pinnedPage(day, { manifest, routeEvents } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 900 },
    timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  page.once('close', () => { ctx.close().catch(() => {}); });
  if (manifest) await page.route('**/years.json', r => r.fulfill(json(manifest)));
  if (routeEvents) await page.route(routeEvents.glob, r => r.fulfill(json(routeEvents.body)));
  await page.clock.setFixedTime(new Date(`${day}T14:00:00Z`));
  await page.goto(URL, { waitUntil: 'networkidle' });
  return page;
}

/** What the main panel settled on, once it settled on anything. */
async function screenState(page) {
  await Promise.race([
    page.waitForSelector('[data-day-key]', { timeout: 30000 }),
    page.waitForSelector('[data-testid="off-season-landing"]', { timeout: 30000 }),
    page.waitForSelector('[data-testid="empty-state"]', { timeout: 30000 }),
  ]).catch(() => {});
  return page.evaluate(() => ({
    days: document.querySelectorAll('[data-day-key]').length,
    landing: !!document.querySelector('[data-testid="off-season-landing"]'),
    empty: !!document.querySelector('[data-testid="empty-state"]'),
    heading: document.querySelector('[data-testid="off-season-landing"] h3')?.textContent?.trim() ?? null,
    countdown: document.querySelector('[data-testid="off-season-countdown"]')?.textContent?.trim() ?? null,
    buttons: [...document.querySelectorAll('[data-testid="off-season-landing"] button')]
      .map(b => b.textContent.trim()),
  }));
}

const edges = await seasonEdges();
console.log(`feed: default year ${edges.year}, events ${edges.first} … ${edges.last}`);
check('0 feed has a season to reason about', !!edges.first && !!edges.last,
  `${edges.first} … ${edges.last}`);

// Stop here rather than carrying an undefined edge into `shift()`, which
// throws and aborts the run with a stack trace instead of a PASS/FAIL summary.
// The process exits non-zero either way, so this is about a temporarily
// unavailable feed reading as an actionable failure rather than as a crash.
if (!edges.first || !edges.last) {
  await browser.close();
  finish();
}

// ------------------------------------------------- 1. post-season, just after
{
  const day = shift(edges.last, 5);
  const page = await pinnedPage(day);
  const s = await screenState(page);
  check('1a landing replaces the empty list', s.landing && s.days === 0,
    `day=${day} landing=${s.landing} days=${s.days} empty=${s.empty}`);
  check('1b it says the season has ended', s.heading === 'See you next season', s.heading);
  check('1c the archive is offered', s.buttons.some(b => /^Browse the \d{4} season$/.test(b)),
    s.buttons.join(' | '));

  // The affordance `enterList` falls back to. If this fails, that fallback is
  // dead and only the rail-chip route is holding the browser checks up.
  //
  // Guarded rather than clicked outright: an unconditional `.click()` throws
  // when the button is absent, which aborts the whole suite and takes entries
  // 2-5 down with it. These harnesses report every check on purpose — a run
  // that fails one still has to say what the others did, because the failures
  // cluster. Falsified by disabling the landing branch in page.tsx: the click
  // timed out and entries 2-5 never ran.
  const archive = page.getByRole('button', { name: /^Browse the \d{4} season$/ });
  if (await archive.count() === 0) {
    check('1d browsing the archive mounts the season', false, 'no archive button to click');
  } else {
    await archive.click();
    await page.waitForSelector('[data-day-key]', { timeout: 15000 }).catch(() => {});
    const after = await page.evaluate(() => document.querySelectorAll('[data-day-key]').length);
    check('1d browsing the archive mounts the season', after > 0, `${after} day sections`);
  }
  await page.close();
}

// ------------------------------------- 2. post-season, the September 30 edge
{
  const day = shift(edges.last, 19);
  const page = await pinnedPage(day);
  const s = await screenState(page);
  check('2a still the landing three weeks later', s.landing && s.days === 0,
    `day=${day} landing=${s.landing} days=${s.days}`);
  check('2b still says the season has ended', s.heading === 'See you next season', s.heading);
  await page.close();
}

// ------------------------------------------------------------- 3. pre-season
//
// The events feed is stubbed empty here, and that is not laziness — it is the
// only way this regime exists at all. With events published, the `next`
// scope's adaptive window keeps reaching forward until it has accumulated 50
// of them, however far off they are: pinned to March against the live 2026
// feed the window lands in the season and the list is NOT empty, which makes
// `in-season` the correct answer and no landing the correct screen. The
// countdown belongs to the window between a year being announced in the
// manifest and its programme going up, which is exactly a year with no events
// in it yet. So that is what is served.
{
  const day = shift(edges.first, -60);
  const page = await pinnedPage(day, {
    routeEvents: { glob: '**/all-events-*.json', body: { data: [] } },
  });
  const s = await screenState(page);
  check('3a landing before an announced season is published', s.landing && s.days === 0,
    `day=${day} landing=${s.landing} days=${s.days}`);
  check('3b it says the season has not started', s.heading === 'Almost showtime', s.heading);
  check('3c it counts down to the opening',
    /^The \d{4} season begins [A-Z][a-z]+ \d{1,2}$/.test(s.countdown ?? ''), s.countdown);
  // #186: pre-season offers exactly one action — browse the most recent
  // season that actually has a schedule. Until #186 this asserted the
  // opposite (`buttons.length === 0`), because the only browse action was
  // year-blind and a button labelled with last year would have applied the
  // scope to this one. That dead end is what #186 removed, on both
  // platforms; `LandingState.determine` and `determineLandingState` now
  // carry the same archive year, so this check pins the port's web half.
  //
  // The label is derived from the live manifest rather than hard-coded: the
  // rule is "newest year strictly earlier than the selected one", NOT
  // `selectedYear - 1`, which can name a year the manifest lacks and whose
  // feed 404s into an empty screen.
  //
  // Both checks stay conjoined with `s.landing` so they cannot pass
  // vacuously — the button assertions are trivially unsatisfiable, but the
  // *absence* one is trivially true on a page with no landing at all.
  // Falsifying 3a-3c by disabling the branch in page.tsx once left the old
  // version of this check green on a page that had nothing on it. A check
  // that survives its own subject being deleted is not a check.
  // `null`, not -Infinity, when nothing is earlier: `Math.max()` of an empty
  // spread is -Infinity, which would assert "Browse the -Infinity season" and
  // fail for a reason that has nothing to do with the behaviour under test.
  // The nil branch is the rule, not a defensive afterthought — a first
  // published season has no earlier one, and `determineLandingState` returns
  // `archiveYear: null` there, which correctly renders no button at all.
  //
  // Not exercised today, and deliberately not dressed up as if it were: the
  // live manifest has carried an earlier year since 2025 was published, so
  // the nil branch cannot be reached from this suite, which reads the real
  // feed by design. It is here so that the day it IS reachable this check
  // fails for its own reason or passes honestly, rather than reporting
  // `Browse the -Infinity season`.
  const earlier = edges.years.filter(y => y < edges.year);
  const archiveYear = earlier.length > 0 ? Math.max(...earlier) : null;
  check('3d pre-season offers the last season that ran',
    s.landing && (archiveYear === null
      ? s.buttons.length === 0
      : s.buttons.length === 1 && s.buttons[0] === `Browse the ${archiveYear} season`),
    `landing=${s.landing} archiveYear=${archiveYear ?? 'none'} `
      + `buttons=${s.buttons.join(' | ') || 'none'}`);
  // "Preview the _ season" stays post-season-only: pre-season IS the
  // upcoming season, so there is nothing ahead to preview.
  check('3e pre-season offers no preview action',
    s.landing && !s.buttons.some(b => b.startsWith('Preview the')),
    `landing=${s.landing} buttons=${s.buttons.join(' | ') || 'none'}`);
  await page.close();
}

// -------------------------------------------------------------- 4. in season
{
  const day = shift(edges.last, -30);
  const page = await pinnedPage(day);
  const s = await screenState(page);
  check('4a a real list mid-season, and no landing', s.days > 0 && !s.landing,
    `day=${day} days=${s.days} landing=${s.landing}`);
  await page.close();
}

// ----------------------------------------- 5. the October manifest rollover
//
// `defaultYear` is server-generated, not derived from the client clock:
// `useAvailableYears` reads it from years.json, and `getDefaultYear()` in
// constants.ts is only the failed-fetch fallback. So pinning the clock past
// October 1 does NOT reproduce the rollover — production keeps serving the
// current default and the page just shows the post-season landing again.
// Stubbing the manifest is the only way to exercise the mechanism #269
// self-heals by. Everything else in this entry stays live.
{
  const nextYear = edges.year + 1;
  const day = shift(edges.last, 25);
  const page = await pinnedPage(day, {
    manifest: {
      years: [...new Set([...edges.years, nextYear])].sort(),
      defaultYear: nextYear,
      generated: '',
    },
    // Next year's events are stubbed rather than taken from production, and
    // that is the difference between a deterministic check and a seasonal
    // one. Leaving them live made 5a assert that the next season is already
    // published on chqcal.org — true today, but a fact about production data
    // rather than about this code. In the very window #269 is about, a year
    // can roll over in the manifest before its programme goes up; production
    // would then correctly show "Almost showtime" and 5a would go red on
    // every PR merged in those weeks, for a reason having nothing to do with
    // the change under review. That is #269's own class of quiet wrongness
    // inverted — a false red instead of a false green — and it would sit on
    // the default CI path, since test:browser has no path filtering.
    routeEvents: { glob: `**/all-events-${nextYear}.json`, body: seasonFixture(nextYear) },
  });
  const s = await screenState(page);
  // Once the manifest points at a year that has events, `next`'s adaptive
  // window reaches forward to them however far off they are, and the reader
  // gets a list again. That IS the self-heal, and with the feed stubbed the
  // check now proves it rather than inheriting it from production.
  check('5a rolling the manifest forward ends the empty screen', s.days > 0 && !s.landing,
    `day=${day} defaultYear=${nextYear} days=${s.days} landing=${s.landing} heading=${s.heading}`);
  // Whatever the next year's feed holds, it must never claim that year's
  // season has already ended — the reader is before it, not after it.
  check('5b it never says the next season has ended',
    s.heading !== 'See you next season', s.heading);
  await page.close();
}

await browser.close();
finish();
