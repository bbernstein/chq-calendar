/**
 * Captures the web app for the /about/web guide.
 *
 * Defaults to the deployed production site; override with ABOUT_CAPTURE_URL
 * (see BASE_URL below) to capture a local build instead. Seeds localStorage so
 * each shot shows a specific, reproducible state rather than whatever the
 * calendar happens to open on. Keys and shapes below mirror
 * src/hooks/useFilterState.ts and src/hooks/useFavorites.ts — if those change,
 * this needs to change with them.
 *
 * Outputs are committed, so `npm run build` never depends on this running.
 *
 * The `playwright` devDependency in package.json is pinned to `^1.62.1`, not
 * the `^1.50.0` floor named in the original task brief. That's not a typo or
 * a substituted command: running `npm install --save-dev playwright@^1.50.0`
 * verbatim resolves `^1.50.0` against the registry (latest matching is
 * 1.62.1) and npm's default save-prefix writes `^<resolved>`, not the input
 * range, back to package.json. 1.62.1 is the version this script was
 * actually exercised against — don't "fix" the declared range back down to
 * `^1.50.0` to match the brief text; that would pin a floor that was never
 * tested.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, readFile, unlink } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/about');
const TMP = resolve(HERE, '../.about-capture.png');
/**
 * Defaults to production, not the dev server, for two reasons: the shots are
 * marketing material and should show the deployed site, and `getWebcalUrl`
 * returns null on localhost (see src/lib/utils/calendarUrls.ts), so the
 * calendar menu would be missing its subscribe option — which the /about/web
 * copy explicitly describes. Override with ABOUT_CAPTURE_URL to shoot a local
 * build.
 *
 * NOTE: shooting an unreleased branch is what the override is for, and there
 * is a right way to do it. `vite build && vite preview --host` serves this
 * branch's bundle while `vite.config.ts`'s preview proxy sends `/cache/**` to
 * https://www.chqcal.org, so the page renders the real feed rather than an
 * empty list. Point ABOUT_CAPTURE_URL at the machine's LAN address
 * (http://192.168.x.x:3000/), NOT at localhost or 127.0.0.1 — those two
 * hostnames are the literal values `getWebcalUrl` refuses, and shooting them
 * drops the subscribe row from the `05-calendar` menu without failing
 * anything.
 */
const BASE_URL = process.env.ABOUT_CAPTURE_URL ?? 'https://www.chqcal.org';
const VIEWPORT = { width: 1280, height: 900 };
const WIDTHS = [640, 1280];

const FILTER_KEY = 'chq-calendar-user-state';
const FAVORITES_KEY = 'chq-calendar-favorites';

/** Matches the object written by useFilterState's persistence effect. */
const baseFilterState = {
  searchTerm: '', selectedTags: [], selectedLocations: [],
  expandedDescriptions: [], recentLocations: [],
  recentCategories: [], showFavoritesOnly: false,
};

/**
 * `dateFilter` and `selectedWeeks` are gone from every seed below, and that is
 * not tidying: #274 phase 4 deleted both from `useFilterState`, so
 * `loadInitialState` ignores them. A seed carrying only those keys seeds
 * NOTHING — which is what `06-weeks` had become, a photograph of an unseeded
 * default page standing in for a week strip that no longer exists. Its subject
 * moved to the rail's week chooser, so the shot follows it.
 *
 * The `open*` flags carry more weight than they used to. Phase 3 made the
 * filter panel a fixed overlay that is `hidden` until the site header's
 * funnel is pressed, so the search field, the venue and category lists and
 * the active-filter chips are all off screen on load. Seeding `searchTerm` or
 * `selectedTags` alone therefore produces a picture of a shorter list with no
 * filter UI in it at all — true, but not a picture of searching or filtering,
 * and indistinguishable from a seed that silently did nothing. The two shots
 * whose subject is the control open the panel; `04-favorites`, whose subject
 * is the resulting list, deliberately does not.
 */
const SHOTS = [
  { id: '01-season', filters: {} },
  { id: '02-search', filters: { searchTerm: 'lecture' }, openFilters: true },
  {
    id: '03-filters',
    // `recentCategories` as well as `selectedTags`: the row of recent-filter
    // shortcut pills is its own documented feature (`web-recent-filters`) and
    // is populated by having *used* a filter, which a cold seed cannot do.
    filters: { selectedTags: ['Lecture'], recentCategories: ['Lecture', 'Music', 'Recreation'] },
    openFilters: true,
  },
  { id: '04-favorites', filters: { showFavoritesOnly: true }, favorites: true },
  { id: '05-calendar', filters: {}, openCalendar: true },
  { id: '06-week-chooser', filters: {}, openWeekChooser: true },
];

async function seed(page, shot, favoriteIds) {
  await page.addInitScript(
    ({ filterKey, favKey, filters, favorites, ids }) => {
      localStorage.setItem(filterKey, JSON.stringify({ ...filters, lastSaved: Date.now() }));
      if (favorites) {
        localStorage.setItem(favKey, JSON.stringify({ eventIds: ids, lastSaved: Date.now() }));
      }
    },
    {
      filterKey: FILTER_KEY, favKey: FAVORITES_KEY,
      filters: { ...baseFilterState, ...shot.filters },
      favorites: Boolean(shot.favorites), ids: favoriteIds,
    }
  );
}

/**
 * Waits for the landing scroll to stop moving, and answers where it stopped.
 *
 * Every shot needs this and not only the interactive ones. The page puts the
 * reader in front of `landingDay` itself, after the feed resolves — so
 * `waitForSelector('[data-event-id]')` returns while the page is still on its
 * way there. Measuring or clicking in that window reads a scroll position
 * that is about to change, which is how the calendar shot ended up
 * photographing a menu that had already scrolled off the bottom of the frame.
 */
async function settleScroll(page) {
  let last = -1;
  for (let i = 0; i < 25; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return y;
    last = y;
    await page.waitForTimeout(150);
  }
  return last;
}

/**
 * Real event ids for the favorites shot — taken from where the reader is
 * standing, not from the top of the document.
 *
 * This used to be `slice(0, n)` over every card on the page, which was the
 * next few events back when the list was the `next` window. #274 phase 4
 * lists the whole year, so the first five cards are now January 3rd's, and
 * the favorites shot became five Horse-Drawn Carriage Rides in the snow with
 * the season's own events nowhere in it. Nothing failed; the shot was simply
 * wrong. Cards ending above the viewport are behind the reader, so the first
 * one that does not is the landing day's.
 */
async function visibleEventIds(page, count) {
  return page.evaluate((n) => {
    const nodes = Array.from(document.querySelectorAll('[data-event-id]'));
    const start = nodes.findIndex((el) => el.getBoundingClientRect().bottom > 0);
    return nodes.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + n)
      .map((el) => el.getAttribute('data-event-id'));
  }, count);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // First pass: load once with no seeding to learn real event ids.
  const probeContext = await browser.newContext({ viewport: VIEWPORT });
  const probe = await probeContext.newPage();
  await probe.goto(BASE_URL, { waitUntil: 'networkidle' });
  await probe.waitForSelector('[data-event-id]', { timeout: 30_000 });
  await settleScroll(probe);
  const favoriteIds = await visibleEventIds(probe, 5);
  await probeContext.close();

  if (favoriteIds.length === 0) {
    throw new Error('No [data-event-id] elements found — is the dev server serving events?');
  }

  for (const shot of SHOTS) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: false });
    const page = await context.newPage();
    await seed(page, shot, favoriteIds);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-event-id]', { timeout: 30_000 });
    await settleScroll(page);

    if (shot.openCalendar) {
      // The calendar popup only opens on a device the app considers desktop
      // (`isDesktop()` tests `(hover: hover) and (pointer: fine)`); on
      // anything else the same button downloads an .ics instead, silently
      // producing a shot of an unchanged list. Assert the menu is really
      // open rather than trusting the click.
      //
      // `.first()` used to be right and is not any more. The list was the
      // `next` window, so the first card in the DOM was the next event; #274
      // phase 4 lists the whole year, so the first card is January 3 while
      // the page has already scrolled itself to today. Clicking `.first()`
      // makes Playwright auto-scroll back to January and photographs a menu
      // on an event from eight months ago. Take a card the reader is actually
      // looking at instead — which also means no scrolling, so the shot keeps
      // the landing position every other shot has.
      //
      // The card has to be in the viewport's UPPER half, not merely in the
      // viewport. `CalendarPopup` is `position: fixed` at the button's own
      // `rect.bottom + 4` and is never flipped above it, so a button low in
      // the frame puts the whole menu below the fold — present in the DOM,
      // absent from the picture. `waitForSelector` passes either way, which
      // is why the boundingBox assertion below exists as well: this shot's
      // entire subject is a menu, and there is no other check that it is in
      // shot. 180px clears the site header and the day rail beneath it.
      const idx = await page.evaluate(() => Array.from(
        document.querySelectorAll('[data-event-id]')
      ).findIndex((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top >= 180 && r.bottom <= window.innerHeight / 2;
      }));
      if (idx < 0) throw new Error('openCalendar: no event card in the upper half of the viewport');
      await page.locator('[data-event-id]').nth(idx).locator('[aria-label="Add to calendar"]').click();
      const menu = page.locator('[role="menu"][aria-label="Add to calendar"]');
      await menu.waitFor({ timeout: 5_000 });
      const box = await menu.boundingBox();
      if (!box || box.y < 0 || box.y + box.height > VIEWPORT.height) {
        throw new Error(`openCalendar: menu is outside the frame (${JSON.stringify(box)})`);
      }
    }

    if (shot.openFilters) {
      // The funnel lives in the site header (#274 phase 3), not on the day
      // rail, and it is the ONLY route to the panel — so this click is the
      // whole of what makes a search or filter shot show anything. Assert the
      // panel is really on screen: `hidden` while closed means a missed click
      // yields a plain list, which looks like a successful capture.
      await page.locator('header button[aria-label="Filters"]').first().click();
      await page.waitForSelector('[data-filter-panel-box]', { state: 'visible', timeout: 5_000 });
    }

    if (shot.openWeekChooser) {
      // Same discipline as `openCalendar` above: assert the grid is really
      // open rather than trusting the click. A chooser that failed to open
      // photographs an ordinary list, which is exactly the silent-wrong-shot
      // failure this whole file's header warns about.
      await page.locator('[data-week-chooser-trigger]').first().click();
      await page.waitForSelector('[data-week-chooser-popover]', { timeout: 5_000 });
    }

    await page.screenshot({ path: TMP });
    await context.close();

    const png = await readFile(TMP);
    for (const width of WIDTHS) {
      const out = resolve(OUT_DIR, `web-${shot.id}-${width}.webp`);
      await sharp(png).resize({ width }).webp({ quality: 82 }).toFile(out);
      console.log(`web-${shot.id}-${width}.webp`);
    }
  }

  await unlink(TMP).catch(() => {});
  await browser.close();
  console.log(`\n${SHOTS.length} shots → ${SHOTS.length * WIDTHS.length} WebP files in public/about/`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
