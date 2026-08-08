/**
 * Captures the web app for the /about/web guide.
 *
 * Runs against a dev server you start yourself (npm run dev), seeding
 * localStorage so each shot shows a specific, reproducible state rather than
 * whatever the calendar happens to open on. Keys and shapes below mirror
 * src/hooks/useFilterState.ts and src/hooks/useFavorites.ts — if those change,
 * this needs to change with them.
 *
 * Outputs are committed, so `npm run build` never depends on this running.
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
 * build, accepting that caveat.
 */
const BASE_URL = process.env.ABOUT_CAPTURE_URL ?? 'https://www.chqcal.org';
const VIEWPORT = { width: 1280, height: 900 };
const WIDTHS = [640, 1280];

const FILTER_KEY = 'chq-calendar-user-state';
const FAVORITES_KEY = 'chq-calendar-favorites';

/** Matches the object written by useFilterState's persistence effect. */
const baseFilterState = {
  searchTerm: '', selectedTags: [], selectedLocations: [], dateFilter: 'next',
  selectedWeeks: [], expandedDescriptions: [], recentLocations: [],
  recentCategories: [], showFavoritesOnly: false,
};

const SHOTS = [
  { id: '01-season', filters: {} },
  { id: '02-search', filters: { searchTerm: 'lecture' } },
  { id: '03-filters', filters: { selectedTags: ['Lecture'], dateFilter: 'all', selectedWeeks: [3, 4] } },
  { id: '04-favorites', filters: { showFavoritesOnly: true, dateFilter: 'all' }, favorites: true },
  { id: '05-calendar', filters: {}, openCalendar: true },
  { id: '06-weeks', filters: { dateFilter: 'all', selectedWeeks: [2, 3, 4] } },
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

/** Grabs real event ids from the loaded page so the favorites shot isn't empty. */
async function firstEventIds(page, count) {
  return page.evaluate((n) => {
    const nodes = document.querySelectorAll('[data-event-id]');
    return Array.from(nodes).slice(0, n).map((el) => el.getAttribute('data-event-id'));
  }, count);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // First pass: load once with no seeding to learn real event ids.
  const probe = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  await probe.goto(BASE_URL, { waitUntil: 'networkidle' });
  await probe.waitForSelector('[data-event-id]', { timeout: 30_000 });
  const favoriteIds = await firstEventIds(probe, 5);
  await probe.close();

  if (favoriteIds.length === 0) {
    throw new Error('No [data-event-id] elements found — is the dev server serving events?');
  }

  for (const shot of SHOTS) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: false });
    const page = await context.newPage();
    await seed(page, shot, favoriteIds);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-event-id]', { timeout: 30_000 });

    if (shot.openCalendar) {
      // The calendar popup only opens on a device the app considers desktop
      // (`isDesktop()` tests `(hover: hover) and (pointer: fine)`); on
      // anything else the same button downloads an .ics instead, silently
      // producing a shot of an unchanged list. Assert the menu is really
      // open rather than trusting the click.
      await page.locator('[data-event-id] [aria-label="Add to calendar"]').first().click();
      await page.waitForSelector('[role="menu"][aria-label="Add to calendar"]', { timeout: 5_000 });
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
