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
 * Open the app with the clock pinned to `day` at mid-morning Institution time.
 *
 * `manifest` and `emptyEvents` replace what the CDN would serve. Both are
 * narrow on purpose — everything not named here stays live production data,
 * which is what makes the other assertions worth anything.
 */
async function pinnedPage(day, { manifest, emptyEvents } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 900 },
    timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  page.once('close', () => { ctx.close().catch(() => {}); });
  if (manifest) await page.route('**/years.json', r => r.fulfill(json(manifest)));
  if (emptyEvents) await page.route('**/all-events-*.json', r => r.fulfill(json({ data: [] })));
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
  await page.getByRole('button', { name: /^Browse the \d{4} season$/ }).click();
  await page.waitForSelector('[data-day-key]', { timeout: 15000 }).catch(() => {});
  const after = await page.evaluate(() => document.querySelectorAll('[data-day-key]').length);
  check('1d browsing the archive mounts the season', after > 0, `${after} day sections`);
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
  const page = await pinnedPage(day, { emptyEvents: true });
  const s = await screenState(page);
  check('3a landing before an announced season is published', s.landing && s.days === 0,
    `day=${day} landing=${s.landing} days=${s.days}`);
  check('3b it says the season has not started', s.heading === 'Almost showtime', s.heading);
  check('3c it counts down to the opening',
    /^The \d{4} season begins [A-Z][a-z]+ \d{1,2}$/.test(s.countdown ?? ''), s.countdown);
  // No year-aware "browse a past season" action exists, so pre-season offers
  // no buttons — a button labelled with last year would apply the scope to
  // this one. Mirrors LandingState.archiveYear == nil for .preSeason on iOS.
  check('3d no buttons pre-season', s.buttons.length === 0, s.buttons.join(' | '));
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
  });
  const s = await screenState(page);
  // Once the manifest points at a year that has events, `next`'s adaptive
  // window reaches forward to them however far off they are, and the reader
  // gets a list again. That IS the self-heal.
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
